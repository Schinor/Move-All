import { aggregateMonthly, monthLabel, reviewCreatedInMonth } from './series';

function daily(start: string, values: number[]): { t: string; v: number }[] {
  const base = new Date(`${start}T12:00:00.000Z`).getTime();
  return values.map((v, i) => ({ t: new Date(base + i * 86_400_000).toISOString(), v }));
}

describe('series (P1-2)', () => {
  it('monthLabel abrevia em pt-BR', () => {
    expect(monthLabel(2026, 6)).toBe('jul/26');
    expect(monthLabel(2026, 0)).toBe('jan/26');
  });

  it('volume soma o mês; variação contra o anterior', () => {
    // Julho completo (31 dias de 10) + agosto completo (31 dias de 20).
    const buckets = aggregateMonthly(
      [...daily('2026-07-01', Array(31).fill(10)), ...daily('2026-08-01', Array(31).fill(20))],
      'volume',
    );
    expect(buckets.map((b) => b.label)).toEqual(['jul/26', 'ago/26']);
    expect(buckets[0].value).toBe(310);
    expect(buckets[0].partial).toBe(false);
    expect(buckets[0].changePct).toBeNull();
    expect(buckets[1].value).toBe(620);
    expect(buckets[1].changePct).toBe(100);
  });

  it('preço usa a média do mês', () => {
    const buckets = aggregateMonthly(
      [...daily('2026-07-01', [100, 200]), ...daily('2026-08-01', [300])],
      'price',
    );
    expect(buckets[0].value).toBe(150);
    expect(buckets[1].value).toBe(300);
    expect(buckets[1].changePct).toBe(100);
  });

  it('reviews usa avaliações novas no mês', () => {
    const buckets = aggregateMonthly(
      [...daily('2026-07-01', [100, 150]), ...daily('2026-08-01', [150, 230])],
      'review',
    );
    expect(buckets[0].value).toBe(50);
    expect(buckets[1].value).toBe(80);
    expect(buckets[1].changePct).toBe(60);
  });

  it('marca parcial sem extrapolar (janela cortando o mês)', () => {
    const buckets = aggregateMonthly(daily('2026-07-10', [5, 5, 5]), 'volume');
    expect(buckets).toHaveLength(1);
    expect(buckets[0].partial).toBe(true);
    expect(buckets[0].value).toBe(15);
  });

  it('entrada vazia ou inválida devolve vazio (nada inventado)', () => {
    expect(aggregateMonthly([], 'volume')).toEqual([]);
    expect(aggregateMonthly([{ t: 'invalida', v: NaN }], 'price')).toEqual([]);
  });

  it('reviewCreatedInMonth usa a base anterior', () => {
    const items = (vs: number[]) => ({ items: vs.map((v) => ({ v })) });
    expect(reviewCreatedInMonth(items([150, 230]), items([100, 150]))).toBe(80);
    expect(reviewCreatedInMonth(items([100, 150]), null)).toBe(50);
  });
});
