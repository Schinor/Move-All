import { BusinessRulesService } from '../../shared/business-rules/business-rules.service';
import { TrendEngineService, TrendSnapshotInput, TrendWindowRollup } from './trend-engine.service';

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-01-01T00:00:00.000Z');
const T1 = new Date(T0.getTime() + 7 * DAY);

function snapshot(
  overrides: Partial<TrendSnapshotInput> = {},
): TrendSnapshotInput {
  return {
    marketplace: 'amazon',
    priceMin: null,
    rating: null,
    reviewCount: null,
    salesSignalRaw: null,
    salesSignalType: null,
    collectedAt: T0,
    ...overrides,
  };
}

describe('TrendEngineService', () => {
  let engine: TrendEngineService;

  beforeEach(() => {
    engine = new TrendEngineService(new BusinessRulesService());
  });

  describe('contrato', () => {
    it('retorna score zerado sem snapshots', () => {
      expect(engine.calculateFromSnapshots([])).toEqual({
        searchGrowthScore: 0,
        marketplaceGrowthScore: 0,
        supplierGrowthScore: 0,
        priceOpportunityScore: 0,
        reviewVelocityScore: 0,
        socialBuzzScore: 0,
        trendScore: 0,
      });
    });

    it('mantém todos os campos do TrendScoreBreakdown', () => {
      const result = engine.calculateFromSnapshots([
        snapshot({ reviewCount: 500, rating: 4.5, priceMin: 30 }),
      ]);

      expect(Object.keys(result).sort()).toEqual(
        [
          'marketplaceGrowthScore',
          'priceOpportunityScore',
          'reviewVelocityScore',
          'searchGrowthScore',
          'socialBuzzScore',
          'supplierGrowthScore',
          'trendScore',
        ].sort(),
      );
    });

    it('zera o score quando não há volume nem sinal relevante', () => {
      const result = engine.calculateFromSnapshots([
        snapshot({ reviewCount: 5, priceMin: 10 }),
      ]);

      expect(result.trendScore).toBe(0);
    });
  });

  describe('baseline com um único snapshot', () => {
    it('produz score > 0 mesmo sem série histórica', () => {
      const result = engine.calculateFromSnapshots([
        snapshot({ reviewCount: 1200, rating: 4.6, priceMin: 49.9 }),
      ]);

      expect(result.trendScore).toBeGreaterThan(0);
      expect(result.marketplaceGrowthScore).toBeGreaterThan(0);
      expect(result.reviewVelocityScore).toBeGreaterThan(0);
      expect(result.priceOpportunityScore).toBeGreaterThan(0);
    });

    it('ordena por volume absoluto de reviews', () => {
      const alto = engine.calculateFromSnapshots([
        snapshot({ reviewCount: 2500 }),
      ]);
      const medio = engine.calculateFromSnapshots([
        snapshot({ reviewCount: 300 }),
      ]);
      const baixo = engine.calculateFromSnapshots([
        snapshot({ reviewCount: 40 }),
      ]);

      expect(alto.trendScore).toBeGreaterThan(medio.trendScore);
      expect(medio.trendScore).toBeGreaterThan(baixo.trendScore);
      expect(baixo.trendScore).toBeGreaterThan(0);
    });

    it('valoriza rating alto sobre rating baixo com o mesmo volume', () => {
      const bom = engine.calculateFromSnapshots([
        snapshot({ reviewCount: 300, rating: 4.8 }),
      ]);
      const ruim = engine.calculateFromSnapshots([
        snapshot({ reviewCount: 300, rating: 2.5 }),
      ]);
      const semRating = engine.calculateFromSnapshots([
        snapshot({ reviewCount: 300 }),
      ]);

      expect(bom.trendScore).toBeGreaterThan(ruim.trendScore);
      // Rating abaixo do piso não rende crédito: equivale a não ter rating.
      expect(ruim.trendScore).toBe(semRating.trendScore);
    });

    it('valoriza a presença de preço', () => {
      const comPreco = engine.calculateFromSnapshots([
        snapshot({ reviewCount: 300, priceMin: 25 }),
      ]);
      const semPreco = engine.calculateFromSnapshots([
        snapshot({ reviewCount: 300 }),
      ]);

      expect(comPreco.trendScore).toBeGreaterThan(semPreco.trendScore);
      expect(comPreco.priceOpportunityScore).toBeGreaterThan(
        semPreco.priceOpportunityScore,
      );
    });
  });

  describe('best_seller_rank', () => {
    it('trata rank menor como sinal melhor no baseline', () => {
      const topRank = engine.calculateFromSnapshots([
        snapshot({ salesSignalRaw: 100, salesSignalType: 'best_seller_rank' }),
      ]);
      const rankRuim = engine.calculateFromSnapshots([
        snapshot({
          salesSignalRaw: 40000,
          salesSignalType: 'best_seller_rank',
        }),
      ]);

      expect(topRank.trendScore).toBeGreaterThan(rankRuim.trendScore);
      expect(rankRuim.trendScore).toBeGreaterThan(0);
    });

    it('qualifica o cluster mesmo sem volume de reviews', () => {
      const result = engine.calculateFromSnapshots([
        snapshot({ salesSignalRaw: 500, salesSignalType: 'best_seller_rank' }),
      ]);

      expect(result.trendScore).toBeGreaterThan(0);
    });

    it('rank fora da faixa relevante não gera sinal', () => {
      const result = engine.calculateFromSnapshots([
        snapshot({
          salesSignalRaw: 5_734_621,
          salesSignalType: 'best_seller_rank',
        }),
      ]);

      expect(result.trendScore).toBe(0);
    });

    it('inverte o crescimento: melhora de rank pontua acima do baseline', () => {
      const melhorou = engine.calculateFromSnapshots([
        snapshot({
          salesSignalRaw: 5000,
          salesSignalType: 'best_seller_rank',
          collectedAt: T0,
        }),
        snapshot({
          salesSignalRaw: 500,
          salesSignalType: 'best_seller_rank',
          collectedAt: T1,
        }),
      ]);
      const baseline = engine.calculateFromSnapshots([
        snapshot({
          salesSignalRaw: 500,
          salesSignalType: 'best_seller_rank',
          collectedAt: T1,
        }),
      ]);

      expect(melhorou.marketplaceGrowthScore).toBeGreaterThan(
        baseline.marketplaceGrowthScore,
      );
      expect(melhorou.trendScore).toBeGreaterThan(baseline.trendScore);
    });

    it('piora de rank não pontua acima do baseline', () => {
      const piorou = engine.calculateFromSnapshots([
        snapshot({
          salesSignalRaw: 100,
          salesSignalType: 'best_seller_rank',
          collectedAt: T0,
        }),
        snapshot({
          salesSignalRaw: 500,
          salesSignalType: 'best_seller_rank',
          collectedAt: T1,
        }),
      ]);
      const baseline = engine.calculateFromSnapshots([
        snapshot({
          salesSignalRaw: 500,
          salesSignalType: 'best_seller_rank',
          collectedAt: T1,
        }),
      ]);

      expect(piorou.trendScore).toBe(baseline.trendScore);
    });

    it('não inverte sinais de volume (sales_count)', () => {
      const cresceu = engine.calculateFromSnapshots([
        snapshot({
          salesSignalRaw: 100,
          salesSignalType: 'sales_count',
          collectedAt: T0,
        }),
        snapshot({
          salesSignalRaw: 900,
          salesSignalType: 'sales_count',
          collectedAt: T1,
        }),
      ]);
      const baseline = engine.calculateFromSnapshots([
        snapshot({
          salesSignalRaw: 900,
          salesSignalType: 'sales_count',
          collectedAt: T1,
        }),
      ]);

      expect(cresceu.marketplaceGrowthScore).toBeGreaterThan(
        baseline.marketplaceGrowthScore,
      );
    });
  });

  describe('série histórica domina o baseline', () => {
    it('crescimento de reviews pontua acima do mesmo snapshot isolado', () => {
      const comHistorico = engine.calculateFromSnapshots([
        snapshot({ reviewCount: 200, priceMin: 40, collectedAt: T0 }),
        snapshot({ reviewCount: 900, priceMin: 40, collectedAt: T1 }),
      ]);
      const soBaseline = engine.calculateFromSnapshots([
        snapshot({ reviewCount: 900, priceMin: 40, collectedAt: T1 }),
      ]);

      expect(comHistorico.trendScore).toBeGreaterThan(soBaseline.trendScore);
      expect(comHistorico.reviewVelocityScore).toBeGreaterThan(
        soBaseline.reviewVelocityScore,
      );
    });

    it('crescimento real supera um baseline forte de outro cluster', () => {
      const emAlta = engine.calculateFromSnapshots([
        snapshot({
          reviewCount: 100,
          salesSignalRaw: 200,
          salesSignalType: 'sales_count',
          priceMin: 60,
          collectedAt: T0,
        }),
        snapshot({
          reviewCount: 900,
          salesSignalRaw: 3000,
          salesSignalType: 'sales_count',
          priceMin: 45,
          collectedAt: T1,
        }),
      ]);
      const baselineForte = engine.calculateFromSnapshots([
        snapshot({
          reviewCount: 3000,
          salesSignalRaw: 5000,
          salesSignalType: 'sales_count',
          rating: 5,
          priceMin: 45,
        }),
      ]);

      expect(emAlta.trendScore).toBeGreaterThan(baselineForte.trendScore);
    });

    it('série estável equivale ao baseline (sem descontinuidade na 2ª carga)', () => {
      const estavel = engine.calculateFromSnapshots([
        snapshot({ reviewCount: 500, rating: 4.4, priceMin: 20, collectedAt: T0 }),
        snapshot({ reviewCount: 500, rating: 4.4, priceMin: 20, collectedAt: T1 }),
      ]);
      const primeiraCarga = engine.calculateFromSnapshots([
        snapshot({ reviewCount: 500, rating: 4.4, priceMin: 20, collectedAt: T0 }),
      ]);

      expect(estavel.trendScore).toBe(primeiraCarga.trendScore);
    });
  });

  describe('calculateFromRollup', () => {
    it('produz o mesmo breakdown que calculateFromSnapshots para uma janela de dois pontos', () => {
      const snapshots: TrendSnapshotInput[] = [
        snapshot({
          reviewCount: 200,
          priceMin: 40,
          salesSignalRaw: 100,
          salesSignalType: 'sales_count',
          collectedAt: T0,
        }),
        snapshot({
          reviewCount: 900,
          priceMin: 35,
          salesSignalRaw: 400,
          salesSignalType: 'sales_count',
          collectedAt: T1,
        }),
      ];
      const latest = snapshots[1];
      const rollup: TrendWindowRollup = {
        firstAvgPrice: 40,
        lastAvgPrice: 35,
        firstAvgReviews: 200,
        lastAvgReviews: 900,
        firstAvgSignal: 100,
        lastAvgSignal: 400,
        firstSalesSignalType: 'sales_count',
        latest,
      };

      expect(engine.calculateFromRollup(rollup)).toEqual(
        engine.calculateFromSnapshots(snapshots),
      );
    });
  });
});
