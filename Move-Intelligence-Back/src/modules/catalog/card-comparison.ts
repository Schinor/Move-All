import { BR_MARKETPLACES, COUNTED_ITEM_STATUSES } from './catalog.constants';
import { CatalogTypeDef } from './taxonomy.types';

export interface ComparisonListing {
  marketplace: string;
  brand: string | null;
  price: number | null;
  status: 'confirmed' | 'auto' | 'provisional';
  comparisonValues: Record<string, unknown>;
}

export interface CardComparison {
  listing_count: number;
  store_count: number;
  brand_count: number;
  price_median_br: number | null;
  price_min_br: number | null;
  price_max_br: number | null;
  ranges: Array<{ attr: string; label_pt: string; unit: string | null; min: number; max: number }>;
  counts: Array<{ attr: string; label_pt: string; values: Array<{ value: string; count: number }>; total: number }>;
  tech_warning: string | null;
}

const BR = new Set<string>(BR_MARKETPLACES);
const TECH_GAP = 0.3;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function display(value: string): string {
  if (value === 'true') return 'sim';
  if (value === 'false') return 'não';
  return value.replace(/_/g, ' ');
}

export function buildCardComparison(type: CatalogTypeDef, listings: ComparisonListing[]): CardComparison {
  const confirmed = listings.filter((l) =>
    COUNTED_ITEM_STATUSES.includes(l.status as (typeof COUNTED_ITEM_STATUSES)[number]),
  );
  const brPrices = confirmed
    .filter((l) => BR.has(l.marketplace) && typeof l.price === 'number' && l.price > 0)
    .map((l) => l.price as number);

  const ranges: CardComparison['ranges'] = [];
  const counts: CardComparison['counts'] = [];
  let bestWarning: { gap: number; text: string } | null = null;

  for (const def of type.comparisonAttrs) {
    if (def.kind === 'number') {
      const nums = confirmed
        .map((l) => l.comparisonValues[def.attr])
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      if (nums.length) ranges.push({ attr: def.attr, label_pt: def.label_pt, unit: def.unit ?? null, min: Math.min(...nums), max: Math.max(...nums) });
      continue;
    }
    const tally = new Map<string, number>();
    const priceGroups = new Map<string, number[]>();
    for (const l of confirmed) {
      const raw = l.comparisonValues[def.attr];
      if (raw === undefined || raw === null || raw === '') continue;
      const key = String(raw);
      tally.set(key, (tally.get(key) ?? 0) + 1);
      if (BR.has(l.marketplace) && typeof l.price === 'number' && l.price > 0) {
        priceGroups.set(key, [...(priceGroups.get(key) ?? []), l.price]);
      }
    }
    if (tally.size) {
      const values = [...tally.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([value, count]) => ({ value, count }));
      counts.push({ attr: def.attr, label_pt: def.label_pt, values, total: values.reduce((s, v) => s + v.count, 0) });
    }
    const groups = [...priceGroups.entries()]
      .filter(([, prices]) => prices.length >= 2)
      .map(([value, prices]) => ({ value, med: median(prices) as number }));
    if (groups.length >= 2) {
      const cheap = groups.reduce((a, b) => (b.med < a.med ? b : a));
      const dear = groups.reduce((a, b) => (b.med > a.med ? b : a));
      const gap = (dear.med - cheap.med) / dear.med;
      if (gap >= TECH_GAP && (!bestWarning || gap > bestWarning.gap)) {
        bestWarning = {
          gap,
          text: `⚠ Tecnologias diferentes: ${def.label_pt} = ${display(cheap.value)} custa ~${Math.round(gap * 100)}% menos que ${def.label_pt} = ${display(dear.value)} — compare antes de negociar.`,
        };
      }
    }
  }

  return {
    listing_count: confirmed.length,
    store_count: new Set(confirmed.map((l) => l.marketplace)).size,
    brand_count: new Set(confirmed.map((l) => l.brand).filter((b): b is string => !!b)).size,
    price_median_br: median(brPrices),
    price_min_br: brPrices.length ? Math.min(...brPrices) : null,
    price_max_br: brPrices.length ? Math.max(...brPrices) : null,
    ranges,
    counts,
    tech_warning: bestWarning?.text ?? null,
  };
}
