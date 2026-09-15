import { expandSearchQuery, normalizeSearchText } from './search-expansion';

describe('expandSearchQuery', () => {
  it('entende "pernas" por grupo muscular (pergunta do print)', () => {
    const expansion = expandSearchQuery('Tem algum produto para as pernas?');
    expect(expansion.tokens).toEqual(['perna']);
    expect(expansion.topics).toEqual(['perna']);
    expect(expansion.labels).toEqual(['Pernas']);
    expect(expansion.categories).toContain('ankle_weights');
    expect(expansion.categories).toEqual(expect.arrayContaining(['spinning_bike', 'resistance_bands']));
    expect(expansion.terms).toEqual(expect.arrayContaining(['bicicleta', 'step']));
  });

  it('ignora acento e plural nos tópicos', () => {
    expect(normalizeSearchText('Abdômen')).toBe('abdomen');
    expect(expandSearchQuery('algo para abdômen').topics).toEqual(['abdomen']);
    expect(expandSearchQuery('treino de braços').topics).toEqual(['braco']);
  });

  it('nome de produto sem tópico só gera palavras', () => {
    const expansion = expandSearchQuery('kettlebell 16kg');
    expect(expansion.tokens).toEqual(['kettlebell', '16kg']);
    expect(expansion.topics).toEqual([]);
    expect(expansion.terms).toEqual([]);
  });
});
