import { cardListFields, provisionalScoreOverride } from './card-fields';

describe('card-fields', () => {
  it('monta campos do card com chips', () => {
    expect(cardListFields({
      cardStatus: 'confirmed', familyName: 'Bikes spinning', typeName: 'Bike spinning',
      cardKeyAttrs: [{ attr: 'resistencia', label_pt: 'resistência', values: [{ value: 'magnetica', label_pt: 'magnética' }] }],
      cardKeyValues: { resistencia: 'magnetica' }, listingCount: 9, storeCount: 4, brandCount: 5,
      priceMedianBr: 1460, priceMinBr: 1390, priceMaxBr: 1520,
    })).toEqual({
      card_status: 'confirmed', family_name: 'Bikes spinning', type_name: 'Bike spinning', card_chips: ['magnética'],
      listing_count: 9, store_count: 4, brand_count: 5, price_median_br: 1460, price_min_br: 1390, price_max_br: 1520,
    });
  });

  it('cluster legado sem tipo: campos nulos e sem chips', () => {
    expect(cardListFields({ cardStatus: 'legacy', familyName: null, typeName: null, cardKeyAttrs: null, cardKeyValues: null,
      listingCount: null, storeCount: null, brandCount: null, priceMedianBr: null, priceMinBr: null, priceMaxBr: null }))
      .toMatchObject({ card_status: 'legacy', card_chips: [], listing_count: null });
  });

  it('provisório zera o score e troca a ação', () => {
    expect(provisionalScoreOverride('provisional')).toEqual({
      move_score: null, score_band: null, action: 'AGUARDANDO_REVISAO', action_label: 'Aguardando revisão' });
    expect(provisionalScoreOverride('confirmed')).toEqual({});
  });
});
