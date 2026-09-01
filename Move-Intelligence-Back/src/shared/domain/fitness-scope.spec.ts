import { isFitnessProduct } from './fitness-scope';

describe('fitness scope', () => {
  it('keeps a fitness item without an explicit category', () => {
    expect(
      isFitnessProduct({
        title: 'Women Training Seamless Fitness Leggings',
      }),
    ).toBe(true);
  });

  it('rejects electronics even when a source misclassifies them', () => {
    expect(
      isFitnessProduct({
        category: 'home_fitness_equipment',
        title: 'JBL Fone de Ouvido Esportivo Sem Fio',
      }),
    ).toBe(false);
  });

  it('rejects generic gaming products', () => {
    expect(
      isFitnessProduct({
        category: 'Interactive Gaming Figures',
        title: 'Video Game Console',
      }),
    ).toBe(false);
  });
});

