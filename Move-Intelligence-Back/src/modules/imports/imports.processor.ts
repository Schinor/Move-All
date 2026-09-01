import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ImportSourceType, ImportStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { ProductsService } from '../products/products.service';
import { parseComex } from './parsers/comex.parser';
import { parseTradeAtlas } from './parsers/trade-atlas.parser';
import { parseAlibaba } from './parsers/alibaba.parser';
import { parseAmazonProducts } from './parsers/amazon-products.parser';
import { parseAmazonSellers } from './parsers/amazon-sellers.parser';
import { parseGoogleShopping } from './parsers/google-shopping.parser';
import { parseShein } from './parsers/shein.parser';
import { parseTiktokShop } from './parsers/tiktok-shop.parser';
import { xlsxToText } from './parsers/xlsx.parser';
import {
  MarketplaceParseResult,
  ParsedMarketplaceListing,
  RowError,
} from './parsers/parser.types';
import { detectSourceType, isXlsx } from './source-detector';
import { isFitnessProduct } from '../../shared/domain/fitness-scope';

/** Parsers das fontes de marketplace (CSVs Bright Data), por tipo de fonte. */
const MARKETPLACE_PARSERS: Partial<
  Record<ImportSourceType, (content: string) => MarketplaceParseResult>
> = {
  [ImportSourceType.TIKTOK_SHOP]: parseTiktokShop,
  [ImportSourceType.SHEIN]: parseShein,
  [ImportSourceType.GOOGLE_SHOPPING]: parseGoogleShopping,
  [ImportSourceType.AMAZON_PRODUCTS]: parseAmazonProducts,
  [ImportSourceType.AMAZON_SELLERS]: parseAmazonSellers,
  [ImportSourceType.ALIBABA]: parseAlibaba,
};

/** Limite de erros persistidos em `errorSummary` para não estourar o JSON. */
const MAX_PERSISTED_ERRORS = 200;
/** Concorrência de upserts por lote. */
const UPSERT_CONCURRENCY = 25;
/** Clusters simulados no Monte Carlo disparado ao fim de um import de marketplace. */
const POST_IMPORT_SIMULATION_LIMIT = 50;

@Injectable()
export class ImportsProcessor {
  private readonly logger = new Logger(ImportsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
  ) {}

