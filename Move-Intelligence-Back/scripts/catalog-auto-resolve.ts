import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AutoResolvePreview, CardAssignerService, ListingRef } from '../src/modules/catalog/card-assigner.service';
import { FichaService } from '../src/modules/catalog/ficha.service';
import { autoAssignConfig } from '../src/modules/catalog/catalog.constants';
import { ProductsService } from '../src/modules/products/products.service';
import { PrismaService } from '../src/shared/database/prisma.service';

export interface AutoResolveReport {
  mode: 'dry-run' | 'apply';
  pendingReviews: number;
  inspected: number;
  singleCandidate: number;
  bestSimilarity: number;
  pendingDifferential: number;
  differentialCards: number;
  requeued: number;
  continuedReview: number;
  examples: Array<{ title: string; cardId: string; similarity: number; margin: number | null }>;
  similarityDistribution: Record<string, number>;
  marginDistribution: Record<string, number>;
}

export interface AutoResolveDependencies {
  prisma: PrismaService;
  assigner: CardAssignerService;
  fichas: FichaService;
}

interface PreviewWithFicha {
  ficha: { title: string; marketplace: string; externalProductId: string };
  preview: AutoResolvePreview;
}

function bucket(value: number): string {
  const start = Math.min(0.95, Math.max(0, Math.floor(value / 0.05 + 1e-9) * 0.05));
  return `${start.toFixed(2)}-${(start + 0.05).toFixed(2)}`;
}

function addBucket(target: Record<string, number>, value: number | undefined): void {
  if (value === undefined || !Number.isFinite(value)) return;
  const key = bucket(value);
  target[key] = (target[key] ?? 0) + 1;
}

function listingKey(listing: ListingRef): string {
  return `${listing.marketplace}::${listing.externalProductId}`;
}

function emptyReport(mode: AutoResolveReport['mode'], pendingReviews: number): AutoResolveReport {
  return {
    mode,
    pendingReviews,
    inspected: 0,
    singleCandidate: 0,
    bestSimilarity: 0,
    pendingDifferential: 0,
    differentialCards: 0,
    requeued: 0,
    continuedReview: 0,
    examples: [],
    similarityDistribution: {},
    marginDistribution: {},
  };
}

async function autoRequeueCounts(prisma: PrismaService): Promise<Map<string, number>> {
  const rows = await prisma.catalogDecision.findMany({
    where: { action: 'auto_requeue' },
    select: { before: true, after: true },
  });
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const value of [row.before, row.after]) {
      if (!value || typeof value !== 'object') continue;
      const listing = (value as { listing?: unknown }).listing;
      if (!listing || typeof listing !== 'object') continue;
      const ref = listing as { marketplace?: unknown; externalProductId?: unknown };
      if (typeof ref.marketplace !== 'string' || typeof ref.externalProductId !== 'string') continue;
      const key = listingKey({ marketplace: ref.marketplace, externalProductId: ref.externalProductId });
      counts.set(key, (counts.get(key) ?? 0) + 1);
      break;
    }
  }
  return counts;
}

function countPreview(report: AutoResolveReport, item: PreviewWithFicha, differentialKeys: Set<string>): void {
  const { preview } = item;
  report.inspected += 1;
  if (preview.kind === 'single_candidate') report.singleCandidate += 1;
  if (preview.kind === 'best_similarity') report.bestSimilarity += 1;
  if (preview.kind === 'pending_differential') report.pendingDifferential += 1;
  if (preview.kind === 'promote_differential') differentialKeys.add(preview.cardKey ?? `${item.ficha.marketplace}::${item.ficha.externalProductId}`);
  if (preview.kind === 'review' || preview.kind === 'error') report.continuedReview += 1;
  addBucket(report.similarityDistribution, preview.similarity);
  addBucket(report.marginDistribution, preview.margin);
  if (preview.kind === 'best_similarity' && preview.clusterId && report.examples.length < 15) {
    report.examples.push({
      title: item.ficha.title,
      cardId: preview.clusterId,
      similarity: preview.similarity ?? 0,
      margin: preview.margin ?? null,
    });
  }
}

async function listPendingReviews(prisma: PrismaService) {
  return prisma.catalogReviewItem.findMany({
    where: { kind: 'provisional_listing', status: 'pending' },
    orderBy: { createdAt: 'asc' },
    select: { marketplace: true, externalProductId: true },
  });
}

