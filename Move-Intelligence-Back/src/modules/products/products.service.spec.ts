import { PrismaService } from '../../shared/database/prisma.service';
import { OpenRouterService } from '../ai-gateway/openrouter.service';
import { OpportunityEngineService } from '../opportunity-engine/opportunity-engine.service';
import { TrendEngineService } from '../trend-engine/trend-engine.service';
import { ProductsService } from './products.service';

// Premissas do cluster "Halteres Ajustáveis" em produção: preço de referência
// abaixo do custo landed e elasticidade -1.6, que é o caso onde o modelo linear
// antigo zerava o volume.
const DEFAULTS = {
  precoVendaBrl: 49,
  fobUsd: 1.62,
  cambioUsd: 5.45,
  freteUnitarioUsd: 6.5,
  impostoImportacaoPct: 35.0,
  icmsPct: 18.0,
  comissaoMarketplacePct: 16.0,
  custoFulfillmentBrl: 32.0,
  custoFixoMensalBrl: 4500.0,
  elasticidadePreco: -1.6,
  volumeBaseMensal: 1846,
};

function buildService(): ProductsService {
  const service = new ProductsService(
    {} as PrismaService,
    {} as TrendEngineService,
    {} as OpportunityEngineService,
    {} as OpenRouterService,
  );

  jest.spyOn(service, 'getUnitEconomicsDefaults').mockResolvedValue(DEFAULTS);

  return service;
}

describe('ProductsService — simulateUnitEconomics', () => {
  describe('projeção de volume por elasticidade', () => {
    it('mantém volume positivo acima do corte do modelo linear (P0 * (1 + 1/|Ed|) = R$79,60)', async () => {
      const service = buildService();

      const { metrics } = await service.simulateUnitEconomics('cluster-1', {
        precoVendaBrl: 300,
      });

      expect(metrics.volumeProjetado).toBeGreaterThan(0);
    });

    it('decai de forma monotônica ao longo de toda a faixa do slider (50 a 3000)', async () => {
      const service = buildService();

      const volumes: number[] = [];
      for (const precoVendaBrl of [80, 300, 1220, 3000]) {
        const { metrics } = await service.simulateUnitEconomics('cluster-1', { precoVendaBrl });
        volumes.push(metrics.volumeProjetado);
      }

      expect(volumes.every((v) => v > 0)).toBe(true);
      for (let i = 1; i < volumes.length; i += 1) {
        expect(volumes[i]).toBeLessThan(volumes[i - 1]);
      }
    });

    it('propaga o volume para lucro e ROI em vez de travá-los no custo fixo', async () => {
      const service = buildService();

      const { metrics } = await service.simulateUnitEconomics('cluster-1', {
        precoVendaBrl: 1220,
      });

      expect(metrics.lucroLiquidoMensal).not.toBe(-DEFAULTS.custoFixoMensalBrl);
      expect(metrics.investimentoEstoque).toBeGreaterThan(0);
      expect(metrics.roiPct).not.toBe(0);
    });
  });

  describe('curva de sensibilidade', () => {
    it('é ancorada no preço simulado, e não no preço padrão do cluster', async () => {
      const service = buildService();

      const barato = await service.simulateUnitEconomics('cluster-1', { precoVendaBrl: 100 });
      const caro = await service.simulateUnitEconomics('cluster-1', { precoVendaBrl: 1220 });

      const precosBarato = barato.curvaSensibilidade.map((p) => p.preco);
      const precosCaro = caro.curvaSensibilidade.map((p) => p.preco);

      expect(precosCaro).not.toEqual(precosBarato);
      // a curva precisa cercar o preço simulado
      expect(Math.min(...precosCaro)).toBeLessThan(1220);
      expect(Math.max(...precosCaro)).toBeGreaterThan(1220);
    });
  });
});
