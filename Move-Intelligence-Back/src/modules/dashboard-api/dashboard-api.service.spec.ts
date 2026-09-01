import { BusinessRulesService } from '../../shared/business-rules/business-rules.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { ConnectorsRegistry } from '../connectors/connectors.registry';
import { TrendEngineService } from '../trend-engine/trend-engine.service';
import { DashboardApiService } from './dashboard-api.service';

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-01-01T00:00:00.000Z');

/** Snapshot mínimo com preço, para exercitar a heurística de risco por preço. */
function snapshot(priceMin: number, offsetDays = 0) {
  return {
    marketplace: 'amazon',
    externalProductId: `sku-${priceMin}-${offsetDays}`,
    productClusterId: 'cluster-1',
    title: 'Halter ajustável',
    priceMin,
    rating: null,
    reviewCount: null,
    salesSignalRaw: null,
    salesSignalType: null,
    sellerId: null,
    sellerName: null,
    moq: null,
    collectedAt: new Date(T0.getTime() + offsetDays * DAY),
  };
}

function cluster(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cluster-1',
    canonicalName: 'halter ajustável',
    category: 'equipment',
    riskLevel: null,
    financialScore: null,
    snapshots: [snapshot(10), snapshot(90, 7)],
    ...overrides,
  };
}

describe('DashboardApiService', () => {
  /** Prisma fake: só o `findMany` de clusters é exercitado por estes testes. */
  function buildService(clusters: unknown[]): DashboardApiService {
    const prisma = {
      productCluster: {
        findMany: jest.fn().mockResolvedValue(clusters),
      },
    } as unknown as PrismaService;

    return new DashboardApiService(
      prisma,
      {} as ConnectorsRegistry,
      new TrendEngineService(new BusinessRulesService()),
      new BusinessRulesService(),
    );
  }

  describe('risco no ranking', () => {
    it('usa o risco da simulação Monte Carlo quando o cluster já foi simulado', async () => {
      const service = buildService([
        cluster({ riskLevel: 'baixo', financialScore: 91 }),
      ]);

      const [product] = await service.listTrendingProducts();

      expect(product.risk).toBe('baixo');
      expect(product.financial_score).toBe(91);
    });

    it('cai na heurística de preço quando não há simulação', async () => {
      const service = buildService([cluster()]);

      const [product] = await service.listTrendingProducts();

      // Preços 10 e 90 → coeficiente de variação alto.
      expect(product.risk).toBe('alto');
      expect(product.financial_score).toBeNull();
    });

    it('ignora um riskLevel fora dos níveis conhecidos e usa a heurística', async () => {
      const service = buildService([cluster({ riskLevel: 'desconhecido' })]);

      const [product] = await service.listTrendingProducts();

      expect(product.risk).toBe('alto');
    });

    it('retorna risco nulo sem simulação e com um único preço', async () => {
      const service = buildService([cluster({ snapshots: [snapshot(10)] })]);

      const [product] = await service.listTrendingProducts();

      expect(product.risk).toBeNull();
    });
  });
});
