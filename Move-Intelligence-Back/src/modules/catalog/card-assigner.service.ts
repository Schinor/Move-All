import { Injectable } from '@nestjs/common';
import { ListingFicha, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { buildCardName, evaluateCardKey, KeyEvaluation, normalizeDifferential } from './card-key';
import { decideMissingSpec, Candidate } from './auto-assign';
import {
  ACTIVE_CARD_STATUSES,
  autoAssignConfig,
  COUNTED_ITEM_STATUSES,
  DIFFERENTIAL_ATTR,
  MISSING_VALUE,
  NONE_VALUE,
} from './catalog.constants';
import { TaxonomyService } from './taxonomy.service';
import { CardKeyAttr, CatalogTypeDef } from './taxonomy.types';

export interface ListingRef {
  marketplace: string;
  externalProductId: string;
}
export type ItemStatus = 'confirmed' | 'provisional' | 'auto';
export type AssignOutcome = 'out_of_scope' | 'suggested_type' | 'confirmed' | 'provisional' | 'auto' | 'error_review';
export interface AssignResult {
  outcome: AssignOutcome;
  clusterId: string | null;
  touched: string[];
}

export type AutoResolvePreviewKind =
  | 'single_candidate'
  | 'best_similarity'
  | 'pending_differential'
  | 'promote_differential'
  | 'review'
  | 'confirmed'
  | 'out_of_scope'
  | 'suggested_type'
  | 'error';

export interface AutoResolvePreview {
  kind: AutoResolvePreviewKind;
  clusterId: string | null;
  cardKey?: string;
  similarity?: number;
  margin?: number;
  reason?: string;
}

const ACTIVE = { in: [...ACTIVE_CARD_STATUSES] as string[] };
const TYPE_CACHE_MS = 60_000;

@Injectable()
export class CardAssignerService {
  private typeCache: { at: number; map: Map<string, CatalogTypeDef> } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly taxonomy: TaxonomyService,
  ) {}

  private async types(): Promise<Map<string, CatalogTypeDef>> {
    if (!this.typeCache || Date.now() - this.typeCache.at > TYPE_CACHE_MS) {
      this.typeCache = { at: Date.now(), map: await this.taxonomy.getTypeMap() };
    }
    return this.typeCache.map;
  }

  private async typeById(typeId: string | null): Promise<CatalogTypeDef | undefined> {
    if (!typeId) return undefined;
    return [...(await this.types()).values()].find((t) => t.id === typeId);
  }

  /** Chamado quando a revisão cria um tipo novo (a próxima montagem precisa enxergá-lo). */
  invalidateTypeCache(): void {
    this.typeCache = null;
  }

  async assign(ficha: ListingFicha, opts: { deferRefresh?: boolean } = {}): Promise<AssignResult> {
    const listing: ListingRef = { marketplace: ficha.marketplace, externalProductId: ficha.externalProductId };
    const current = await this.prisma.productClusterItem.findUnique({
      where: { marketplace_externalProductId: listing },
    });

    if (ficha.status === 'error') {
      await this.ensureListingReview(listing, current?.clusterId ?? null, 'ficha falhou');
      return { outcome: 'error_review', clusterId: current?.clusterId ?? null, touched: [] };
    }
    if (ficha.inScope === false) {
      const moved = await this.moveListing(listing, null, 'confirmed', opts);
      await this.resolveListingReviews(listing, 'auto_out_of_scope');
      return { outcome: 'out_of_scope', clusterId: null, touched: moved.touched };
    }
    const type = ficha.typeKey ? (await this.types()).get(ficha.typeKey) : undefined;
    if (!type) {
      const moved = await this.moveListing(listing, null, 'confirmed', opts);
      await this.registerSuggestedType(ficha.suggestedType);
      return { outcome: 'suggested_type', clusterId: null, touched: moved.touched };
    }

    const evaluation = evaluateCardKey(
      type,
      (ficha.cardKeyValues ?? {}) as Record<string, unknown>,
      ficha.newDifferential,
    );
    const adopt = current && (await this.isAdoptableLegacy(current.clusterId)) ? current.clusterId : null;

    let clusterId: string;
    let status: ItemStatus;
    let reason: string | null = null;
    if (evaluation.newDifferential) {
      const automatic = await this.assignNewDifferential(ficha, listing, current, type, evaluation, opts);
      if (automatic) return automatic;
      clusterId = (await this.findActiveByKey(evaluation.cardKey)) ?? (await this.createCard(type, evaluation, 'provisional', adopt));
      status = 'provisional';
      reason = `diferencial novo: ${evaluation.newDifferential}`;
    } else if (evaluation.complete) {
      clusterId = (await this.findActiveByKey(evaluation.cardKey)) ?? (await this.createCard(type, evaluation, 'confirmed', adopt));
      status = 'confirmed';
    } else {
      const decision = decideMissingSpec(await this.autoAssignCandidates(type, evaluation, listing), autoAssignConfig());
      if (decision.kind === 'assign') {
        clusterId = decision.clusterId;
        status = 'auto';
        const before = {
          listing,
          clusterId: current?.clusterId ?? null,
          status: (current?.status as ItemStatus | null) ?? null,
        };
        const after = { listing, clusterId, status, rule: decision.rule };
        const moved = await this.moveListing(listing, clusterId, status, opts);
        const review = await this.prisma.catalogReviewItem.findFirst({
          where: { kind: 'provisional_listing', status: 'pending', ...listing },
          select: { id: true },
        });
        await this.resolveListingReviews(listing, 'auto');
        await this.prisma.catalogDecision.create({
          data: {
            action: 'auto_assign',
            actorUserId: null,
            reviewItemId: review?.id ?? null,
            before: before as unknown as Prisma.InputJsonValue,
            after: after as unknown as Prisma.InputJsonValue,
          },
        });
        return { outcome: status, clusterId, touched: moved.touched };
      }
      clusterId = (await this.mostProbableCard(type, evaluation)) ?? (await this.createCard(type, evaluation, 'provisional', adopt));
      status = 'provisional';
      const labels = evaluation.missing.map((attr) => type.cardKeyAttrs.find((a) => a.attr === attr)?.label_pt ?? attr);
      reason = decision.reason === 'falta a especificação' ? `falta a especificação: ${labels.join(', ')}` : decision.reason;
    }

    const moved = await this.moveListing(listing, clusterId, status, opts);
    if (reason) await this.ensureListingReview(listing, clusterId, reason);
    else await this.resolveListingReviews(listing, 'auto_confirmed');
    return { outcome: status, clusterId, touched: moved.touched };
  }

  /** Inspeção somente leitura para o relatório de auto-resolução. */
  async previewAutoResolution(ficha: ListingFicha): Promise<AutoResolvePreview> {
    const listing: ListingRef = { marketplace: ficha.marketplace, externalProductId: ficha.externalProductId };
    if (ficha.status === 'error') return { kind: 'error', clusterId: null, reason: ficha.lastError ?? 'ficha falhou' };
    if (ficha.inScope === false) return { kind: 'out_of_scope', clusterId: null };
    const type = ficha.typeKey ? (await this.types()).get(ficha.typeKey) : undefined;
    if (!type) return { kind: 'suggested_type', clusterId: null };
    const evaluation = evaluateCardKey(type, (ficha.cardKeyValues ?? {}) as Record<string, unknown>, ficha.newDifferential);
    if (evaluation.newDifferential) {
      const context = await this.differentialContext(ficha, listing, type, evaluation);
      if (context.belowLimit) {
        const baseClusterId = await this.findBaseCardForDifferential(type, evaluation);
        return baseClusterId
          ? { kind: 'pending_differential', clusterId: baseClusterId }
          : { kind: 'review', clusterId: null, reason: `diferencial novo: ${evaluation.newDifferential}` };
      }
      return { kind: 'promote_differential', clusterId: null, cardKey: evaluation.cardKey };
    }
    if (evaluation.complete) {
      return { kind: 'confirmed', clusterId: await this.findActiveByKey(evaluation.cardKey) };
    }
    const candidates = await this.autoAssignCandidates(type, evaluation, listing);
    const decision = decideMissingSpec(candidates, autoAssignConfig());
    if (decision.kind === 'assign') {
      const ordered = [...candidates].sort((a, b) => b.similarity - a.similarity || a.clusterId.localeCompare(b.clusterId));
      return {
        kind: decision.rule,
        clusterId: decision.clusterId,
        similarity: ordered[0]?.similarity ?? 0,
        margin: ordered.length > 1 ? ordered[0].similarity - ordered[1].similarity : undefined,
      };
    }
    return { kind: 'review', clusterId: null, reason: decision.reason };
  }

  async moveListing(
    listing: ListingRef,
    targetClusterId: string | null,
    status: ItemStatus,
    opts: { deferRefresh?: boolean } = {},
  ): Promise<{ fromClusterId: string | null; touched: string[] }> {
    const current = await this.prisma.productClusterItem.findUnique({
      where: { marketplace_externalProductId: listing },
    });
    const from = current?.clusterId ?? null;
    if (targetClusterId === null) {
      if (current) await this.prisma.productClusterItem.delete({ where: { id: current.id } });
    } else if (current) {
      await this.prisma.productClusterItem.update({
        where: { id: current.id },
        data: { clusterId: targetClusterId, status, matchedBy: 'catalog', similarityScore: 1, matchedAt: new Date() },
      });
    } else {
      await this.prisma.productClusterItem.create({
        data: { clusterId: targetClusterId, ...listing, status, matchedBy: 'catalog', similarityScore: 1 },
      });
    }
    await this.prisma.productListingSnapshot.updateMany({
      where: { marketplace: listing.marketplace, externalProductId: listing.externalProductId },
      data: { productClusterId: targetClusterId },
    });
    await this.prisma.trackedListing.updateMany({
      where: { source: listing.marketplace, nativeId: listing.externalProductId },
      data: { productId: targetClusterId },
    });
    const touched = [...new Set([targetClusterId, from].filter((id): id is string => !!id))];
    if (!opts.deferRefresh) {
      if (targetClusterId) await this.refreshCard(targetClusterId);
      if (from && from !== targetClusterId) await this.refreshCard(from, targetClusterId);
    }
    return { fromClusterId: from, touched };
  }

  async refreshMany(pairs: Array<{ clusterId: string; lastDestination: string | null }>): Promise<void> {
    const seen = new Map<string, string | null>();
    for (const pair of pairs) seen.set(pair.clusterId, pair.lastDestination ?? seen.get(pair.clusterId) ?? null);
    for (const [clusterId, lastDestination] of seen) await this.refreshCard(clusterId, lastDestination);
  }

  async refreshCard(clusterId: string, lastDestination: string | null = null): Promise<void> {
    const card = await this.prisma.productCluster.findUnique({ where: { id: clusterId }, include: { items: true } });
    if (!card) return;
    if (card.items.length === 0) {
      if (card.cardStatus === 'legacy' && lastDestination) {
        await this.prisma.productCluster.update({
          where: { id: clusterId },
          data: { cardStatus: 'merged', mergedIntoId: lastDestination, simulatedAt: null },
        });
      } else {
        await this.prisma.productCluster.update({ where: { id: clusterId }, data: { simulatedAt: null } });
      }
      return;
    }
    if (card.cardKey === null) {
      await this.prisma.productCluster.update({ where: { id: clusterId }, data: { simulatedAt: null } });
      return;
    }
    const hasConfirmed = card.items.some((item) =>
      COUNTED_ITEM_STATUSES.includes(item.status as (typeof COUNTED_ITEM_STATUSES)[number]),
    );
    const provisional = card.items.filter((item) => item.status === 'provisional');
    await this.prisma.productListingSnapshot.updateMany({
      where: { productClusterId: clusterId },
      data: { analyticsExcluded: false },
    });
    if (hasConfirmed && provisional.length > 0) {
      await this.prisma.productListingSnapshot.updateMany({
        where: {
          productClusterId: clusterId,
          OR: provisional.map((item) => ({ marketplace: item.marketplace, externalProductId: item.externalProductId })),
        },
        data: { analyticsExcluded: true },
      });
    }
    const data: Prisma.ProductClusterUpdateInput = {
      cardStatus: hasConfirmed ? 'confirmed' : 'provisional',
      simulatedAt: null,
    };
    const type = await this.typeById(card.typeId);
    if (!card.nameLocked && type) {
      data.canonicalName = buildCardName(type, (card.cardKeyValues ?? {}) as Record<string, string>);
    }
    await this.prisma.productCluster.update({ where: { id: clusterId }, data });
  }

  /** Usado pela revisão ("criar card novo" / "aprovar tipo"). Reaproveita card ativo com a mesma chave. */
  async createCardForType(typeKey: string, cardKeyValues: Record<string, string>, name?: string): Promise<string> {
    const type = (await this.types()).get(typeKey);
    if (!type) throw new Error(`Tipo inexistente: ${typeKey}`);
    const evaluation = evaluateCardKey(type, cardKeyValues, cardKeyValues['diferencial'] ?? null);
    const existing = await this.findActiveByKey(evaluation.cardKey);
    if (existing) return existing;
    const id = await this.createCard(type, evaluation, 'confirmed', null);
    if (name) {
      await this.prisma.productCluster.update({ where: { id }, data: { canonicalName: name, nameLocked: true } });
    }
    return id;
  }

  private async isAdoptableLegacy(clusterId: string): Promise<boolean> {
    const cluster = await this.prisma.productCluster.findUnique({ where: { id: clusterId } });
    return !!cluster && cluster.cardStatus === 'legacy' && cluster.cardKey === null;
  }

  private async findActiveByKey(cardKey: string): Promise<string | null> {
    const row = await this.prisma.productCluster.findFirst({
      where: { cardKey, cardStatus: ACTIVE },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return row?.id ?? null;
  }

  private async mostProbableCard(type: CatalogTypeDef, evaluation: KeyEvaluation): Promise<string | null> {
    const known = Object.entries(evaluation.values).filter(([, value]) => value !== MISSING_VALUE);
    const cards = await this.prisma.productCluster.findMany({
      where: { typeId: type.id, cardStatus: ACTIVE },
      select: {
        id: true,
        cardKeyValues: true,
        createdAt: true,
        items: { where: { status: { in: [...COUNTED_ITEM_STATUSES] } }, select: { id: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const matching = cards.filter((card) =>
      known.every(([attr, value]) => ((card.cardKeyValues ?? {}) as Record<string, string>)[attr] === value),
    );
    matching.sort((a, b) => b.items.length - a.items.length || a.createdAt.getTime() - b.createdAt.getTime());
    return matching[0]?.id ?? null;
  }

  private async autoAssignCandidates(type: CatalogTypeDef, evaluation: KeyEvaluation, listing: ListingRef): Promise<Candidate[]> {
    const known = Object.entries(evaluation.values).filter(([, value]) => value !== MISSING_VALUE);
    const cards = await this.prisma.productCluster.findMany({
      where: { typeId: type.id, cardStatus: 'confirmed' },
      select: {
        id: true,
        cardStatus: true,
        cardKeyValues: true,
        items: { where: { status: { in: [...COUNTED_ITEM_STATUSES] } }, select: { id: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const matching = cards.filter((card) => card.cardStatus === 'confirmed' &&
      known.every(([attr, value]) => ((card.cardKeyValues ?? {}) as Record<string, string>)[attr] === value));
    if (matching.length === 0) return [];

    const similarities = await this.similarityByCard(listing, matching.map((card) => card.id));
    return matching.map((card) => ({
      clusterId: card.id,
      similarity: similarities.get(card.id) ?? 0,
      countedItems: card.items.length,
    }));
  }

  private canonicalDifferential(type: CatalogTypeDef, raw: unknown): string | null {
    const normalized = normalizeDifferential(raw);
    if (!normalized) return null;
    const attr = type.cardKeyAttrs.find((candidate) => candidate.attr === DIFFERENTIAL_ATTR);
    const known = attr?.values.find((value) =>
      value.value === normalized || (value.aliases ?? []).some((alias) => normalizeDifferential(alias) === normalized),
    );
    return known?.value ?? normalized;
  }

  private async findBaseCardForDifferential(type: CatalogTypeDef, evaluation: KeyEvaluation): Promise<string | null> {
    const known = Object.entries(evaluation.values).filter(([attr, value]) => attr !== DIFFERENTIAL_ATTR && value !== MISSING_VALUE);
    const cards = await this.prisma.productCluster.findMany({
      where: { typeId: type.id, cardStatus: { in: [...ACTIVE_CARD_STATUSES] } },
      select: {
        id: true,
        cardStatus: true,
        cardKeyValues: true,
        createdAt: true,
        items: { where: { status: { in: [...COUNTED_ITEM_STATUSES] } }, select: { id: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const matching = cards.filter((card) => {
      if (!known.every(([attr, value]) => ((card.cardKeyValues ?? {}) as Record<string, string>)[attr] === value)) return false;
      const differential = this.canonicalDifferential(type, ((card.cardKeyValues ?? {}) as Record<string, unknown>)[DIFFERENTIAL_ATTR]);
      return differential === null || differential === NONE_VALUE;
    });
    matching.sort((a, b) =>
      Number(b.cardStatus === 'confirmed') - Number(a.cardStatus === 'confirmed') ||
      b.items.length - a.items.length ||
      a.createdAt.getTime() - b.createdAt.getTime(),
    );
    return matching[0]?.id ?? null;
  }

  private async ensureDifferentialValue(type: CatalogTypeDef, differential: string): Promise<void> {
    const row = await this.prisma.catalogType.findUnique({ where: { id: type.id }, select: { cardKeyAttrs: true } });
    if (!row) return;
    const attrs = ((row.cardKeyAttrs as unknown as CardKeyAttr[]) ?? []).map((attr) => ({
      ...attr,
      values: [...attr.values],
    }));
    let differentialAttr = attrs.find((attr) => attr.attr === DIFFERENTIAL_ATTR);
    if (!differentialAttr) {
      differentialAttr = { attr: DIFFERENTIAL_ATTR, label_pt: DIFFERENTIAL_ATTR, values: [{ value: NONE_VALUE, label_pt: 'sem diferencial' }] };
      attrs.push(differentialAttr);
    }
    if (!differentialAttr.values.some((value) => value.value === differential)) {
      differentialAttr.values.push({ value: differential, label_pt: '' });
    }
    const changed = attrs.some((attr, index) => JSON.stringify(attr) !== JSON.stringify((row.cardKeyAttrs as unknown as CardKeyAttr[])[index]));
    if (changed) {
      await this.prisma.catalogType.update({
        where: { id: type.id },
        data: { cardKeyAttrs: attrs as unknown as Prisma.InputJsonValue },
      });
      this.invalidateTypeCache();
    }
  }

  private async assignNewDifferential(
    ficha: ListingFicha,
    listing: ListingRef,
    current: { clusterId: string; status: string } | null,
    type: CatalogTypeDef,
    evaluation: KeyEvaluation,
    opts: { deferRefresh?: boolean },
  ): Promise<AssignResult | null> {
    const context = await this.differentialContext(ficha, listing, type, evaluation);
    const { differential, matching, belowLimit } = context;
    if (!differential) return null;

    if (belowLimit) {
      const baseClusterId = await this.findBaseCardForDifferential(type, evaluation);
      if (!baseClusterId) return null;
      const before = {
        listing,
        clusterId: current?.clusterId ?? null,
        status: (current?.status as ItemStatus | null) ?? null,
      };
      const after = {
        listing,
        clusterId: baseClusterId,
        status: 'auto' as const,
        rule: 'pending_differential' as const,
        note: `diferencial pendente: ${differential}`,
      };
      const moved = await this.moveListing(listing, baseClusterId, 'auto', opts);
      const review = await this.prisma.catalogReviewItem.findFirst({
        where: { kind: 'provisional_listing', status: 'pending', ...listing },
        select: { id: true },
      });
      await this.resolveListingReviews(listing, 'auto');
      await this.prisma.catalogDecision.create({
        data: {
          action: 'auto_assign',
          actorUserId: null,
          reviewItemId: review?.id ?? null,
          before: before as unknown as Prisma.InputJsonValue,
          after: after as unknown as Prisma.InputJsonValue,
        },
      });
      return { outcome: 'auto', clusterId: baseClusterId, touched: moved.touched };
    }

    await this.ensureDifferentialValue(type, differential);
    let targetClusterId = await this.findActiveByKey(evaluation.cardKey);
    if (targetClusterId) {
      await this.prisma.productCluster.update({ where: { id: targetClusterId }, data: { cardStatus: 'confirmed' } });
    } else {
      targetClusterId = await this.createCard(type, evaluation, 'confirmed', null);
    }

    const touched = new Set<string>([targetClusterId]);
    for (const row of matching) {
      const ref = { marketplace: row.marketplace, externalProductId: row.externalProductId };
      const item = await this.prisma.productClusterItem.findUnique({ where: { marketplace_externalProductId: ref } });
      const before = {
        listing: ref,
        clusterId: item?.clusterId ?? null,
        status: (item?.status as ItemStatus | null) ?? null,
      };
      const moved = await this.moveListing(ref, targetClusterId, 'auto', { deferRefresh: true });
      moved.touched.forEach((id) => touched.add(id));
      const review = await this.prisma.catalogReviewItem.findFirst({
        where: { kind: 'provisional_listing', status: 'pending', ...ref },
        select: { id: true },
      });
      await this.resolveListingReviews(ref, 'auto');
      await this.prisma.catalogDecision.create({
        data: {
          action: 'auto_promote_differential',
          actorUserId: null,
          reviewItemId: review?.id ?? null,
          before: before as unknown as Prisma.InputJsonValue,
          after: {
            listing: ref,
            clusterId: targetClusterId,
            status: 'auto',
            note: `diferencial promovido: ${differential}`,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }
    if (!opts.deferRefresh) {
      await this.refreshMany([...touched].map((clusterId) => ({ clusterId, lastDestination: clusterId === targetClusterId ? null : targetClusterId })));
    }
    return { outcome: 'auto', clusterId: targetClusterId, touched: [...touched] };
  }

  private async differentialContext(
    ficha: ListingFicha,
    listing: ListingRef,
    type: CatalogTypeDef,
    evaluation: KeyEvaluation,
  ): Promise<{
    differential: string | null;
    matching: Array<{ marketplace: string; externalProductId: string; newDifferential: string | null }>;
    belowLimit: boolean;
  }> {
    const differential = this.canonicalDifferential(type, evaluation.newDifferential);
    const rows = await this.prisma.listingFicha.findMany({
      where: { status: 'done', typeKey: type.key },
      select: { marketplace: true, externalProductId: true, newDifferential: true },
    });
    const matching = rows.filter((row) => this.canonicalDifferential(type, row.newDifferential) === differential);
    const currentKey = `${listing.marketplace}::${listing.externalProductId}`;
    if (!matching.some((row) => `${row.marketplace}::${row.externalProductId}` === currentKey)) {
      matching.push({ marketplace: ficha.marketplace, externalProductId: ficha.externalProductId, newDifferential: differential });
    }
    const marketplaces = new Set(matching.map((row) => row.marketplace));
    const cfg = autoAssignConfig();
    return {
      differential,
      matching,
      belowLimit: matching.length < cfg.diffMinListings || marketplaces.size < cfg.diffMinMarketplaces,
    };
  }

  /** Uma única consulta mantém a similaridade por card e usa sempre o snapshot mais recente. */
  private async similarityByCard(listing: ListingRef, clusterIds: string[]): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<Array<{ cluster_id: string; similarity: number | string | null }>>`
      SELECT pc.id AS cluster_id,
             COALESCE(MAX(
               CASE
                 WHEN current_snapshot.title IS NULL OR item_snapshot.title IS NULL THEN 0
                 ELSE similarity(lower(current_snapshot.title), lower(item_snapshot.title))
               END
             ), 0)::float8 AS similarity
      FROM product_clusters pc
      LEFT JOIN product_cluster_items pci
        ON pci.cluster_id = pc.id
       AND pci.status IN (${Prisma.join([...COUNTED_ITEM_STATUSES])})
      LEFT JOIN LATERAL (
        SELECT pls.title
        FROM product_listing_snapshots pls
        WHERE pls.marketplace = pci.marketplace
          AND pls.external_product_id = pci.external_product_id
        ORDER BY pls.collected_at DESC
        LIMIT 1
      ) item_snapshot ON TRUE
      LEFT JOIN LATERAL (
        SELECT pls.title
        FROM product_listing_snapshots pls
        WHERE pls.marketplace = ${listing.marketplace}
          AND pls.external_product_id = ${listing.externalProductId}
        ORDER BY pls.collected_at DESC
        LIMIT 1
      ) current_snapshot ON TRUE
      WHERE pc.id::text IN (${Prisma.join(clusterIds)})
      GROUP BY pc.id`;
    return new Map(
      rows.map((row) => {
        const value = Number(row.similarity);
        return [row.cluster_id, Number.isFinite(value) ? value : 0];
      }),
    );
  }

  private async createCard(
    type: CatalogTypeDef,
    evaluation: KeyEvaluation,
    status: ItemStatus,
    adoptClusterId: string | null,
  ): Promise<string> {
    const data = {
      typeId: type.id,
      cardKey: evaluation.cardKey,
      cardKeyValues: evaluation.values as Prisma.InputJsonValue,
      category: type.familyKey,
      cardStatus: status,
    };
    const canonicalName = buildCardName(type, evaluation.values);
    if (adoptClusterId) {
      const cluster = await this.prisma.productCluster.findUnique({ where: { id: adoptClusterId } });
      await this.prisma.productCluster.update({
        where: { id: adoptClusterId },
        data: { ...data, ...(cluster?.nameLocked ? {} : { canonicalName }) },
      });
      return adoptClusterId;
    }
    const created = await this.prisma.productCluster.create({ data: { ...data, canonicalName } });
    return created.id;
  }

  async registerSuggestedType(raw: string | null): Promise<string> {
    const key = normalizeDifferential(raw) ?? 'sem_sugestao';
    const similar = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM catalog_review_items
      WHERE kind = 'suggested_type' AND status = 'pending'
        AND (suggested_type_key = ${key} OR ${key} = ANY(suggested_type_aliases) OR similarity(suggested_type_key, ${key}) >= 0.6)
      ORDER BY similarity(suggested_type_key, ${key}) DESC
      LIMIT 1`;
    let item: { id: string; suggestedTypeAliases: string[] };
    if (similar[0]) {
      const existing = await this.prisma.catalogReviewItem.findUnique({ where: { id: similar[0].id } });
      const aliases = existing?.suggestedTypeAliases ?? [];
      item = aliases.includes(key)
        ? { id: similar[0].id, suggestedTypeAliases: aliases }
        : await this.prisma.catalogReviewItem.update({
            where: { id: similar[0].id },
            data: { suggestedTypeAliases: [...aliases, key] },
          });
    } else {
      item = await this.prisma.catalogReviewItem.create({
        data: { kind: 'suggested_type', suggestedTypeKey: key, suggestedTypeAliases: [key], reason: `tipo novo sugerido: ${key}` },
      });
    }
    const listingCount = await this.prisma.listingFicha.count({
      where: { typeKey: 'unknown', inScope: { not: false }, suggestedType: { in: item.suggestedTypeAliases } },
    });
    await this.prisma.catalogReviewItem.update({ where: { id: item.id }, data: { listingCount } });
    return item.id;
  }

  async ensureListingReview(listing: ListingRef, clusterId: string | null, reason: string): Promise<void> {
    const existing = await this.prisma.catalogReviewItem.findFirst({
      where: { kind: 'provisional_listing', status: 'pending', ...listing },
    });
    if (existing) {
      await this.prisma.catalogReviewItem.update({ where: { id: existing.id }, data: { suggestedClusterId: clusterId, reason } });
    } else {
      await this.prisma.catalogReviewItem.create({
        data: { kind: 'provisional_listing', ...listing, suggestedClusterId: clusterId, reason, listingCount: 1 },
      });
    }
  }

  async resolveListingReviews(listing: ListingRef, resolution: string, actorId: string | null = null): Promise<void> {
    await this.prisma.catalogReviewItem.updateMany({
      where: { kind: 'provisional_listing', status: 'pending', ...listing },
      data: { status: 'resolved', resolution, resolvedAt: new Date(), resolvedBy: actorId },
    });
  }
}
