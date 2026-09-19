import { buildFichaInput, inputHash, normalizeListingTitle } from './ficha-input';

describe('ficha-input', () => {
  it('remove o sufixo "(FONTE)" dos dados de demonstração', () => {
    expect(normalizeListingTitle('Walking Pad Esteira Dobrável Ultracompacta (1688)')).toBe('Walking Pad Esteira Dobrável Ultracompacta');
    expect(normalizeListingTitle('Walking Pad Esteira Dobrável Ultracompacta (MERCADOLIVRE)')).toBe('Walking Pad Esteira Dobrável Ultracompacta');
    expect(normalizeListingTitle('Kit (3 peças)  Elástico')).toBe('Kit (3 peças) Elástico');
  });

  it('mesmo título-base de lojas diferentes gera o mesmo hash', () => {
    const a = inputHash(buildFichaInput('Halter Sextavado 5kg (AMAZON)'));
    const b = inputHash(buildFichaInput('Halter Sextavado 5kg (SHOPEE_BR)'));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('junta título e recorte sem repetir o título e corta em 4000', () => {
    const text = buildFichaInput('Bike X', 'Bike X\n- roda 13 kg\n' + 'y'.repeat(5000));
    expect(text.startsWith('Bike X\n- roda 13 kg')).toBe(true);
    expect(text.length).toBe(4000);
  });

  it('sem recorte usa só o título', () => {
    expect(buildFichaInput('Bike X', '   ')).toBe('Bike X');
    expect(buildFichaInput('Bike X', null)).toBe('Bike X');
  });
});
