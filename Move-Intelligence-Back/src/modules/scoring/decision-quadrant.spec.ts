import { classifyQuadrant, isFinancialGood, scoreBandFromScore } from './decision-quadrant';

describe('decision-quadrant (B3)', () => {
  const base = {
    score: 82,
    scoreBand: 'green' as const,
    dataConfidence: 'suficiente',
    financialThreshold: 'green',
  };

  it('sobe + verde → DECIDIR_AGORA', () => {
    expect(
      classifyQuadrant({ ...base, momentum: { direction: 'sobe', confidence: 'completa' } }),
    ).toBe('DECIDIR_AGORA');
  });

  it('sobe + amarela/vermelha → NEGOCIAR_CUSTO', () => {
    expect(
      classifyQuadrant({
        ...base,
        score: 60,
        scoreBand: 'yellow',
        momentum: { direction: 'sobe', confidence: 'completa' },
      }),
    ).toBe('NEGOCIAR_CUSTO');
    expect(
      classifyQuadrant({
        ...base,
        score: 30,
        scoreBand: 'red',
        momentum: { direction: 'sobe', confidence: 'so_vendas' },
      }),
    ).toBe('NEGOCIAR_CUSTO');
  });

  it('estavel/cai + verde → TESTAR_DEMANDA', () => {
    expect(
      classifyQuadrant({ ...base, momentum: { direction: 'estavel', confidence: 'completa' } }),
    ).toBe('TESTAR_DEMANDA');
    expect(
      classifyQuadrant({ ...base, momentum: { direction: 'cai', confidence: 'so_busca' } }),
    ).toBe('TESTAR_DEMANDA');
  });

  it('demais casos → IGNORAR', () => {
    expect(
      classifyQuadrant({
        ...base,
        score: 40,
        scoreBand: 'red',
        momentum: { direction: 'cai', confidence: 'completa' },
      }),
    ).toBe('IGNORAR');
  });

  it('sem score ou momentum insuficiente → DADOS_INSUFICIENTES', () => {
    expect(
      classifyQuadrant({
        ...base,
        score: null,
        scoreBand: null,
        momentum: { direction: 'estavel', confidence: 'completa' },
      }),
    ).toBe('DADOS_INSUFICIENTES');
    expect(
      classifyQuadrant({
        ...base,
        dataConfidence: 'historico_curto',
        momentum: { direction: 'sobe', confidence: 'completa' },
      }),
    ).toBe('DADOS_INSUFICIENTES');
    expect(
      classifyQuadrant({
        ...base,
        momentum: { direction: 'estavel', confidence: 'insuficiente' },
      }),
    ).toBe('DADOS_INSUFICIENTES');
  });

  it('quadrant_financial_threshold permite incluir o amarelo', () => {
    expect(isFinancialGood('yellow', 'green')).toBe(false);
    expect(isFinancialGood('yellow', 'yellow')).toBe(true);
    expect(
      classifyQuadrant({
        ...base,
        score: 60,
        scoreBand: 'yellow',
        financialThreshold: 'yellow',
        momentum: { direction: 'sobe', confidence: 'completa' },
      }),
    ).toBe('DECIDIR_AGORA');
  });

  it('scoreBandFromScore usa 70/50', () => {
    expect(scoreBandFromScore(71)).toBe('green');
    expect(scoreBandFromScore(70)).toBe('yellow');
    expect(scoreBandFromScore(51)).toBe('yellow');
    expect(scoreBandFromScore(50)).toBe('red');
    expect(scoreBandFromScore(null)).toBeNull();
  });
});
