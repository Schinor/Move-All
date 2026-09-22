import { PrismaService } from '../../shared/database/prisma.service';
import { TrackingTiersService } from './tracking-tiers.service';

const now = new Date('2026-09-22T12:00:00.000Z');
const env = { TRACK_TOP_CARDS: '1', TRACK_TIER1_SLOTS: '1', TRACK_TIER2_SLOTS: '0' } as NodeJS.ProcessEnv;

function tracked(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, source: 'amazon', nativeId: id, productId: 'A', status: 'ACTIVE', tier: 2, tierReason: null,
    nextDueAt: new Date('2026-10-20T00:00:00.000Z'), lastSuccessAt: new Date('2026-09-20T00:00:00.000Z'),
    firstSeenAt: new Date('2026-08-01T00:00:00.000Z'), discoveredByTerm: null, ...extra,
  };
}

function build(rows: ReturnType<typeof tracked>[], opts: { fichas?: unknown[]; items?: unknown[] } = {}) {
  const prisma = {
    trackedListing: {
      findMany: jest.fn().mockResolvedValue(rows),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    listingFicha: { findMany: jest.fn().mockResolvedValue(opts.fichas ?? []) },
    productClusterItem: {
      findMany: jest.fn().mockResolvedValue(
        opts.items ?? rows.map((row) => ({ marketplace: row.source, externalProductId: row.nativeId, clusterId: row.productId, status: 'confirmed' })),
      ),
    },
    listingObservation: { findMany: jest.fn().mockResolvedValue([]) },
    productScore: { findMany: jest.fn().mockResolvedValue([{ productClusterId: 'A', score: 90, computedAt: now }]) },
    watchlistItem: { findMany: jest.fn().mockResolvedValue([]) },
    searchTrendSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
    productCluster: { findMany: jest.fn().mockResolvedValue([]) },
    discoveryTerm: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };
  return { prisma, service: new TrackingTiersService(prisma as unknown as PrismaService) };
}

describe('TrackingTiersService.recalculate', () => {
  it('status: fora do escopo e sem card com ficha pronta → IGNORED; candidato em card contado → ACTIVE', async () => {
    const rows = [tracked('t1'), tracked('t2'), tracked('t3', { status: 'CANDIDATE' }), tracked('t4')];
    const { prisma, service } = build(rows, {
      fichas: [
        { marketplace: 'amazon', externalProductId: 't1', status: 'done', inScope: false },
        { marketplace: 'amazon', externalProductId: 't2', status: 'done', inScope: true },
        { marketplace: 'amazon', externalProductId: 't4', status: 'pending', inScope: null },
      ],
      items: [
        { marketplace: 'amazon', externalProductId: 't1', clusterId: 'A', status: 'confirmed' },
        { marketplace: 'amazon', externalProductId: 't3', clusterId: 'A', status: 'auto' },
      ],
    });
    const out = await service.recalculate({ now, env });
    expect(out.status_changes).toEqual({ ignored: 2, activated: 1 });
    expect(prisma.trackedListing.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['t1', 't2'] } }, data: { status: 'IGNORED' } });
    expect(prisma.trackedListing.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['t3'] } }, data: { status: 'ACTIVE' } });
  });

  it('subiu de nível: adianta a próxima visita; desceu: mantém a data', async () => {
    const rows = [
      tracked('up', { tier: 3 }),
      tracked('down', { tier: 1, tierReason: 'top50', nextDueAt: new Date('2026-09-25T00:00:00.000Z') }),
    ];
    const { prisma, service } = build(rows);
    prisma.listingObservation.findMany.mockResolvedValue([{ listingId: 'up', reviewsCount: 10 }, { listingId: 'down', reviewsCount: 1 }]);
    await service.recalculate({ now, env });
    const calls = prisma.trackedListing.update.mock.calls.map(([arg]) => arg);
    const up = calls.find((call) => call.where.id === 'up');
    expect(up.data).toEqual(expect.objectContaining({ tier: 1, tierReason: 'top50', nextDueAt: new Date('2026-09-23T12:00:00.000Z') }));
    const down = calls.find((call) => call.where.id === 'down');
    expect(down.data).toEqual(expect.objectContaining({ tier: 3, tierReason: 'demais' }));
    expect(down.data).not.toHaveProperty('nextDueAt');
  });

  it('grava só o que mudou e calcula a estimativa semanal', async () => {
    const rows = [tracked('same', { tier: 1, tierReason: 'top50' }), tracked('other', { tier: 3, tierReason: 'demais' })];
    const { prisma, service } = build(rows);
    prisma.listingObservation.findMany.mockResolvedValue([{ listingId: 'same', reviewsCount: 99 }]);
    const out = await service.recalculate({ now, env });
    expect(prisma.trackedListing.update).not.toHaveBeenCalled();
    expect(out).toMatchObject({ dry_run: false, tier1: 1, tier2: 0, tier3: 1, changed: 0, by_reason: { top50: 1, demais: 1 } });
    // 7/3.5 + 7/30 = 2.23 → arredonda para 2
    expect(out.estimated_weekly_calls).toBe(2);
  });

  it('dry-run não grava nada', async () => {
    const { prisma, service } = build([tracked('t1', { tier: 3 })], {
      fichas: [{ marketplace: 'amazon', externalProductId: 'x', status: 'done', inScope: false }],
    });
    const out = await service.recalculate({ dryRun: true, now, env });
    expect(out.dry_run).toBe(true);
    expect(prisma.trackedListing.update).not.toHaveBeenCalled();
    expect(prisma.trackedListing.updateMany).not.toHaveBeenCalled();
  });

  it('descoberta recente e card em alta no radar entram no nível 2', async () => {
    const rows = [
      tracked('a1', { tier: 3 }),
      tracked('d1', { tier: 3, productId: null, discoveredByTerm: 'Nike Adjustable Dumbbells', firstSeenAt: new Date('2026-09-15T00:00:00.000Z') }),
      tracked('h1', { tier: 3, productId: 'H' }),
    ];
    const { prisma, service } = build(rows, {
      items: [
        { marketplace: 'amazon', externalProductId: 'a1', clusterId: 'A', status: 'confirmed' },
        { marketplace: 'amazon', externalProductId: 'h1', clusterId: 'H', status: 'confirmed' },
      ],
    });
    prisma.discoveryTerm.findMany.mockResolvedValue([{ termNorm: 'nike adjustable dumbbells' }]);
    prisma.productCluster.findMany.mockResolvedValue([{ id: 'H', type: { key: 'kettlebell' } }, { id: 'A', type: { key: 'spin_bike' } }]);
    prisma.searchTrendSnapshot.findMany.mockResolvedValue([
      { typeKey: 'kettlebell', geo: 'BR', growth12w: 0.1 },
      { typeKey: 'kettlebell', geo: 'US', growth12w: 0.45 },
      { typeKey: 'spin_bike', geo: 'BR', growth12w: 0.19 },
    ]);
    const out = await service.recalculate({ now, env: { ...env, TRACK_TIER2_SLOTS: '5' } });
    expect(out.by_reason).toEqual({ top50: 1, descoberta: 1, radar: 1 });
  });
});
