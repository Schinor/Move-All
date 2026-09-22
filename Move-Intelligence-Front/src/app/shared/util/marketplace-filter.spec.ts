import { describe, expect, it } from 'vitest';
import { filterByMarketplace, marketplaceChips } from './marketplace-filter';

const rows = [
  { m: 'alibaba', id: 1 },
  { m: 'amazon_br', id: 2 },
  { m: 'alibaba', id: 3 },
  { m: '1688', id: 4 },
];
const label = (m: string) => ({ alibaba: 'Alibaba', amazon_br: 'Amazon BR', '1688': '1688' })[m] ?? m;

describe('marketplace-filter', () => {
  it('monta "Todos" + um chip por marketplace, com contagem, ordenado pelo rótulo', () => {
    expect(marketplaceChips(rows, (r) => r.m, label)).toEqual([
      { marketplace: null, label: 'Todos', count: 4 },
      { marketplace: '1688', label: '1688', count: 1 },
      { marketplace: 'alibaba', label: 'Alibaba', count: 2 },
      { marketplace: 'amazon_br', label: 'Amazon BR', count: 1 },
    ]);
  });

  it('filtra pelo marketplace escolhido e devolve tudo com null', () => {
    expect(filterByMarketplace(rows, (r) => r.m, 'alibaba').map((r) => r.id)).toEqual([1, 3]);
    expect(filterByMarketplace(rows, (r) => r.m, null)).toHaveLength(4);
  });

  it('lista vazia devolve só "Todos (0)"', () => {
    expect(marketplaceChips([], (r: { m: string }) => r.m, label)).toEqual([
      { marketplace: null, label: 'Todos', count: 0 },
    ]);
  });
});
