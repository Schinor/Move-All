import { buildFichaSystemPrompt, buildFichaUserMessage } from './ficha-prompt';
import { CatalogTypeDef } from './taxonomy.types';

const TYPES: CatalogTypeDef[] = [{
  id: 't1', key: 'spin_bike', familyKey: 'spinning_bike', familyNamePt: 'Bikes spinning', namePt: 'Bike spinning',
  descriptionEn: 'upright indoor cycling bike', ncm: '9506.91.00',
  cardKeyAttrs: [{ attr: 'resistencia', label_pt: 'resistência', values: [{ value: 'magnetica', label_pt: 'magnética' }, { value: 'friccao', label_pt: 'por fricção' }] }],
  comparisonAttrs: [{ attr: 'roda_inercia_kg', label_pt: 'roda de inércia', kind: 'number', unit: 'kg' }],
  variationAttrs: ['cor'],
}];

describe('ficha-prompt', () => {
  const system = buildFichaSystemPrompt(TYPES);

  it('lista os tipos com valores permitidos, comparação e variação', () => {
    expect(system).toContain('spin_bike: upright indoor cycling bike');
    expect(system).toContain('resistencia ∈ {magnetica, friccao}');
    expect(system).toContain('roda_inercia_kg (number, kg)');
    expect(system).toContain('variation: cor');
  });

  it('exige JSON Lines e as chaves da ficha', () => {
    expect(system).toContain('JSON Lines');
    for (const key of ['ref', 'type_key', 'suggested_type', 'in_scope', 'is_accessory_or_part', 'is_kit_or_bundle',
      'has_variations', 'card_key_values', 'new_differential', 'comparison_values', 'variation_values', 'specs',
      'brand', 'model', 'confidence']) {
      expect(system).toContain(`"${key}"`);
    }
  });

  it('traz os exemplos do teste cego', () => {
    expect(system).toContain('Esteira Elétrica Plana Residencial Bluetooth');
    expect(system).toContain('dumbbell_handle');
    expect(system).toContain('呼吸啞鈴');
  });

  it('mensagem do usuário é um array JSON com ref e text', () => {
    const msg = buildFichaUserMessage([{ ref: 'L1', text: 'Bike X' }]);
    expect(JSON.parse(msg)).toEqual([{ ref: 'L1', text: 'Bike X' }]);
  });
});
