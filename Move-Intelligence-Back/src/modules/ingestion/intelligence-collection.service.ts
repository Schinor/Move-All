import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CollectionStatus, Prisma } from '@prisma/client';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService } from '../../shared/database/prisma.service';
import { RedisCacheService } from '../../shared/redis/redis-cache.service';
import { FichaService } from '../catalog/ficha.service';
import { ProductsService } from '../products/products.service';
import { DiscoverySearchService } from '../radar-discovery/discovery-search.service';
import { TrackingTiersService } from './tracking-tiers.service';
import { RunIntelligenceCollectionDto } from './dto/run-intelligence-collection.dto';
import { RunTrackListingsDto } from './dto/run-track-listings.dto';
import { RunWeeklyIntelligenceCollectionDto } from './dto/run-weekly-intelligence-collection.dto';

interface PipelineSummary {
  term: string;
  cluster: string;
  products: number;
  demand_signals: number;
  product_demand_links: number;
  product_ids: string[];
  failures: Array<{ scope: string; source: string; message: string }>;
  [key: string]: unknown;
}

const RESULT_PREFIX = 'MOVE_ETL_RESULT=';
const PROGRESS_PREFIX = 'MOVE_ETL_PROGRESS=';
const MAX_PROCESS_OUTPUT = 1_000_000;
const FULL_WEEKLY_CLUSTER_COUNT = 16;
const FULL_WEEKLY_TERM_COUNT = 47;
const TRACK_LISTINGS_CATEGORY = 'track_listings';
const TRACK_BATCH_LIMIT = 50;
const COLLECTION_CATEGORIES = [
  'bright_data_etl_v2',
  'bright_data_etl_v2_weekly',
  TRACK_LISTINGS_CATEGORY,
  'radar_discovery',
];