async function assertAutomaticDecisionSchema(prisma: PrismaService): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ is_nullable: string }>>`
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'catalog_decisions' AND column_name = 'actor_user_id'`;
  if (rows[0]?.is_nullable !== 'YES') {
    throw new Error('catalog:auto-resolve --apply bloqueado: aplique a migration 20260919120000_catalog_auto_assign antes de gravar decisões automáticas.');
  }
}

export async function runAutoResolve(
  deps: AutoResolveDependencies,
  options: { apply: boolean },
): Promise<AutoResolveReport> {
  if (options.apply) await assertAutomaticDecisionSchema(deps.prisma);
  const reviews = await listPendingReviews(deps.prisma);
  const report = emptyReport(options.apply ? 'apply' : 'dry-run', reviews.length);
  const differentialKeys = new Set<string>();
  const refresh = new Map<string, string | null>();
  const requeueCounts = options.apply ? new Map<string, number>() : await autoRequeueCounts(deps.prisma);
  const maxRequeues = autoAssignConfig().maxRequeues;

  for (const review of reviews) {
    if (!review.marketplace || !review.externalProductId) continue;
    const listing = { marketplace: review.marketplace, externalProductId: review.externalProductId };
    const ficha = await deps.prisma.listingFicha.findUnique({ where: { marketplace_externalProductId: listing } });
    if (!ficha) continue;
    const fichaRef = { title: ficha.title, ...listing };

    if (options.apply) {
      if (ficha.status === 'error') {
        const result = await deps.fichas.autoResolveError(ficha);
        if (result === 'requeued') report.requeued += 1;
        else report.continuedReview += 1;
        report.inspected += 1;
        continue;
      }
      const result = await deps.assigner.assign(ficha, { deferRefresh: true });
      report.inspected += 1;
      if (result.outcome === 'auto') {
        for (const clusterId of result.touched) {
          refresh.set(clusterId, clusterId === result.clusterId ? null : result.clusterId);
        }
      } else if (result.outcome === 'provisional' || result.outcome === 'error_review') {
        report.continuedReview += 1;
      }
      continue;
    }

    const preview = await deps.assigner.previewAutoResolution(ficha);
    countPreview(report, { ficha: fichaRef, preview }, differentialKeys);
    if (preview.kind === 'error') {
      const count = requeueCounts.get(listingKey(listing)) ?? 0;
      if (count < maxRequeues) {
        report.requeued += 1;
        report.continuedReview -= 1;
      }
    }
  }

  report.differentialCards = differentialKeys.size;
  if (options.apply) {
    await deps.assigner.refreshMany([...refresh].map(([clusterId, lastDestination]) => ({ clusterId, lastDestination })));
  }
  return report;
}

export async function finalizeScores(products: ProductsService): Promise<number> {
  let total = 0;
  for (let i = 0; i < 20; i += 1) {
    const batch = await products.simulateBatchForRanking(50);
    total += batch.simulated;
    if (batch.candidates === 0) break;
  }
  return total;
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (process.env.FICHA_ENABLED === 'true') {
    throw new Error('FICHA_ENABLED=true detectado; mantenha FICHA_ENABLED=false antes do auto-resolve');
  }
  process.env.FICHA_ENABLED = 'false';

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const deps: AutoResolveDependencies = {
      prisma: app.get(PrismaService),
      assigner: app.get(CardAssignerService),
      fichas: app.get(FichaService),
    };
    const report = await runAutoResolve(deps, { apply });
    const cardIds = report.examples.map((example) => example.cardId);
    const cards = cardIds.length
      ? await deps.prisma.productCluster.findMany({ where: { id: { in: cardIds } }, select: { id: true, canonicalName: true } })
      : [];
    const names = new Map(cards.map((card) => [card.id, card.canonicalName]));
    console.log(JSON.stringify({
      ...report,
      examples: report.examples.map((example) => ({ ...example, cardName: names.get(example.cardId) ?? example.cardId })),
    }, null, 2));
    if (apply) {
      const simulated = await finalizeScores(app.get(ProductsService));
      console.log(`catalog:auto-resolve — scores recalculados: ${simulated}`);
    }
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
