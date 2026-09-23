import { PrismaService } from '../../shared/database/prisma.service';
import { RedisCacheService } from '../../shared/redis/redis-cache.service';
import { OpenRouterService } from '../ai-gateway/openrouter.service';
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
  // Origem explícita dos defaults (T0.3/F1.7): o mock acompanha o contrato real.
  premiseSources: {
    precoVendaBrl: 'observado',
    fobUsd: 'estimativa_18pct_do_preco',
    volumeBaseMensal: 'observado',
    cambioUsd: 'default',
  },
};

function buildService(): ProductsService {
  const service = new ProductsService(
    {} as PrismaService,
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

describe('ProductsService — getSearchTrends (Subprojeto C)', () => {
  it('card sem tipo devolve series vazia', async () => {
    const prisma = {
      productCluster: { findUnique: jest.fn().mockResolvedValue({ typeId: null }) },
    };
    const service = new ProductsService(prisma as unknown as PrismaService, {} as OpenRouterService);

    await expect(service.getSearchTrends('c1')).resolves.toEqual({ type_key: null, series: [] });
  });

  it('devolve a última coleta válida de cada país do tipo', async () => {
    const prisma = {
      productCluster: { findUnique: jest.fn().mockResolvedValue({ typeId: 't1' }) },
      catalogType: { findUnique: jest.fn().mockResolvedValue({ key: 'spin_bike' }) },
      searchTrendSnapshot: {
        findMany: jest.fn().mockResolvedValue([
          {
            geo: 'BR',
            status: 'ok',
            term: 'bike spinning',
            capturedAt: new Date('2026-09-20'),
            points: [{ week_start: '2026-09-13', value: 56, partial: true }],
            growth4w: 0.1,
            growth12w: -0.2,
          },
          {
            geo: 'US',
            status: 'erro',
            term: 'spin bike',
            capturedAt: new Date('2026-09-20'),
            points: [],
            growth4w: null,
            growth12w: null,
          },
        ]),
      },
    };
    const service = new ProductsService(prisma as unknown as PrismaService, {} as OpenRouterService);

    const out = await service.getSearchTrends('c1');

    expect(out.type_key).toBe('spin_bike');
    expect(out.series).toHaveLength(1);
    expect(out.series[0]).toMatchObject({ geo: 'BR', term: 'bike spinning', growth_4w: 0.1 });
  });
});

// S7 (RELATORIO_ANALISE_DADOS_E_SCORES.md seção 3.2): a simulação "e se" do
// usuário (com overrides de premissas) não pode sobrescrever o score oficial
// do ranking nem invalida o cache — só a simulação sem overrides e o lote
// gravam riskLevel/financialScore.
describe('ProductsService — runMonteCarloSimulation (S7)', () => {
  const fakeCluster = {
    id: 'cluster-1',
    canonicalName: 'Halteres Ajustáveis',
    category: 'dumbbells',
    snapshots: [],
  };

  function buildMonteCarloService() {
    const prisma = {
      productCluster: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const cache = {
      delPattern: jest.fn().mockResolvedValue(undefined),
      wrap: async (_key: string, _ttl: number, factory: () => unknown) => factory(),
    };

    const service = new ProductsService(
      prisma as unknown as PrismaService,
      {} as OpenRouterService,
      cache as unknown as RedisCacheService,
    );

    jest.spyOn(service as never, 'getSimulationCluster').mockResolvedValue(fakeCluster as never);
    jest.spyOn(service as never, 'defaultMonteCarloPremises').mockResolvedValue({
      premises: {},
      sources: {},
    } as never);
    jest.spyOn(service as never, 'runMonteCarloPython').mockResolvedValue({
      risk_level: 'Baixo',
      financial_score: 91,
    } as never);

    return { service, prisma, cache };
  }

  it('não persiste riskLevel/financialScore nem invalida o cache quando há overrides do usuário', async () => {
    const { service, prisma, cache } = buildMonteCarloService();

    const result = await service.runMonteCarloSimulation('cluster-1', {
      premises: { preco_venda: 199 },
    });

    expect(result.is_user_scenario).toBe(true);
    expect(prisma.productCluster.update).not.toHaveBeenCalled();
    expect(cache.delPattern).not.toHaveBeenCalled();
  });

  it('persiste riskLevel/financialScore e invalida o cache na simulação oficial (sem overrides)', async () => {
    const { service, prisma, cache } = buildMonteCarloService();

    const result = await service.runMonteCarloSimulation('cluster-1', {});

    expect(result.is_user_scenario).toBe(false);
    expect(prisma.productCluster.update).toHaveBeenCalledTimes(1);
    expect(prisma.productCluster.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cluster-1' },
        data: expect.objectContaining({ riskLevel: 'Baixo', financialScore: 91 }),
      }),
    );
    expect(cache.delPattern).toHaveBeenCalledWith('dashboard:trends:products:*');
  });

  it('B: offer_key troca custo e MOQ e NÃO grava score oficial', async () => {
    const { service, prisma } = buildMonteCarloService();
    const runPython = jest.spyOn(service as never, 'runMonteCarloPython');
    runPython.mockResolvedValue({
      risk_level: 'Baixo',
      financial_score: 91,
    } as never);
    jest.spyOn(service as never, 'offerRepo', 'get').mockReturnValue({
      listOfferListings: jest.fn().mockResolvedValue([
        { key: 'alibaba:A', marketplace: 'alibaba', externalProductId: 'A', itemStatus: 'confirmed', priceMin: 90, priceMax: 96, currency: 'USD', moq: 50 },
      ]),
    } as never);
    jest.spyOn(service as never, 'fxCnyUsd').mockResolvedValue(0.14 as never);

    const out = await service.runMonteCarloSimulation('cluster-1', { offer_key: 'alibaba:A' });

    expect(runPython).toHaveBeenCalledWith(expect.objectContaining({
      premises: expect.objectContaining({ custo_usd: 96, qtd_minima_pedido: 50 }),
    }));
    expect(out.is_user_scenario).toBe(true);
    expect(prisma.productCluster.update).not.toHaveBeenCalled();
  });

  it('B: offer_key inexistente → 400', async () => {
    const { service } = buildMonteCarloService();
    jest.spyOn(service as never, 'offerRepo', 'get').mockReturnValue({
      listOfferListings: jest.fn().mockResolvedValue([]),
    } as never);
    await expect(service.runMonteCarloSimulation('cluster-1', { offer_key: 'alibaba:X' })).rejects.toThrow('Oferta não encontrada');
  });
});

// F2.4: o lote oficial deriva premissas do histórico (F2.2), roda 50.000
// cenários com seed fixa e grava o ProductScore (ou só a confiança).
describe('ProductsService — simulateBatchForRanking oficial (F2.4)', () => {
  const DAY = 86_400_000;
  const BASE = new Date('2026-08-01T12:00:00.000Z').getTime();

  function snapshot(week: number, overrides: Record<string, unknown> = {}) {
    return {
      marketplace: 'amazon_br',
      currency: 'BRL',
      priceMin: 500,
      salesSignalRaw: 100 + week * 10,
      salesSignalType: 'units_monthly',
      reviewCount: 10,
      rating: 4.8,
      moq: 1,
      collectedAt: new Date(BASE + week * 7 * DAY),
      externalProductId: 'B000000001',
      sellerName: 'Loja X',
      ...overrides,
    };
  }

  function buildBatchService(snapshots: unknown[]) {
    const prisma = {
      productCluster: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'cluster-1',
            canonicalName: 'Halteres Ajustáveis',
            category: 'dumbbells',
            simulatedAt: null,
            createdAt: new Date(),
            snapshots,
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      productScore: { create: jest.fn().mockResolvedValue({}) },
      exchangeRate: { findMany: jest.fn().mockResolvedValue([]) },
      productClusterItem: { findMany: jest.fn().mockResolvedValue([]) },
      productListingSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
      offerScore: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({}) },
    };
    const cache = { delPattern: jest.fn().mockResolvedValue(undefined) };

    const service = new ProductsService(
      prisma as unknown as PrismaService,
      {} as OpenRouterService,
      cache as unknown as RedisCacheService,
    );
    jest.spyOn(service as never, 'defaultMonteCarloPremises').mockResolvedValue({
      premises: { elasticidade: 2.5 },
      sources: {},
    } as never);
    const runPython = jest
      .spyOn(service as never, 'runMonteCarloPython')
      .mockResolvedValue({
        risk_level: 'Baixo',
        financial_score: 91,
        decision: 'AVANCAR',
        metrics: { p_vpl_positivo: 0.91, cvar_5: 100, vpl_mediano: 200 },
        premises: { demanda_referencia: 100 },
        premises_hash: 'hash-abc',
        data_version: 'premises@1',
      } as never);
    return { service, prisma, cache, runPython };
  }

  it('com histórico suficiente, grava ProductScore oficial (50k, seed fixa)', async () => {
    const snapshots = [
      snapshot(0, { salesSignalRaw: 100 }),
      snapshot(1, { salesSignalRaw: 110 }),
      snapshot(2, { salesSignalRaw: 120 }),
      snapshot(3, { salesSignalRaw: 130 }),
      {
        marketplace: '1688',
        currency: 'CNY',
        priceMin: 100,
        salesSignalRaw: null,
        salesSignalType: null,
        reviewCount: null,
        rating: null,
        moq: 50,
        collectedAt: new Date(BASE + 21 * DAY),
        externalProductId: 'C1',
        sellerName: null,
      },
    ];
    const { service, prisma, cache, runPython } = buildBatchService(snapshots);

    const summary = await service.simulateBatchForRanking(10);

    expect(summary.simulated).toBe(1);
    expect(runPython).toHaveBeenCalledWith(
      expect.objectContaining({ scenario_count: 50_000, seed: 7, price_scan: false }),
    );
    expect(prisma.productScore.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productClusterId: 'cluster-1',
        score: 91,
        decision: 'AVANCAR',
        pVplPositivo: 0.91,
        cvar5: 100,
        vplMediano: 200,
        premisesHash: 'hash-abc',
        dataVersion: 'premises@1',
        dataConfidence: 'suficiente',
        scenarioCount: 50_000,
      }),
    });
    // Legado segue gravado até F2.7.
    expect(prisma.productCluster.update).toHaveBeenCalled();
    expect(cache.delPattern).toHaveBeenCalledWith('monte-carlo:*');
    expect(cache.delPattern).toHaveBeenCalledWith('dashboard:trends:products:*');
  });

  it('sem histórico, grava só a confiança (score nulo, sem chamar o Python)', async () => {
    const { service, prisma, runPython } = buildBatchService([]);

    const summary = await service.simulateBatchForRanking(10);

    expect(summary.simulated).toBe(1);
    expect(runPython).not.toHaveBeenCalled();
    expect(prisma.productScore.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productClusterId: 'cluster-1',
        score: null,
        decision: 'SEM_SCORE',
        dataConfidence: 'historico_curto',
        scenarioCount: 0,
      }),
    });
  });

  it('B: simula cada oferta com custo e MOQ dela e grava offer_scores', async () => {
    const snapshots = [
      snapshot(0, { salesSignalRaw: 100 }),
      snapshot(1, { salesSignalRaw: 110 }),
      snapshot(2, { salesSignalRaw: 120 }),
      snapshot(3, { salesSignalRaw: 130 }),
      {
        marketplace: '1688',
        currency: 'USD',
        priceMin: 100,
        priceMax: 110,
        salesSignalRaw: null,
        salesSignalType: null,
        reviewCount: null,
        rating: null,
        moq: 50,
        collectedAt: new Date(BASE + 21 * DAY),
        externalProductId: 'C1',
        sellerName: null,
      },
    ];
    const { service, prisma, runPython } = buildBatchService(snapshots);
    prisma.productClusterItem.findMany.mockResolvedValue([
      { marketplace: '1688', externalProductId: 'C1', status: 'confirmed' },
      { marketplace: 'alibaba', externalProductId: 'C2', status: 'auto' },
      { marketplace: 'alibaba', externalProductId: 'C3', status: 'confirmed' },
    ]);
    prisma.productListingSnapshot.findMany.mockResolvedValue([
      { marketplace: '1688', externalProductId: 'C1', title: 't1', sellerName: 'X', productUrl: null, priceMin: 100, priceMax: 110, currency: 'USD', moq: 50, rating: null, salesSignalRaw: null, collectedAt: new Date(BASE + 21 * DAY) },
      { marketplace: 'alibaba', externalProductId: 'C2', title: 't2', sellerName: 'Y', productUrl: null, priceMin: null, priceMax: null, currency: 'USD', moq: 10, rating: null, salesSignalRaw: null, collectedAt: new Date(BASE + 21 * DAY) },
      { marketplace: 'alibaba', externalProductId: 'C3', title: 't3', sellerName: 'Z', productUrl: null, priceMin: 5, priceMax: 5, currency: 'USD', moq: 10, rating: null, salesSignalRaw: null, collectedAt: new Date(BASE + 21 * DAY) },
    ]);

    await service.simulateBatchForRanking(10);

    // 1 chamada do card + 1 da oferta C1 (C2 sem preço, C3 suspeito: sem Python)
    expect(runPython).toHaveBeenCalledTimes(2);
    expect(runPython).toHaveBeenLastCalledWith(expect.objectContaining({
      premises: expect.objectContaining({ custo_usd: 110, qtd_minima_pedido: 50 }),
      scenario_count: 50_000, seed: 7, price_scan: false,
    }));
    const states = prisma.offerScore.create.mock.calls.map((call: any[]) => [call[0].data.externalProductId, call[0].data.state]);
    expect(states).toEqual(expect.arrayContaining([['C1', 'com_score'], ['C2', 'sem_preco'], ['C3', 'suspeito']]));
  });

  it('B: falha na oferta não derruba o card', async () => {
    const snapshots = [
      snapshot(0, { salesSignalRaw: 100 }), snapshot(1, { salesSignalRaw: 110 }),
      snapshot(2, { salesSignalRaw: 120 }), snapshot(3, { salesSignalRaw: 130 }),
      {
        marketplace: '1688',
        currency: 'USD',
        priceMin: 100,
        priceMax: 110,
        salesSignalRaw: null,
        salesSignalType: null,
        reviewCount: null,
        rating: null,
        moq: 50,
        collectedAt: new Date(BASE + 21 * DAY),
        externalProductId: 'C1',
        sellerName: null,
      },
    ];
    const { service, prisma } = buildBatchService(snapshots);
    prisma.productClusterItem.findMany.mockRejectedValue(new Error('boom'));

    const summary = await service.simulateBatchForRanking(10);

    expect(summary.simulated).toBe(1);
    expect(summary.failed).toBe(0);
    expect(prisma.productScore.create).toHaveBeenCalled();
  });

  it('B: card sem premissas não simula ofertas', async () => {
    const { service, prisma } = buildBatchService([]);
    await service.simulateBatchForRanking(10);
    expect(prisma.productClusterItem.findMany).not.toHaveBeenCalled();
    expect(prisma.offerScore.create).not.toHaveBeenCalled();
  });

  it('simulateBatchForRanking não considera cards provisórios nem merged', async () => {
    const prisma = {
      productCluster: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new ProductsService(
      prisma as unknown as PrismaService,
      {} as OpenRouterService,
    );

    await service.simulateBatchForRanking(10);

    expect(prisma.productCluster.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ cardStatus: { notIn: ['provisional', 'merged'] } }),
    }));
  });
});

