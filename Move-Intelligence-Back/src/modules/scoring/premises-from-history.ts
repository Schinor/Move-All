/**
 * Derivação de premissas Monte Carlo a partir do histórico (F2.2, Fase 2).
 *
 * Módulo PURO: sem Prisma, sem rede, sem datas de "agora". Recebe as
 * observações já filtradas (não sintéticas, `scrape_status='ok'`) e devolve
 * premissas com fórmulas explícitas + confiança dos dados. Séries sintéticas
 * de TESTE vivem no spec — nunca no banco.
 *
 * Com `historico_curto` ou `sem_custo`, NÃO há score: devolve só a confiança
 * (o lote oficial F2.4 grava apenas a confiança nesses casos).
 */

import { offerUnitCostUsd, SUPPLIER_MARKETPLACES } from '../products/offers/offer-rules';

export interface HistoryObservation {
  /** Chave estável do anúncio (ex.: `marketplace:nativeId`). */
  listingKey: string;
  marketplace: string;
  currency?: string | null;
  /** Preço à vista observado. */
  priceMin: number | null;
  priceMax?: number | null;
  /** Vendas mensais estimadas do anúncio. */
  salesSignal: number | null;
  collectedAt: Date;
}

export type DataConfidence = 'suficiente' | 'historico_curto' | 'sem_vendas' | 'sem_custo';

export interface HistoryPremises {
  demanda_referencia: number;
  crescimento_demanda_mensal: number;
  incerteza_crescimento: number | null;
  vol_demanda: number;
  preco_venda: number;
  vol_preco: number;
  custo_usd: number;
  dataVersion: string;
}

export interface PremisesResult {
  premises: HistoryPremises | null;
  dataConfidence: DataConfidence;
}

/** Versão da derivação (vai para `ProductScore.dataVersion`). */
export const PREMISES_DATA_VERSION = 'premises@1';

// Mínimo de histórico para análise (D4): ≥ 4 observações em ≥ 21 dias.
const MIN_OBSERVATIONS = 4;
const MIN_HISTORY_DAYS = 21;
// Janela de estimação: últimas 4 semanas; regressão exige ≥ 3 baldes válidos.
const WINDOW_DAYS = 28;
const MIN_VALID_BUCKETS = 3;
const DAYS_PER_MONTH = 30.44;

