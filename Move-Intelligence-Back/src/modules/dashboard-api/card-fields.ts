import { cardChipLabels } from '../catalog/card-key';
import { CardKeyAttr, CatalogTypeDef } from '../catalog/taxonomy.types';

export interface CardRowInput {
  cardStatus: string | null;
  familyName: string | null;
  typeName: string | null;
  cardKeyAttrs: CardKeyAttr[] | null;
  cardKeyValues: Record<string, string> | null;
  listingCount: number | null;
  storeCount: number | null;
  brandCount: number | null;
  priceMedianBr: number | null;
  priceMinBr: number | null;
  priceMaxBr: number | null;
}

export function cardListFields(row: CardRowInput): Record<string, unknown> {
  const chips = row.cardKeyAttrs && row.cardKeyValues
    ? cardChipLabels({ cardKeyAttrs: row.cardKeyAttrs } as CatalogTypeDef, row.cardKeyValues)
    : [];
  return {
    card_status: row.cardStatus,
    family_name: row.familyName,
    type_name: row.typeName,
    card_chips: chips,
    listing_count: row.listingCount,
    store_count: row.storeCount,
    brand_count: row.brandCount,
    price_median_br: row.priceMedianBr,
    price_min_br: row.priceMinBr,
    price_max_br: row.priceMaxBr,
  };
}

/** Card provisório aparece sem score e com a ação "Aguardando revisão" (spec D9 e 4.4). */
export function provisionalScoreOverride(cardStatus: string | null): Record<string, unknown> {
  return cardStatus === 'provisional'
    ? { move_score: null, score_band: null, action: 'AGUARDANDO_REVISAO', action_label: 'Aguardando revisão' }
    : {};
}