describe('ProductsService — getOffers (Subprojeto B)', () => {
  function build(latestScore: unknown, listings: unknown[], scores: Map<string, unknown>) {
    const prisma = {
      productCluster: { findUnique: jest.fn().mockResolvedValue({ id: 'card-1' }) },
      productScore: { findFirst: jest.fn().mockResolvedValue(latestScore) },
      exchangeRate: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new ProductsService(prisma as unknown as PrismaService, {} as OpenRouterService);
    jest.spyOn(service as never, 'offerRepo', 'get').mockReturnValue({
      listOfferListings: jest.fn().mockResolvedValue(listings),
      latestOfferScores: jest.fn().mockResolvedValue(scores),
    } as never);
    jest.spyOn(service as never, 'fxCnyUsd').mockResolvedValue(0.14 as never);
    return service;
  }
  const listing = (id: string, over: Record<string, unknown> = {}) => ({
    key: `alibaba:${id}`, marketplace: 'alibaba', externalProductId: id, itemStatus: 'confirmed',
    title: `t${id}`, sellerName: `S${id}`, url: null, priceMin: 90, priceMax: 100, currency: 'USD',
    moq: 10, rating: 4.5, salesSignal: 10, collectedAt: new Date('2026-09-10'), ...over,
  });

  it('ordena por score, aponta a melhor oferta e marca aguardando_lote', async () => {
    const service = build(
      { score: 74, dataConfidence: 'suficiente', premises: { custo_usd: 110 } },
      [listing('A'), listing('B'), listing('C')],
      new Map([
        ['alibaba:A', { key: 'alibaba:A', score: 60, state: 'com_score', unitCostUsd: 100, moq: 10, capitalPrimeiroPedido: 1000, pVplPositivo: 0.6, computedAt: new Date() }],
        ['alibaba:B', { key: 'alibaba:B', score: 81, state: 'com_score', unitCostUsd: 100, moq: 10, capitalPrimeiroPedido: 900, pVplPositivo: 0.8, computedAt: new Date() }],
      ]),
    );
    const out = await service.getOffers('card-1');
    expect(out.card).toEqual({ score: 74, unit_cost_usd: 110, data_confidence: 'suficiente' });
    expect(out.best_offer_key).toBe('alibaba:B');
    expect(out.offers.map((o) => o.key)).toEqual(['alibaba:B', 'alibaba:A', 'alibaba:C']);
    expect(out.offers[2]).toMatchObject({ state: 'aguardando_lote', score: null, unit_cost_usd: 100 });
  });

  it('card sem score → ofertas com preço ficam sem_score_card', async () => {
    const service = build(
      { score: null, dataConfidence: 'historico_curto', premises: {} },
      [listing('A'), listing('B', { priceMin: null, priceMax: null })],
      new Map(),
    );
    const out = await service.getOffers('card-1');
    expect(out.best_offer_key).toBeNull();
    expect(out.offers.map((o) => o.state).sort()).toEqual(['sem_preco', 'sem_score_card']);
  });

  it('sem registro e com preço de isca → suspeito calculado na hora', async () => {
    const service = build(
      { score: 74, dataConfidence: 'suficiente', premises: { custo_usd: 110 } },
      [listing('A', { priceMin: 5, priceMax: 5 })],
      new Map(),
    );
    const out = await service.getOffers('card-1');
    expect(out.offers[0].state).toBe('suspeito');
  });
});

// F2.5: /products/compare anexa o Move Score vigente (legados mantidos).
describe('ProductsService — compareProducts com Move Score (F2.5)', () => {
  it('anexa moveScore/decisão/confiança e mantém os legados', async () => {
    const prisma = {
      productCluster: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'c1',
            canonicalName: 'Halteres',
            category: 'dumbbells',
            riskLevel: null,
            financialScore: null,
            snapshots: [],
          },
        ]),
        findUnique: jest.fn().mockResolvedValue({
          id: 'c1',
          canonicalName: 'Halteres',
          category: 'dumbbells',
          snapshots: [],
        }),
      },
      productListingSnapshot: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      productScore: {
        findMany: jest.fn().mockResolvedValue([
          {
            productClusterId: 'c1',
            score: 77,
            decision: 'AVANCAR COM RESSALVAS',
            dataConfidence: 'suficiente',
            pVplPositivo: 0.75,
            cvar5: 10,
            computedAt: new Date('2026-09-14T00:00:00.000Z'),
          },
        ]),
      },
      exchangeRate: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new ProductsService(
      prisma as unknown as PrismaService,
      {} as OpenRouterService,
    );

    const [item] = await service.compareProducts(['c1']);

    expect(item.moveScore).toBe(77);
    expect(item.decision).toBe('AVANCAR COM RESSALVAS');
    expect(item.dataConfidence).toBe('suficiente');
    expect(item.pVplPositivo).toBe(0.75);
    expect(item.cvar5).toBe(10);
    expect(item).toHaveProperty('riskLevel', null);
    expect(item).not.toHaveProperty('financialScore');
  });

  it('C1: compare expõe action, score_band, momentum e detected_on', async () => {
    const prisma = {
      productCluster: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'c1', canonicalName: 'Halteres', category: 'dumbbells', riskLevel: null, financialScore: null, snapshots: [] },
        ]),
        findUnique: jest.fn().mockResolvedValue({ id: 'c1', canonicalName: 'Halteres', category: 'dumbbells', snapshots: [] }),
      },
      productListingSnapshot: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      productScore: {
        findMany: jest.fn().mockResolvedValue([
          {
            productClusterId: 'c1', score: 82, decision: 'AVANCAR', dataConfidence: 'suficiente',
            pVplPositivo: 0.82, cvar5: 10, computedAt: new Date(), action: 'DECIDIR_AGORA',
            scoreBand: 'green', momentumDirection: 'sobe', momentumGrowthPct: 20, momentumConfidence: 'completa',
          },
        ]),
      },
      exchangeRate: { findMany: jest.fn().mockResolvedValue([]) },
      reviewSummary: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new ProductsService(prisma as unknown as PrismaService, {} as OpenRouterService);
    const [item] = await service.compareProducts(['c1']);
    expect(item.action).toBe('DECIDIR_AGORA');
    expect(item.score_band).toBe('green');
  });
});

