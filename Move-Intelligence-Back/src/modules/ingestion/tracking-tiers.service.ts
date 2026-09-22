import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { COUNTED_ITEM_STATUSES } from '../catalog/catalog.constants';
import { normalizeTerm } from '../radar-discovery/discovery-candidates';
import { assignTiers, TierListing, TierReason, trackingTierConfig, TRACK_CADENCE_DAYS } from './tracking-tiers';

export interface TierRecalcSummary {
  dry_run: boolean;
  tier1: number;
  tier2: number;
  tier3: number;
  by_reason: Partial<Record<TierReason, number>>;
  status_changes: { ignored: number; activated: number };
  changed: number;
  estimated_weekly_calls: number;
}

const DAY_MS = 86_400_000;
const WRITE_CHUNK = 100;

@Injectable()
export class TrackingTiersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Spec §7.2/§7.3: status → níveis com vagas → grava só o que mudou. */
  async recalculate(opts: { dryRun?: boolean; now?: Date; env?: NodeJS.ProcessEnv } = {}): Promise<TierRecalcSummary> {
    const dryRun = opts.dryRun === true;
    const now = opts.now ?? new Date();
    const cfg = trackingTierConfig(opts.env ?? process.env);

    const tracked = await this.prisma.trackedListing.findMany({
      where: { status: { in: ['ACTIVE', 'CANDIDATE'] } },
      select: {
        id: true, source: true, nativeId: true, productId: true, status: true, tier: true, tierReason: true,
        nextDueAt: true, lastSuccessAt: true, firstSeenAt: true, discoveredByTerm: true,
      },
    });
    // Volume atual (~600 anúncios): carregar fichas e itens inteiros é simples e barato.
    const [fichas, items] = await Promise.all([
      this.prisma.listingFicha.findMany({ select: { marketplace: true, externalProductId: true, status: true, inScope: true } }),
      this.prisma.productClusterItem.findMany({ select: { marketplace: true, externalProductId: true, clusterId: true, status: true } }),
    ]);
    const key = (marketplace: string, externalProductId: string) => `${marketplace}::${externalProductId}`;
    const fichaBy = new Map(fichas.map((ficha) => [key(ficha.marketplace, ficha.externalProductId), ficha]));
    const itemBy = new Map(items.map((item) => [key(item.marketplace, item.externalProductId), item]));

    const ignoredIds: string[] = [];
    const activatedIds: string[] = [];
    const alive: Array<{ row: (typeof tracked)[number]; cardId: string | null }> = [];
    for (const row of tracked) {
      const ficha = fichaBy.get(key(row.source, row.nativeId));
      const item = itemBy.get(key(row.source, row.nativeId));
      if (ficha?.inScope === false || (!item && ficha?.status === 'done')) {
        ignoredIds.push(row.id);
        continue;
      }
      if (row.status === 'CANDIDATE' && item && (COUNTED_ITEM_STATUSES as readonly string[]).includes(item.status)) {
        activatedIds.push(row.id);
      }
      alive.push({ row, cardId: item?.clusterId ?? row.productId ?? null });
    }

    const aliveIds = alive.map((entry) => entry.row.id);
    const cardIds = [...new Set(alive.map((entry) => entry.cardId).filter((id): id is string => !!id))];
    const [observations, scoreRows, watchRows, snapshots, clusters, searchedTerms] = await Promise.all([
      this.prisma.listingObservation.findMany({
        where: { listingId: { in: aliveIds } },
        orderBy: [{ listingId: 'asc' }, { observedAt: 'desc' }],
        distinct: ['listingId'],
        select: { listingId: true, reviewsCount: true },
      }),
      this.prisma.productScore.findMany({
        select: { productClusterId: true, score: true, computedAt: true },
        orderBy: [{ computedAt: 'desc' }],
      }),
      this.prisma.watchlistItem.findMany({ select: { productClusterId: true } }),
      this.prisma.searchTrendSnapshot.findMany({
        where: { status: 'ok' },
        orderBy: { capturedAt: 'desc' },
        distinct: ['typeKey', 'geo'],
        select: { typeKey: true, geo: true, growth12w: true },
      }),
      this.prisma.productCluster.findMany({ where: { id: { in: cardIds } }, select: { id: true, type: { select: { key: true } } } }),
      this.prisma.discoveryTerm.findMany({ where: { status: 'searched' }, select: { termNorm: true } }),
    ]);

    const reviewsBy = new Map(observations.map((observation) => [observation.listingId, observation.reviewsCount ?? null]));
    const cardScores = new Map<string, number | null>(cardIds.map((id) => [id, null]));
    const seenScores = new Set<string>();
    for (const row of scoreRows) {
      if (!cardScores.has(row.productClusterId) || seenScores.has(row.productClusterId)) continue;
      seenScores.add(row.productClusterId);
      cardScores.set(row.productClusterId, row.score);
    }
    const growthByType = new Map<string, number>();
    for (const snapshot of snapshots) {
      if (snapshot.growth12w === null || snapshot.growth12w === undefined) continue;
      growthByType.set(snapshot.typeKey, Math.max(growthByType.get(snapshot.typeKey) ?? -Infinity, snapshot.growth12w));
    }
    const hotCards = new Map<string, number>();
    for (const cluster of clusters) {
      const growth = cluster.type?.key ? growthByType.get(cluster.type.key) : undefined;
      if (growth !== undefined && growth >= cfg.radarMinGrowth) hotCards.set(cluster.id, growth);
    }
    const searched = new Set(searchedTerms.map((term) => term.termNorm));
    const windowStart = now.getTime() - cfg.discoveryWindowDays * DAY_MS;

    const listings: TierListing[] = alive.map(({ row, cardId }) => ({
      id: row.id,
      cardId,
      reviews: reviewsBy.get(row.id) ?? null,
      nativeId: row.nativeId,
      firstSeenAt: row.firstSeenAt,
      fromDiscovery: !!row.discoveredByTerm && searched.has(normalizeTerm(row.discoveredByTerm)) && row.firstSeenAt.getTime() >= windowStart,
    }));
    const assignments = assignTiers({
      listings,
      cardScores,
      watchlist: watchRows.map((watch) => watch.productClusterId),
      hotCards,
      config: { topCards: cfg.topCards, tier1Slots: cfg.tier1Slots, tier2Slots: cfg.tier2Slots },
    });

    const rowBy = new Map(alive.map((entry) => [entry.row.id, entry.row]));
    const updates: Array<{ id: string; data: Prisma.TrackedListingUncheckedUpdateInput }> = [];
    const byReason: Partial<Record<TierReason, number>> = {};
    let weekly = 0;
    const counts = { 1: 0, 2: 0, 3: 0 };
    for (const assignment of assignments) {
      counts[assignment.tier] += 1;
      byReason[assignment.reason] = (byReason[assignment.reason] ?? 0) + 1;
      weekly += 7 / TRACK_CADENCE_DAYS[assignment.tier];
      const row = rowBy.get(assignment.id)!;
      if (row.tier === assignment.tier && row.tierReason === assignment.reason) continue;
      const data: Prisma.TrackedListingUncheckedUpdateInput = { tier: assignment.tier, tierReason: assignment.reason, tierUpdatedAt: now };
      if (assignment.tier < row.tier) {
        const base = (row.lastSuccessAt ?? now).getTime();
        const candidate = new Date(base + TRACK_CADENCE_DAYS[assignment.tier] * DAY_MS);
        data['nextDueAt'] = candidate < row.nextDueAt ? candidate : row.nextDueAt;
      }
      updates.push({ id: assignment.id, data });
    }

    if (!dryRun) {
      if (ignoredIds.length) await this.prisma.trackedListing.updateMany({ where: { id: { in: ignoredIds } }, data: { status: 'IGNORED' } });
      if (activatedIds.length) await this.prisma.trackedListing.updateMany({ where: { id: { in: activatedIds } }, data: { status: 'ACTIVE' } });
      for (let offset = 0; offset < updates.length; offset += WRITE_CHUNK) {
        await this.prisma.$transaction(
          updates.slice(offset, offset + WRITE_CHUNK).map((update) => this.prisma.trackedListing.update({ where: { id: update.id }, data: update.data })),
        );
      }
    }

    return {
      dry_run: dryRun,
      tier1: counts[1],
      tier2: counts[2],
      tier3: counts[3],
      by_reason: byReason,
      status_changes: { ignored: ignoredIds.length, activated: activatedIds.length },
      changed: updates.length,
      estimated_weekly_calls: Math.round(weekly),
    };
  }
}
