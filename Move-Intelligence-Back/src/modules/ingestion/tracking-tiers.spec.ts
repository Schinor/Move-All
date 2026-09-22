import { assignTiers, rankCards, TierListing, trackingTierConfig, TRACK_CADENCE_DAYS } from './tracking-tiers';

const L = (id: string, cardId: string | null, reviews: number | null = null, extra: Partial<TierListing> = {}): TierListing => ({
  id, cardId, reviews, nativeId: id, firstSeenAt: new Date('2026-09-01T00:00:00Z'), fromDiscovery: false, ...extra,
});
const byId = (out: ReturnType<typeof assignTiers>) => Object.fromEntries(out.map((a) => [a.id, `${a.tier}:${a.reason}`]));

describe('assignTiers', () => {
  it('nível 1 em rodízio pelos top cards, com vagas; sobra do top vai para o nível 2', () => {
    const listings = [L('a1', 'A', 10), L('a2', 'A', 50), L('a3', 'A', 5), L('b1', 'B', 1), L('b2', 'B', 2), L('c1', 'C', 99)];
    const out = assignTiers({
      listings,
      cardScores: new Map([['A', 90], ['B', 80], ['C', 70]]),
      watchlist: [],
      hotCards: new Map(),
      config: { topCards: 2, tier1Slots: 3, tier2Slots: 3 },
    });
    expect(byId(out)).toEqual({
      a2: '1:top50', b2: '1:top50', a1: '1:top50',
      a3: '2:top50', b1: '2:top50',
      c1: '3:demais',
    });
  });

  it('watchlist entra primeiro no rodízio do nível 1', () => {
    const out = assignTiers({
      listings: [L('a1', 'A', 1), L('b1', 'B', 1), L('w1', 'W', 1)],
      cardScores: new Map([['A', 90], ['B', 80], ['W', 10]]),
      watchlist: ['W'],
      hotCards: new Map(),
      config: { topCards: 1, tier1Slots: 2, tier2Slots: 0 },
    });
    expect(byId(out)).toEqual({ w1: '1:watchlist', a1: '1:top50', b1: '3:demais' });
  });

  it('nível 2: descoberta (mais nova primeiro), depois radar (maior alta primeiro), depois sobra do top', () => {
    const out = assignTiers({
      listings: [
        L('a1', 'A', 5), L('a2', 'A', 1),
        L('d0', null, null, { fromDiscovery: true, firstSeenAt: new Date('2026-09-10T00:00:00Z') }),
        L('d1', null, null, { fromDiscovery: true, firstSeenAt: new Date('2026-09-20T00:00:00Z') }),
        L('g1', 'G', 1), L('h1', 'H', 2), L('h2', 'H', 1),
      ],
      cardScores: new Map([['A', 90], ['G', 10], ['H', 20]]),
      watchlist: [],
      hotCards: new Map([['H', 0.5], ['G', 0.9]]),
      config: { topCards: 1, tier1Slots: 1, tier2Slots: 4 },
    });
    expect(byId(out)).toEqual({
      a1: '1:top50',
      d1: '2:descoberta', d0: '2:descoberta', g1: '2:radar', h1: '2:radar',
      a2: '3:demais', h2: '3:demais',
    });
  });

  it('cada anúncio aparece uma vez; card sem score fica por último', () => {
    const listings = [L('x', 'X'), L('y', 'Y'), L('z', 'Z')];
    const out = assignTiers({
      listings,
      cardScores: new Map([['X', null], ['Y', 50], ['Z', 60]]),
      watchlist: [],
      hotCards: new Map([['Y', 0.3]]),
      config: { topCards: 3, tier1Slots: 2, tier2Slots: 5 },
    });
    expect(out).toHaveLength(3);
    expect(new Set(out.map((a) => a.id)).size).toBe(3);
    expect(byId(out)).toEqual({ z: '1:top50', y: '1:top50', x: '2:top50' });
    expect(rankCards(new Map([['X', null], ['Y', 50], ['Z', 60], ['A', 60]]))).toEqual(['A', 'Z', 'Y', 'X']);
  });

  it('config padrão e cadência', () => {
    expect(trackingTierConfig({} as NodeJS.ProcessEnv)).toEqual({
      topCards: 50, tier1Slots: 80, tier2Slots: 100, radarMinGrowth: 0.2, discoveryWindowDays: 30,
    });
    expect(trackingTierConfig({ TRACK_TIER1_SLOTS: '10', TRACK_RADAR_MIN_GROWTH: '0.5' } as NodeJS.ProcessEnv))
      .toEqual(expect.objectContaining({ tier1Slots: 10, radarMinGrowth: 0.5 }));
    expect(TRACK_CADENCE_DAYS).toEqual({ 1: 3.5, 2: 7, 3: 30 });
  });
});