function isBrPrice(obs: HistoryObservation): boolean {
  if (obs.currency === 'BRL') return true;
  return obs.marketplace === 'amazon_br' || obs.marketplace === 'mercado_livre' || obs.marketplace === 'shopee_br';
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Regressão OLS de y sobre x: {slope, erro padrão do slope (null se n < 3)}. */
function linearRegression(xs: number[], ys: number[]): { slope: number; slopeSe: number | null } {
  const n = xs.length;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXX = xs.reduce((a, b) => a + b * b, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const denominator = n * sumXX - sumX * sumX;
  if (!(denominator > 0)) return { slope: 0, slopeSe: null };
  const slope = (n * sumXY - sumX * sumY) / denominator;
  if (n < 3) return { slope, slopeSe: null };
  const intercept = (sumY - slope * sumX) / n;
  const sse = xs.reduce((acc, x, i) => acc + (ys[i] - (intercept + slope * x)) ** 2, 0);
  const sxx = sumXX - (sumX * sumX) / n;
  if (!(sxx > 0)) return { slope, slopeSe: null };
  return { slope, slopeSe: Math.sqrt(sse / (n - 2)) / Math.sqrt(sxx) };
}

export function derivePremisesFromHistory(
  observations: HistoryObservation[],
  opts: { fxCnyUsd: number },
): PremisesResult {
  const dated = observations
    .filter((obs) => obs.collectedAt instanceof Date && !Number.isNaN(obs.collectedAt.getTime()))
    .sort((a, b) => a.collectedAt.getTime() - b.collectedAt.getTime());

  if (dated.length < MIN_OBSERVATIONS) {
    return { premises: null, dataConfidence: 'historico_curto' };
  }
  const spanDays =
    (dated[dated.length - 1].collectedAt.getTime() - dated[0].collectedAt.getTime()) / 86_400_000;
  if (spanDays < MIN_HISTORY_DAYS) {
    return { premises: null, dataConfidence: 'historico_curto' };
  }

  const end = dated[dated.length - 1].collectedAt.getTime();
  const start = end - WINDOW_DAYS * 86_400_000;
  const inWindow = dated.filter((obs) => obs.collectedAt.getTime() >= start);

  // Painel balanceado: só anúncios observados nas duas metades da janela —
  // sem ele, a média mistura amostras diferentes entre datas (falso crescimento).
  const half = start + (WINDOW_DAYS * 86_400_000) / 2;
  const firstHalf = new Set(
    inWindow.filter((obs) => obs.collectedAt.getTime() < half).map((obs) => obs.listingKey),
  );
  const secondHalf = new Set(
    inWindow.filter((obs) => obs.collectedAt.getTime() >= half).map((obs) => obs.listingKey),
  );
  const basket = new Set([...firstHalf].filter((key) => secondHalf.has(key)));
  const panel = inWindow.filter((obs) => basket.has(obs.listingKey));

  const salesByListing = new Map<string, number[]>();
  for (const obs of panel) {
    if (obs.salesSignal !== null && obs.salesSignal !== undefined && obs.salesSignal > 0) {
      const list = salesByListing.get(obs.listingKey) ?? [];
      list.push(obs.salesSignal);
      salesByListing.set(obs.listingKey, list);
    }
  }
  if (salesByListing.size === 0) {
    return { premises: null, dataConfidence: 'sem_vendas' };
  }
  // Soma das vendas mensais estimadas do painel balanceado.
  const demanda_referencia = Math.round(
    [...salesByListing.values()].reduce((sum, values) => sum + mean(values), 0),
  );

  // Série semanal do painel para crescimento e volatilidade.
  const buckets: number[] = [0, 0, 0, 0];
  const bucketCounts = [0, 0, 0, 0];
  const WEEK_MS = 7 * 86_400_000;
  for (const obs of panel) {
    if (obs.salesSignal === null || obs.salesSignal === undefined || obs.salesSignal <= 0) continue;
    // Baldes semanais contados do início da janela; o teto evita que o ponto
    // exatamente no fim caia fora e colapse no balde anterior.
    const rel = obs.collectedAt.getTime() - start;
    const index = Math.max(0, Math.min(3, Math.ceil(rel / WEEK_MS) - 1));
    buckets[index] += obs.salesSignal;
    bucketCounts[index] += 1;
  }
  const valid = buckets
    .map((total, index) => ({ total, index }))
    .filter((bucket) => bucket.total > 0 && bucketCounts[bucket.index] > 0);
  if (valid.length < MIN_VALID_BUCKETS) {
    return { premises: null, dataConfidence: 'historico_curto' };
  }
  const xs = valid.map((bucket) => ((bucket.index + 0.5) * 7) / DAYS_PER_MONTH);
  const ys = valid.map((bucket) => Math.log(bucket.total));
  const { slope, slopeSe } = linearRegression(xs, ys);
  const logReturns: number[] = [];
  for (let i = 1; i < valid.length; i += 1) {
    logReturns.push(Math.log(valid[i].total / valid[i - 1].total));
  }
  // Desvio padrão dos log-retornos semanais × √4 (mensalização).
  const vol_demanda = std(logReturns) * 2;

  const brPrices = inWindow
    .filter(isBrPrice)
    .map((obs) => obs.priceMin)
    .filter((price): price is number => price !== null && price !== undefined && price > 0);
  const precoMediano = median(brPrices);
  if (precoMediano === null) {
    return { premises: null, dataConfidence: 'historico_curto' };
  }
  const vol_preco = brPrices.length >= 2 ? std(brPrices) / mean(brPrices) : 0;

  const costUsd = inWindow
    .filter((obs) => (SUPPLIER_MARKETPLACES as readonly string[]).includes(obs.marketplace))
    .map((obs) => offerUnitCostUsd({ priceMin: obs.priceMin, priceMax: obs.priceMax, currency: obs.currency }, opts.fxCnyUsd))
    .filter((price): price is number => price !== null && price > 0);
  const custoMediano = median(costUsd);
  if (custoMediano === null) {
    return { premises: null, dataConfidence: 'sem_custo' };
  }

  return {
    premises: {
      demanda_referencia,
      crescimento_demanda_mensal: slope,
      incerteza_crescimento: slopeSe,
      vol_demanda,
      preco_venda: precoMediano,
      vol_preco,
      custo_usd: custoMediano,
      dataVersion: PREMISES_DATA_VERSION,
    },
    dataConfidence: 'suficiente',
  };
}
