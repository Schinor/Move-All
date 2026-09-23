import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { CardRollupsService } from '../../shared/card-rollups/card-rollups.service';
import { CardAssignerService, ItemStatus, ListingRef } from './card-assigner.service';
import { ACTIVE_CARD_STATUSES, PRIORITY, UNKNOWN_TYPE } from './catalog.constants';
import { TRACK_CADENCE_DAYS } from '../ingestion/tracking-tiers';

type Kind = 'provisional_listing' | 'suggested_type';
interface ListingState {
  listing: ListingRef;
  clusterId: string | null;
  status: ItemStatus | null;
  inScope: boolean | null;
}
const UNDOABLE = new Set(['confirm', 'move', 'create_card', 'out_of_scope', 'rename_card', 'auto_assign']);

export interface CardListingView {
  marketplace: string;
  external_product_id: string;
  title: string;
  url: string | null;
  price: number | null;
  currency: string | null;
  rating: number | null;
  status: ItemStatus;
  variation: string | null;
  brand: string | null;
  tracking: {
    status: string;
    tier: number;
    reason: string | null;
    cadence_days: number | null;
    last_success_at: string | null;
  } | null;
}

@Injectable()
export class CatalogReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assigner: CardAssignerService,
    @Optional() private readonly cardRollups?: CardRollupsService,
  ) {}

  // ---------- leitura ----------
  async counts(): Promise<{ provisional_listing: number; suggested_type: number }> {
    const [provisional, suggested] = await Promise.all([
      this.prisma.catalogReviewItem.count({ where: { kind: 'provisional_listing', status: 'pending' } }),
      this.prisma.catalogReviewItem.count({ where: { kind: 'suggested_type', status: 'pending' } }),
    ]);
    return { provisional_listing: provisional, suggested_type: suggested };
  }

  async list(kind: Kind, page = 1, pageSize = 20): Promise<{ total: number; items: unknown[] }> {
    const where = { kind, status: 'pending' };
    const orderBy: Prisma.CatalogReviewItemOrderByWithRelationInput[] =
      kind === 'suggested_type' ? [{ listingCount: 'desc' }, { createdAt: 'asc' }] : [{ createdAt: 'asc' }];
    const [total, rows] = await Promise.all([
      this.prisma.catalogReviewItem.count({ where }),
      this.prisma.catalogReviewItem.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { suggestedCluster: { select: { id: true, canonicalName: true, category: true } } },
      }),
    ]);
    const items = [];
    for (const row of rows) {
      if (kind === 'provisional_listing' && row.marketplace && row.externalProductId) {
        const listing = { marketplace: row.marketplace, externalProductId: row.externalProductId };
        const [snapshot, ficha] = await Promise.all([
          this.prisma.productListingSnapshot.findFirst({ where: listing, orderBy: { collectedAt: 'desc' } }),
          this.prisma.listingFicha.findUnique({ where: { marketplace_externalProductId: listing } }),
        ]);
        items.push({
          id: row.id,
          kind,
          reason: row.reason,
          marketplace: row.marketplace,
          external_product_id: row.externalProductId,
          title: snapshot?.title ?? ficha?.title ?? row.externalProductId,
          url: snapshot?.productUrl ?? null,
          price: snapshot?.priceMin !== null && snapshot?.priceMin !== undefined ? Number(snapshot.priceMin) : null,
          currency: snapshot?.currency ?? null,
          suggested_card: row.suggestedCluster
            ? { id: row.suggestedCluster.id, name: row.suggestedCluster.canonicalName, category: row.suggestedCluster.category }
            : null,
          ficha: ficha
            ? { type_key: ficha.typeKey, card_key_values: ficha.cardKeyValues, missing_key_attrs: ficha.missingKeyAttrs,
                comparison_values: ficha.comparisonValues, brand: ficha.brand }
            : null,
          created_at: row.createdAt,
        });
      } else {
        const aliases = row.suggestedTypeAliases;
        const [samples, similar] = await Promise.all([
          this.prisma.listingFicha.findMany({
            where: { typeKey: UNKNOWN_TYPE, suggestedType: { in: aliases }, inScope: { not: false } },
            select: { title: true, marketplace: true },
            take: 3,
          }),
          this.prisma.$queryRaw<Array<{ key: string; name_pt: string }>>`
            SELECT key, name_pt FROM catalog_types
            WHERE active = true AND similarity(key, ${row.suggestedTypeKey ?? ''}) >= 0.3
            ORDER BY similarity(key, ${row.suggestedTypeKey ?? ''}) DESC LIMIT 3`,
        ]);
        items.push({
          id: row.id,
          kind,
          reason: row.reason,
          suggested_type_key: row.suggestedTypeKey,
          aliases,
          listing_count: row.listingCount,
          samples,
          similar_types: similar,
          created_at: row.createdAt,
        });
      }
    }
    return { total, items };
  }

  async listCardListings(clusterId: string): Promise<CardListingView[]> {
    const items = await this.prisma.productClusterItem.findMany({ where: { clusterId }, orderBy: { matchedAt: 'asc' } });
    if (items.length === 0) return [];
    const refs = items.map((i) => ({ marketplace: i.marketplace, externalProductId: i.externalProductId }));
    const [fichas, snapshots, trackedRows] = await Promise.all([
      this.prisma.listingFicha.findMany({ where: { OR: refs } }),
      this.prisma.productListingSnapshot.findMany({
        where: { productClusterId: clusterId },
        orderBy: { collectedAt: 'desc' },
        distinct: ['marketplace', 'externalProductId'],
      }),
      this.prisma.trackedListing.findMany({
        where: { OR: refs.map((i) => ({ source: i.marketplace, nativeId: i.externalProductId })) },
        select: { source: true, nativeId: true, status: true, tier: true, tierReason: true, lastSuccessAt: true },
      }),
    ]);
    const key = (m: string, e: string) => `${m}::${e}`;
    const fichaBy = new Map(fichas.map((f) => [key(f.marketplace, f.externalProductId), f]));
    const snapBy = new Map(snapshots.map((s) => [key(s.marketplace, s.externalProductId), s]));
    const trackedBy = new Map(trackedRows.map((t) => [key(t.source, t.nativeId), t]));
    return items.map((item) => {
      const f = fichaBy.get(key(item.marketplace, item.externalProductId));
      const s = snapBy.get(key(item.marketplace, item.externalProductId));
      const variation = Object.entries((f?.variationValues ?? {}) as Record<string, unknown>)
        .map(([attr, value]) => `${attr.replace(/_/g, ' ')}: ${String(value)}`)
        .join(' · ');
      return {
        marketplace: item.marketplace,
        external_product_id: item.externalProductId,
        title: s?.title ?? f?.title ?? item.externalProductId,
        url: s?.productUrl ?? null,
        price: s?.priceMin !== null && s?.priceMin !== undefined ? Number(s.priceMin) : null,
        currency: s?.currency ?? null,
        rating: s?.rating !== null && s?.rating !== undefined ? Number(s.rating) : null,
        status: item.status as ItemStatus,
        variation: variation || null,
        brand: f?.brand ?? null,
        tracking: (() => {
          const t = trackedBy.get(key(item.marketplace, item.externalProductId));
          if (!t) return null;
          return {
            status: t.status,
            tier: t.tier,
            reason: t.tierReason ?? null,
            cadence_days: TRACK_CADENCE_DAYS[t.tier as 1 | 2 | 3] ?? null,
            last_success_at: t.lastSuccessAt?.toISOString() ?? null,
          };
        })(),
      };
    });
  }

  async searchCards(q: string) {
    const rows = await this.prisma.productCluster.findMany({
      where: { cardStatus: { in: [...ACTIVE_CARD_STATUSES] }, canonicalName: { contains: q.trim(), mode: 'insensitive' } },
      select: { id: true, canonicalName: true, category: true, cardStatus: true },
      orderBy: { canonicalName: 'asc' },
      take: 20,
    });
    return rows.map((r) => ({ id: r.id, name: r.canonicalName, category: r.category, card_status: r.cardStatus }));
  }

  async families() {
    const rows = await this.prisma.catalogFamily.findMany({ orderBy: { sortOrder: 'asc' }, select: { key: true, namePt: true } });
    return rows.map((r) => ({ key: r.key, name_pt: r.namePt }));
  }

  // ---------- ações sobre anúncio ----------
  async confirm(reviewId: string, actorId: string) {
    const review = await this.pendingListingReview(reviewId);
    const before = await this.state(this.listingOf(review));
    const target = review.suggestedClusterId ?? before.clusterId;
    if (!target) throw new BadRequestException('Este anúncio não tem card sugerido; use "mover" ou "criar card".');
    return this.applyListing(review, 'confirm', before, target, 'confirmed', actorId);
  }

  async move(reviewId: string, targetClusterId: string, actorId: string) {
    const review = await this.pendingListingReview(reviewId);
    const target = await this.prisma.productCluster.findUnique({ where: { id: targetClusterId } });
    if (!target || !ACTIVE_CARD_STATUSES.includes(target.cardStatus as never)) {
      throw new NotFoundException('Card de destino inexistente ou inativo.');
    }
    const before = await this.state(this.listingOf(review));
    return this.applyListing(review, 'move', before, targetClusterId, 'confirmed', actorId);
  }

  async createCard(reviewId: string, dto: { typeKey: string; cardKeyValues: Record<string, string>; name?: string }, actorId: string) {
    const review = await this.pendingListingReview(reviewId);
    const before = await this.state(this.listingOf(review));
    const clusterId = await this.assigner.createCardForType(dto.typeKey, dto.cardKeyValues, dto.name);
    const result = await this.applyListing(review, 'create_card', before, clusterId, 'confirmed', actorId);
    this.cardRollups?.markStale();
    return { ...result, clusterId };
  }

  async outOfScope(reviewId: string, actorId: string) {
    const review = await this.pendingListingReview(reviewId);
    const listing = this.listingOf(review);
    const before = await this.state(listing);
    await this.assigner.moveListing(listing, null, 'confirmed');
    await this.prisma.listingFicha.update({ where: { marketplace_externalProductId: listing }, data: { inScope: false } });
    await this.assigner.resolveListingReviews(listing, 'out_of_scope', actorId);
    const after: ListingState = { listing, clusterId: null, status: null, inScope: false };
    return this.decision('out_of_scope', actorId, review.id, before, after);
  }

  // ---------- ações sobre tipo sugerido ----------
  async approveType(reviewId: string, dto: { familyKey: string; key: string; namePt: string; ncm?: string | null }, actorId: string) {
    const review = await this.pendingTypeReview(reviewId);
    const family = await this.prisma.catalogFamily.findUnique({ where: { key: dto.familyKey } });
    if (!family) throw new NotFoundException(`Família inexistente: ${dto.familyKey}`);
    const type = await this.prisma.catalogType.create({
      data: {
        familyId: family.id,
        key: dto.key,
        namePt: dto.namePt,
        descriptionEn: dto.namePt,
        ncm: dto.ncm ?? null,
        cardKeyAttrs: [],
        comparisonAttrs: [],
        variationAttrs: [],
        source: 'approved',
      },
    });
    this.assigner.invalidateTypeCache();
    const where = { typeKey: UNKNOWN_TYPE, suggestedType: { in: review.suggestedTypeAliases }, inScope: { not: false } };
    const fichas = await this.prisma.listingFicha.findMany({ where, select: { id: true } });
    await this.prisma.listingFicha.updateMany({ where, data: { typeKey: dto.key, suggestedType: null } });
    for (const { id } of fichas) {
      const ficha = await this.prisma.listingFicha.findUnique({ where: { id } });
      if (ficha) await this.assigner.assign(ficha);
    }
    await this.resolveReview(review.id, 'approve_type', actorId);
    const result = await this.decision('approve_type', actorId, review.id, { aliases: review.suggestedTypeAliases }, { typeKey: dto.key, typeId: type.id });
    this.cardRollups?.markStale();
    return { ...result, typeId: type.id };
  }

  async mergeType(reviewId: string, typeKey: string, actorId: string) {
    const review = await this.pendingTypeReview(reviewId);
    const type = await this.prisma.catalogType.findUnique({ where: { key: typeKey } });
    if (!type) throw new NotFoundException(`Tipo inexistente: ${typeKey}`);
    const { count } = await this.prisma.listingFicha.updateMany({
      where: { typeKey: UNKNOWN_TYPE, suggestedType: { in: review.suggestedTypeAliases }, inScope: { not: false } },
      data: { status: 'pending', priority: PRIORITY.REVIEW_MERGE, attempts: 0, lastError: null },
    });
    await this.resolveReview(review.id, 'merge_type', actorId);
    const result = await this.decision('merge_type', actorId, review.id, { aliases: review.suggestedTypeAliases }, { typeKey, requeued: count });
    this.cardRollups?.markStale();
    return { ...result, requeued: count };
  }

  /** Junta uma sugestão já coberta pela taxonomia sem criar outro tipo. */
  async mergeSuggestedTypeToExisting(reviewId: string, typeKey: string, actorId: string | null = null) {
    const review = await this.pendingTypeReview(reviewId);
    const type = await this.prisma.catalogType.findUnique({ where: { key: typeKey } });
    if (!type) throw new NotFoundException(`Tipo inexistente: ${typeKey}`);
    const where = { typeKey: UNKNOWN_TYPE, suggestedType: { in: review.suggestedTypeAliases }, inScope: { not: false } };
    const fichas = await this.prisma.listingFicha.findMany({ where, select: { id: true } });
    await this.prisma.listingFicha.updateMany({ where, data: { typeKey, suggestedType: null } });
    for (const { id } of fichas) {
      const ficha = await this.prisma.listingFicha.findUnique({ where: { id } });
      if (ficha) await this.assigner.assign(ficha);
    }
    await this.resolveReview(review.id, 'merge_type', actorId);
    const result = await this.decision('merge_type', actorId, review.id,
      { aliases: review.suggestedTypeAliases },
      { typeKey, reattributed: fichas.length },
    );
    return { ...result, reattributed: fichas.length };
  }

  async discardType(reviewId: string, actorId: string) {
    const review = await this.pendingTypeReview(reviewId);
    const where = { typeKey: UNKNOWN_TYPE, suggestedType: { in: review.suggestedTypeAliases }, inScope: { not: false } };
    const fichas = await this.prisma.listingFicha.findMany({ where, select: { id: true } });
    await this.prisma.listingFicha.updateMany({ where, data: { inScope: false } });
    for (const { id } of fichas) {
      const ficha = await this.prisma.listingFicha.findUnique({ where: { id } });
      if (ficha) await this.assigner.assign(ficha);
    }
    await this.resolveReview(review.id, 'discard_type', actorId);
    return this.decision('discard_type', actorId, review.id, { aliases: review.suggestedTypeAliases }, { discarded: fichas.length });
  }

  // ---------- card ----------
  async renameCard(clusterId: string, name: string, actorId: string) {
    const card = await this.prisma.productCluster.findUnique({ where: { id: clusterId } });
    if (!card) throw new NotFoundException('Card inexistente.');
    await this.prisma.productCluster.update({ where: { id: clusterId }, data: { canonicalName: name, nameLocked: true } });
    this.cardRollups?.markStale();
    return this.decision('rename_card', actorId, null,
      { clusterId, name: card.canonicalName, nameLocked: card.nameLocked },
      { clusterId, name, nameLocked: true });
  }

  // ---------- desfazer ----------
  async undo(decisionId: string, actorId: string) {
    const decision = await this.prisma.catalogDecision.findUnique({ where: { id: decisionId } });
    if (!decision) throw new NotFoundException('Decisão inexistente.');
    if (decision.undoneByDecisionId) throw new ConflictException('Esta decisão já foi desfeita.');
    if (!UNDOABLE.has(decision.action)) throw new ConflictException('esta ação não pode ser desfeita');

    if (decision.action === 'rename_card') {
      const before = decision.before as { clusterId: string; name: string; nameLocked: boolean };
      const after = decision.after as { name: string };
      const card = await this.prisma.productCluster.findUnique({ where: { id: before.clusterId } });
      if (!card || card.canonicalName !== after.name) throw new ConflictException('o card foi alterado depois desta decisão');
      await this.prisma.productCluster.update({ where: { id: before.clusterId }, data: { canonicalName: before.name, nameLocked: before.nameLocked } });
    } else {
      const before = decision.before as unknown as ListingState;
      const after = decision.after as unknown as ListingState;
      const now = await this.state(before.listing);
      if (now.clusterId !== after.clusterId || now.status !== after.status) {
        throw new ConflictException('o anúncio foi alterado depois desta decisão');
      }
      await this.assigner.moveListing(before.listing, before.clusterId, before.status ?? 'confirmed');
      if (before.inScope !== after.inScope) {
        await this.prisma.listingFicha.update({
          where: { marketplace_externalProductId: before.listing },
          data: { inScope: before.inScope },
        });
      }
      if (decision.reviewItemId) {
        await this.prisma.catalogReviewItem.update({
          where: { id: decision.reviewItemId },
          data: { status: 'pending', resolution: null, resolvedBy: null, resolvedAt: null },
        });
      }
    }
    const undo = await this.decision('undo', actorId, decision.reviewItemId, decision.after as object, decision.before as object);
    await this.prisma.catalogDecision.update({ where: { id: decision.id }, data: { undoneByDecisionId: undo.decisionId } });
    this.cardRollups?.markStale();
    return undo;
  }

  // ---------- auxiliares ----------
  private listingOf(review: { marketplace: string | null; externalProductId: string | null }): ListingRef {
    return { marketplace: review.marketplace as string, externalProductId: review.externalProductId as string };
  }

  private async pendingListingReview(id: string) {
    const review = await this.prisma.catalogReviewItem.findUnique({ where: { id } });
    if (!review || review.kind !== 'provisional_listing') throw new NotFoundException('Item de revisão inexistente.');
    if (review.status !== 'pending') throw new ConflictException('Este item já foi decidido.');
    return review;
  }

  private async pendingTypeReview(id: string) {
    const review = await this.prisma.catalogReviewItem.findUnique({ where: { id } });
    if (!review || review.kind !== 'suggested_type') throw new NotFoundException('Item de revisão inexistente.');
    if (review.status !== 'pending') throw new ConflictException('Este item já foi decidido.');
    return review;
  }

  private async state(listing: ListingRef): Promise<ListingState> {
    const [item, ficha] = await Promise.all([
      this.prisma.productClusterItem.findUnique({ where: { marketplace_externalProductId: listing } }),
      this.prisma.listingFicha.findUnique({ where: { marketplace_externalProductId: listing } }),
    ]);
    return {
      listing,
      clusterId: item?.clusterId ?? null,
      status: (item?.status as ItemStatus | undefined) ?? null,
      inScope: ficha?.inScope ?? null,
    };
  }

  private async applyListing(
    review: { id: string; marketplace: string | null; externalProductId: string | null },
    action: string,
    before: ListingState,
    target: string,
    status: ItemStatus,
    actorId: string,
  ) {
    const listing = this.listingOf(review);
    await this.assigner.moveListing(listing, target, status);
    await this.assigner.resolveListingReviews(listing, action, actorId);
    const after: ListingState = { listing, clusterId: target, status, inScope: before.inScope };
    return this.decision(action, actorId, review.id, before, after);
  }

  private async resolveReview(id: string, resolution: string, actorId: string | null) {
    await this.prisma.catalogReviewItem.update({
      where: { id },
      data: { status: 'resolved', resolution, resolvedBy: actorId, resolvedAt: new Date() },
    });
  }

  private async decision(action: string, actorId: string | null, reviewItemId: string | null, before: object, after: object) {
    const row = await this.prisma.catalogDecision.create({
      data: {
        action,
        actorUserId: actorId,
        reviewItemId,
        before: before as Prisma.InputJsonValue,
        after: after as Prisma.InputJsonValue,
      },
    });
    return { decisionId: row.id };
  }
}