@Injectable()
export class IntelligenceCollectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fichas: FichaService,
    private readonly products: ProductsService,
    private readonly discovery: DiscoverySearchService,
    private readonly tiers: TrackingTiersService,
    private readonly cache?: RedisCacheService,
  ) {}

  async start(dto: RunIntelligenceCollectionDto) {
    const job = await this.prisma.collectionJob.create({
      data: {
        source: dto.sources.join(','),
        queryTerm: dto.term.trim(),
        category: 'bright_data_etl_v2',
        status: CollectionStatus.QUEUED,
        requestedBy: 'platform-ui',
        stats: this.toJson({
          sources: dto.sources,
          limit: dto.limit,
          geos: dto.geos ?? ['BR'],
          include_demand: dto.includeDemand === true,
          window_days: dto.windowDays,
        }),
      },
    });

    setImmediate(() => {
      void this.execute(job.id, dto);
    });
    return job;
  }

  /** Subprojeto D: coleta de um termo com categoria própria, esperando terminar (busca do radar). */
  async runTermAndWait(dto: RunIntelligenceCollectionDto, category: string) {
    const job = await this.prisma.collectionJob.create({
      data: {
        source: dto.sources.join(','),
        queryTerm: dto.term.trim(),
        category,
        status: CollectionStatus.QUEUED,
        requestedBy: 'radar-discovery',
        stats: this.toJson({
          sources: dto.sources,
          limit: dto.limit,
          geos: dto.geos ?? ['BR'],
          include_demand: dto.includeDemand === true,
          exact_term: dto.exactTerm === true,
          window_days: dto.windowDays,
        }),
      },
    });
    await this.execute(job.id, dto);
    return this.prisma.collectionJob.findUniqueOrThrow({ where: { id: job.id } });
  }

  async startWeekly(dto: RunWeeklyIntelligenceCollectionDto) {
    const weeklyStats = this.weeklyInitialStats(dto);
    let job;
    try {
      job = await this.prisma.$transaction(
        async (transaction) => {
          const active = await transaction.collectionJob.findFirst({
            where: {
              category: 'bright_data_etl_v2_weekly',
              status: { in: [CollectionStatus.QUEUED, CollectionStatus.RUNNING] },
            },
            orderBy: { createdAt: 'desc' },
          });
          if (active) {
            throw new ConflictException(`Já existe uma coleta semanal ativa: ${active.id}`);
          }
          return transaction.collectionJob.create({
            data: {
              source: dto.sources.join(','),
              queryTerm: 'Base semanal · catálogo completo',
              category: 'bright_data_etl_v2_weekly',
              status: CollectionStatus.QUEUED,
              requestedBy: 'platform-cli',
              stats: this.toJson(weeklyStats),
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new ConflictException('Outra coleta semanal foi iniciada simultaneamente.');
      }
      throw error;
    }

    setImmediate(() => {
      void this.executeWeekly(job.id, dto);
    });
    return job;
  }

  /**
   * Inicia o job de acompanhamento com o mesmo lock de "job ativo" da coleta
   * semanal: só um track-listings QUEUED/RUNNING por vez.
   */
  async startTrackListings(dto: RunTrackListingsDto) {
    let job;
    try {
      job = await this.prisma.$transaction(
        async (transaction) => {
          const active = await transaction.collectionJob.findFirst({
            where: {
              category: TRACK_LISTINGS_CATEGORY,
              status: { in: [CollectionStatus.QUEUED, CollectionStatus.RUNNING] },
            },
            orderBy: { createdAt: 'desc' },
          });
          if (active) {
            throw new ConflictException(`Já existe um acompanhamento ativo: ${active.id}`);
          }
          return transaction.collectionJob.create({
            data: {
              source: 'track-listings',
              queryTerm: 'Acompanhamento · anúncios vencidos',
              category: TRACK_LISTINGS_CATEGORY,
              status: CollectionStatus.QUEUED,
              requestedBy: 'scheduler-track',
              stats: this.toJson({ max_calls: dto.maxCalls }),
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new ConflictException('Outro acompanhamento foi iniciado simultaneamente.');
      }
      throw error;
    }

    setImmediate(() => {
      void this.executeTrackListings(job.id, dto);
    });
    return job;
  }

  async list(limit = 20) {
    const jobs = await this.prisma.collectionJob.findMany({
      where: { category: { in: COLLECTION_CATEGORIES } },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(limit, 50)),
    });
    return jobs.map((job) => this.presentJob(job));
  }

  async get(jobId: string) {
    const job = await this.prisma.collectionJob.findUnique({ where: { id: jobId } });
    if (!job || !job.category || !COLLECTION_CATEGORIES.includes(job.category)) {
      throw new NotFoundException(`Collection job not found: ${jobId}`);
    }
    return this.presentJob(job);
  }

  private async executeWeekly(
    jobId: string,
    dto: RunWeeklyIntelligenceCollectionDto,
  ) {
    await this.prisma.collectionJob.update({
      where: { id: jobId },
      data: { status: CollectionStatus.RUNNING, startedAt: new Date() },
    });

    // Subprojeto D: termos aprovados do radar antes da rotação normal. Falha aqui não derruba a semanal.
    let radarDiscovery: unknown;
    try {
      radarDiscovery = await this.discovery.runApproved({
        runTerm: (request, category) =>
          this.runTermAndWait(request as unknown as RunIntelligenceCollectionDto, category),
      });
    } catch (error) {
      radarDiscovery = { error: error instanceof Error ? error.message : String(error) };
    }

    let progressUpdate = Promise.resolve();
    try {
      const summary = await this.runPythonWeekly(dto, (progress) => {
        progressUpdate = progressUpdate
          .then(() =>
            this.prisma.collectionJob.update({
              where: { id: jobId },
              data: { stats: this.toJson({ ...this.weeklyInitialStats(dto), ...progress }) },
            }),
          )
          .then(() => undefined)
          .catch(() => undefined);
      });
      await progressUpdate;
      const analyticalSnapshots = await this.syncAnalyticalModels(summary.product_ids);
      const status =
        summary.failures.length > 0 ? CollectionStatus.PARTIAL : CollectionStatus.SUCCESS;
      // Lote oficial após a ingestão (F2.4, fire-and-forget como no CSV).
      this.scheduleRankingSimulation();
      await this.prisma.collectionJob.update({
        where: { id: jobId },
        data: {
          status,
          finishedAt: new Date(),
          stats: this.toJson({ ...summary, analytical_snapshots: analyticalSnapshots, radar_discovery: radarDiscovery }),
          errorMessage:
            status === CollectionStatus.PARTIAL
              ? summary.failures.map((failure) => failure.message).slice(0, 3).join('; ')
              : null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.collectionJob.update({
        where: { id: jobId },
        data: {
          status: CollectionStatus.FAILED,
          finishedAt: new Date(),
          errorMessage: message.slice(0, 2000),
        },
      });
    }
  }

  /**
   * Dispara o Monte Carlo em lote sem bloquear o job (fire-and-forget):
   * o score oficial é recalculado após qualquer ingestão.
   */
  private scheduleRankingSimulation(): void {
    void this.products
      .simulateBatchForRanking(TRACK_BATCH_LIMIT)
      .catch(() => undefined);
  }

  /**
   * Job de acompanhamento: roda o Python, sincroniza as observações em
   * snapshots analíticos (isSynthetic=false), registra anúncios na ficha,
   * dispara o Monte Carlo em lote e promove os tiers pelo score.
   */
  private async executeTrackListings(jobId: string, dto: RunTrackListingsDto) {
    await this.prisma.collectionJob.update({
      where: { id: jobId },
      data: { status: CollectionStatus.RUNNING, startedAt: new Date() },
    });

    try {
      const summary = await this.runPythonTrack(dto);
      const observationIds = Array.isArray(summary.observation_ids)
        ? (summary.observation_ids as string[]).filter(
            (id): id is string => typeof id === 'string' && !id.startsWith('dry-run:'),
          )
        : [];
      const synced = await this.syncObservationsToSnapshots(observationIds);
      const batch = await this.products.simulateBatchForRanking(TRACK_BATCH_LIMIT);
      const tiers = await this.tiers.recalculate();
      await this.cache?.delPattern('dashboard:trends:products:*');
      const failures = Array.isArray(summary.failures) ? summary.failures : [];
      const status =
        failures.length > 0 ? CollectionStatus.PARTIAL : CollectionStatus.SUCCESS;
      await this.prisma.collectionJob.update({
        where: { id: jobId },
        data: {
          status,
          finishedAt: new Date(),
          stats: this.toJson({ ...summary, ...synced, monte_carlo_batch: batch, tiers }),
          errorMessage:
            status === CollectionStatus.PARTIAL
              ? failures.map((failure) => String(failure)).slice(0, 3).join('; ')
              : null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.collectionJob.update({
        where: { id: jobId },
        data: {
          status: CollectionStatus.FAILED,
          finishedAt: new Date(),
          errorMessage: message.slice(0, 2000),
        },
      });
    }
  }

  private async execute(jobId: string, dto: RunIntelligenceCollectionDto) {    await this.prisma.collectionJob.update({
      where: { id: jobId },
      data: { status: CollectionStatus.RUNNING, startedAt: new Date() },
    });

    try {
      const summary = await this.runPython(dto);
      const analyticalSnapshots = await this.syncAnalyticalModels(summary.product_ids);
      const status =
        summary.failures.length > 0 ? CollectionStatus.PARTIAL : CollectionStatus.SUCCESS;

      // Lote oficial após a ingestão (F2.4, fire-and-forget como no CSV).
      this.scheduleRankingSimulation();
      await this.prisma.collectionJob.update({
        where: { id: jobId },
        data: {
          status,
          finishedAt: new Date(),
          stats: this.toJson({ ...summary, analytical_snapshots: analyticalSnapshots }),
          errorMessage:
            status === CollectionStatus.PARTIAL
              ? summary.failures.map((failure) => failure.message).slice(0, 3).join('; ')
              : null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.collectionJob.update({
        where: { id: jobId },
        data: {
          status: CollectionStatus.FAILED,
          finishedAt: new Date(),
          errorMessage: message.slice(0, 2000),
        },
      });
    }
  }

  private runPython(dto: RunIntelligenceCollectionDto): Promise<PipelineSummary> {
    const dataDirectory = resolve(
      process.env.MOVE_INTELLIGENCE_DATA_DIR ??
        resolve(process.cwd(), '..', 'Move-Intelligence-Dados'),
    );
    const mainFile = resolve(dataDirectory, 'main.py');
    if (!existsSync(mainFile)) {
      throw new Error(`Move-Intelligence-Dados não encontrado em ${dataDirectory}`);
    }

    const python = process.env.PYTHON_BIN || 'python3';
    const args = this.buildLiveArgs(mainFile, dto);

    return new Promise((resolvePromise, reject) => {
      const child = spawn(python, args, {
        cwd: dataDirectory,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          MOVE_ETL_DATABASE_URL: this.etlDatabaseUrl(),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => {
        stdout = (stdout + chunk.toString()).slice(-MAX_PROCESS_OUTPUT);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-MAX_PROCESS_OUTPUT);
      });
      child.on('error', (error) => reject(error));
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(this.processError(stderr || stdout, code)));
          return;
        }
        const resultLine = stdout
          .split(/\r?\n/)
          .reverse()
          .find((line) => line.startsWith(RESULT_PREFIX));
        if (!resultLine) {
          reject(new Error('O ETL terminou sem emitir o resumo estruturado.'));
          return;
        }
        try {
          resolvePromise(JSON.parse(resultLine.slice(RESULT_PREFIX.length)) as PipelineSummary);
        } catch {
          reject(new Error('O resumo emitido pelo ETL não é um JSON válido.'));
        }
      });
    });
  }

  private buildLiveArgs(mainFile: string, dto: RunIntelligenceCollectionDto): string[] {
    const args = [
      mainFile,
      '--pipeline',
      'live-intelligence',
      '--term',
      dto.term.trim(),
      '--sources',
      dto.sources.join(','),
      '--limit',
      String(dto.limit),
      '--geos',
      (dto.geos ?? ['BR']).join(','),
      '--window-days',
      String(dto.windowDays),
    ];
    if (dto.includeDemand === false) {
      args.push('--skip-demand');
    }
    if (dto.exactTerm === true) args.push('--exact-term');
    return args;
  }

  private runPythonWeekly(
    dto: RunWeeklyIntelligenceCollectionDto,
    onProgress?: (progress: Record<string, unknown>) => void,
  ): Promise<PipelineSummary> {
    const dataDirectory = resolve(
      process.env.MOVE_INTELLIGENCE_DATA_DIR ??
        resolve(process.cwd(), '..', 'Move-Intelligence-Dados'),
    );
    const mainFile = resolve(dataDirectory, 'main.py');
    if (!existsSync(mainFile)) {
      throw new Error(`Move-Intelligence-Dados não encontrado em ${dataDirectory}`);
    }

    const args = [
      mainFile,
      '--pipeline',
      'weekly-intelligence',
      '--sources',
      dto.sources.join(','),
      '--limit',
      String(dto.limit),
      '--geos',
      dto.geos.join(','),
      '--window-days',
      '7',
      '--keyword-depth',
      dto.keywordDepth,
    ];
    if (dto.includeDemand === false) args.push('--skip-demand');
    if (dto.clusters?.length) args.push('--clusters', dto.clusters.join(','));
    if (dto.maxTerms) args.push('--max-terms', String(dto.maxTerms));

    return this.spawnPython(dataDirectory, args, onProgress);
  }

  private runPythonTrack(dto: RunTrackListingsDto): Promise<PipelineSummary> {    const dataDirectory = resolve(
      process.env.MOVE_INTELLIGENCE_DATA_DIR ??
        resolve(process.cwd(), '..', 'Move-Intelligence-Dados'),
    );
    const mainFile = resolve(dataDirectory, 'main.py');
    if (!existsSync(mainFile)) {
      throw new Error(`Move-Intelligence-Dados não encontrado em ${dataDirectory}`);
    }
    return this.spawnPython(dataDirectory, [
      mainFile,
      '--pipeline',
      'track-listings',
      '--max-calls',
      String(dto.maxCalls),
    ]);
  }

  /**
   * Atualiza `exchange_rates` via PTAX (F1.7). Upsert idempotente no Python;
   * sem lock de job (pode rodar todo dia sem risco de duplicar).
   */
  async refreshExchangeRates(): Promise<PipelineSummary> {
    const dataDirectory = resolve(
      process.env.MOVE_INTELLIGENCE_DATA_DIR ??
        resolve(process.cwd(), '..', 'Move-Intelligence-Dados'),
    );
    const mainFile = resolve(dataDirectory, 'main.py');
    if (!existsSync(mainFile)) {
      throw new Error(`Move-Intelligence-Dados não encontrado em ${dataDirectory}`);
    }
    return this.spawnPython(dataDirectory, [mainFile, '--pipeline', 'exchange-rates']);
  }

  /**
   * Sincroniza observações do acompanhamento em `product_listing_snapshots`
   * (sempre `isSynthetic=false`: é coleta real) e vincula anúncios sem
   * produto canônico via matching. Observações sem preço (blocked/not_found)
   * não viram snapshot — não há o que agregar.
   */
  private async syncObservationsToSnapshots(
    observationIds: string[],
  ): Promise<{ analytical_snapshots: number; registered_listings: number }> {
    if (observationIds.length === 0) {
      return { analytical_snapshots: 0, registered_listings: 0 };
    }
    const observations = await this.prisma.listingObservation.findMany({
      where: { id: { in: observationIds } },
      include: { listing: true },
      take: observationIds.length,
    });

    let snapshots = 0;
    let registered = 0;
    for (const observation of observations) {
      // A3.1: preço suspeito não entra no ranking — só observações com
      // scrapeStatus 'ok' viram snapshot ('partial'/'blocked'/'not_found'
      // ficam só no histórico do anúncio).
      if (observation.scrapeStatus !== 'ok') {
        continue;
      }
      if (observation.price === null || observation.price === undefined) {
        continue;
      }
      const listing = observation.listing;
      const price = Number(observation.price);
      if (!Number.isFinite(price) || price <= 0) {
        continue;
      }
      let productClusterId = listing.productId;
      if (!productClusterId) {
        const discovered = await this.prisma.intelligenceProduct.findFirst({
          where: { source: listing.source, recordId: listing.nativeId },
          orderBy: { capturedAt: 'desc' },
        });
        const specific = this.asRecord(discovered?.sourceSpecific);
        await this.fichas.registerListing({
          marketplace: listing.source,
          externalProductId: listing.nativeId,
          title: discovered?.title ?? listing.canonicalUrl,
          excerpt: typeof specific['page_excerpt'] === 'string' ? (specific['page_excerpt'] as string) : null,
        });
        productClusterId = await this.fichas.currentCardId({ marketplace: listing.source, externalProductId: listing.nativeId });
        registered += 1;
      }
      const soldRaw = observation.soldCountLower;
      const data = {
        productClusterId,
        title: listing.canonicalUrl,
        priceMin: observation.price,
        priceMax: observation.price,
        currency: observation.currency,
        rating: observation.rating,
        reviewCount: observation.reviewsCount,
        salesSignalRaw: soldRaw === null || soldRaw === undefined ? null : soldRaw,
        salesSignalType: soldRaw === null || soldRaw === undefined ? null : 'units_sold',
        // Vendedor real não foi raspado nesta fase — null, nunca inventado.
        sellerName: null,
        imageCount: 0,
        imageUrl: null,
        productUrl: listing.canonicalUrl,
        rawProductId: null,
        collectedAt: observation.observedAt,
        isSynthetic: false,
      };
      const existing = await this.prisma.productListingSnapshot.findFirst({
        where: {
          marketplace: listing.source,
          externalProductId: listing.nativeId,
          collectedAt: observation.observedAt,
        },
      });
      if (existing) {
        await this.prisma.productListingSnapshot.update({ where: { id: existing.id }, data });
      } else {
        await this.prisma.productListingSnapshot.create({
          data: {
            marketplace: listing.source,
            externalProductId: listing.nativeId,
            ...data,
          },
        });
      }
      snapshots += 1;
    }
    if (snapshots > 0) {
      await this.cache?.delPattern('dashboard:trends:products:*');
    }
    return { analytical_snapshots: snapshots, registered_listings: registered };
  }

  private spawnPython(
    dataDirectory: string,
    args: string[],
    onProgress?: (progress: Record<string, unknown>) => void,
  ): Promise<PipelineSummary> {
    const python = process.env.PYTHON_BIN || 'python3';
    return new Promise((resolvePromise, reject) => {
      const child = spawn(python, args, {
        cwd: dataDirectory,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          MOVE_ETL_DATABASE_URL: this.etlDatabaseUrl(),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let pendingLine = '';
      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout = (stdout + text).slice(-MAX_PROCESS_OUTPUT);
        const lines = (pendingLine + text).split(/\r?\n/);
        pendingLine = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith(PROGRESS_PREFIX) || !onProgress) continue;
          try {
            onProgress(
              JSON.parse(line.slice(PROGRESS_PREFIX.length)) as Record<string, unknown>,
            );
          } catch {
            // Progresso inválido não interfere no resultado final estruturado.
          }
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-MAX_PROCESS_OUTPUT);
      });
      child.on('error', (error) => reject(error));
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(this.processError(stderr || stdout, code)));
          return;
        }
        const resultLine = stdout
          .split(/\r?\n/)
          .reverse()
          .find((line) => line.startsWith(RESULT_PREFIX));
        if (!resultLine) {
          reject(new Error('O ETL terminou sem emitir o resumo estruturado.'));
          return;
        }
        try {
          resolvePromise(JSON.parse(resultLine.slice(RESULT_PREFIX.length)) as PipelineSummary);
        } catch {
          reject(new Error('O resumo emitido pelo ETL não é um JSON válido.'));
        }
      });
    });
  }


  private async syncAnalyticalModels(productIds: string[]): Promise<number> {
    if (productIds.length === 0) {
      return 0;
    }
    let synchronized = 0;
    for (let offset = 0; offset < productIds.length; offset += 100) {
      const ids = productIds.slice(offset, offset + 100);
      const products = await this.prisma.intelligenceProduct.findMany({
        where: { id: { in: ids } },
        take: ids.length,
      });
      const existingSnapshots = await this.prisma.productListingSnapshot.findMany({
        where: { rawProductId: { in: ids } },
        orderBy: { collectedAt: 'desc' },
        take: ids.length * 2,
      });
      const existingByRawId = new Map(
        existingSnapshots.map((snapshot) => [snapshot.rawProductId, snapshot]),
      );
      const writes = [];
      for (const product of products) {
        const evidence = this.asRecord(product.sourceSpecific);
        const listingRef = { marketplace: product.source, externalProductId: product.recordId };
        const specificForFicha = this.asRecord(product.sourceSpecific);
        await this.fichas.registerListing({
          ...listingRef,
          title: product.title,
          excerpt: typeof specificForFicha['page_excerpt'] === 'string' ? (specificForFicha['page_excerpt'] as string) : null,
        });
        const clusterId = await this.fichas.currentCardId(listingRef);
        const rawFields = this.asRecord(evidence['_raw_record_fields']);
        const imageUrl =
          this.firstString(rawFields['image_url']) ||
          this.firstString(evidence['image_url']) ||
          this.firstArrayString(rawFields['image_urls']) ||
          this.firstArrayString(evidence['image_urls']);
        const productUrl =
          this.firstString(rawFields['source_page_url']) ||
          this.firstString(rawFields['url']) ||
          this.firstString(evidence['source_page_url']);
        const data = {
          productClusterId: clusterId,
          title: product.title,
          priceMin: product.priceValue,
          priceMax: product.priceValue,
          currency: product.priceCurrency,
          moq: product.moq,
          rating: product.rating,
          reviewCount: product.reviewsCount,
          salesSignalRaw: product.monthlySales,
          salesSignalType: product.monthlySales === null ? null : 'units_sold',
          sellerName: product.supplier,
          imageCount: imageUrl ? 1 : 0,
          imageUrl,
          productUrl,
          rawProductId: product.id,
          // Propaga a flag do produto sintético para o snapshot, para que o
          // rollup do ranking possa excluí-lo quando INCLUDE_SYNTHETIC_DATA=false.
          isSynthetic: product.isSynthetic,
        };
        const existing = existingByRawId.get(product.id);
        writes.push(
          existing
            ? this.prisma.productListingSnapshot.update({ where: { id: existing.id }, data })
            : this.prisma.productListingSnapshot.create({
                data: {
                  marketplace: product.source,
                  externalProductId: product.recordId,
                  collectedAt: product.capturedAt,
                  ...data,
                },
              }),
        );
      }
      if (writes.length) await this.prisma.$transaction(writes);
      synchronized += products.length;
    }
    if (synchronized > 0) {
      await this.cache?.delPattern('dashboard:trends:products:*');
    }
    return synchronized;
  }

  private processError(output: string, code: number | null): string {
    const lines = output.trim().split(/\r?\n/).filter(Boolean);
    const explicit = [...lines]
      .reverse()
      .find((line) =>
        /(?:RuntimeError|ValueError|BrightDataRequestError|BrightDataMcpError):/.test(line),
      );
    if (explicit) {
      return explicit
        .replace(
          /^.*?(?=(?:RuntimeError|ValueError|BrightDataRequestError|BrightDataMcpError):)/,
          '',
        )
        .slice(0, 4000);
    }
    return (lines.slice(-3).join(' ') || `ETL encerrado com código ${code}`).slice(0, 4000);
  }

  private etlDatabaseUrl(): string {
    const configured = process.env.DATABASE_URL ?? process.env.MOVE_ETL_DATABASE_URL;
    if (!configured) return '';
    try {
      const parsed = new URL(configured);
      parsed.searchParams.delete('schema');
      return parsed.toString();
    } catch {
      return configured;
    }
  }

  private presentJob<T extends { errorMessage: string | null }>(job: T): T {
    if (!job.errorMessage) return job;
    let errorMessage = job.errorMessage;
    if (
      /api\.brightdata\.com/.test(errorMessage) &&
      /Connection refused|Failed to establish a new connection/.test(errorMessage)
    ) {
      errorMessage =
        'A rede local bloqueou a conexão com api.brightdata.com. Verifique DNS, VPN ou firewall e tente novamente.';
    } else if (/MCP Bright Data .+não encontrado|BRIGHTDATA_MCP_URL não configurada/.test(errorMessage)) {
      errorMessage =
        'A conexão MCP Bright Data não está disponível no servidor. Configure BRIGHTDATA_MCP_URL ou habilite a descoberta local.';
    } else if (/BRIGHTDATA_.+não configurada/.test(errorMessage)) {
      errorMessage =
        'Credenciais Bright Data incompletas em Move-Intelligence-Dados/.env.';
    }
    return { ...job, errorMessage };
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private firstString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private firstArrayString(value: unknown): string | null {
    return Array.isArray(value)
      ? value.find((item): item is string => typeof item === 'string' && Boolean(item.trim())) ?? null
      : null;
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private weeklyInitialStats(
    dto: RunWeeklyIntelligenceCollectionDto,
  ): Record<string, unknown> {
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd);
    windowStart.setUTCDate(windowStart.getUTCDate() - 6);
    const clusterCount = dto.clusters?.length ?? FULL_WEEKLY_CLUSTER_COUNT;
    const termsRequested =
      dto.maxTerms ??
      (dto.keywordDepth === 'canonical'
        ? clusterCount
        : dto.clusters
          ? clusterCount * 3
          : FULL_WEEKLY_TERM_COUNT);

    return {
      mode: 'weekly',
      sources: dto.sources,
      limit: dto.limit,
      geos: dto.geos,
      include_demand: dto.includeDemand,
      keyword_depth: dto.keywordDepth,
      window_days: 7,
      window_start: windowStart.toISOString().slice(0, 10),
      window_end: windowEnd.toISOString().slice(0, 10),
      clusters: dto.clusters ?? 'all',
      clusters_requested: clusterCount,
      terms_requested: termsRequested,
      terms_completed: 0,
      unique_products: 0,
      demand_signals: 0,
      failures: 0,
    };
  }
}
