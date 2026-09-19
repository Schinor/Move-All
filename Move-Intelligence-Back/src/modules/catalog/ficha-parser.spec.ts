import { parseFichaJsonLines, validateFicha } from './ficha-parser';
import { CatalogTypeDef } from './taxonomy.types';

const SPIN: CatalogTypeDef = {
  id: 't1', key: 'spin_bike', familyKey: 'spinning_bike', familyNamePt: 'Bikes spinning', namePt: 'Bike spinning',
  descriptionEn: 'x', ncm: null,
  cardKeyAttrs: [{ attr: 'resistencia', label_pt: 'resistência', values: [{ value: 'magnetica', label_pt: 'magnética' }] }],
  comparisonAttrs: [
    { attr: 'roda_inercia_kg', label_pt: 'roda', kind: 'number', unit: 'kg' },
    { attr: 'com_app', label_pt: 'app', kind: 'boolean' },
  ],
  variationAttrs: ['cor'],
};
const TYPES = new Map([[SPIN.key, SPIN]]);

describe('parseFichaJsonLines', () => {
  it('lê uma linha por objeto, ignora cerca e linha cortada', () => {
    const content = '```json\n{"ref":"L1","type_key":"spin_bike"}\n{"ref":"L2","type_key":"unknown"}\n{"ref":"L3","type_k';
    expect(parseFichaJsonLines(content).map((l) => l.ref)).toEqual(['L1', 'L2']);
  });

  it('aceita também um array JSON', () => {
    expect(parseFichaJsonLines('[{"ref":"L1"},{"ref":"L2"}]').map((l) => l.ref)).toEqual(['L1', 'L2']);
  });

  it('aceita objetos formatados em várias linhas com objetos aninhados', () => {
    const content = `{
      "ref": "L1",
      "type_key": "spin_bike",
      "specs": { "texto": "chave } preservada", "peso": { "valor": 13 } }
    }
    {
      "ref": "L2",
      "type_key": "unknown"
    }`;
    expect(parseFichaJsonLines(content).map((l) => l.ref)).toEqual(['L1', 'L2']);
  });

  it('ignora objetos sem ref e conteúdo vazio', () => {
    expect(parseFichaJsonLines('{"type_key":"x"}')).toEqual([]);
    expect(parseFichaJsonLines(null)).toEqual([]);
  });
});

describe('validateFicha', () => {
  it('tipo conhecido com chave completa', () => {
    const v = validateFicha({ ref: 'L1', type_key: 'spin_bike', in_scope: true, card_key_values: { resistencia: 'magnetica' },
      comparison_values: { roda_inercia_kg: '13', com_app: true, inventado: 1 }, variation_values: { cor: 'preto', peso: 2 },
      brand: 'Merach', confidence: 1.7 }, TYPES);
    expect(v.typeKey).toBe('spin_bike');
    expect(v.cardKeyValues).toEqual({ resistencia: 'magnetica' });
    expect(v.missingKeyAttrs).toEqual([]);
    expect(v.comparisonValues).toEqual({ roda_inercia_kg: 13, com_app: true });
    expect(v.variationValues).toEqual({ cor: 'preto' });
    expect(v.brand).toBe('Merach');
    expect(v.confidence).toBe(1);
  });

  it('valor não permitido vira atributo faltando', () => {
    const v = validateFicha({ ref: 'L1', type_key: 'spin_bike', card_key_values: { resistencia: 'ar' } }, TYPES);
    expect(v.cardKeyValues).toEqual({});
    expect(v.missingKeyAttrs).toEqual(['resistencia']);
  });

  it('tipo inventado vira unknown com sugestão', () => {
    const v = validateFicha({ ref: 'L1', type_key: 'squat_cage' }, TYPES);
    expect(v.typeKey).toBe('unknown');
    expect(v.suggestedType).toBe('squat_cage');
  });

  it('fora do escopo', () => {
    const v = validateFicha({ ref: 'L1', type_key: 'unknown', in_scope: false }, TYPES);
    expect(v.inScope).toBe(false);
    expect(v.typeKey).toBe('unknown');
  });

  it('diferencial novo é normalizado', () => {
    const v = validateFicha({ ref: 'L1', type_key: 'spin_bike', card_key_values: { resistencia: 'magnetica' }, new_differential: 'Water Tank' }, TYPES);
    expect(v.newDifferential).toBe('water_tank');
  });
});
