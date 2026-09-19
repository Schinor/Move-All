/** Regras puras das ofertas (Subprojeto B). Sem Prisma, sem rede. */

export const SUPPLIER_MARKETPLACES = ['1688', 'alibaba', 'aliexpress'] as const;

export type OfferStoredState = 'com_score' | 'sem_preco' | 'suspeito';

export interface OfferPrice {
  priceMin: number | null | undefined;
  priceMax?: number | null | undefined;
  currency?: string | null;
}

function positive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Preço no MOQ (B-D3): price_max, senão price_min; USD direto, CNY convertido, outra moeda = sem preço. */
export function offerUnitCostUsd(price: OfferPrice, fxCnyUsd: number): number | null {
  const base = positive(price.priceMax) ?? positive(price.priceMin);
  if (base === null) return null;
  const currency = (price.currency ?? '').toUpperCase();
  if (currency === 'CNY') return base * fxCnyUsd;
  if (currency === 'USD' || currency === '') return base;
  return null;
}

export function offerState(input: {
  unitCostUsd: number | null;
  cardUnitCostUsd: number | null;
  suspiciousRatio: number;
}): OfferStoredState {
  if (input.unitCostUsd === null) return 'sem_preco';
  if (
    input.cardUnitCostUsd !== null &&
    input.cardUnitCostUsd > 0 &&
    input.unitCostUsd < input.cardUnitCostUsd * input.suspiciousRatio
  ) {
    return 'suspeito';
  }
  return 'com_score';
}

export function offerKey(marketplace: string, externalProductId: string): string {
  return `${marketplace}:${externalProductId}`;
}

export function parseOfferKey(key: string): { marketplace: string; externalProductId: string } | null {
  const index = key.indexOf(':');
  if (index <= 0 || index === key.length - 1) return null;
  const marketplace = key.slice(0, index);
  if (!(SUPPLIER_MARKETPLACES as readonly string[]).includes(marketplace)) return null;
  return { marketplace, externalProductId: key.slice(index + 1) };
}

export function normalizedMoq(moq: number | null | undefined): number {
  return typeof moq === 'number' && Number.isFinite(moq) && moq > 0 ? Math.round(moq) : 1;
}

export function sortOffers<T extends { score: number | null; unitCostUsd: number | null }>(offers: T[]): T[] {
  return [...offers].sort((a, b) => {
    if (a.score !== b.score) {
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return b.score - a.score;
    }
    const ca = a.unitCostUsd ?? Number.POSITIVE_INFINITY;
    const cb = b.unitCostUsd ?? Number.POSITIVE_INFINITY;
    return ca - cb;
  });
}
