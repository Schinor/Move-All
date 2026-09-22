import { buildDiscoveryCandidates, normalizeTerm, RisingItem, TypeTerms } from './discovery-candidates';

const types: TypeTerms[] = [
  { typeKey: 'adjustable_dumbbell', pt: 'halter ajustável', en: 'adjustable dumbbells' },
  { typeKey: 'ab_crunch_machine', pt: 'máquina abdominal', en: 'ab crunch machine' },
  { typeKey: 'ab_wheel', pt: 'roda abdominal', en: 'ab roller' },
  { typeKey: 'aerobic_step', pt: 'step aeróbico', en: 'aerobic step' },
  { typeKey: 'pilates_reformer', pt: 'reformer pilates', en: 'pilates reformer' },
];
const r = (query: string, value: number, label = `+${value}%`, breakout = false): RisingItem => ({ query, value, label, breakout });
const terms = (list: ReturnType<typeof buildDiscoveryCandidates>) => list.map((c) => c.term).sort();

describe('buildDiscoveryCandidates', () => {
  it('normaliza sem acento, pontuação e espaços extras', () => {
    expect(normalizeTerm('  Step   Aeróbico, Ajustável! ')).toBe('step aerobico ajustavel');
  });

  it('aplica os exemplos da especificação (§5.2)', () => {
    const out = buildDiscoveryCandidates([
      { typeKey: 'adjustable_dumbbell', geo: 'US', relatedRising: [r('coffee grinder', 19750, 'Breakout', true), r('nike adjustable dumbbells', 800), r('best adjustable dumbbells', 190)] },
      { typeKey: 'ab_crunch_machine', geo: 'US', relatedRising: [r('hip thrust machine', 103950, 'Breakout', true)] },
      { typeKey: 'ab_wheel', geo: 'US', relatedRising: [r('ab roller with elbow support', 140)] },
      { typeKey: 'aerobic_step', geo: 'US', relatedRising: [r('adjustable aerobic step', 500)] },
      { typeKey: 'pilates_reformer', geo: 'US', relatedRising: [r('what is pilates', 300)] },
    ], types);
    expect(terms(out)).toEqual(['ab roller with elbow support', 'adjustable aerobic step', 'nike adjustable dumbbells']);
    const nike = out.find((c) => c.term === 'nike adjustable dumbbells')!;
    expect(nike).toEqual({
      typeKey: 'adjustable_dumbbell', geo: 'US', term: 'nike adjustable dumbbells', termNorm: 'nike adjustable dumbbells',
      risingValue: 800, risingLabel: '+800%', breakout: false,
    });
  });

  it('mantém só os 3 de maior alta por coleta', () => {
    const out = buildDiscoveryCandidates([{
      typeKey: 'adjustable_dumbbell', geo: 'US',
      relatedRising: [r('a dumbbells', 10), r('b dumbbells', 50), r('c dumbbells', 30), r('d dumbbells', 40), r('e dumbbells', 20)],
    }], types);
    expect(out.map((c) => c.risingValue).sort((a, b) => b - a)).toEqual([50, 40, 30]);
  });

  it('descarta termo igual ao termo do radar de qualquer tipo', () => {
    const out = buildDiscoveryCandidates([
      { typeKey: 'ab_wheel', geo: 'BR', relatedRising: [r('roda abdominal', 90), r('Roda Abdominal com apoio', 60)] },
    ], types);
    expect(terms(out)).toEqual(['Roda Abdominal com apoio']);
  });

  it('mesmo termo em dois tipos no mesmo país: fica o de maior alta', () => {
    const out = buildDiscoveryCandidates([
      { typeKey: 'ab_wheel', geo: 'US', relatedRising: [r('abdominal roller pro', 100)] },
      { typeKey: 'ab_crunch_machine', geo: 'US', relatedRising: [r('abdominal roller pro', 300)] },
    ], types);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ typeKey: 'ab_crunch_machine', risingValue: 300 });
  });

  it('ignora tipo sem termos e itens vazios', () => {
    const out = buildDiscoveryCandidates([
      { typeKey: 'desconhecido', geo: 'US', relatedRising: [r('adjustable dumbbells rack', 100)] },
      { typeKey: 'adjustable_dumbbell', geo: 'US', relatedRising: [r('   ', 100)] },
    ], types);
    expect(out).toEqual([]);
  });
});
