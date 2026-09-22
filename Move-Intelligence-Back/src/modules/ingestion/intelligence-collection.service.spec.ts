import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import { FichaService } from '../catalog/ficha.service';
import { ProductsService } from '../products/products.service';
import { DiscoverySearchService } from '../radar-discovery/discovery-search.service';
import { IntelligenceCollectionService } from './intelligence-collection.service';
import { RunTrackListingsDto } from './dto/run-track-listings.dto';
import { RunIntelligenceCollectionDto } from './dto/run-intelligence-collection.dto';
import { RunWeeklyIntelligenceCollectionDto } from './dto/run-weekly-intelligence-collection.dto';
import { TrackingTiersService } from './tracking-tiers.service';

function buildService() {
  const collectionJob = {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback({ collectionJob }),
    ),
    collectionJob,
    listingObservation: { findMany: jest.fn() },
    productListingSnapshot: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    trackedListing: {
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    productCluster: { findMany: jest.fn().mockResolvedValue([]) },
    productScore: { findMany: jest.fn().mockResolvedValue([]) },
    intelligenceProduct: { findFirst: jest.fn().mockResolvedValue(null) },
    watchlistItem: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const fichas = {
    registerListing: jest.fn().mockResolvedValue('created'),
    currentCardId: jest.fn().mockResolvedValue(null),
  };
  const products = {
    simulateBatchForRanking: jest.fn().mockResolvedValue({ simulated: 0 }),
  };
  const discovery = { runApproved: jest.fn().mockResolvedValue({ skipped: 'disabled', searched: 0, failed: 0, terms: [] }) };
  const tiers = { recalculate: jest.fn().mockResolvedValue({ tier1: 0, tier2: 0, tier3: 0 }) };
  const service = new IntelligenceCollectionService(
    prisma as unknown as PrismaService,
    fichas as unknown as FichaService,
    products as unknown as ProductsService,
    discovery as unknown as DiscoverySearchService,
    tiers as unknown as TrackingTiersService,
  );
  return { service, prisma, fichas, products, discovery, tiers };
}

describe('IntelligenceCollectionService — track-listings (F1.5)', () => {
  it('startTrackListings recusa quando já há acompanhamento ativo (lock)', async () => {
    const { service, prisma } = buildService();
    prisma.collectionJob.findFirst.mockResolvedValue({ id: 'job-ativo' });

    await expect(service.startTrackListings(new RunTrackListingsDto())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.collectionJob.create).not.toHaveBeenCalled();
  });

  it('syncObservationsToSnapshots grava snapshot real e registra o anúncio na ficha', async () => {
    const { service, prisma, fichas } = buildService();
    const observedAt = new Date('2026-09-14T12:00:00.000Z');
    prisma.listingObservation.findMany.mockResolvedValue([
      {
        id: 'obs-1',
        price: 199.9,
        currency: 'BRL',
        rating: 4.8,
        reviewsCount: 10,
        soldCountLower: 100,
        scrapeStatus: 'ok',
        observedAt,
        listing: {
          id: 'listing-1',
          source: 'amazon_br',
          nativeId: 'B000000001',
          canonicalUrl: 'https://www.amazon.com.br/dp/B000000001',
          productId: null,
        },
      },
    ]);
    prisma.productListingSnapshot.findFirst.mockResolvedValue(null);
    const result = await (service as any).syncObservationsToSnapshots(['obs-1']);

    expect(result).toEqual({ analytical_snapshots: 1, registered_listings: 1 });
    expect(fichas.registerListing).toHaveBeenCalledWith({
      marketplace: 'amazon_br',
      externalProductId: 'B000000001',
      title: 'https://www.amazon.com.br/dp/B000000001',
      excerpt: null,
    });
    expect(prisma.productListingSnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        marketplace: 'amazon_br',
        externalProductId: 'B000000001',
        // Coleta real: nunca sintético; vendedor desconhecido: null.
        isSynthetic: false,
        sellerName: null,
        productClusterId: null,
      }),
    });
  });

  it('syncObservationsToSnapshots usa o título real na ficha (A3.2)', async () => {
    const { service, prisma, fichas } = buildService();
    const observedAt = new Date('2026-09-14T12:00:00.000Z');
    const discovered = {
      id: 'prod-1',
      source: 'amazon_br',
      recordId: 'B000000001',
      title: 'Halter Ajustável 24kg Par',
    };
    prisma.intelligenceProduct.findFirst.mockResolvedValue(discovered);
    prisma.listingObservation.findMany.mockResolvedValue([
      {
        id: 'obs-2',
        price: 199.9,
        currency: 'BRL',
        rating: 4.8,
        reviewsCount: 10,
        soldCountLower: 100,
        scrapeStatus: 'ok',
        observedAt,
        listing: {
          id: 'listing-2',
          source: 'amazon_br',
          nativeId: 'B000000001',
          canonicalUrl: 'https://www.amazon.com.br/dp/B000000001',
          productId: null,
        },
      },
    ]);
    prisma.productListingSnapshot.findFirst.mockResolvedValue(null);

    const result = await (service as any).syncObservationsToSnapshots(['obs-2']);

    expect(result).toEqual({ analytical_snapshots: 1, registered_listings: 1 });
    expect(prisma.intelligenceProduct.findFirst).toHaveBeenCalledWith({
      where: { source: 'amazon_br', recordId: 'B000000001' },
      orderBy: { capturedAt: 'desc' },
    });
    expect(fichas.registerListing).toHaveBeenCalledWith({
      marketplace: 'amazon_br',
      externalProductId: 'B000000001',
      title: 'Halter Ajustável 24kg Par',
      excerpt: null,
    });
  });

  it('syncObservationsToSnapshots pula observação sem preço', async () => {
    const { service, prisma } = buildService();
    prisma.listingObservation.findMany.mockResolvedValue([
      {
        id: 'obs-blocked',
        price: null,
        scrapeStatus: 'ok',
        observedAt: new Date(),
        listing: { id: 'listing-9', source: 'amazon_br', nativeId: 'B9', canonicalUrl: 'https://x', productId: null },
      },
    ]);

    const result = await (service as any).syncObservationsToSnapshots(['obs-blocked']);

    expect(result).toEqual({ analytical_snapshots: 0, registered_listings: 0 });
    expect(prisma.productListingSnapshot.create).not.toHaveBeenCalled();
  });

  it('syncObservationsToSnapshots pula observação partial mesmo com preço (A3.1)', async () => {
    const { service, prisma } = buildService();
    prisma.listingObservation.findMany.mockResolvedValue([
      {
        id: 'obs-partial',
        price: 199.9,
        currency: 'BRL',
        scrapeStatus: 'partial',
        observedAt: new Date(),
        listing: { id: 'listing-8', source: 'amazon_br', nativeId: 'B8', canonicalUrl: 'https://x', productId: 'cluster-x' },
      },
    ]);

    const result = await (service as any).syncObservationsToSnapshots(['obs-partial']);

    expect(result).toEqual({ analytical_snapshots: 0, registered_listings: 0 });
    expect(prisma.productListingSnapshot.create).not.toHaveBeenCalled();
  });

  describe('descoberta pelo radar (Subprojeto D)', () => {
    it('buildLiveArgs passa --exact-term só quando pedido', () => {
      const { service } = buildService();
      const dto = Object.assign(new RunIntelligenceCollectionDto(), {
        term: 'nike adjustable dumbbells', sources: ['amazon'], limit: 10, geos: ['US'], includeDemand: false,
      });
      expect((service as any).buildLiveArgs('main.py', dto)).not.toContain('--exact-term');
      const args = (service as any).buildLiveArgs('main.py', { ...dto, exactTerm: true });
      expect(args).toEqual(expect.arrayContaining(['--term', 'nike adjustable dumbbells', '--skip-demand', '--exact-term']));
    });

    it('runTermAndWait cria o job com a categoria, espera o execute e devolve o job final', async () => {
      const { service, prisma } = buildService();
      prisma.collectionJob.create.mockResolvedValue({ id: 'job-1' });
      prisma.collectionJob.findUniqueOrThrow.mockResolvedValue({ id: 'job-1', status: 'SUCCESS', stats: { tracked_new: 3 }, errorMessage: null });
      const execute = jest.spyOn(service as any, 'execute').mockResolvedValue(undefined);
      const dto = Object.assign(new RunIntelligenceCollectionDto(), { term: 'x', sources: ['amazon'], limit: 10, geos: ['US'], includeDemand: false, exactTerm: true });
      const job = await service.runTermAndWait(dto, 'radar_discovery');
      expect(prisma.collectionJob.create.mock.calls[0][0].data).toEqual(expect.objectContaining({ category: 'radar_discovery', queryTerm: 'x' }));
      expect(execute).toHaveBeenCalledWith('job-1', dto);
      expect(job).toEqual(expect.objectContaining({ id: 'job-1', stats: { tracked_new: 3 } }));
    });

    it('coleta semanal roda a descoberta antes e não cai se ela falhar', async () => {
      const { service, prisma, discovery } = buildService();
      const order: string[] = [];
      discovery.runApproved.mockImplementation(async () => { order.push('discovery'); throw new Error('boom'); });
      jest.spyOn(service as any, 'runPythonWeekly').mockImplementation(async () => {
        order.push('weekly');
        return { term: '', cluster: '', products: 0, demand_signals: 0, product_demand_links: 0, product_ids: [], failures: [] };
      });
      jest.spyOn(service as any, 'syncAnalyticalModels').mockResolvedValue(0);
      jest.spyOn(service as any, 'scheduleRankingSimulation').mockImplementation(() => undefined);
      await (service as any).executeWeekly('job-w', new RunWeeklyIntelligenceCollectionDto());
      expect(order).toEqual(['discovery', 'weekly']);
      const finalUpdate = prisma.collectionJob.update.mock.calls.at(-1)![0];
      expect(finalUpdate.data.status).toBe('SUCCESS');
      expect(finalUpdate.data.stats).toEqual(expect.objectContaining({ radar_discovery: { error: 'boom' } }));
    });
  });
});
