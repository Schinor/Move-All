import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { SearchParams } from '../../shared/types/marketplace.types';
import { ConnectorsRegistry } from '../connectors/connectors.registry';
import { NormalizationService } from '../normalization/normalization.service';
import { FichaService } from '../catalog/ficha.service';
import { SnapshotsService } from '../snapshots/snapshots.service';
import { RunCollectionDto } from './dto/run-collection.dto';

@Injectable()
export class IngestionService {
  constructor(
    private readonly connectors: ConnectorsRegistry,
    private readonly normalization: NormalizationService,
    private readonly fichas: FichaService,
    private readonly snapshots: SnapshotsService,
    private readonly prisma: PrismaService,
  ) {}

  async runCollection(dto: RunCollectionDto) {
    const searchParams: SearchParams = {
      term: dto.term,
      category: dto.category,
      language: dto.language,
      market: dto.market,
      limit: dto.limit ?? 20,
    };

    const selectedConnectors = dto.source
      ? [this.requireConnector(dto.source)]
      : this.connectors.getAll().filter((connector) => connector.isEnabled());

    const job = await this.prisma.collectionJob.create({
      data: {
        source: dto.source,
        queryTerm: dto.term,
        category: dto.category,
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });

    const stats = {
      sourcesRequested: selectedConnectors.length,
      rawProducts: 0,
      snapshotsCreated: 0,
      failures: [] as Array<{ source: string; message: string }>,
    };

    for (const connector of selectedConnectors) {
      try {
        const rawProducts = await connector.searchProducts(searchParams);
        stats.rawProducts += rawProducts.length;

        await this.prisma.rawApiResponse.create({
          data: {
            source: connector.sourceName,
            endpoint: 'searchProducts',
            queryTerm: dto.term,
            requestParams: this.toJson(searchParams),
            responseBody: this.toJson({
              items: rawProducts.map((product) => product.rawPayload),
            }),
            statusCode: 200,
          },
        });

        for (const rawProduct of rawProducts) {
          const normalized = await this.normalization.normalize(rawProduct);
          const listing = { marketplace: normalized.marketplace, externalProductId: normalized.externalProductId };
          await this.fichas.registerListing({
            ...listing,
            title: normalized.titleOriginal ?? normalized.titleNormalized,
          });
          const clusterId = await this.fichas.currentCardId(listing);

          await this.snapshots.persist(normalized, clusterId ?? undefined);
          stats.snapshotsCreated += 1;
        }
      } catch (error) {
        stats.failures.push({
          source: connector.sourceName,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const status =
      stats.failures.length === 0
        ? 'SUCCESS'
        : stats.snapshotsCreated > 0
          ? 'PARTIAL'
          : 'FAILED';

    return this.prisma.collectionJob.update({
      where: { id: job.id },
      data: {
        status,
        finishedAt: new Date(),
        errorMessage:
          status === 'FAILED'
            ? stats.failures.map((failure) => failure.message).join('; ')
            : undefined,
        stats: this.toJson(stats),
      },
    });
  }

  private requireConnector(source: string) {
    const connector = this.connectors.getByName(source);
    if (!connector) {
      throw new NotFoundException(`Connector not registered: ${source}`);
    }

    return connector;
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