  /**
   * Processa um `ImportJob`: lê o arquivo bruto, detecta o tipo, parseia e
   * persiste os registros de forma idempotente (upsert por chave natural).
   * Uma linha rejeitada NÃO aborta o job — vai para `errorSummary`.
   */
  async process(jobId: string): Promise<void> {
    const job = await this.prisma.importJob.findUnique({
      where: { id: jobId },
    });
    if (!job) {
      throw new NotFoundException(`ImportJob não encontrado: ${jobId}`);
    }

    await this.prisma.importJob.update({
      where: { id: jobId },
      data: { status: ImportStatus.PROCESSING, startedAt: new Date() },
    });

    try {
      const buffer = await fs.readFile(job.storagePath);
      const text = isXlsx(job.originalName, job.mimeType, buffer)
        ? await xlsxToText(buffer)
        : buffer.toString('utf8');

      const family =
        job.sourceType === ImportSourceType.AUTO
          ? detectSourceType(text)
          : job.sourceType;

      let rowsTotal = 0;
      let rowsImported = 0;
      let errors: RowError[] = [];
      let detectedType: ImportSourceType = family;
      let isMarketplaceImport = false;

      const marketplaceParser = MARKETPLACE_PARSERS[family];

      if (
        family === ImportSourceType.COMEX_ANUAL ||
        family === ImportSourceType.COMEX_MENSAL
      ) {
        const result = parseComex(text);
        detectedType = result.sourceType;
        rowsTotal = result.rowsTotal;
        errors = result.errors;
        rowsImported = await this.persistTradeExports(result.rows, jobId);
      } else if (marketplaceParser) {
        const result = marketplaceParser(text);
        detectedType = result.sourceType;
        rowsTotal = result.rowsTotal;
        errors = result.errors;
        const fitnessRows = result.rows.filter((listing) =>
          isFitnessProduct({
            category: listing.category,
            title: listing.title,
          }),
        );
        const filteredCount = result.rows.length - fitnessRows.length;
        if (filteredCount > 0) {
          this.logger.log(
            `ImportJob ${jobId}: ${filteredCount} anúncios fora do escopo fitness foram ignorados.`,
          );
        }
        rowsImported = await this.persistMarketplace(
          { ...result, rows: fitnessRows },
          jobId,
        );
        isMarketplaceImport = true;
      } else {
        const result = parseTradeAtlas(text);
        detectedType = result.sourceType;
        rowsTotal = result.rowsTotal;
        errors = result.errors;
        rowsImported = await this.persistShipments(result.rows, jobId);
      }

      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: ImportStatus.DONE,
          detectedType,
          rowsTotal,
          rowsImported,
          rowsRejected: errors.length,
          errorSummary: this.buildErrorSummary(errors),
          finishedAt: new Date(),
        },
      });

      this.logger.log(
        `ImportJob ${jobId} concluído: ${rowsImported}/${rowsTotal} importados, ${errors.length} rejeitados (${detectedType}).`,
      );

      if (isMarketplaceImport && rowsImported > 0) {
        this.scheduleRankingSimulation(jobId);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Erro desconhecido';
      this.logger.error(`ImportJob ${jobId} falhou: ${message}`);
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: ImportStatus.FAILED,
          errorSummary: this.toJson({ fatal: message }),
          finishedAt: new Date(),
        },
      });
      throw error;
    } finally {
      await this.discardRawFile(jobId, job.storagePath);
    }
  }

  /**
   * O arquivo de upload é apenas transporte. Depois do parse, os dados e o
   * histórico ficam no PostgreSQL e o bruto é removido do filesystem.
   */
  private async discardRawFile(jobId: string, storagePath: string): Promise<void> {
    await fs.rm(storagePath, { force: true }).catch((error: unknown) => {
      this.logger.warn(
        `Não foi possível remover o arquivo temporário do import ${jobId}: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
    });
    await fs.rmdir(dirname(storagePath)).catch(() => undefined);
    await this.prisma.importJob.update({
      where: { id: jobId },
      data: { storagePath: `database://import-jobs/${jobId}` },
    });
  }

  /**
   * Dispara o Monte Carlo em lote sem bloquear a conclusão do import
   * (fire-and-forget): o ranking passa a ter risco simulado nos clusters novos.
   */
  private scheduleRankingSimulation(jobId: string): void {
    void this.products
      .simulateBatchForRanking(POST_IMPORT_SIMULATION_LIMIT)
      .then((summary) => {
        this.logger.log(
          `Monte Carlo pós-import ${jobId}: ${summary.simulated} simulados, ${summary.failed} falhas.`,
        );
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Monte Carlo pós-import ${jobId} falhou: ${
            error instanceof Error ? error.message : 'erro desconhecido'
          }`,
        );
      });
  }

  private async persistTradeExports(
    rows: Array<ReturnType<typeof parseComex>['rows'][number]>,
    importJobId: string,
  ): Promise<number> {
    let imported = 0;
    for (const batch of chunk(rows, UPSERT_CONCURRENCY)) {
      await Promise.all(
        batch.map(async (row) => {
          await this.prisma.tradeExport.upsert({
            where: { naturalKey: row.naturalKey },
            create: { ...row, importJobId },
            update: {
              ncmDescription: row.ncmDescription,
              year: row.year,
              month: row.month,
              country: row.country,
              state: row.state,
              fobUsd: row.fobUsd,
              netKg: row.netKg,
              importJobId,
            },
          });
          imported += 1;
        }),
      );
    }
    return imported;
  }

  private async persistShipments(
    rows: Array<ReturnType<typeof parseTradeAtlas>['rows'][number]>,
    importJobId: string,
  ): Promise<number> {
    let imported = 0;
    for (const batch of chunk(rows, UPSERT_CONCURRENCY)) {
      await Promise.all(
        batch.map(async (row) => {
          const { naturalKey, ...rest } = row;
          await this.prisma.shipment.upsert({
            where: { naturalKey },
            create: { naturalKey, ...rest, importJobId },
            update: { ...rest, importJobId },
          });
          imported += 1;
        }),
      );
    }
    return imported;
  }

  /**
   * Persiste um resultado de marketplace (CSV Bright Data):
   * anúncios → `ProductListingSnapshot` (+ cluster trivial) e vendedores →
   * `MarketplaceSeller`. Idempotente: os snapshots do job são apagados antes
   * da reinserção, então reprocessar o mesmo job não duplica histórico.
   */
  private async persistMarketplace(
    result: MarketplaceParseResult,
    importJobId: string,
  ): Promise<number> {
    await this.prisma.productListingSnapshot.deleteMany({
      where: { importJobId },
    });

    let imported = 0;
    for (const batch of chunk(result.rows, UPSERT_CONCURRENCY)) {
      await Promise.all(
        batch.map(async (listing) => {
          const productClusterId =
            await this.findOrCreateTrivialCluster(listing);
          await this.prisma.productListingSnapshot.create({
            data: {
              marketplace: listing.marketplace,
              externalProductId: listing.externalProductId,
              productClusterId,
              title: listing.title,
              priceMin: listing.priceMin,
              priceMax: listing.priceMax,
              currency: listing.currency,
              moq: listing.moq,
              stock: listing.stock,
              rating: listing.rating,
              reviewCount: listing.reviewCount,
              salesSignalRaw: listing.salesSignalRaw,
              salesSignalType: listing.salesSignalType,
              sellerId: listing.sellerId,
              sellerName: listing.sellerName,
              imageCount: listing.imageCount,
              importJobId,
            },
          });
          imported += 1;
        }),
      );
    }

    for (const batch of chunk(result.sellers, UPSERT_CONCURRENCY)) {
      await Promise.all(
        batch.map(async (seller) => {
          const { marketplace, externalSellerId, ...rest } = seller;
          await this.prisma.marketplaceSeller.upsert({
            where: {
              marketplace_externalSellerId: { marketplace, externalSellerId },
            },
            create: { marketplace, externalSellerId, ...rest, importJobId },
            update: { ...rest, importJobId },
          });
          imported += 1;
        }),
      );
    }

    return imported;
  }

  /**
   * Encontra (ou cria) o cluster trivial de um anúncio — mesma lógica de
   * `ProductMatchingService.findOrCreateTrivialCluster`, aqui via `this.prisma`
   * para não acoplar o módulo de imports ao de product-matching.
   */
  private async findOrCreateTrivialCluster(
    listing: ParsedMarketplaceListing,
  ): Promise<string> {
    const existing = await this.prisma.productClusterItem.findUnique({
      where: {
        marketplace_externalProductId: {
          marketplace: listing.marketplace,
          externalProductId: listing.externalProductId,
        },
      },
    });
    if (existing) {
      return existing.clusterId;
    }

    const cluster = await this.prisma.productCluster.create({
      data: {
        canonicalName: listing.title.trim().toLowerCase(),
        category: listing.category,
        confidenceScore: 1,
        items: {
          create: {
            marketplace: listing.marketplace,
            externalProductId: listing.externalProductId,
            similarityScore: 1,
          },
        },
      },
    });
    return cluster.id;
  }

  private buildErrorSummary(errors: RowError[]): Prisma.InputJsonValue {
    return this.toJson({
      total: errors.length,
      truncated: errors.length > MAX_PERSISTED_ERRORS,
      items: errors.slice(0, MAX_PERSISTED_ERRORS),
    });
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
