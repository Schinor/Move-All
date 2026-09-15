import { computeSubSignals, SubSignalDemand, SubSignalSnapshot } from './sub-signals';

const WEEK = 7 * 86_400_000;
const END = Date.UTC(2026, 8, 14, 12);
const at = (weeksAgo: number) => new Date(END - weeksAgo * WEEK);

function snapshot(partial: Partial<SubSignalSnapshot> & { weeksAgo: number }): SubSignalSnapshot {
  return {
    marketplace: 'mercado_livre',
    externalProductId: 'ml-1',
    priceMin: 400,
    currency: 'BRL',
    salesSignalRaw: 100,
    reviewCount: null,
    sellerName: 'Loja BR',
    ...partial,
    collectedAt: at(partial.weeksAgo),
  };
}

describe('computeSubSignals', () => {
  it('calcula marketplace, preço, reviews, fornecedores e busca', () => {
    const snapshots: SubSignalSnapshot[] = [];
    for (let w = 0; w < 16; w++) {
      snapshots.push(snapshot({ weeksAgo: w, salesSignalRaw: w < 8 ? 150 : 100, reviewCount: 200 - w * 10 }));
      snapshots.push(
        snapshot({ weeksAgo: w, marketplace: 'alibaba', externalProductId: 'ali-1', priceMin: 20, currency: 'USD', salesSignalRaw: null, sellerName: 'Fábrica A' }),
      );
    }
    const demand: SubSignalDemand[] = Array.from({ length: 16 }, (_, w) => ({
      source: 'google_trends',
      weekStart: at(w),
      trendIndex: w < 8 ? 60 : 40,
    }));

    const signals = computeSubSignals(snapshots, demand, { fxUsdBrl: 5, fxCnyBrl: 0.7 });

    expect(signals.marketplaceGrowth?.value).toBe(75); // +50% → 50 + 25
    expect(signals.priceOpportunity?.inputs.ratio).toBe(4); // 400 / (20 × 5)
    expect(signals.priceOpportunity?.value).toBe(60);
    expect(signals.reviewVelocity?.inputs.reviews_per_week).toBe(10); // 40 novas em 4 semanas
    expect(signals.reviewVelocity?.value).toBe(52);
    expect(signals.supplierGrowth?.value).toBe(20);
    expect(signals.searchGrowth?.value).toBe(75);
  });

  it('dimensão sem dado não aparece (nunca vira zero)', () => {
    const signals = computeSubSignals([snapshot({ weeksAgo: 0 })], [], { fxUsdBrl: 5, fxCnyBrl: 0.7 });
    expect(signals).not.toHaveProperty('marketplaceGrowth');
    expect(signals).not.toHaveProperty('priceOpportunity');
    expect(signals).not.toHaveProperty('supplierGrowth');
    expect(signals).not.toHaveProperty('searchGrowth');
  });
});
