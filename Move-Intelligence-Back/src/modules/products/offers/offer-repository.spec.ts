import { OfferRepository } from './offer-repository';
import { PrismaService } from '../../../shared/database/prisma.service';

function build(items: unknown[], snapshots: unknown[], scores: unknown[] = []) {
  const prisma = {
    productClusterItem: { findMany: jest.fn().mockResolvedValue(items) },
    productListingSnapshot: { findMany: jest.fn().mockResolvedValue(snapshots) },
    offerScore: {
      findMany: jest.fn().mockResolvedValue(scores),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  return { repo: new OfferRepository(prisma as unknown as PrismaService), prisma };
}

describe('OfferRepository', () => {
  it('lista só anúncios de fornecedor contados, com o snapshot mais recente', async () => {
    const { repo, prisma } = build(
      [
        { marketplace: 'alibaba', externalProductId: 'A', status: 'confirmed' },
        { marketplace: '1688', externalProductId: 'B', status: 'auto' },
      ],
      [
        { marketplace: 'alibaba', externalProductId: 'A', title: 'novo', sellerName: 'Y', productUrl: 'u', priceMin: 90, priceMax: 96, currency: 'USD', moq: 50, rating: 4.4, salesSignalRaw: 320, collectedAt: new Date('2026-09-10') },
        { marketplace: 'alibaba', externalProductId: 'A', title: 'antigo', sellerName: 'Y', productUrl: 'u', priceMin: 80, priceMax: 85, currency: 'USD', moq: 50, rating: 4.4, salesSignalRaw: 300, collectedAt: new Date('2026-09-01') },
      ],
    );

    const offers = await repo.listOfferListings('card-1');

    expect(prisma.productClusterItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        clusterId: 'card-1',
        marketplace: { in: ['1688', 'alibaba', 'aliexpress'] },
        status: { in: ['confirmed', 'auto'] },
      }),
    }));
    expect(offers).toHaveLength(2);
    const a = offers.find((o) => o.key === 'alibaba:A')!;
    expect(a).toMatchObject({ title: 'novo', priceMax: 96, moq: 50, itemStatus: 'confirmed', salesSignal: 320 });
    const b = offers.find((o) => o.key === '1688:B')!;
    expect(b).toMatchObject({ priceMin: null, priceMax: null, collectedAt: null, itemStatus: 'auto' });
  });

  it('latestOfferScores devolve o registro mais recente por oferta', async () => {
    const { repo } = build([], [], [
      { marketplace: 'alibaba', externalProductId: 'A', score: 81, state: 'com_score', unitCostUsd: 96, moq: 50, capitalPrimeiroPedido: 31000, pVplPositivo: 0.78, computedAt: new Date('2026-09-12') },
      { marketplace: 'alibaba', externalProductId: 'A', score: 60, state: 'com_score', unitCostUsd: 99, moq: 50, capitalPrimeiroPedido: 30000, pVplPositivo: 0.6, computedAt: new Date('2026-09-05') },
    ]);
    const map = await repo.latestOfferScores('card-1');
    expect(map.get('alibaba:A')).toMatchObject({ score: 81, unitCostUsd: 96 });
  });
});
