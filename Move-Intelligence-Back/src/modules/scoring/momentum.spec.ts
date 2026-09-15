import {
  computeMomentum,
  salesGrowthPct,
  searchGrowthPct,
} from './momentum';

describe('momentum (B2)', () => {
  it('série crescente → sobe com fontes completas', () => {
    const sales = [100, 110, 120, 135, 150, 165, 185, 210];
    const search = [20, 21, 22, 23, 24, 25, 26, 27, 30, 32, 34, 36, 40, 44, 48, 55];
    const res = computeMomentum({ salesWeekly: sales, searchWeekly: search });
    expect(res.confidence).toBe('completa');
    expect(res.direction).toBe('sobe');
    expect(res.sources).toContain('vendas');
    expect(res.sources).toContain('busca');
    expect(res.growthPct).toBeGreaterThan(10);
  });

  it('série estável → estavel', () => {
    const sales = [100, 101, 99, 100, 101, 100, 99, 100];
    const search = Array(16).fill(40);
    const res = computeMomentum({ salesWeekly: sales, searchWeekly: search });
    expect(res.direction).toBe('estavel');
    expect(Math.abs(res.growthPct)).toBeLessThanOrEqual(10);
  });

  it('série decrescente → cai', () => {
    const sales = [210, 185, 165, 150, 135, 120, 110, 100];
    const search = [55, 48, 44, 40, 36, 34, 32, 30, 27, 26, 25, 24, 23, 22, 21, 20];
    const res = computeMomentum({ salesWeekly: sales, searchWeekly: search });
    expect(res.direction).toBe('cai');
    expect(res.growthPct).toBeLessThan(-10);
  });

  it('sem busca usa só vendas (so_vendas)', () => {
    const sales = [100, 120, 140, 160, 180, 200, 220, 250];
    const res = computeMomentum({ salesWeekly: sales, searchWeekly: [] });
    expect(res.confidence).toBe('so_vendas');
    expect(res.sources).toEqual(['vendas']);
    expect(res.direction).toBe('sobe');
  });

  it('sem vendas usa só busca (so_busca)', () => {
    const search = [20, 20, 20, 20, 20, 20, 20, 20, 40, 40, 40, 40, 40, 40, 40, 40];
    const res = computeMomentum({ salesWeekly: [], searchWeekly: search });
    expect(res.confidence).toBe('so_busca');
    expect(res.sources).toContain('busca');
  });

  it('sem nada → insuficiente', () => {
    const res = computeMomentum({ salesWeekly: [], searchWeekly: [] });
    expect(res.confidence).toBe('insuficiente');
    expect(res.sources).toEqual([]);
  });

  it('sazonalidade: pico em janeiro descontado pelo YoY', () => {
    // Ano anterior com o mesmo pico: crescimento YoY ~0 segura o número.
    const prevYear = [80, 80, 80, 80, 80, 80, 80, 80];
    const search = [40, 40, 40, 40, 40, 40, 40, 40, 80, 80, 80, 80, 80, 80, 80, 80];
    const withoutYoy = searchGrowthPct(search);
    const withYoy = searchGrowthPct(search, prevYear);
    expect(withoutYoy).not.toBeNull();
    expect(withYoy).not.toBeNull();
    // Com YoY igual ao pico, o crescimento cai pela metade (média vsPrev+vsYoY).
    expect(Math.abs(withYoy as number)).toBeLessThan(Math.abs(withoutYoy as number));
  });

  it('social indisponível não entra nas sources (B6)', () => {
    const sales = [100, 110, 120, 135, 150, 165, 185, 210];
    const res = computeMomentum(
      { salesWeekly: sales, searchWeekly: [], socialGrowthPct: 50, socialAvailable: false },
      {},
    );
    expect(res.sources).not.toContain('social');
  });

  it('sem Google, social assume a busca', () => {
    const sales: number[] = [];
    const res = computeMomentum({
      salesWeekly: sales,
      searchWeekly: [],
      socialGrowthPct: 42,
      socialAvailable: true,
    });
    expect(res.confidence).toBe('so_busca');
    expect(res.sources).toContain('social');
    expect(res.growthPct).toBe(42);
  });

  it('salesGrowthPct exige mínimo de pontos', () => {
    expect(salesGrowthPct([100, 110])).toBeNull();
    expect(salesGrowthPct([])).toBeNull();
  });
});
