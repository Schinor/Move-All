import { buildCardComparison, median } from './card-comparison';
import { CatalogTypeDef } from './taxonomy.types';

const SPIN: CatalogTypeDef = {
  id: 't1', key: 'spin_bike', familyKey: 'f', familyNamePt: 'F', namePt: 'Bike spinning', descriptionEn: 'x', ncm: null,
  cardKeyAttrs: [],
  comparisonAttrs: [
    { attr: 'roda_inercia_kg', label_pt: 'roda de inércia', kind: 'number', unit: 'kg' },
    { attr: 'com_app', label_pt: 'com app', kind: 'boolean' },
  ],
  variationAttrs: [],
};

const L = (marketplace: string, price: number | null, values: Record<string, unknown>, extra: Partial<{ brand: string; status: 'confirmed' | 'auto' | 'provisional' }> = {}) => ({
  marketplace, price, brand: extra.brand ?? null, status: extra.status ?? 'confirmed' as const, comparisonValues: values,
});

describe('median', () => {
  it('calcula mediana par e ímpar', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('buildCardComparison', () => {
  const listings = [
    L('mercado_livre', 1000, { roda_inercia_kg: 6, com_app: false }, { brand: 'A' }),
    L('shopee_br', 1100, { roda_inercia_kg: 8, com_app: false }, { brand: 'B' }),
    L('amazon_br', 2000, { roda_inercia_kg: 13, com_app: true }, { brand: 'A' }),
    L('mercado_livre', 2200, { roda_inercia_kg: 13, com_app: true }),
    L('1688', 90, { roda_inercia_kg: 20 }),
    L('mercado_livre', 50, { roda_inercia_kg: 99 }, { status: 'provisional' }),
  ];
  const c = buildCardComparison(SPIN, listings);

  it('conta só confirmados; lojas e marcas distintas', () => {
    expect(c.listing_count).toBe(5);
    expect(c.store_count).toBe(4);
    expect(c.brand_count).toBe(2);
  });

  it('conta itens auto como confirmados', () => {
    const c = buildCardComparison(SPIN, [
      L('mercado_livre', 1000, { roda_inercia_kg: 6 }, { status: 'auto' }),
      L('shopee_br', 1200, { roda_inercia_kg: 8 }, { status: 'provisional' }),
    ]);
    expect(c.listing_count).toBe(1);
    expect(c.store_count).toBe(1);
    expect(c.price_median_br).toBe(1000);
  });

  it('preço de venda BR: mediana e faixa só de lojas brasileiras', () => {
    expect(c.price_median_br).toBe(1550);
    expect(c.price_min_br).toBe(1000);
    expect(c.price_max_br).toBe(2200);
  });

  it('faixas numéricas e contagens de booleanos', () => {
    expect(c.ranges).toEqual([{ attr: 'roda_inercia_kg', label_pt: 'roda de inércia', unit: 'kg', min: 6, max: 20 }]);
    expect(c.counts).toEqual([{ attr: 'com_app', label_pt: 'com app', total: 4, values: [{ value: 'false', count: 2 }, { value: 'true', count: 2 }] }]);
  });

  it('aviso de tecnologia quando o preço difere ≥ 30%', () => {
    expect(c.tech_warning).toBe('⚠ Tecnologias diferentes: com app = não custa ~50% menos que com app = sim — compare antes de negociar.');
  });

  it('sem aviso quando a diferença é pequena ou os grupos são pequenos', () => {
    const small = buildCardComparison(SPIN, [
      L('mercado_livre', 1000, { com_app: false }), L('mercado_livre', 1050, { com_app: false }),
      L('mercado_livre', 1100, { com_app: true }), L('mercado_livre', 1150, { com_app: true }),
    ]);
    expect(small.tech_warning).toBeNull();
    expect(buildCardComparison(SPIN, []).price_median_br).toBeNull();
  });
});
