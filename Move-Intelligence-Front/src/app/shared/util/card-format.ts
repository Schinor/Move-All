import { CardComparison, TrendProduct } from '../../core/models/contract.models';

const brl = (value: number) => Math.round(value).toLocaleString('pt-BR');

export function familyTypeText(p: TrendProduct): string | null {
  return p.familyName && p.typeName ? `${p.familyName} › ${p.typeName}` : null;
}

export function listingsText(p: TrendProduct): string | null {
  if (p.listingCount === null || p.listingCount === undefined) return null;
  const n = p.listingCount;
  const s = p.storeCount ?? 0;
  return `${n} ${n === 1 ? 'anúncio' : 'anúncios'} em ${s} ${s === 1 ? 'loja' : 'lojas'}`;
}

export function priceMedianText(p: TrendProduct): string | null {
  return p.priceMedianBr === null || p.priceMedianBr === undefined ? null : `~R$ ${brl(p.priceMedianBr)}`;
}

export function priceRangeText(p: TrendProduct): string | null {
  if (p.priceMinBr == null || p.priceMaxBr == null || p.priceMinBr === p.priceMaxBr) return null;
  return `R$ ${brl(p.priceMinBr)}–${brl(p.priceMaxBr)}`;
}

export function comparisonCountText(c: CardComparison['counts'][number]): string {
  const yes = c.values.find((v) => v.value === 'true');
  const isBoolean = c.values.every((v) => v.value === 'true' || v.value === 'false');
  if (isBoolean) return `${c.labelPt}: ${yes?.count ?? 0} de ${c.total}`;
  const parts = [...c.values].sort((a, b) => b.count - a.count).map((v) => `${v.value.replace(/_/g, ' ')} (${v.count})`);
  return `${c.labelPt}: ${parts.join(', ')}`;
}
