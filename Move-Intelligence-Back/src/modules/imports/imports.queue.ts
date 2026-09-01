import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { AppConfigService } from '../../shared/config/app-config.service';
import { ImportsProcessor } from './imports.processor';

const QUEUE_NAME = 'imports';
const CONNECT_TIMEOUT_MS = 2000;

interface ImportJobData {
  jobId: string;
}

interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  maxRetriesPerRequest: null;
}

function parseRedisUrl(redisUrl: string): RedisConnectionOptions {
  const url = new URL(redisUrl);
  const opts: RedisConnectionOptions = {
    host: url.hostname || 'localhost',
    port: Number(url.port || 6379),
    maxRetriesPerRequest: null,
  };
  if (url.username) {
    opts.username = url.username;
  }
  if (url.password) {
    opts.password = url.password;
  }
  const dbPath = url.pathname.replace(/^\//, '');
  if (dbPath) {
    opts.db = Number(dbPath);
  }
  return opts;
}

/**
 * Enfileira o processamento de importações no BullMQ/Redis. Se o Redis não
 * estiver disponível (ou desabilitado por config), cai para processamento
 * SÍNCRONO in-process, mantendo a mesma interface de status — conforme o
 * fallback previsto no plano para o MVP.
 */
@Injectable()
export class ImportsQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImportsQueue.name);
  private queue?: Queue<ImportJobData>;
  private worker?: Worker<ImportJobData>;
  private queueReady = false;

  constructor(
    private readonly config: AppConfigService,
    private readonly processor: ImportsProcessor,
  ) {}

  async onModuleInit(): Promise<void> {
    const useQueue = this.config.get<boolean>('imports.useQueue');
    if (useQueue === false) {
      this.logger.log(
        'Fila desabilitada por configuração — importações rodarão de forma síncrona.',
      );
      return;
    }

    const redisUrl =
      this.config.get<string>('redis.url') ?? 'redis://localhost:6379';

    // Probe rápido: verifica disponibilidade do Redis sem travar o boot.
    const probe = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
      retryStrategy: (times) => (times > 3 ? null : 200),
    });

    try {
      await this.withTimeout(probe.connect(), CONNECT_TIMEOUT_MS);
      await probe.ping();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'motivo desconhecido';
      this.logger.warn(
        `Redis indisponível (${message}) — usando processamento síncrono in-process.`,
      );
      probe.disconnect();
      return;
    }
    probe.disconnect();

    // BullMQ gerencia a própria conexão (usa a cópia de ioredis que ele traz).
    const connection = parseRedisUrl(redisUrl);
    this.queue = new Queue<ImportJobData>(QUEUE_NAME, { connection });
    this.worker = new Worker<ImportJobData>(
      QUEUE_NAME,
      async (job: Job<ImportJobData>) => {
        await this.processor.process(job.data.jobId);
      },
      { connection },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Job da fila falhou (${job?.data.jobId ?? '?'}): ${err.message}`,
      );
    });
    this.queueReady = true;
    this.logger.log('Fila BullMQ conectada ao Redis.');
  }

  /** True quando o processamento roda via fila (assíncrono). */
  get usingQueue(): boolean {
    return this.queueReady;
  }

  /**
   * Enfileira (ou processa inline) um job de importação.
   * No modo inline o processamento roda em background, sem bloquear a resposta.
   */
  async enqueue(jobId: string): Promise<void> {
    if (this.queueReady && this.queue) {
      await this.queue.add('process', { jobId }, { removeOnComplete: true });
      return;
    }
    // Fallback síncrono: dispara sem aguardar; o status é rastreado no banco.
    void this.processor.process(jobId).catch((error) => {
      this.logger.error(
        `Processamento inline do job ${jobId} falhou: ${
          error instanceof Error ? error.message : error
        }`,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), ms),
      ),
    ]);
  }
}
