/**
 * Avaliações positivas (4–5★), neutras (3★) e negativas (1–2★) por semana,
 * a partir da distribuição de estrelas das observações dos anúncios.
 * Módulo PURO: sem Prisma.
 *
 * As novas avaliações da semana são a diferença da contagem por estrela em
 * relação à observação anterior do mesmo anúncio (a primeira serve de base).
 */

export interface ReviewObservation {
  listingId: string;
  observedAt: Date;
  rating: number | null;
  reviewsCount: number | null;
  distribution: unknown;
}

export interface ReviewSentimentPoint {
  t: string;
  positive: number;
  neutral: number;
  negative: number;
  avg_rating: number | null;
  total_reviews: number;
}

export interface ReviewSentimentTotals {
  positive: number;
  neutral: number;
  negative: number;
  positive_share: number | null;
  negative_share: number | null;
  avg_rating: number | null;
}

const STARS = ['1', '2', '3', '4', '5'] as const;
const DAY_MS = 86_400_000;

/** Contagens 1–5★; distribuição em percentual (soma ≈ 100) vira contagem pelo total de avaliações. */
export function starCounts(distribution: unknown, reviewsCount: number | null): number[] | null {
  if (!distribution || typeof distribution !== 'object' || Array.isArray(distribution)) return null;
  const raw = STARS.map((star) => Math.max(0, Number((distribution as Record<string, unknown>)[star]) || 0));
  const sum = raw.reduce((total, value) => total + value, 0);
  if (sum <= 0) return null;
  if (reviewsCount && reviewsCount > sum * 1.5 && Math.abs(sum - 100) <= 1.5) {
    return raw.map((value) => (value / 100) * reviewsCount);
  }
  return raw;
}

function weekStartUtc(date: Date): number {
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const weekday = (new Date(day).getUTCDay() + 6) % 7;
  return day - weekday * DAY_MS;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function buildReviewSentimentSeries(
  observations: ReviewObservation[],
  windowMs: number,
): { points: ReviewSentimentPoint[]; totals: ReviewSentimentTotals | null } {
  const byListing = new Map<string, ReviewObservation[]>();
  for (const observation of observations) {
    if (!(observation.observedAt instanceof Date) || Number.isNaN(observation.observedAt.getTime())) continue;
    const list = byListing.get(observation.listingId) ?? [];
    list.push(observation);
    byListing.set(observation.listingId, list);
  }

  type Bucket = {
    positive: number;
    neutral: number;
    negative: number;
    latest: Map<string, { rating: number; reviews: number }>;
  };
  const buckets = new Map<number, Bucket>();

  for (const rows of byListing.values()) {
    rows.sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
    let previous: number[] | null = null;
    for (const row of rows) {
      const key = weekStartUtc(row.observedAt);
      const bucket = buckets.get(key) ?? { positive: 0, neutral: 0, negative: 0, latest: new Map() };
      const counts = starCounts(row.distribution, row.reviewsCount);
      if (counts && previous) {
        const delta = counts.map((count, index) => Math.max(0, count - (previous as number[])[index]));
        bucket.negative += delta[0] + delta[1];
        bucket.neutral += delta[2];
        bucket.positive += delta[3] + delta[4];
      }
      if (counts) previous = counts;
      if (row.rating !== null && row.reviewsCount) {
        bucket.latest.set(row.listingId, { rating: Number(row.rating), reviews: row.reviewsCount });
      }
      buckets.set(key, bucket);
    }
  }

  const keys = [...buckets.keys()].sort((a, b) => a - b);
  if (keys.length === 0) return { points: [], totals: null };
  const end = keys[keys.length - 1];
  const windowed =
    Number.isFinite(windowMs) && windowMs < Number.MAX_SAFE_INTEGER
      ? keys.filter((key) => key > end - windowMs)
      : keys;

  const points: ReviewSentimentPoint[] = windowed.map((key) => {
    const bucket = buckets.get(key)!;
    let weight = 0;
    let weighted = 0;
    for (const value of bucket.latest.values()) {
      weight += value.reviews;
      weighted += value.rating * value.reviews;
    }
    return {
      t: new Date(key).toISOString(),
      positive: Math.round(bucket.positive),
      neutral: Math.round(bucket.neutral),
      negative: Math.round(bucket.negative),
      avg_rating: weight > 0 ? round(weighted / weight, 2) : null,
      total_reviews: weight,
    };
  });

  const positive = points.reduce((sum, point) => sum + point.positive, 0);
  const neutral = points.reduce((sum, point) => sum + point.neutral, 0);
  const negative = points.reduce((sum, point) => sum + point.negative, 0);
  const total = positive + neutral + negative;
  return {
    points,
    totals: {
      positive,
      neutral,
      negative,
      positive_share: total > 0 ? round((positive / total) * 100) : null,
      negative_share: total > 0 ? round((negative / total) * 100) : null,
      avg_rating: [...points].reverse().find((point) => point.avg_rating !== null)?.avg_rating ?? null,
    },
  };
}
