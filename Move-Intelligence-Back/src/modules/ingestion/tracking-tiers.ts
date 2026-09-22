/** Subprojeto D (spec §7.1): níveis de acompanhamento com vagas. Função pura. */

/** Espelho de TIER_CADENCE_DAYS em Move-Intelligence-Dados/app/pipelines/run_track_listings.py. */
export const TRACK_CADENCE_DAYS: Record<1 | 2 | 3, number> = { 1: 3.5, 2: 7, 3: 30 };

export type TierReason = 'watchlist' | 'top50' | 'descoberta' | 'radar' | 'demais';
export interface TierListing {
  id: string;
  cardId: string | null;
  reviews: number | null;
  nativeId: string;
  firstSeenAt: Date;
  fromDiscovery: boolean;
}
export interface TierConfig { topCards: number; tier1Slots: number; tier2Slots: number }
export interface TierInput {
  listings: TierListing[];
  /** Último score de cada card (nulo = sem score). */
  cardScores: Map<string, number | null>;
  watchlist: string[];
  /** Card → maior growth_12w (só os que passaram do limite). */
  hotCards: Map<string, number>;
  config: TierConfig;
}
export interface TierAssignment { id: string; tier: 1 | 2 | 3; reason: TierReason }

function intEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function trackingTierConfig(env: NodeJS.ProcessEnv = process.env) {
  const growth = Number.parseFloat(env.TRACK_RADAR_MIN_GROWTH ?? '');
  return {
    topCards: intEnv(env.TRACK_TOP_CARDS, 50),
    tier1Slots: intEnv(env.TRACK_TIER1_SLOTS, 80),
    tier2Slots: intEnv(env.TRACK_TIER2_SLOTS, 100),
    radarMinGrowth: Number.isFinite(growth) ? growth : 0.2,
    discoveryWindowDays: intEnv(env.TRACK_DISCOVERY_WINDOW_DAYS, 30),
  };
}

/** Maior score primeiro; nulo por último; empate pelo id (mesma ordem do promoteTiers antigo). */
export function rankCards(scores: Map<string, number | null>): string[] {
  return [...scores.entries()]
    .sort(([idA, scoreA], [idB, scoreB]) => {
      if (scoreA === null && scoreB === null) return idA.localeCompare(idB);
      if (scoreA === null) return 1;
      if (scoreB === null) return -1;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return idA.localeCompare(idB);
    })
    .map(([id]) => id);
}

function groupByCard(listings: TierListing[]): Map<string, TierListing[]> {
  const groups = new Map<string, TierListing[]>();
  for (const listing of listings) {
    if (!listing.cardId) continue;
    const list = groups.get(listing.cardId) ?? [];
    list.push(listing);
    groups.set(listing.cardId, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => {
      if (a.reviews === null && b.reviews !== null) return 1;
      if (b.reviews === null && a.reviews !== null) return -1;
      if (a.reviews !== null && b.reviews !== null && b.reviews !== a.reviews) return b.reviews - a.reviews;
      return a.nativeId.localeCompare(b.nativeId);
    });
  }
  return groups;
}

/** Um anúncio de cada card por volta, na ordem dos cards, até acabar a vaga. */
function roundRobin(order: string[], groups: Map<string, TierListing[]>, taken: Set<string>, slots: number): TierListing[] {
  const queues = order.map((id) => (groups.get(id) ?? []).filter((listing) => !taken.has(listing.id)));
  const out: TierListing[] = [];
  let progressed = true;
  while (out.length < slots && progressed) {
    progressed = false;
    for (const queue of queues) {
      if (out.length >= slots) break;
      const next = queue.shift();
      if (!next) continue;
      out.push(next);
      taken.add(next.id);
      progressed = true;
    }
  }
  return out;
}

export function assignTiers(input: TierInput): TierAssignment[] {
  const { config } = input;
  const groups = groupByCard(input.listings);
  const watch = [...new Set(input.watchlist)];
  const watchSet = new Set(watch);
  const ranked = rankCards(input.cardScores).filter((id) => !watchSet.has(id)).slice(0, config.topCards);
  const topOrder = [...watch, ...ranked];
  const taken = new Set<string>();
  const result = new Map<string, TierAssignment>();

  for (const listing of roundRobin(topOrder, groups, taken, config.tier1Slots)) {
    result.set(listing.id, { id: listing.id, tier: 1, reason: watchSet.has(listing.cardId as string) ? 'watchlist' : 'top50' });
  }

  let room = config.tier2Slots;
  const discovery = input.listings
    .filter((listing) => listing.fromDiscovery && !taken.has(listing.id))
    .sort((a, b) => b.firstSeenAt.getTime() - a.firstSeenAt.getTime() || a.id.localeCompare(b.id))
    .slice(0, room);
  for (const listing of discovery) {
    taken.add(listing.id);
    result.set(listing.id, { id: listing.id, tier: 2, reason: 'descoberta' });
  }
  room -= discovery.length;

  const hotOrder = [...input.hotCards.entries()].sort(([a, growthA], [b, growthB]) => growthB - growthA || a.localeCompare(b)).map(([id]) => id);
  const radar = roundRobin(hotOrder, groups, taken, room);
  for (const listing of radar) result.set(listing.id, { id: listing.id, tier: 2, reason: 'radar' });
  room -= radar.length;

  for (const listing of roundRobin(topOrder, groups, taken, room)) {
    result.set(listing.id, { id: listing.id, tier: 2, reason: 'top50' });
  }

  return input.listings.map((listing) => result.get(listing.id) ?? { id: listing.id, tier: 3, reason: 'demais' });
}
