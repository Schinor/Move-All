import { BusinessRulesService } from '../../shared/business-rules/business-rules.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { ConnectorsRegistry } from '../connectors/connectors.registry';
import { TrendEngineService } from '../trend-engine/trend-engine.service';
import { DashboardApiService } from './dashboard-api.service';
import { RedisCacheService } from '../../shared/redis/redis-cache.service';

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-01-01T00:00:00.000Z');
const T1 = new Date(T0.getTime() + 7 * DAY);

function rollup(overrides: Record<string, unknown> = {}) {
  const prices = [10, 90];
  const mean = 50;
  const stddev = Math.sqrt(prices.reduce((sum, price) => sum + (price - mean) ** 2, 0) / prices.length);

  return {
    id: 'cluster-1',
    canonical_name: 'halter ajustável',
    category: 'equipment',
    risk_level: null,
    financial_score: null,
    first_collected_at: T0,
    last_collected_at: T1,
    first_avg_price: 10,
    last_avg_price: 90,
    first_avg_reviews: null,
    last_avg_reviews: null,
    first_avg_signal: null,
    last_avg_signal: null,
    first_signal_type: null,
    latest_marketplace: 'amazon',
    latest_price: 90,
    latest_rating: null,
    latest_reviews: null,
    latest_signal: null,
    latest_signal_type: null,
    marketplaces: ['amazon'],
    demand_sources: [],
    latest_image_url: null,
    has_reviews: false,
    has_sales: false,
    has_seller: false,
    projected_revenue: 0,
    price_mean: mean,
    price_stddev: stddev,
    price_count: 2,
    volume_spark: [],
    demand_spark: [],
    demand_score: null,
    supplier_count: 0,
    ...overrides,
  };
}

describe('DashboardApiService', () => {
  function buildService(
    rows: unknown[],
    cache?: { wrap: jest.Mock },
  ): { service: DashboardApiService; prisma: { $queryRaw: jest.Mock } } {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(rows),
    };

    const service = new DashboardApiService(
      prisma as unknown as PrismaService,
      {} as ConnectorsRegistry,
      new TrendEngineService(new BusinessRulesService()),
      new BusinessRulesService(),
      cache as unknown as RedisCacheService | undefined,
    );

    return { service, prisma };
  }

  describe('risco no ranking', () => {
    it('usa o risco da simulação Monte Carlo quando o cluster já foi simulado', async () => {
      const { service } = buildService([
        rollup({ risk_level: 'baixo', financial_score: 91 }),
      ]);

      const [product] = await service.listTrendingProducts();

      expect(product.risk).toBe('baixo');
      expect(product.financial_score).toBe(91);
    });

    it('cai na heurística de preço quando não há simulação', async () => {
      const { service } = buildService([rollup()]);

      const [product] = await service.listTrendingProducts();

      expect(product.risk).toBe('alto');
      expect(product.financial_score).toBeNull();
    });

    it('ignora um riskLevel fora dos níveis conhecidos e usa a heurística', async () => {
      const { service } = buildService([rollup({ risk_level: 'desconhecido' })]);

      const [product] = await service.listTrendingProducts();

      expect(product.risk).toBe('alto');
    });

    it('retorna risco nulo sem simulação e com um único preço', async () => {
      const { service } = buildService([
        rollup({
          first_avg_price: 10,
          last_avg_price: 10,
          latest_price: 10,
          price_mean: 10,
          price_stddev: 0,
          price_count: 1,
        }),
      ]);

      const [product] = await service.listTrendingProducts();

      expect(product.risk).toBeNull();
    });
  });

  describe('sort e category', () => {
    it('filtra por category na query SQL', async () => {
      const { service, prisma } = buildService([rollup({ category: 'cardio_fitness' })]);

      await service.listTrendingProducts({ category: 'cardio_fitness' });

      expect(prisma.$queryRaw).toHaveBeenCalled();
      const sql = prisma.$queryRaw.mock.calls[0][0] as { values: unknown[] };
      expect(sql.values).toContain('cardio_fitness');
    });

    it('ordena por nome quando sort=name', async () => {
      const { service } = buildService([
        rollup({
          id: 'b',
          canonical_name: 'Zebra Bike',
          latest_reviews: 800,
          last_avg_reviews: 800,
          first_avg_reviews: 400,
        }),
        rollup({
          id: 'a',
          canonical_name: 'Alpha Bike',
          latest_reviews: 800,
          last_avg_reviews: 800,
          first_avg_reviews: 400,
        }),
      ]);

      const products = await service.listTrendingProducts({ sort: 'name' });

      expect(products.map((p) => p.canonical_name)).toEqual(['Alpha Bike', 'Zebra Bike']);
    });

    it('inclui sort e category na chave de cache', async () => {
      const wrap = jest.fn(async (_key: string, _ttl: number, factory: () => Promise<unknown>) =>
        factory(),
      );
      const { service } = buildService([rollup()], { wrap });

      await service.listTrendingProducts({
        limit: 20,
        sort: 'trend_score',
        category: 'cardio_fitness',
      });

      expect(wrap).toHaveBeenCalledWith(
        'dashboard:trends:products:20:trend_score:cardio_fitness',
        3600,
        expect.any(Function),
      );
    });
  });
});
