import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, extname, join } from 'node:path';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ImportSourceType, ImportStatus } from '@prisma/client';
import { AppConfigService } from '../../shared/config/app-config.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { UploadedImportFile } from './dto/create-import.dto';
import { ImportsQueue } from './imports.queue';
import { ALLOWED_EXTENSIONS } from './source-detector';

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly queue: ImportsQueue,
  ) {}

  /**
   * Recebe o arquivo do upload: valida, persiste o bruto em disco, cria o
   * `ImportJob` e enfileira o processamento.
   */
  async createFromUpload(file: UploadedImportFile) {
    this.validate(file);

    const jobId = randomUUID();
    const safeName = this.safeFilename(file.originalName);
    const dir = join(this.storageDir(), jobId);
    const storagePath = join(dir, safeName);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(storagePath, file.buffer);

    const job = await this.prisma.importJob.create({
      data: {
        id: jobId,
        filename: safeName,
        originalName: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: file.buffer.length,
        sourceType: file.sourceType,
        status: ImportStatus.RECEIVED,
        storagePath,
      },
    });

    await this.queue.enqueue(jobId);

    return {
      jobId: job.id,
      status: job.status,
      mode: this.queue.usingQueue ? 'queued' : 'inline',
    };
  }

  /** Lista jobs de importação, mais recentes primeiro. */
  async list(skip = 0, take = 20) {
    const safeTake = Math.min(Math.max(take, 1), 100);
    const [items, total] = await Promise.all([
      this.prisma.importJob.findMany({
        orderBy: { createdAt: 'desc' },
        skip: Math.max(skip, 0),
        take: safeTake,
      }),
      this.prisma.importJob.count(),
    ]);
    return { items, total, skip, take: safeTake };
  }

  /** Status + erros de um job específico. */
  async getById(id: string) {
    const job = await this.prisma.importJob.findUnique({ where: { id } });
    if (!job) {
      throw new NotFoundException(`Importação não encontrada: ${id}`);
    }
    return job;
  }

  /** Reprocessa somente enquanto o arquivo temporário ainda estiver disponível. */
  async reprocess(id: string) {
    const job = await this.getById(id);
    await fs.access(job.storagePath).catch(() => {
      throw new BadRequestException(
        'Arquivo bruto não disponível para reprocessamento.',
      );
    });

    await this.prisma.importJob.update({
      where: { id },
      data: {
        status: ImportStatus.RECEIVED,
        rowsTotal: 0,
        rowsImported: 0,
        rowsRejected: 0,
        errorSummary: undefined,
        startedAt: null,
        finishedAt: null,
      },
    });

    await this.queue.enqueue(id);
    return { jobId: id, status: ImportStatus.RECEIVED };
  }

  private validate(file: UploadedImportFile): void {
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Arquivo vazio.');
    }

    const ext = extname(file.originalName).toLowerCase();
    if (
      !ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number])
    ) {
      throw new BadRequestException(
        `Extensão não suportada: "${ext}". Aceitos: ${ALLOWED_EXTENSIONS.join(', ')}.`,
      );
    }

    const maxBytes =
      this.config.get<number>('imports.maxUploadBytes') ?? 20 * 1024 * 1024;
    if (file.buffer.length > maxBytes) {
      throw new PayloadTooLargeException(
        `Arquivo excede o limite de ${(maxBytes / (1024 * 1024)).toFixed(0)} MB.`,
      );
    }
  }

  private storageDir(): string {
    return (
      this.config.get<string>('imports.storageDir') ??
      join(process.cwd(), 'storage', 'imports')
    );
  }

  private safeFilename(originalName: string): string {
    const base = basename(originalName).replace(/[^\w.-]+/g, '_');
    return base === '' ? 'upload' : base;
  }
}

export function resolveSourceType(value: unknown): ImportSourceType {
  if (typeof value !== 'string' || value.trim() === '') {
    return ImportSourceType.AUTO;
  }
  const upper = value.trim().toUpperCase();
  if ((Object.values(ImportSourceType) as string[]).includes(upper)) {
    return upper as ImportSourceType;
  }
  throw new BadRequestException(`sourceType inválido: "${value}".`);
}
