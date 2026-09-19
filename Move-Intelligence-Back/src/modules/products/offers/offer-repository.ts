import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';
import { syntheticSnapshotWhere } from '../../../shared/synthetic-data/synthetic-data.filter';
import { COUNTED_ITEM_STATUSES } from '../../catalog/catalog.constants';
import { offerKey, SUPPLIER_MARKETPLACES } from './offer-rules';

export interface OfferListing {
  key: string;
  marketplace: string;
  externalProductId: string;
  itemStatus: string;
  title: string | null;
  sellerName: string | null;
  url: string | null;
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  moq: number | null;
  rating: number | null;
  salesSignal: number | null;
  collectedAt: Date | null;
}

export interface OfferScoreRow {
  key: string;
  score: number | null;
  state: string;
  unitCostUsd: number | null;
  moq: number;
  capitalPrimeiroPedido: number | null;
  pVplPositivo: number | null;
  computedAt: Date;
}

export interface OfferScoreInput {
  productClusterId: string;
  marketplace: string;
  externalProductId: string;
  score: number | null;
  state: 'com_score' | 'sem_preco' | 'suspeito';
  unitCostUsd: number | null;
  moq: number;
  capitalPrimeiroPedido: number | null;
  pVplPositivo: number | null;
  vplMediano: number | null;
  cvar5: number | null;
  premises: Record<string, unknown>;
  premisesHash: string;
  dataVersion: string;
  scenarioCount: number;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Acesso ao banco das ofertas (Subprojeto B). Sem regra de negócio: as regras ficam em offer-rules. */
export class OfferRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listOfferListings(clusterId: string): Promise<OfferListing[]> {
    const items = await this.prisma.productClusterItem.findMany({
      where: {
        clusterId,
        marketplace: { in: [...SUPPLIER_MARKETPLACES] },
        status: { in: [...COUNTED_ITEM_STATUSES] },
      },
      select: { marketplace: true, externalProductId: true, status: true },
    });
    if (items.length === 0) return [];
    const snapshots = await this.prisma.productListingSnapshot.findMany({
      where: {
        ...syntheticSnapshotWhere(),
        OR: items.map((item) => ({ marketplace: item.marketplace, externalProductId: item.externalProductId })),
      },
      orderBy: { collectedAt: 'desc' },
      select: {
        marketplace: true,
        externalProductId: true,
        title: true,
        sellerName: true,
        productUrl: true,
        priceMin: true,
        priceMax: true,
        currency: true,
        moq: true,
        rating: true,
        salesSignalRaw: true,
        collectedAt: true,
      },
    });
    const latest = new Map<string, (typeof snapshots)[number]>();
    for (const snap of snapshots) {
      const key = offerKey(snap.marketplace, snap.externalProductId);
      if (!latest.has(key)) latest.set(key, snap);
    }
    return items.map((item) => {
      const key = offerKey(item.marketplace, item.externalProductId);
      const snap = latest.get(key);
      return {
        key,
        marketplace: item.marketplace,
        externalProductId: item.externalProductId,
        itemStatus: item.status,
        title: snap?.title ?? null,
        sellerName: snap?.sellerName ?? null,
        url: snap?.productUrl ?? null,
        priceMin: num(snap?.priceMin),
        priceMax: num(snap?.priceMax),
        currency: snap?.currency ?? null,
        moq: snap?.moq ?? null,
        rating: num(snap?.rating),
        salesSignal: num(snap?.salesSignalRaw),
        collectedAt: snap?.collectedAt ?? null,
      };
    });
  }

  async latestOfferScores(clusterId: string): Promise<Map<string, OfferScoreRow>> {
    const rows = await this.prisma.offerScore.findMany({
      where: { productClusterId: clusterId },
      orderBy: { computedAt: 'desc' },
      take: 2_000,
    });
    const map = new Map<string, OfferScoreRow>();
    for (const row of rows) {
      const key = offerKey(row.marketplace, row.externalProductId);
      if (map.has(key)) continue;
      map.set(key, {
        key,
        score: row.score,
        state: row.state,
        unitCostUsd: num(row.unitCostUsd),
        moq: row.moq,
        capitalPrimeiroPedido: row.capitalPrimeiroPedido,
        pVplPositivo: row.pVplPositivo,
        computedAt: row.computedAt,
      });
    }
    return map;
  }

  async createOfferScore(data: OfferScoreInput): Promise<void> {
    await this.prisma.offerScore.create({
      data: {
        ...data,
        premises: JSON.parse(JSON.stringify(data.premises)) as Prisma.InputJsonValue,
      },
    });
  }
}