describe('ProductsService — séries com compare=previous (C3)', () => {
  function snapshots() {
    const base = new Date('2026-06-01T00:00:00.000Z').getTime();
    const rows = [];
    for (let d = 0; d < 70; d += 1) {
      rows.push({
        collectedAt: new Date(base + d * 86_400_000),
        priceMin: 100 + d,
        salesSignalRaw: 50 + d,
        reviewCount: 10 + d,
        currency: 'BRL',
        marketplace: 'amazon_br',
      });
    }
    return rows;
  }

  function buildService() {
    const rows = snapshots();
    const prisma = {
      productListingSnapshot: {
        findFirst: jest.fn().mockResolvedValue({ collectedAt: rows.at(-1)?.collectedAt }),
        findMany: jest.fn().mockResolvedValue(rows),
      },
      exchangeRate: { findMany: jest.fn().mockResolvedValue([]) },
      logisticsCostParam: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new ProductsService(prisma as unknown as PrismaService, {} as OpenRouterService);
    return service;
  }

  it('60d está em WINDOW_MS e compare devolve current+previous', async () => {
    const service = buildService();
    const res = (await service.getPriceHistory('c1', '60d', 'previous')) as {
      window: string;
      points: Array<{ t: string; v: number }>;
      current: Array<{ t: string; v: number }>;
      previous: Array<{ t: string; v: number }>;
    };
    expect(res.window).toBe('60d');
    expect(res.current.length).toBeGreaterThan(0);
    expect(res.previous.length).toBeGreaterThan(0);
    expect(res.points).toEqual(res.current);
  });

  it('sem compare mantém { window, points }', async () => {
    const service = buildService();
    const res = (await service.getVolumeHistory('c1', '30d')) as { window: string; points: unknown[] };
    expect(res.window).toBe('30d');
    expect(Array.isArray(res.points)).toBe(true);
  });
});

describe('ProductsService — limite e janela das séries (Tarefa 11)', () => {
  const latestAt = new Date('2026-09-20T00:00:00Z');

  function build() {
    const prisma = {
      productListingSnapshot: {
        findFirst: jest.fn(async (_args: {
          where: Record<string, unknown>;
          orderBy: { collectedAt: 'desc' };
          select: { collectedAt: true };
        }) => ({ collectedAt: latestAt })),
        findMany: jest.fn(async (_args: {
          where: Record<string, unknown>;
          orderBy: { collectedAt: 'asc' | 'desc' };
          take?: number;
        }) => [] as Array<Record<string, unknown>>),
      },
    };
    const service = new ProductsService(prisma as unknown as PrismaService, {} as OpenRouterService);
    return { service, prisma };
  }

  it('séries: com mais de 5.000 snapshots, "all" usa os 5.000 mais recentes', async () => {
    const { service, prisma } = build();
    await (service as unknown as {
      loadSeriesSnapshots: (productClusterId: string, lookbackMs: number | null) => Promise<unknown[]>;
    }).loadSeriesSnapshots('c1', null);
    const args = prisma.productListingSnapshot.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual({ collectedAt: 'desc' });
    expect(args.take).toBe(5000);
  });

  it('séries: com janela, filtra no banco a partir do mais recente', async () => {
    const { service, prisma } = build();
    await (service as unknown as {
      loadSeriesSnapshots: (productClusterId: string, lookbackMs: number | null) => Promise<unknown[]>;
    }).loadSeriesSnapshots('c1', 30 * 86_400_000);
    const args = prisma.productListingSnapshot.findMany.mock.calls[0][0];
    expect(args.where.collectedAt).toEqual({ gte: new Date('2026-08-21T00:00:00Z') });
    expect(args.orderBy).toEqual({ collectedAt: 'asc' });
  });
});

describe('ProductsService — getAiRecommendation robusto (P0-2)', () => {
  // Resposta real do print do Raul: cerca de abertura sem fechamento (truncada).
  const TRUNCATED =
    '```json\n{ "decision": "AVANCAR_COM_RESSALVAS", "rationale": "O produto apresenta bom potencial de mercado com demanda crescent';

  function buildAiService(responseContent: string) {
    const created: Array<{ data: Record<string, unknown> }> = [];
    const logs: Array<{ data: Record<string, unknown> }> = [];
    const prisma = {
      productCluster: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'c1',
          canonicalName: 'Halteres Ajustáveis 24kg',
          category: 'musculacao_pesos_livres',
          snapshots: [],
          alerts: [],
        }),
      },
      productListingSnapshot: {
        aggregate: jest.fn().mockResolvedValue({
          _count: { _all: 0 },
          _avg: { priceMin: null },
          _min: { priceMin: null },
          _max: { priceMin: null },
        }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      aiRecommendation: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => {
          created.push(args);
          return { id: 'rec-1', createdAt: new Date('2026-09-15T12:00:00.000Z'), ...args.data };
        }),
      },
      productScore: {
        findFirst: jest.fn().mockResolvedValue({ computedAt: new Date('2026-09-14T00:00:00.000Z') }),
        findMany: jest.fn().mockResolvedValue([
          {
            productClusterId: 'c1',
            score: 82,
            decision: 'AVANCAR',
            dataConfidence: 'suficiente',
            pVplPositivo: 0.82,
            cvar5: 100,
            computedAt: new Date('2026-09-14T00:00:00.000Z'),
            action: 'DECIDIR_AGORA',
            scoreBand: 'green',
            momentumDirection: 'sobe',
            momentumGrowthPct: 24.5,
            momentumConfidence: 'completa',
            riskExplanation: 'Risco baixo.',
            riskDrivers: [{ factor: 'demanda', share: 60 }],
          },
        ]),
      },
      aiCallLog: {
        create: jest.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => {
          logs.push(args);
          return {};
        }),
      },
    };
    const openRouter = {
      chatCompletion: jest.fn().mockResolvedValue({ content: responseContent, model: 'test-model' }),
    };
    const service = new ProductsService(
      prisma as unknown as PrismaService,
      openRouter as unknown as OpenRouterService,
    );
    return { service, prisma, openRouter, created, logs };
  }

  it('recomendação por IA: cache vale enquanto não houver score mais novo', async () => {
    const { service, prisma, openRouter } = buildAiService('{}');
    const computedAt = new Date('2026-09-10T00:00:00Z');
    (prisma.productScore.findFirst as jest.Mock).mockResolvedValue({ computedAt });
    (prisma.aiRecommendation.findFirst as jest.Mock).mockResolvedValue({
      id: 'r1', action: 'DECIDIR_AGORA', decision: 'AVANCAR', rationale: 'ok', generatedText: '{}',
      modelVersion: 'm', createdAt: new Date('2026-09-11T00:00:00Z'),
    });

    const out = await service.getAiRecommendation('c1');

    expect(out.cached).toBe(true);
    const where = prisma.aiRecommendation.findFirst.mock.calls[0][0].where;
    expect(where.createdAt).toEqual({ gte: computedAt });
    expect(openRouter.chatCompletion).not.toHaveBeenCalled();
  });

  it('recomendação por IA: preços e contagem vêm de agregação, sem carregar snapshots', async () => {
    const { service, prisma } = buildAiService(JSON.stringify({
      action: 'DECIDIR_AGORA', rationale: 'Dados conferidos.', key_drivers: [],
    }));

    await service.getAiRecommendation('c1');

    expect(prisma.productListingSnapshot.aggregate).toHaveBeenCalledTimes(2);
    expect(prisma.productListingSnapshot.aggregate.mock.calls[0][0]).toHaveProperty('_count._all', true);
    const clusterQuery = prisma.productCluster.findUnique.mock.calls[0][0];
    expect(clusterQuery.include.snapshots).toBeUndefined();
  });

  it('resposta truncada com cerca → fallback determinístico, sem JSON na tela, ação das regras', async () => {
    const { service, created, logs, openRouter } = buildAiService(TRUNCATED);

    const result = await service.getAiRecommendation('c1');

    expect(openRouter.chatCompletion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxTokens: 1500 }),
    );
    expect(openRouter.chatCompletion.mock.calls[0][1]).not.toHaveProperty('responseFormat');
    expect(result.action).toBe('DECIDIR_AGORA');
    expect(result.rationale).toContain('Move Score 82');
    expect(result.rationale).not.toContain('```');
    expect(result.rationale).not.toContain('{');
    expect(result.key_drivers).toEqual([]);
    expect(logs).toHaveLength(1);
    expect(logs[0].data.status).toBe('rejected_validation');
    expect(created).toHaveLength(1);
    expect(created[0].data.promptVersion).toBe('v2.1-deterministic-fallback');
    expect(String(created[0].data.rationale)).not.toContain('```');
  });

  it('JSON válido usa o rationale da IA mas mantém a ação das regras', async () => {
    const { service } = buildAiService(`Aqui está a análise em texto:\n\`\`\`json
${JSON.stringify({
  action: 'IGNORAR',
  rationale: 'Margem apertada no custo atual.',
  key_drivers: ['custo alto'],
  recommended_next_step: 'Renegociar.',
})}
\`\`\``);

    const result = await service.getAiRecommendation('c1');

    expect(result.action).toBe('DECIDIR_AGORA');
    expect(result.rationale).toBe('Margem apertada no custo atual.');
    expect(result.key_drivers).toEqual(['custo alto']);
    expect(result.recommended_next_step).toBe('Renegociar.');
  });

  it('cache ignora linha inválida antiga e regenera', async () => {
    const { service, prisma } = buildAiService(
      JSON.stringify({ action: 'DECIDIR_AGORA', rationale: 'Tudo certo.', key_drivers: [] }),
    );
    (prisma.aiRecommendation.findFirst as jest.Mock).mockResolvedValue({
      id: 'old',
      productClusterId: 'c1',
      decision: 'REPROVAR',
      action: 'monitorar',
      rationale: '```json {"decision": "X"}',
      generatedText: '```json {"decision": "X"}',
      modelVersion: 'old-model',
      createdAt: new Date('2026-09-15T11:00:00.000Z'),
    });

    const result = await service.getAiRecommendation('c1');

    expect(result.cached).toBe(false);
    expect(result.action).toBe('DECIDIR_AGORA');
  });
});
