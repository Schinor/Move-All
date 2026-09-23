import { PrismaService } from '../database/prisma.service';
import * as sql from './card-rollup.sql';
import { CardRollupsService } from './card-rollups.service';

function build(state: { computedAt: Date; stale: boolean } | null) {
  const store: Array<{ productClusterId: string; category: string | null; sortOrder: number; row: unknown }> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    cardRollupState: {
      findUnique: jest.fn().mockResolvedValue(state),
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
    cardRollup: {
      deleteMany: jest.fn().mockResolvedValue({}),
      createMany: jest.fn(async ({ data }: { data: typeof store }) => { store.push(...data); return { count: data.length }; }),
      findMany: jest.fn(async ({ where }: { where: { category?: string } }) => store
        .filter((r) => !where.category || r.category === where.category)
        .sort((a, b) => a.sortOrder - b.sortOrder)),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const rows = [
    { id: 'c1', category: 'bikes', canonical_name: 'B', first_collected_at: new Date('2026-01-01T00:00:00Z') },
    { id: 'c2', category: 'mats', canonical_name: 'M', first_collected_at: new Date('2026-01-02T00:00:00Z') },
  ];
  const query = jest.spyOn(sql, 'queryCardRollupRows').mockResolvedValue(rows as never);
  return { prisma, query, service: new CardRollupsService(prisma as unknown as PrismaService) };
}

describe('CardRollupsService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sem estado: calcula, grava em ordem e lê', async () => {
    const { service, query, prisma } = build(null);
    const out = await service.getRows();
    expect(query).toHaveBeenCalledTimes(1);
    expect(prisma.cardRollup.createMany.mock.calls[0][0].data.map((d: { sortOrder: number }) => d.sortOrder)).toEqual([0, 1]);
    expect(out.map((r: unknown) => (r as { id: string }).id)).toEqual(['c1', 'c2']);
    expect(prisma.cardRollupState.upsert).toHaveBeenCalled();
  });

  it('grava números da linha e sparklines como texto sem alterar id e categoria', async () => {
    const { service, query, prisma } = build(null);
    const precision = 100.46621666666667;
    query.mockResolvedValue([{
      id: 'precision',
      category: 'bikes',
      financial_score: 82.5,
      volume_spark: [precision],
      demand_spark: [precision],
    }] as never);
    await service.refresh();
    const stored = prisma.cardRollup.createMany.mock.calls[0][0].data[0].row;
    const metadata = prisma.cardRollup.createMany.mock.calls[0][0].data[0];
    expect(stored.id).toBe('precision');
    expect(stored.category).toBe('bikes');
    expect(metadata.productClusterId).toBe('precision');
    expect(metadata.category).toBe('bikes');
    expect(stored.financial_score).toBe('82.5');
    expect(stored.volume_spark).toEqual([String(precision)]);
    expect(stored.demand_spark).toEqual([String(precision)]);
  });

  it('estado recente e não stale: não recalcula; filtra por categoria', async () => {
    const { service, query, prisma } = build({ computedAt: new Date(), stale: false });
    prisma.cardRollup.findMany.mockResolvedValue([{ productClusterId: 'c2', category: 'mats', sortOrder: 0, row: { id: 'c2', category: 'mats' } }]);
    const out = await service.getRows('mats');
    expect(query).not.toHaveBeenCalled();
    expect(prisma.cardRollup.findMany.mock.calls[0][0].where).toEqual({ includeSynthetic: expect.any(Boolean), category: 'mats' });
    expect(out).toEqual([{ id: 'c2', category: 'mats' }]);
  });

  it('stale ou velho demais: recalcula', async () => {
    const stale = build({ computedAt: new Date(), stale: true });
    await stale.service.getRows();
    expect(stale.query).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
    const old = build({ computedAt: new Date(Date.now() - 2 * 3600_000), stale: false });
    await old.service.getRows();
    expect(old.query).toHaveBeenCalledTimes(1);
  });

  it('refresh simultâneo roda uma vez', async () => {
    const { service, query } = build(null);
    await Promise.all([service.refresh(), service.refresh(), service.refresh()]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('obtém a trava advisory antes de apagar rollups', async () => {
    const { service, prisma } = build(null);
    await service.refresh();
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw.mock.calls[0][0][0]).toBe(
      "SELECT pg_advisory_xact_lock(hashtext('card_rollups_refresh'))",
    );
    expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.cardRollup.deleteMany.mock.invocationCallOrder[0],
    );
  });

  it('marca feita durante refresh mantém estado stale', async () => {
    const { service, prisma } = build(null);
    (service as any).lastMarkAt = Date.now() + 60_000;
    await service.refresh();
    expect(prisma.cardRollupState.upsert.mock.calls[0][0].create.stale).toBe(true);
    expect(prisma.cardRollupState.upsert.mock.calls[0][0].update.stale).toBe(true);
  });

  it('markStale grava no máximo uma vez a cada 2 s e agenda recálculo', async () => {
    jest.useFakeTimers();
    const { service, prisma } = build({ computedAt: new Date(), stale: false });
    const refresh = jest.spyOn(service, 'refresh').mockResolvedValue(0);
    service.markStale();
    service.markStale();
    expect(prisma.cardRollupState.updateMany).toHaveBeenCalledTimes(1);
    await jest.runOnlyPendingTimersAsync();
    expect(refresh).toHaveBeenCalled();
    jest.useRealTimers();
  });
});
