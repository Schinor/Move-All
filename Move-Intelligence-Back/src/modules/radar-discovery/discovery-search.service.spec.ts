import { PrismaService } from '../../shared/database/prisma.service';
import { DISCOVERY_SOURCES, DiscoverySearchService } from './discovery-search.service';

const ON = { RADAR_DISCOVERY_ENABLED: 'true', FICHA_ENABLED: 'true' } as NodeJS.ProcessEnv;

function build(rows: Array<{ id: string; term: string; geo: string }>) {
  const prisma = {
    discoveryTerm: {
      findMany: jest.fn().mockResolvedValue(rows),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  return { prisma, service: new DiscoverySearchService(prisma as unknown as PrismaService) };
}

describe('DiscoverySearchService', () => {
  it('desligado → skipped, sem chamar nada', async () => {
    const { prisma, service } = build([{ id: 't1', term: 'x', geo: 'US' }]);
    const runTerm = jest.fn();
    const out = await service.runApproved({ runTerm, env: { RADAR_DISCOVERY_ENABLED: 'true' } as NodeJS.ProcessEnv });
    expect(out.skipped).toBe('disabled');
    expect(runTerm).not.toHaveBeenCalled();
    expect(prisma.discoveryTerm.findMany).not.toHaveBeenCalled();
  });

  it('busca os aprovados mais antigos, um por vez, com as fontes do país e o termo literal', async () => {
    expect(DISCOVERY_SOURCES.US).toEqual(['amazon', 'alibaba', 'aliexpress']);
    const { prisma, service } = build([
      { id: 't1', term: 'nike adjustable dumbbells', geo: 'US' },
      { id: 't2', term: 'reformer dobrável', geo: 'BR' },
    ]);
    const runTerm = jest.fn()
      .mockResolvedValueOnce({ id: 'job-1', status: 'SUCCESS', stats: { tracked_new: 14 }, errorMessage: null })
      .mockResolvedValueOnce({ id: 'job-2', status: 'PARTIAL', stats: {}, errorMessage: 'shopee falhou' });
    const out = await service.runApproved({ runTerm, env: ON });

    expect(prisma.discoveryTerm.findMany).toHaveBeenCalledWith({
      where: { status: 'approved' }, orderBy: [{ decidedAt: 'asc' }, { id: 'asc' }], take: 5,
    });
    expect(runTerm).toHaveBeenNthCalledWith(1, {
      term: 'nike adjustable dumbbells', sources: DISCOVERY_SOURCES.US, limit: 10, geos: ['US'],
      includeDemand: false, exactTerm: true, windowDays: 7,
    }, 'radar_discovery');
    expect(runTerm.mock.calls[1][0].sources).toEqual(['amazon_br', 'mercado_livre', 'shopee_br']);
    expect(prisma.discoveryTerm.update).toHaveBeenNthCalledWith(1, {
      where: { id: 't1' },
      data: expect.objectContaining({ status: 'searched', searchJobId: 'job-1', newListings: 14, searchError: null }),
    });
    expect(prisma.discoveryTerm.update.mock.calls[1][0].data).toEqual(expect.objectContaining({ status: 'searched', newListings: 0 }));
    expect(out).toMatchObject({ skipped: null, searched: 2, failed: 0 });
  });

  it('falha grava search_error, mantém approved e segue para o próximo', async () => {
    const { prisma, service } = build([
      { id: 't1', term: 'a', geo: 'US' },
      { id: 't2', term: 'b', geo: 'US' },
    ]);
    const runTerm = jest.fn()
      .mockResolvedValueOnce({ id: 'job-1', status: 'FAILED', stats: {}, errorMessage: 'Bright Data fora do ar' })
      .mockRejectedValueOnce(new Error('spawn python3 ENOENT'));
    const out = await service.runApproved({ runTerm, env: ON });
    const first = prisma.discoveryTerm.update.mock.calls[0][0];
    expect(first.data).toEqual({ searchError: 'Bright Data fora do ar', searchJobId: 'job-1' });
    expect(first.data).not.toHaveProperty('status');
    expect(prisma.discoveryTerm.update.mock.calls[1][0].data.searchError).toBe('spawn python3 ENOENT');
    expect(out).toMatchObject({ searched: 0, failed: 2 });
  });

  it('respeita o limite (env e parâmetro) e o dry-run só lista', async () => {
    const { prisma, service } = build([{ id: 't1', term: 'a', geo: 'BR' }]);
    const runTerm = jest.fn();
    const out = await service.runApproved({ runTerm, dryRun: true, maxTerms: 1, env: {} as NodeJS.ProcessEnv });
    expect(prisma.discoveryTerm.findMany.mock.calls[0][0].take).toBe(1);
    expect(runTerm).not.toHaveBeenCalled();
    expect(out.terms).toEqual([{ id: 't1', term: 'a', geo: 'BR', sources: ['amazon_br', 'mercado_livre', 'shopee_br'] }]);
    await service.runApproved({ runTerm: jest.fn(), env: { ...ON, RADAR_DISCOVERY_MAX_TERMS: '2' } });
    expect(prisma.discoveryTerm.findMany.mock.calls[1][0].take).toBe(2);
  });
});
