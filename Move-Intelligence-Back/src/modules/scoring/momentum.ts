/**
 * Momentum — eixo de tendência (B2, decisão 7).
 *
 * Módulo PURO: sem Prisma, sem rede, sem datas de "agora".
 * - Vendas: inclinação de log(vendas) nas últimas 8 semanas.
 * - Busca: variação das últimas 8 semanas contra as 8 anteriores e, quando
 *   existir, contra o mesmo período do ano anterior (desconta sazonalidade).
 * - Combinado: média ponderada (default 0,6 vendas / 0,4 busca, configurável).
 *   Se faltar uma fonte, usa só a outra. TikTok entra só como crescimento
 *   Δlog (nunca na média com o índice Google); quando o Google falta, o
 *   Δlog social assume o componente de busca.
 * - Saída sem nota 0–100 (decisão 1): growthPct só no tooltip/Ranking.
 */

export type MomentumDirection = 'sobe' | 'estavel' | 'cai';
export type MomentumSource = 'vendas' | 'busca' | 'social';
export type MomentumConfidence = 'completa' | 'so_vendas' | 'so_busca' | 'insuficiente';

export interface MomentumInput {
  /** Série semanal de vendas/reviews do painel balanceado (mais recente por último). */
  salesWeekly: number[];
  /** Série semanal de busca Google Trends BR/US (mais recente por último). */
  searchWeekly: number[];
  /** Mesmas 8 semanas do ano anterior, quando existir (desconta sazonalidade). */
  searchWeeklyPrevYear?: number[] | null;
  /** Crescimento Δlog→% do TikTok, quando disponível (A3.8). */
  socialGrowthPct?: number | null;
  /** Status da fonte social (A7/B6): unavailable ignora o social. */
  socialAvailable?: boolean;
}

export interface MomentumTuning {
  salesWeight: number;
  searchWeight: number;
  upThresholdPct: number;
  downThresholdPct: number;
}

export const DEFAULT_MOMENTUM_TUNING: MomentumTuning = {
  salesWeight: 0.6,
  searchWeight: 0.4,
  upThresholdPct: 10,
  downThresholdPct: -10,
};

export interface MomentumResult {
  direction: MomentumDirection;
  growthPct: number;
  sources: MomentumSource[];
  confidence: MomentumConfidence;
}

function avg(values: number[]): number | null {
  const valid = values.filter((v) => Number.isFinite(v) && v > 0);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function linearSlope(xs: number[], ys: number[]): number {
  const n = xs.length;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXX = xs.reduce((a, b) => a + b * b, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const denom = n * sumXX - sumX * sumX;
  if (!(denom > 0)) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

/** Crescimento de vendas: inclinação de log(vendas) nas últimas 8 semanas → % em 8 semanas. */
export function salesGrowthPct(salesWeekly: number[]): number | null {
  const recent = salesWeekly.filter((v) => Number.isFinite(v) && v > 0).slice(-8);
  if (recent.length < 3) return null;
  const xs = recent.map((_, i) => i);
  const ys = recent.map((v) => Math.log(v));
  const slopePerWeek = linearSlope(xs, ys);
  if (!Number.isFinite(slopePerWeek)) return null;
  return (Math.exp(slopePerWeek * 8) - 1) * 100;
}

/** Crescimento de busca: 8 recentes vs 8 anteriores (+ YoY quando existir). */
export function searchGrowthPct(
  searchWeekly: number[],
  searchWeeklyPrevYear?: number[] | null,
): number | null {
  const clean = searchWeekly.filter((v) => Number.isFinite(v) && v >= 0);
  if (clean.length < 16) {
    // Sem 16 semanas, tenta ao menos 8 vs média disponível? Exige 8+8.
    if (clean.length < 8) return null;
    // Com 8–15 semanas, compara segunda metade vs primeira metade.
    const half = Math.floor(clean.length / 2);
    const prev = avg(clean.slice(0, half));
    const recent = avg(clean.slice(half));
    if (prev === null || recent === null || prev <= 0) return null;
    return ((recent - prev) / prev) * 100;
  }
  const recent8 = clean.slice(-8);
  const prev8 = clean.slice(-16, -8);
  const avgRecent = avg(recent8);
  const avgPrev = avg(prev8);
  if (avgRecent === null || avgPrev === null || avgPrev <= 0) return null;
  const vsPrev = ((avgRecent - avgPrev) / avgPrev) * 100;
  if (searchWeeklyPrevYear && searchWeeklyPrevYear.length >= 8) {
    const prevYear = avg(searchWeeklyPrevYear.slice(-8));
    if (prevYear !== null && prevYear > 0) {
      const vsYoy = ((avgRecent - prevYear) / prevYear) * 100;
      return (vsPrev + vsYoy) / 2;
    }
  }
  return vsPrev;
}

export function computeMomentum(
  input: MomentumInput,
  tuning: Partial<MomentumTuning> = {},
): MomentumResult {
  const t: MomentumTuning = { ...DEFAULT_MOMENTUM_TUNING, ...tuning };
  const socialOn = input.socialAvailable !== false;
  const socialPct =
    socialOn && Number.isFinite(input.socialGrowthPct as number)
      ? (input.socialGrowthPct as number)
      : null;

  const sales = salesGrowthPct(input.salesWeekly ?? []);
  let search = searchGrowthPct(input.searchWeekly ?? [], input.searchWeeklyPrevYear ?? null);
  let searchSource: MomentumSource | null = search !== null ? 'busca' : null;
  // Sem Google, o Δlog social assume o componente de busca (A3.8/B2).
  if (search === null && socialPct !== null) {
    search = socialPct;
    searchSource = 'social';
  }

  const sources: MomentumSource[] = [];
  if (sales !== null) sources.push('vendas');
  if (search !== null && searchSource) sources.push(searchSource);
  // Google + social disponível: informa social sem mudar o número (só crescimento).
  if (searchSource === 'busca' && socialPct !== null && !sources.includes('social')) {
    sources.push('social');
  }

  if (sales === null && search === null) {
    return { direction: 'estavel', growthPct: 0, sources: [], confidence: 'insuficiente' };
  }

  let combined: number;
  let confidence: MomentumConfidence;
  if (sales !== null && search !== null) {
    const total = t.salesWeight + t.searchWeight;
    combined = (sales * t.salesWeight + search * t.searchWeight) / (total > 0 ? total : 1);
    confidence = 'completa';
  } else if (sales !== null) {
    combined = sales;
    confidence = 'so_vendas';
  } else {
    combined = search as number;
    confidence = 'so_busca';
  }

  const growthPct = Math.round(combined * 10) / 10;
  const direction: MomentumDirection =
    growthPct > t.upThresholdPct ? 'sobe' : growthPct < t.downThresholdPct ? 'cai' : 'estavel';
  return { direction, growthPct, sources, confidence };
}
