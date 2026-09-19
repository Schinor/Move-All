import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import { FichaService } from '../catalog/ficha.service';
import { ProductsService } from '../products/products.service';
import { IntelligenceCollectionService } from './intelligence-collection.service';
import { RunTrackListingsDto } from './dto/run-track-listings.dto';

function buildService() {
  const collectionJob = {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
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
  const service = new IntelligenceCollectionService(
    prisma as unknown as PrismaService,
    fichas as unknown as FichaService,
    products as unknown as ProductsService,
  );
  return { service, prisma, fichas, products };
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

  it('promoteTiers: top 50 → 1, 51–300 → 2, restante → 3, watchlist sempre 1 (A3.3: pelo ProductScore)', async () => {
    const { service, prisma } = buildService();
    const now = new Date('2026-09-14T12:00:00.000Z');
    // Último score por cluster vence: cluster-1 tem linha antiga alta e linha
    // nova baixa (vale a nova); cluster-100 tem score de tier 2 mas é watchlist.
    const scoreRows: Array<{ productClusterId: string; score: number | null; computedAt: Date }> =
      Array.from({ length: 300 }, (_, index) => ({
        productClusterId: `cluster-${index}`,
        score: 100 - Math.floor(index / 3),
        computedAt: now,
      }));
    scoreRows.push({
      productClusterId: 'cluster-1',
      score: 5,
      computedAt: new Date('2026-09-15T12:00:00.000Z'),
    });
    scoreRows.push({
      productClusterId: 'cluster-null',
      score: null,
      computedAt: now,
    });
    prisma.productScore.findMany.mockResolvedValue(scoreRows);
    prisma.watchlistItem.findMany.mockResolvedValue([{ productClusterId: 'cluster-100' }]);
    // 300 vinculados ranqueados + 20 vinculados fora do ranking (caem para tier 3).
    const rankedIds = Array.from({ length: 300 }, (_, index) => `cluster-${index}`);
    prisma.trackedListing.findMany.mockResolvedValue([
      ...rankedIds.map((clusterId) => ({ id: `listing-${clusterId}`, productId: clusterId })),
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `listing-extra-${index}`,
        productId: `cluster-extra-${index}`,
      })),
    ]);
    prisma.trackedListing.updateMany
      .mockResolvedValueOnce({ count: 51 })
      .mockResolvedValueOnce({ count: 249 })
      .mockResolvedValueOnce({ count: 20 });

    const result = await (service as any).promoteTiers();

    // Ordenação pelo score oficial, não pela coluna legada financialScore.
    expect(prisma.productScore.findMany).toHaveBeenCalled();
    expect(prisma.productCluster.findMany).not.toHaveBeenCalled();
    // cluster-100 estava no tier 2 mas é watchlist: sobe para o tier 1.
    const tier1Call = prisma.trackedListing.updateMany.mock.calls[0][0];
    expect(tier1Call.data).toEqual({ tier: 1 });
    expect(tier1Call.where.productId.in).toHaveLength(51);
    expect(tier1Call.where.productId.in).toContain('cluster-100');
    const tier2Call = prisma.trackedListing.updateMany.mock.calls[1][0];
    expect(tier2Call.data).toEqual({ tier: 2 });
    expect(tier2Call.where.productId.in).toHaveLength(249);
    expect(tier2Call.where.productId.in).not.toContain('cluster-100');
    expect(result).toEqual({ tier1: 51, tier2: 249, tier3: 20 });
  });

  it('promoteTiers: nulo ordena por último e não rouba vaga do tier 1', async () => {
    const { service, prisma } = buildService();
    const now = new Date('2026-09-14T12:00:00.000Z');
    // 51 clusters com 90 + 1 com score nulo: o nulo fica depois de todos os
    // 90 (não entra no top 50) e o vinculado sem linha de score cai ao tier 3.
    const scoredIds = Array.from({ length: 51 }, (_, index) => `c-${String(index).padStart(2, '0')}`);
    prisma.productScore.findMany.mockResolvedValue([
      ...scoredIds.map((productClusterId) => ({ productClusterId, score: 90, computedAt: now })),
      { productClusterId: 'cluster-b', score: null, computedAt: now },
    ]);
    prisma.watchlistItem.findMany.mockResolvedValue([]);
    prisma.trackedListing.findMany.mockResolvedValue([
      ...scoredIds.map((productClusterId) => ({ id: `listing-${productClusterId}`, productId: productClusterId })),
      { id: 'listing-b', productId: 'cluster-b' },
      { id: 'listing-c', productId: 'cluster-sem-score' },
    ]);
    prisma.trackedListing.updateMany
      .mockResolvedValueOnce({ count: 50 })
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 });

    const result = await (service as any).promoteTiers();

    const tier1Call = prisma.trackedListing.updateMany.mock.calls[0][0];
    expect(tier1Call.where.productId.in).toHaveLength(50);
    expect(tier1Call.where.productId.in).not.toContain('cluster-b');
    const tier2Call = prisma.trackedListing.updateMany.mock.calls[1][0];
    // c-50 (90, fora do top 50) + cluster-b (nulo, por último).
    expect(tier2Call.where.productId.in).toEqual(['c-50', 'cluster-b']);
    expect(result).toEqual({ tier1: 50, tier2: 2, tier3: 1 });
  });
});
