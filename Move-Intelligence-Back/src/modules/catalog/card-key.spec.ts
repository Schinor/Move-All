import { buildCardName, cardChipLabels, evaluateCardKey, normalizeDifferential } from './card-key';
import { fichaConfig } from './catalog.constants';
import { CatalogTypeDef } from './taxonomy.types';

function type(partial: Partial<CatalogTypeDef>): CatalogTypeDef {
  return {
    id: 't', key: 'x', familyKey: 'f', familyNamePt: 'F', namePt: 'X', descriptionEn: 'x', ncm: null,
    cardKeyAttrs: [], comparisonAttrs: [], variationAttrs: [], ...partial,
  };
}

const SPIN = type({
  key: 'spin_bike', namePt: 'Bike spinning',
  cardKeyAttrs: [{ attr: 'resistencia', label_pt: 'resistência', values: [
    { value: 'magnetica', label_pt: 'magnética' }, { value: 'friccao', label_pt: 'por fricção' }] }],
});
const TREADMILL = type({
  key: 'treadmill', namePt: 'Esteira',
  cardKeyAttrs: [{ attr: 'diferencial', label_pt: 'diferencial', values: [
    { value: 'nenhum', label_pt: 'sem diferencial' }, { value: 'chuveiro', label_pt: 'com chuveiro' }] }],
});
const PLATE = type({
  key: 'weight_plate', namePt: 'Anilha',
  cardKeyAttrs: [
    { attr: 'formato', label_pt: 'formato', values: [{ value: 'bumper', label_pt: 'bumper' }] },
    { attr: 'furo', label_pt: 'furo', values: [{ value: 'olimpico_50mm', label_pt: 'furo olímpico 50 mm' }] },
  ],
});
const KETTLE_NO_ATTRS = type({ key: 'battle_rope', namePt: 'Battle rope' });
const ALIASED = type({
  key: 'aliased', namePt: 'Aliased',
  cardKeyAttrs: [{ attr: 'formato', label_pt: 'formato', values: [
    { value: 'smart_app', label_pt: 'smart com app', aliases: ['smart'] },
  ] }, { attr: 'diferencial', label_pt: 'diferencial', values: [
    { value: 'nenhum', label_pt: 'sem diferencial' },
    { value: 'com_elasticos', label_pt: '', aliases: ['com_cordas'] },
  ] }],
});

describe('evaluateCardKey', () => {
  it('chave completa', () => {
    const r = evaluateCardKey(SPIN, { resistencia: 'magnetica' }, null);
    expect(r).toEqual({ cardKey: 'spin_bike|resistencia=magnetica', values: { resistencia: 'magnetica' }, missing: [], newDifferential: null, complete: true });
  });

  it('valor fora da lista vira faltando com "?"', () => {
    const r = evaluateCardKey(SPIN, { resistencia: 'eletromagnetica' }, null);
    expect(r.cardKey).toBe('spin_bike|resistencia=?');
    expect(r.missing).toEqual(['resistencia']);
    expect(r.complete).toBe(false);
  });

  it('respeita a ordem dos atributos do tipo', () => {
    const r = evaluateCardKey(PLATE, { furo: 'olimpico_50mm', formato: 'bumper' }, null);
    expect(r.cardKey).toBe('weight_plate|formato=bumper|furo=olimpico_50mm');
  });

  it('tipo sem atributos-chave: chave = tipo', () => {
    expect(evaluateCardKey(KETTLE_NO_ATTRS, {}, null).cardKey).toBe('battle_rope');
  });

  it('diferencial novo ocupa o atributo diferencial e deixa a chave incompleta', () => {
    const r = evaluateCardKey(TREADMILL, {}, 'Shower Head');
    expect(r.cardKey).toBe('treadmill|diferencial=shower_head');
    expect(r.newDifferential).toBe('shower_head');
    expect(r.missing).toEqual([]);
    expect(r.complete).toBe(false);
  });

  it('diferencial já permitido mandado em new_differential vale como valor conhecido', () => {
    const r = evaluateCardKey(TREADMILL, {}, 'chuveiro');
    expect(r).toEqual({ cardKey: 'treadmill|diferencial=chuveiro', values: { diferencial: 'chuveiro' }, missing: [], newDifferential: null, complete: true });
  });

  it('diferencial novo em tipo sem atributo diferencial vai para o fim da chave', () => {
    expect(evaluateCardKey(SPIN, { resistencia: 'magnetica' }, 'water').cardKey)
      .toBe('spin_bike|resistencia=magnetica|diferencial=water');
  });

  it('normaliza aliases para o valor canônico antes de comparar a taxonomia', () => {
    const smart = evaluateCardKey(ALIASED, { formato: 'smart' }, null);
    expect(smart.values.formato).toBe('smart_app');
    expect(smart.complete).toBe(false);

    const cords = evaluateCardKey(ALIASED, {}, 'com cordas');
    expect(cords.values.diferencial).toBe('com_elasticos');
    expect(cords.newDifferential).toBeNull();
    expect(cords.complete).toBe(false);
    expect(cords.missing).toEqual(['formato']);
  });
});

describe('buildCardName / cardChipLabels', () => {
  it('monta nome com rótulos e ignora "nenhum"', () => {
    expect(buildCardName(SPIN, { resistencia: 'magnetica' })).toBe('Bike spinning magnética');
    expect(buildCardName(TREADMILL, { diferencial: 'nenhum' })).toBe('Esteira');
    expect(buildCardName(TREADMILL, { diferencial: 'chuveiro' })).toBe('Esteira com chuveiro');
  });

  it('ignora "?" e usa o próprio valor para diferencial sem rótulo', () => {
    expect(buildCardName(SPIN, { resistencia: '?' })).toBe('Bike spinning');
    expect(buildCardName(TREADMILL, { diferencial: 'shower_head' })).toBe('Esteira com shower head');
  });

  it('chips são os rótulos sem o nome do tipo', () => {
    expect(cardChipLabels(PLATE, { formato: 'bumper', furo: 'olimpico_50mm' })).toEqual(['bumper', 'furo olímpico 50 mm']);
  });
});

describe('normalizeDifferential / fichaConfig', () => {
  it('normaliza diferencial', () => {
    expect(normalizeDifferential('  Chuveiro Integrado ')).toBe('chuveiro_integrado');
    expect(normalizeDifferential('')).toBeNull();
    expect(normalizeDifferential(null)).toBeNull();
  });

  it('lê padrões e limites', () => {
    expect(fichaConfig({})).toEqual({ enabled: false, cron: '*/30 * * * *', dailyCallLimit: 35, batchSize: 20, maxTokens: 20000, timeoutMs: 120000, model: undefined });
    expect(fichaConfig({ FICHA_ENABLED: 'true', FICHA_BATCH_SIZE: '500', FICHA_MODEL: ' m ' }).batchSize).toBe(60);
    expect(fichaConfig({ FICHA_MODEL: ' m ' }).model).toBe('m');
  });
});
