import { PrismaService } from '../../shared/database/prisma.service';
import { ConnectorsRegistry } from '../connectors/connectors.registry';
import { DashboardApiService } from './dashboard-api.service';
import { RedisCacheService } from '../../shared/redis/redis-cache.service';
import { DEFAULT_BUSINESS_RULES } from '../../shared/business-rules/business-rules.defaults';

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
    tiktok_growth: null,
    supplier_count: 0,
    ...overrides,
  };
}

describe('DashboardApiService', () => {
  function buildService(
    rows: unknown[],
    cache?: { wrap: jest.Mock },
    scoreRows: unknown[] = [],
  ): {
    service: DashboardApiService;
    prisma: { $queryRaw: jest.Mock; productScore: { findMany: jest.Mock } };
  } {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(rows),
      productScore: { findMany: jest.fn().mockResolvedValue(scoreRows) },
    };

    const service = new DashboardApiService(
      prisma as unknown as PrismaService,
      {} as ConnectorsRegistry,
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
    });

    it('cai na heurística de preço quando não há simulação', async () => {
      const { service } = buildService([rollup()]);

      const [product] = await service.listTrendingProducts();

      expect(product.risk).toBe('alto');
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

      const products = (await service.listTrendingProducts({ sort: 'name' })) as Array<{
        canonical_name: string;
      }>;

      expect(products.map((p) => p.canonical_name)).toEqual(['Alpha Bike', 'Zebra Bike']);
    });

    it('inclui sort e category na chave de cache', async () => {
      const wrap = jest.fn(async (_key: string, _ttl: number, factory: () => Promise<unknown>) =>
        factory(),
      );
      const { service } = buildService([rollup()], { wrap });

      await service.listTrendingProducts({
        limit: 20,
        sort: 'move_score',
        category: 'cardio_fitness',
      });

      expect(wrap).toHaveBeenCalledWith(
        'dashboard:trends:products:20:move_score:desc:cardio_fitness:all',
        3600,
        expect.any(Function),
      );
    });

    it("sort legado 'trend_score' cai no Move Score", async () => {
      const { service } = buildService([rollup()]);

      const [product] = await service.listTrendingProducts({ sort: 'trend_score' });

      expect(product).toHaveProperty('move_score');
      expect(product).not.toHaveProperty('trend_score');
    });
  });

  describe('filtro de dados sintéticos no SQL', () => {
    const ORIGINAL_ENV = process.env.INCLUDE_SYNTHETIC_DATA;

    afterEach(() => {
      // Restaura a env para não vazar estado entre testes.
      if (ORIGINAL_ENV === undefined) {
        delete process.env.INCLUDE_SYNTHETIC_DATA;
      } else {
        process.env.INCLUDE_SYNTHETIC_DATA = ORIGINAL_ENV;
      }
    });

    function sqlText(sql: unknown): string {
      // Prisma.Sql expõe strings/values; serializa para achar is_synthetic.
      if (sql && typeof sql === 'object' && 'strings' in (sql as Record<string, unknown>)) {
        const parts = (sql as { strings: unknown[] }).strings.map(String);
        return parts.join(' ');
      }
      return JSON.stringify(sql);
    }

    it('com env desligada, o SQL do ranking cita is_synthetic', async () => {
      delete process.env.INCLUDE_SYNTHETIC_DATA;
      const { service, prisma } = buildService([rollup()]);

      await service.listTrendingProducts();

      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(sqlText(prisma.$queryRaw.mock.calls[0][0])).toContain('is_synthetic');
    });

    it("com INCLUDE_SYNTHETIC_DATA=true, o SQL do ranking não cita is_synthetic", async () => {
      process.env.INCLUDE_SYNTHETIC_DATA = 'true';
      const { service, prisma } = buildService([rollup()]);

      await service.listTrendingProducts();

      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(sqlText(prisma.$queryRaw.mock.calls[0][0])).not.toContain('is_synthetic');
    });
  });

  describe('Move Score no contrato (F2.5)', () => {
    it('anexa move_score/decisão/confiança do ProductScore vigente', async () => {
      const { service } = buildService(
        [rollup()],
        undefined,
        [
          {
            productClusterId: 'cluster-1',
            score: 82,
            decision: 'AVANCAR',
            dataConfidence: 'suficiente',
            pVplPositivo: 0.88,
            cvar5: 120.5,
            computedAt: new Date('2026-09-14T00:00:00.000Z'),
          },
        ],
      );

      const [product] = await service.listTrendingProducts();

      expect(product.move_score).toBe(82);
      expect(product.decision).toBe('AVANCAR');
      expect(product.data_confidence).toBe('suficiente');
      expect(product.p_vpl_positivo).toBe(0.88);
      expect(product.cvar5).toBe(120.5);
      // Campos legados removidos do contrato em F2.7.
      expect(product).not.toHaveProperty('trend_score');
      expect(product).not.toHaveProperty('opportunity_score');
      expect(product).not.toHaveProperty('western_saturation_score');
      expect(product).not.toHaveProperty('financial_score');
    });

    it('sem ProductScore, os campos do Move Score ficam nulos', async () => {
      const { service } = buildService([rollup()]);

      const [product] = await service.listTrendingProducts();

      expect(product.move_score).toBeNull();
      expect(product.decision).toBeNull();
      expect(product.data_confidence).toBeNull();
      expect(product.p_vpl_positivo).toBeNull();
      expect(product.cvar5).toBeNull();
    });
  });

  describe('demanda sem mistura de escalas (A3.8)', () => {
    function sqlText(sql: unknown): string {
      if (sql && typeof sql === 'object' && 'strings' in (sql as Record<string, unknown>)) {
        const parts = (sql as { strings: unknown[] }).strings.map(String);
        return parts.join(' ');
      }
      return JSON.stringify(sql);
    }

    it('o SQL do ranking separa Google Trends do TikTok', async () => {
      const { service, prisma } = buildService([rollup()]);

      await service.listTrendingProducts();

      const sql = sqlText(prisma.$queryRaw.mock.calls[0][0]);
      // demand_score/spark só Google; TikTok só como Δlog.
      expect(sql).toContain("ds.source = 'google_trends'");
      expect(sql).toContain("ds.source = 'tiktok_search'");
      expect(sql).toContain('tiktok_growth');
    });

    it('mapeia tiktok_growth e usa como último fallback do growth_pct', async () => {
      // B6: com fonte disponível, Δlog ln(200)−ln(100) ≈ 0.693 → 100%.
      const table = DEFAULT_BUSINESS_RULES.socialSourcesStatus as Record<string, string>;
      const prev = table.tiktok_shop;
      table.tiktok_shop = 'available';
      try {
        const { service } = buildService([rollup({ tiktok_growth: 0.693147 })]);

        const [product] = await service.listTrendingProducts();

        expect(product.tiktok_growth_pct).toBe(100);
        // Sem volumes nem série Google, o growth_pct cai no TikTok.
        expect(product.growth_pct).toBe(100);
      } finally {
        table.tiktok_shop = prev;
      }
    });

    it('B6: fonte social unavailable → tiktok nulo, nunca nota baixa', async () => {
      const table = DEFAULT_BUSINESS_RULES.socialSourcesStatus as Record<string, string>;
      const prev = table.tiktok_shop;
      table.tiktok_shop = 'unavailable';
      try {
        const { service } = buildService([rollup({ tiktok_growth: 0.693147 })]);

        const [product] = await service.listTrendingProducts();

        expect(product.tiktok_growth_pct).toBeNull();
      } finally {
        table.tiktok_shop = prev;
      }
    });

    it('sem TikTok, tiktok_growth_pct fica nulo', async () => {
      const { service } = buildService([rollup()]);

      const [product] = await service.listTrendingProducts();

      expect(product.tiktok_growth_pct).toBeNull();
    });
  });

  describe('contrato Fase C (C1/C2)', () => {
    function scoreRow(overrides: Record<string, unknown> = {}) {
      return {
        productClusterId: 'cluster-1',
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
        ...overrides,
      };
    }

    it('expõe action, score_band, momentum, risk, detected_on, top_supplier e review_summary', async () => {
      const { service } = buildService([rollup()], undefined, [scoreRow()]);

      const [product] = await service.listTrendingProducts();

      expect(product.action).toBe('DECIDIR_AGORA');
      expect(product.score_band).toBe('green');
      expect(product.momentum).toEqual(
        expect.objectContaining({ direction: 'sobe', growth_pct: 24.5, confidence: 'completa' }),
      );
      expect(product.risk_explanation).toEqual(
        expect.objectContaining({ text: 'Risco baixo.' }),
      );
      expect(product.detected_on).toEqual(expect.arrayContaining(['amazon']));
      expect(product.top_supplier).toBeNull();
      expect(product.review_summary).toEqual(expect.objectContaining({ by_band: {} }));
      expect(product.price).toBe(90);
    });

    it('C2: pagina com total, ordena por qualquer indicador e filtra por action', async () => {
      const rows = [
        rollup({ id: 'c1', canonical_name: 'A', latest_price: 100, latest_reviews: 10 }),
        rollup({ id: 'c2', canonical_name: 'B', latest_price: 200, latest_reviews: 5 }),
      ];
      const scores = [
        scoreRow({ productClusterId: 'c1', score: 60, action: 'NEGOCIAR_CUSTO', scoreBand: 'yellow' }),
        scoreRow({ productClusterId: 'c2', score: 85, action: 'DECIDIR_AGORA', scoreBand: 'green' }),
      ];
      const { service } = buildService(rows, undefined, scores);

      const page = (await service.listTrendingProducts({ page: 1, pageSize: 1, sort: 'price' })) as {
        items: Array<{ canonical_name: string }>;
        total: number;
        page: number;
        page_size: number;
      };
      expect(page.total).toBe(2);
      expect(page.items).toHaveLength(1);
      expect(page.items[0].canonical_name).toBe('B');

      const filtered = (await service.listTrendingProducts({ action: 'DECIDIR_AGORA' })) as {
        items: Array<{ action: string }>;
        total: number;
      };
      expect(filtered.total).toBe(1);
      expect(filtered.items[0].action).toBe('DECIDIR_AGORA');
    });

    it('C4: /search retorna produtos, categorias e fornecedores (fallback sem pg_trgm)', async () => {      const prisma: {
        $queryRaw: jest.Mock;
        productCluster: { findMany: jest.Mock };
        supplier: { findMany: jest.Mock };
        productScore: { findMany: jest.Mock };
      } = {
        $queryRaw: jest.fn().mockRejectedValueOnce(new Error('no pg_trgm')).mockRejectedValueOnce(new Error('no pg_trgm')),
        productCluster: {
          findMany: jest.fn().mockResolvedValue([{ id: 'c1', canonicalName: 'Halter 24kg', category: 'pesos' }]),
        },
        supplier: { findMany: jest.fn().mockResolvedValue([{ id: 's1', name: 'Fornecedor X', source: 'alibaba' }]) },
        productScore: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const { DashboardApiService } = await import('./dashboard-api.service');
      const svc = new DashboardApiService(
        prisma as never,
        {} as never,
        undefined,
      );
      const res = await svc.search('halter');
      expect(res.products).toHaveLength(1);
      expect(res.categories).toContain('pesos');
      expect(res.suppliers).toHaveLength(1);
    });

    it('P1-4: SQL usa word_similarity + strpos (contém) com prioridade a quem contém o termo', async () => {
      const prisma: {
        $queryRaw: jest.Mock;
        productScore: { findMany: jest.Mock };
      } = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        productScore: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const { DashboardApiService } = await import('./dashboard-api.service');
      const svc = new DashboardApiService(
        prisma as never,
        {} as never,
        undefined,
      );
      await svc.search('halter');
      const sqlTexts = prisma.$queryRaw.mock.calls.map((call) =>
        JSON.stringify(call[0]).toLowerCase(),
      );
      expect(sqlTexts.length).toBeGreaterThan(0);
      expect(sqlTexts.some((sql) => sql.includes('word_similarity'))).toBe(true);
      expect(sqlTexts.some((sql) => sql.includes('strpos'))).toBe(true);
    });

    it('busca por objetivo: "pernas" inclui as categorias ligadas e devolve o rótulo', async () => {
      const prisma: { $queryRaw: jest.Mock; productScore: { findMany: jest.Mock } } = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        productScore: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const { DashboardApiService } = await import('./dashboard-api.service');
      const svc = new DashboardApiService(prisma as never, {} as never, undefined);
      const res = await svc.search('Tem algo para as pernas?');
      const sql = JSON.stringify(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).toContain('spinning_bike');
      expect(sql).toContain('ankle_weights');
      expect(res.topics).toEqual([expect.objectContaining({ key: 'perna', label: 'Pernas' })]);
    });

    it('P1-4: fallback parcial encontra termo sem acento/maiúsculas', async () => {
      const prisma: {
        $queryRaw: jest.Mock;
        productCluster: { findMany: jest.Mock };
        supplier: { findMany: jest.Mock };
        productScore: { findMany: jest.Mock };
      } = {
        $queryRaw: jest.fn().mockRejectedValue(new Error('sem pg_trgm')),
        productCluster: {
          findMany: jest.fn().mockImplementation(async (args: { where: { OR: unknown[] } }) => {
            // O fallback busca termo original E normalizado em nome e categoria.
            expect(args.where.OR.length).toBeGreaterThanOrEqual(4);
            return [{ id: 'c2', canonicalName: 'Tapete de Yoga', category: 'yoga' }];
          }),
        },
        supplier: { findMany: jest.fn().mockResolvedValue([]) },
        productScore: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const { DashboardApiService } = await import('./dashboard-api.service');
      const svc = new DashboardApiService(
        prisma as never,
        {} as never,
        undefined,
      );
      const res = await svc.search('YOGA');
      expect(res.products).toHaveLength(1);
      expect(res.products[0].name).toBe('Tapete de Yoga');
    });

    it('C6: executivo escolhe DECIDIR_AGORA e usa fallback sem IA', async () => {
      const rows = [
        rollup({ id: 'c1', canonical_name: 'Halter', latest_price: 100 }),
        rollup({ id: 'c2', canonical_name: 'Esteira', latest_price: 200 }),
      ];
      const scores = [
        scoreRow({ productClusterId: 'c1', score: 90, action: 'DECIDIR_AGORA' }),
        scoreRow({ productClusterId: 'c2', score: 70, action: 'NEGOCIAR_CUSTO', scoreBand: 'yellow' }),
      ];
      const { service } = buildService(rows, undefined, scores);
      const exec = await service.getExecutiveRecommendation();
      expect(exec.recommended.product_cluster_id).toBe('c1');
      expect(exec.recommended.text).toContain('Halter');
    });
  });

  describe('ordenação com direção entre páginas (P0-4)', () => {
    const rows = [
      rollup({ id: 'c1', canonical_name: 'A', latest_price: 100, latest_rating: 4.0 }),
      rollup({ id: 'c2', canonical_name: 'B', latest_price: 300, latest_rating: 5.0 }),
      rollup({ id: 'c3', canonical_name: 'C', latest_price: 200, latest_rating: 3.0 }),
    ];

    it('ordena por Nota desc e asc de forma consistente entre páginas', async () => {
      const { service } = buildService(rows);
      const desc = (await service.listTrendingProducts({ sort: 'rating', dir: 'desc', page: 1, pageSize: 2 })) as {
        items: Array<{ canonical_name: string }>;
        total: number;
      };
      const desc2 = (await service.listTrendingProducts({ sort: 'rating', dir: 'desc', page: 2, pageSize: 2 })) as {
        items: Array<{ canonical_name: string }>;
      };
      expect(desc.items.map((p) => p.canonical_name)).toEqual(['B', 'A']);
      expect(desc2.items.map((p) => p.canonical_name)).toEqual(['C']);
      expect(desc.total).toBe(3);

      const asc = (await service.listTrendingProducts({ sort: 'rating', dir: 'asc', page: 1, pageSize: 3 })) as {
        items: Array<{ canonical_name: string }>;
      };
      expect(asc.items.map((p) => p.canonical_name)).toEqual(['C', 'A', 'B']);
    });

    it('ordena por Preço asc e desc de forma consistente entre páginas', async () => {
      const { service } = buildService(rows);
      const asc = (await service.listTrendingProducts({ sort: 'price', dir: 'asc', page: 1, pageSize: 2 })) as {
        items: Array<{ canonical_name: string }>;
      };
      const asc2 = (await service.listTrendingProducts({ sort: 'price', dir: 'asc', page: 2, pageSize: 2 })) as {
        items: Array<{ canonical_name: string }>;
      };
      expect(asc.items.map((p) => p.canonical_name)).toEqual(['A', 'C']);
      expect(asc2.items.map((p) => p.canonical_name)).toEqual(['B']);
    });
  });
});
