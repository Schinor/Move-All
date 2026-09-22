import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import { DiscoveryTermsService } from './discovery-terms.service';

function build() {
  const prisma = {
    searchTrendSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
    keywordTerm: { findMany: jest.fn().mockResolvedValue([]) },
    catalogType: { findMany: jest.fn().mockResolvedValue([]) },
    discoveryTerm: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  };
  return { prisma, service: new DiscoveryTermsService(prisma as unknown as PrismaService) };
}

describe('DiscoveryTermsService', () => {
  const now = new Date('2026-09-22T09:00:00.000Z');

  function seedRadar(prisma: ReturnType<typeof build>['prisma']) {
    prisma.searchTrendSnapshot.findMany.mockResolvedValue([
      { typeKey: 'adjustable_dumbbell', geo: 'US', relatedRising: [
        { query: 'coffee grinder', value: 19750, label: 'Breakout', breakout: true },
        { query: 'nike adjustable dumbbells', value: 800, label: '+800%', breakout: false },
      ] },
      { typeKey: 'aerobic_step', geo: 'US', relatedRising: [
        { query: 'adjustable aerobic step', value: 500, label: '+500%', breakout: false },
      ] },
    ]);
    prisma.keywordTerm.findMany.mockResolvedValue([
      { term: 'halter ajustável', language: 'pt', category: 'adjustable_dumbbell' },
      { term: 'adjustable dumbbells', language: 'en', category: 'adjustable_dumbbell' },
      { term: 'step aeróbico', language: 'pt', category: 'aerobic_step' },
      { term: 'aerobic step', language: 'en', category: 'aerobic_step' },
    ]);
  }

  it('refresh: lê a coleta mais recente com status ok de cada tipo/país', async () => {
    const { prisma, service } = build();
    await service.refresh({ dryRun: true, now });
    expect(prisma.searchTrendSnapshot.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'ok' }, orderBy: { capturedAt: 'desc' }, distinct: ['typeKey', 'geo'],
    }));
  });

  it('refresh: upsert sem mexer no status e resumo por país', async () => {
    const { prisma, service } = build();
    seedRadar(prisma);
    prisma.discoveryTerm.findMany.mockResolvedValue([{ geo: 'US', termNorm: 'adjustable aerobic step' }]);
    const summary = await service.refresh({ now });
    expect(summary).toMatchObject({ dry_run: false, candidates: 2, created: 1, updated: 1, created_by_geo: { US: 1 } });
    expect(prisma.discoveryTerm.upsert).toHaveBeenCalledTimes(2);
    for (const [arg] of prisma.discoveryTerm.upsert.mock.calls) {
      expect(arg.update).not.toHaveProperty('status');
      expect(arg.update).toEqual(expect.objectContaining({ lastSeenAt: now }));
    }
    const created = prisma.discoveryTerm.upsert.mock.calls.map(([a]) => a.create.term);
    expect(created).not.toContain('coffee grinder');
  });

  it('refresh --dry-run não grava', async () => {
    const { prisma, service } = build();
    seedRadar(prisma);
    const summary = await service.refresh({ dryRun: true, now });
    expect(summary.created).toBe(2);
    expect(prisma.discoveryTerm.upsert).not.toHaveBeenCalled();
  });

  it('approve só de new, grava quem e quando', async () => {
    const { prisma, service } = build();
    await expect(service.approve('t1', 'u1')).resolves.toEqual({ id: 't1', status: 'approved' });
    const arg = prisma.discoveryTerm.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 't1', status: { in: ['new'] } });
    expect(arg.data).toEqual(expect.objectContaining({ status: 'approved', decidedBy: 'u1' }));
    expect(arg.data.decidedAt).toBeInstanceOf(Date);
  });

  it('transição inválida → 409; id inexistente → 404', async () => {
    const { prisma, service } = build();
    prisma.discoveryTerm.updateMany.mockResolvedValue({ count: 0 });
    prisma.discoveryTerm.findUnique.mockResolvedValueOnce({ id: 't1', status: 'searched' });
    await expect(service.ignore('t1', 'u1')).rejects.toBeInstanceOf(ConflictException);
    prisma.discoveryTerm.findUnique.mockResolvedValueOnce(null);
    await expect(service.restore('x', 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ignore aceita new e approved; restore volta ignored para new', async () => {
    const { prisma, service } = build();
    await service.ignore('t1', 'u1');
    expect(prisma.discoveryTerm.updateMany.mock.calls[0][0].where).toEqual({ id: 't1', status: { in: ['new', 'approved'] } });
    await service.restore('t1', 'u1');
    expect(prisma.discoveryTerm.updateMany.mock.calls[1][0]).toEqual(expect.objectContaining({
      where: { id: 't1', status: { in: ['ignored'] } },
      data: expect.objectContaining({ status: 'new' }),
    }));
  });

  it('list: aceita vários status, filtra país e família e devolve snake_case com nome do tipo', async () => {
    const { prisma, service } = build();
    prisma.catalogType.findMany.mockResolvedValue([
      { key: 'aerobic_step', namePt: 'Step aeróbico', family: { key: 'accessories' } },
      { key: 'spin_bike', namePt: 'Bike spinning', family: { key: 'bikes' } },
    ]);
    prisma.discoveryTerm.findMany.mockResolvedValue([{
      id: 't1', typeKey: 'aerobic_step', geo: 'US', term: 'adjustable aerobic step', risingLabel: '+500%', breakout: false,
      firstSeenAt: now, lastSeenAt: now, status: 'searched', searchedAt: now, newListings: 14, searchError: null,
    }]);
    const out = await service.list({ status: 'approved,searched', geo: 'US', family: 'accessories' });
    const where = prisma.discoveryTerm.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ status: { in: ['approved', 'searched'] }, geo: 'US', typeKey: { in: ['aerobic_step'] } });
    expect(out[0]).toEqual({
      id: 't1', term: 'adjustable aerobic step', geo: 'US', type_key: 'aerobic_step', type_name: 'Step aeróbico',
      family_key: 'accessories', rising_label: '+500%', breakout: false, first_seen_at: now.toISOString(),
      last_seen_at: now.toISOString(), status: 'searched', searched_at: now.toISOString(), new_listings: 14, search_error: null,
    });
  });

  it('counts: devolve as 4 chaves mesmo sem linhas', async () => {
    const { prisma, service } = build();
    prisma.discoveryTerm.groupBy.mockResolvedValue([{ status: 'new', _count: { _all: 3 } }]);
    await expect(service.counts()).resolves.toEqual({ new: 3, approved: 0, searched: 0, ignored: 0 });
  });
});
