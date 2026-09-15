/**
 * Sub-sinais do radar do dossiê (0–100 por dimensão), calculados a partir dos
 * anúncios e sinais de busca já coletados. Módulo PURO: sem Prisma.
 *
 * Dimensão sem dado não aparece (nunca vira 0). Social não é calculado aqui:
 * a fonte do TikTok está indisponível (B6) e aparece como tal na tela.
 */

export type SubSignalKey =
  | 'marketplaceGrowth'
  | 'supplierGrowth'
  | 'priceOpportunity'
  | 'reviewVelocity'
  | 'searchGrowth';

export interface SubSignalSnapshot {
  marketplace: string;
  externalProductId: string;
  priceMin: unknown;
  currency?: string | null;
  salesSignalRaw: unknown;
  reviewCount: number | null;
  sellerName: string | null;
  collectedAt: Date;
}

export interface SubSignalDemand {
  source: string;
  weekStart: Date;
  trendIndex: unknown;
}

export interface SubSignal {
  value: number;
  explanation: string;
  inputs: Record<string, number>;
}

const WEEK_MS = 7 * 86_400_000;
const BR_MARKETPLACES = new Set(['amazon_br', 'mercado_livre', 'mercadolivre', 'shopee_br']);
const B2B_MARKETPLACES = new Set(['alibaba', '1688', 'aliexpress']);

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampScore(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function pctText(value: number): string {
  const rounded = round(value);
  return `${rounded >= 0 ? '+' : ''}${String(rounded).replace('.', ',')}%`;
}

export function computeSubSignals(
  snapshots: SubSignalSnapshot[],
  demand: SubSignalDemand[],
  opts: { fxUsdBrl: number; fxCnyBrl: number },
): Partial<Record<SubSignalKey, SubSignal>> {
  const out: Partial<Record<SubSignalKey, SubSignal>> = {};
  const dated = snapshots.filter(
    (snapshot) => snapshot.collectedAt instanceof Date && !Number.isNaN(snapshot.collectedAt.getTime()),
  );

  if (dated.length > 0) {
    const end = dated.reduce((max, snapshot) => Math.max(max, snapshot.collectedAt.getTime()), 0);
    const weekIndex = (snapshot: SubSignalSnapshot) =>
      Math.floor((end - snapshot.collectedAt.getTime()) / WEEK_MS);

    // Marketplace: vendas das últimas 8 semanas vs as 8 anteriores.
    let recentSales = 0;
    let priorSales = 0;
    for (const snapshot of dated) {
      const sales = toNumber(snapshot.salesSignalRaw);
      if (sales === null || sales <= 0) continue;
      const week = weekIndex(snapshot);
      if (week < 8) recentSales += sales;
      else if (week < 16) priorSales += sales;
    }
    if (recentSales > 0 && priorSales > 0) {
      const growth = ((recentSales - priorSales) / priorSales) * 100;
      out.marketplaceGrowth = {
        value: clampScore(50 + growth / 2),
        explanation: `Vendas das últimas 8 semanas ${pctText(growth)} em relação às 8 anteriores.`,
        inputs: { growth_pct: round(growth) },
      };
    }

    const lastMonth = dated.filter((snapshot) => weekIndex(snapshot) < 4);

    // Preço: preço de venda no Brasil vs custo do fornecedor B2B (último mês).
    const brPrices = lastMonth
      .filter(
        (snapshot) =>
          !B2B_MARKETPLACES.has(snapshot.marketplace) &&
          (BR_MARKETPLACES.has(snapshot.marketplace) || snapshot.currency === 'BRL'),
      )
      .map((snapshot) => toNumber(snapshot.priceMin))
      .filter((price): price is number => price !== null && price > 0);
    const costs = lastMonth
      .filter((snapshot) => B2B_MARKETPLACES.has(snapshot.marketplace))
      .map((snapshot) => {
        const price = toNumber(snapshot.priceMin);
        if (price === null || price <= 0) return null;
        if (snapshot.currency === 'CNY') return price * opts.fxCnyBrl;
        if (snapshot.currency === 'BRL') return price;
        return price * opts.fxUsdBrl;
      })
      .filter((price): price is number => price !== null && price > 0);
    const brMedian = median(brPrices);
    const costMedian = median(costs);
    if (brMedian !== null && costMedian !== null) {
      const ratio = brMedian / costMedian;
      out.priceOpportunity = {
        value: clampScore(((ratio - 1) / 5) * 100),
        explanation: `Preço de venda no Brasil ${String(round(ratio)).replace('.', ',')}× o custo do fornecedor (antes de frete e impostos).`,
        inputs: { price_br: round(brMedian, 2), cost_brl: round(costMedian, 2), ratio: round(ratio, 2) },
      };
    }

    // Reviews: novas avaliações por semana nas últimas 4 semanas.
    const byListing = new Map<string, SubSignalSnapshot[]>();
    for (const snapshot of dated) {
      if (snapshot.reviewCount === null || snapshot.reviewCount === undefined) continue;
      const key = `${snapshot.marketplace}:${snapshot.externalProductId}`;
      const list = byListing.get(key) ?? [];
      list.push(snapshot);
      byListing.set(key, list);
    }
    let newReviews = 0;
    let listingsWithHistory = 0;
    for (const rows of byListing.values()) {
      const latest = rows.reduce((a, b) => (b.collectedAt > a.collectedAt ? b : a));
      const past = rows
        .filter((row) => weekIndex(row) >= 4)
        .reduce<SubSignalSnapshot | null>((a, b) => (!a || b.collectedAt > a.collectedAt ? b : a), null);
      if (!past || weekIndex(latest) >= 4) continue;
      newReviews += Math.max(0, (latest.reviewCount ?? 0) - (past.reviewCount ?? 0));
      listingsWithHistory += 1;
    }
    if (listingsWithHistory > 0) {
      const perWeek = newReviews / 4;
      out.reviewVelocity = {
        value: clampScore((100 * Math.log10(1 + perWeek)) / Math.log10(1 + 100)),
        explanation: `${Math.round(perWeek)} novas avaliações por semana nas últimas 4 semanas.`,
        inputs: { reviews_per_week: round(perWeek) },
      };
    }

    // Fornecedores: vendedores B2B ativos no último mês.
    const suppliers = new Set(
      lastMonth
        .filter((snapshot) => B2B_MARKETPLACES.has(snapshot.marketplace))
        .map((snapshot) => snapshot.sellerName ?? `${snapshot.marketplace}:${snapshot.externalProductId}`),
    );
    if (suppliers.size > 0) {
      out.supplierGrowth = {
        value: clampScore((suppliers.size / 5) * 100),
        explanation: `${suppliers.size} ${suppliers.size === 1 ? 'fornecedor B2B ativo' : 'fornecedores B2B ativos'} (Alibaba, 1688, AliExpress) no último mês.`,
        inputs: { suppliers: suppliers.size },
      };
    }
  }

  // Busca: Google Trends das últimas 8 semanas vs as 8 anteriores.
  const byWeek = new Map<number, number[]>();
  for (const signal of demand) {
    if (signal.source !== 'google_trends' || !(signal.weekStart instanceof Date)) continue;
    const value = toNumber(signal.trendIndex);
    if (value === null) continue;
    const key = signal.weekStart.getTime();
    byWeek.set(key, [...(byWeek.get(key) ?? []), value]);
  }
  const weeks = [...byWeek.keys()].sort((a, b) => b - a);
  const recent = weeks.slice(0, 8).flatMap((week) => byWeek.get(week) ?? []);
  const prior = weeks.slice(8, 16).flatMap((week) => byWeek.get(week) ?? []);
  if (recent.length > 0 && prior.length > 0) {
    const average = (list: number[]) => list.reduce((sum, value) => sum + value, 0) / list.length;
    const recentAvg = average(recent);
    const priorAvg = average(prior);
    if (priorAvg > 0) {
      const growth = ((recentAvg - priorAvg) / priorAvg) * 100;
      out.searchGrowth = {
        value: clampScore(50 + growth / 2),
        explanation: `Interesse de busca (Google Trends) ${pctText(growth)} nas últimas 8 semanas em relação às 8 anteriores.`,
        inputs: { growth_pct: round(growth), recent_index: round(recentAvg), prior_index: round(priorAvg) },
      };
    }
  }

  return out;
}
