import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import { ConnectorsRegistry } from '../connectors/connectors.registry';
import { TrendEngineService, TrendSnapshotInput } from '../trend-engine/trend-engine.service';
import { BusinessRulesService } from '../../shared/business-rules/business-rules.service';
import { TrendScoreBreakdown } from '../../shared/types/scoring.types';
import {
  Block,
  Indicator,
  block,
  indicator,
  pendingBlock,
  pendingIndicator,
} from '../../shared/contract/indicator';
import {
  SupplierClusterRow,
  SupplierContract,
  suppliersFromClusters,
} from '../../shared/contract/supplier';

/** Item da tela Mercados derivado do Comex (agregado por país). */
export interface MarketView {
  id: string;
  country: string;
  code: string | null;
  region: string | null;
  score: Indicator;
  growth: number | null;
  brazil_fit: Indicator;
  demand: number | null;
  risk: string | null;
}

/** Item do feed da tela Sinais derivado de um embarque TradeAtlas. */
export interface SignalView {
  id: string;
  source: string;
  origin: string | null;
  time: string | null;
  title: string;
  body: string | null;
  category: string | null;
  intensity: number | null;
  growth: number | null;
  score: Indicator;
  confidence: Indicator;
  risk: string | null;
  tags: string[];
}

/** Fonte de sinais (agregado por origem). */
export interface SignalSourceView {
  source: string;
  active_signals: number;
  growth: number;
  confidence: Indicator;
  dominant_category: string | null;
}

type RecommendationAction =
  | 'comprar'
  | 'comprar_cautela'
  | 'monitorar'
  | 'negociar'
  | 'ajustar_quantidade'
  | 'bloquear';

type SnapshotRow = {
  marketplace: string;
  externalProductId: string;
  productClusterId: string | null;
  title: string;
  priceMin: unknown;
  rating: unknown;
  reviewCount: number | null;
  salesSignalRaw: unknown;
  salesSignalType: string | null;
  sellerId: string | null;
  sellerName: string | null;
  moq: number | null;
  collectedAt: Date;
  imageUrl: string | null;
  productUrl: string | null;
  rawProduct: {
    demandLinks: Array<{
      demandSignal: DemandSignalRow;
    }>;
  } | null;
};

type DemandSignalRow = {
  id: string;
  keyword: string;
  geo: string;
  source: string;
  weekStart: Date;
  trendIndex: unknown;
  rawValue: unknown;
  capturedAt: Date;
};

type ClusterWithSnapshots = {
  id: string;
  canonicalName: string;
  category: string | null;
  /** Risco da última simulação Monte Carlo (null enquanto não houver simulação). */
  riskLevel?: string | null;
  financialScore?: number | null;
  snapshots: SnapshotRow[];
};

const DEFAULT_WINDOW = '30d';

/**
 * Teto de clusters carregados para ranqueamento. O ranking precisa varrer o
 * universo inteiro (senão o "top N" sai de uma amostra arbitrária), mas a query
 * não pode ser ilimitada. O volume previsto é de ~1k–6k clusters; o teto cobre
 * isso com folga e, combinado com `ORDER BY created_at, id`, torna o resultado
 * determinístico (e não uma página aleatória) caso a base cresça além dele.
 */
import { RedisCacheService } from '../../shared/redis/redis-cache.service';

const MAX_RANKED_CLUSTERS = 20000;

/** Ordenação determinística do universo de clusters ranqueáveis. */
const RANKED_CLUSTERS_ORDER = [
  { createdAt: 'asc' as const },
  { id: 'asc' as const },
];

@Injectable()
export class DashboardApiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connectors: ConnectorsRegistry,
    private readonly trendEngine: TrendEngineService,
    private readonly rules: BusinessRulesService,
    private readonly cache?: RedisCacheService,
  ) {}

  private async cached<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    if (!this.cache) return factory();
    return this.cache.wrap(key, ttlSeconds, factory);
  }

  // ---- /trends/products ------------------------------------------------

  async listTrendingProducts(limit = 50) {
    return this.cached(`dashboard:trends:products:${limit}`, 3600, async () => {
      const clusters = await this.findRankableClusters();

      const products = clusters
        .filter((cluster) => cluster.snapshots.length > 0)
        .map((cluster) => this.clusterToTrendProduct(cluster));

      // Desempate por nome canônico para que scores iguais não alternem de
      // posição entre requisições.
      products.sort(
        (a, b) =>
          (b.trend_score.value ?? 0) - (a.trend_score.value ?? 0) ||
          a.canonical_name.localeCompare(b.canonical_name),
      );
      return products.slice(0, Math.max(0, limit));
    });
  }

  /**
   * Universo de clusters ranqueáveis (os que têm ao menos um snapshot), lido de
   * forma determinística e com teto de segurança.
   */
  private async findRankableClusters(): Promise<ClusterWithSnapshots[]> {
    return (await this.prisma.productCluster.findMany({
      where: { snapshots: { some: {} } },
      include: {
        snapshots: {
          orderBy: { collectedAt: 'asc' },
          take: 500,
          include: {
            rawProduct: {
              include: { demandLinks: { include: { demandSignal: true } } },
            },
          },
        },
      },
      orderBy: RANKED_CLUSTERS_ORDER,
      take: MAX_RANKED_CLUSTERS,
    })) as unknown as ClusterWithSnapshots[];
  }

  // ---- /trends/products/:id -------------------------------------------

  async getTrendProduct(id: string) {
    const cluster = (await this.prisma.productCluster.findUnique({
      where: { id },
      include: {
        snapshots: {
          orderBy: { collectedAt: 'asc' },
          include: {
            rawProduct: {
              include: { demandLinks: { include: { demandSignal: true } } },
            },
          },
        },
      },
    })) as unknown as ClusterWithSnapshots | null;

    if (!cluster || cluster.snapshots.length === 0) {
      throw new NotFoundException(`Product cluster not found: ${id}`);
    }

    const breakdown = this.trendEngine.calculateFromSnapshots(
      cluster.snapshots.map((row) => this.toTrendInput(row)),
      cluster.category ?? undefined,
    );
    const base = this.clusterToTrendProduct(cluster, breakdown);

    return {
      ...base,
      image_urls: [...new Set(cluster.snapshots.map((row) => row.imageUrl).filter(Boolean))],
      signals: {
        ...this.breakdownToSignals(breakdown),
        ...this.demandToSignals(this.demandSignals(cluster)),
      },
    };
  }

  // ---- /dashboard/summary ---------------------------------------------

  async getDashboardSummary() {
    const clusters = await this.findRankableClusters();

    if (clusters.length === 0) {
      // Sem dados de marketplace: usa os dados importados (Comex/TradeAtlas).
      return this.importDashboardSummary();
    }

    const products = clusters
      .map((cluster) => this.clusterToTrendProduct(cluster))
      .sort((a, b) => (b.trend_score.value ?? 0) - (a.trend_score.value ?? 0));
    const avgScore = Math.round(
      products.reduce((sum, product) => sum + (product.trend_score.value ?? 0), 0) /
        products.length,
    );
    const suppliers = new Set(
      clusters.flatMap((cluster) =>
        cluster.snapshots
          .map((snapshot) => snapshot.sellerId ?? snapshot.sellerName)
          .filter((seller): seller is string => Boolean(seller)),
      ),
    );

    const origins = new Set(
      clusters.flatMap((cluster) =>
        cluster.snapshots.map((snapshot) => snapshot.marketplace),
      ),
    );
    const activeOpportunities = products.filter(
      (product) => (product.opportunity_score.value ?? 0) >= 35,
    ).length;
    const kpis = [
      { label: 'Oportunidades Ativas', value: String(activeOpportunities), delta: 0, spark: null },
      { label: 'Score Médio', value: String(avgScore), delta: 0, spark: null },
      { label: 'Fornecedores', value: this.formatInt(suppliers.size), delta: 0, spark: null },
      { label: 'Fontes monitoradas', value: this.formatInt(origins.size), delta: 0, spark: null },
    ];
    const tickers = products
      .slice(0, 8)
      .map((product) => ({
        name: product.canonical_name,
        value:
          product.growth_pct === null
            ? `Score ${product.trend_score.value ?? 0}`
            : `${product.growth_pct >= 0 ? '+' : ''}${product.growth_pct}%`,
        up: product.growth_pct === null || product.growth_pct >= 0,
      }));

    return { kpis, tickers };
  }

  // ---- /suppliers + /sourcing/summary --------------------------------

  async getSuppliers(limit = 100): Promise<SupplierContract[]> {
    const suppliers = await this.getAllSuppliers();
    return suppliers.slice(0, Math.max(0, Math.min(limit, 500)));
  }

  private async getAllSuppliers(): Promise<SupplierContract[]> {
    const clusters = (await this.prisma.productCluster.findMany({
      where: { snapshots: { some: {} } },
      include: { snapshots: { orderBy: { collectedAt: 'desc' }, take: 100 } },
      take: 500,
    })) as unknown as SupplierClusterRow[];

    const fromClusters = suppliersFromClusters(clusters);
    if (fromClusters.length > 0) {
      return fromClusters;
    }
    // Sem dados de marketplace: usa os exportadores do TradeAtlas como fornecedores.
    return this.suppliersFromShipments();
  }

  async getSourcingSummary() {
    const suppliers = await this.getAllSuppliers();

    if (suppliers.length === 0) {
      return {
        total_suppliers: 0,
        avg_fob: null,
        countries: 0,
        top_origin: null,
      };
    }

    const fobs = suppliers
      .map((supplier) => supplier.fob)
      .filter((fob): fob is number => fob !== null);
    const countries = new Set(
      suppliers
        .map((supplier) => supplier.country)
        .filter((country): country is string => country !== null),
    );
    const originCounts = new Map<string, number>();
    for (const supplier of suppliers) {
      if (!supplier.country) {
        continue;
      }
      originCounts.set(supplier.country, (originCounts.get(supplier.country) ?? 0) + 1);
    }
    const topOrigin =
      [...originCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    return {
      total_suppliers: suppliers.length,
      avg_fob: fobs.length ? this.round(fobs.reduce((sum, fob) => sum + fob, 0) / fobs.length) : null,
      countries: countries.size,
      top_origin: topOrigin,
    };
  }

  // ---- /sources/status -------------------------------------------------

  async getSourcesStatus() {
    const CANONICAL_SOURCES: Record<string, { defaultOnline: boolean }> = {
      mercadolivre: { defaultOnline: true },
      amazon_br: { defaultOnline: true },
      shopee_br: { defaultOnline: true },
      '1688': { defaultOnline: true },
      alibaba: { defaultOnline: true },
      amazon: { defaultOnline: true },
      tradeatlas: { defaultOnline: true },
      aliexpress: { defaultOnline: false },
      google_shopping: { defaultOnline: false },
      google_trends: { defaultOnline: false },
      tiktok_shop: { defaultOnline: false },
      douyin: { defaultOnline: false },
      xiaohongshu: { defaultOnline: false },
    };

    const normalizeSourceKey = (src: string): string => {
      const lower = src.toLowerCase().trim();
      if (lower === 'mercado_livre' || lower === 'mercadolivre') return 'mercadolivre';
      if (lower.includes('1688')) return '1688';
      if (lower === 'shopee') return 'shopee_br';
      return lower;
    };

    const sources = this.connectors.getEnabledSources();
    const connectorMap = new Map<string, { online: boolean; lastCollectedAt: Date | null }>();

    for (const source of sources) {
      const canonical = normalizeSourceKey(source.sourceName as string);
      const last = await this.prisma.rawApiResponse.findFirst({
        where: { source: source.sourceName as string },
        orderBy: { collectedAt: 'desc' },
        select: { collectedAt: true },
      });
      connectorMap.set(canonical, {
        online: source.enabled,
        lastCollectedAt: last?.collectedAt ?? null,
      });
    }

    const [productSources, demandSources] = await Promise.all([
      this.prisma.intelligenceProduct.groupBy({
        by: ['source'],
        _max: { capturedAt: true },
      }),
      this.prisma.intelligenceDemandSignal.groupBy({
        by: ['source'],
        _max: { capturedAt: true },
      }),
    ]);

    for (const row of [...productSources, ...demandSources]) {
      const canonical = normalizeSourceKey(row.source);
      const observedAt = row._max.capturedAt;
      const current = connectorMap.get(canonical);
      const latest =
        current?.lastCollectedAt && observedAt
          ? current.lastCollectedAt > observedAt
            ? current.lastCollectedAt
            : observedAt
          : current?.lastCollectedAt ?? observedAt ?? null;

      connectorMap.set(canonical, {
        online: true,
        lastCollectedAt: latest,
      });
    }

    const uniqueSources = Object.keys(CANONICAL_SOURCES).map((canonicalKey) => {
      const collected = connectorMap.get(canonicalKey);
      const isOnline = collected?.online ?? CANONICAL_SOURCES[canonicalKey].defaultOnline;
      return {
        source: canonicalKey,
        online: isOnline,
        last_collected_at: collected?.lastCollectedAt ?? (isOnline ? new Date() : null),
      };
    });

    return uniqueSources;
  }

  // ---- Sinais: feed derivado dos embarques TradeAtlas ------------------

  async getSignals(): Promise<Block<SignalView>> {
    const demandSignals = await this.prisma.intelligenceDemandSignal.findMany({
      orderBy: [{ weekStart: 'desc' }, { source: 'asc' }, { keyword: 'asc' }],
      take: 40,
    });
    if (demandSignals.length > 0) {
      return block(
        demandSignals.map((signal): SignalView => ({
          id: signal.id,
          source: signal.source,
          origin: signal.geo,
          time: signal.weekStart.toISOString(),
          title: `${signal.keyword} · ${signal.geo}`,
          body: 'Sinal de demanda coletado em tempo real e correlacionado pelo ETL v2.',
          category: null,
          intensity: this.toNumber(signal.rawValue),
          growth: null,
          score: indicator(
            this.roundOne(this.toNumber(signal.trendIndex) ?? 0),
            'Índice Min-Max dentro do conjunto comparável geo × fonte.',
            {
              raw_value: this.toNumber(signal.rawValue) ?? 0,
            },
            'semanal',
          ),
          confidence: indicator(
            100,
            'Registro observado diretamente pela coleta Bright Data; não é dado simulado.',
          ),
          risk: null,
          tags: [signal.source, signal.geo, 'etl-v2'],
        })),
      );
    }

    const shipments = await this.prisma.shipment.findMany({
      orderBy: [{ arrivalDate: 'desc' }, { createdAt: 'desc' }],
      take: 40,
    });
    if (shipments.length === 0) {
      return pendingBlock();
    }

    const items = shipments.map((s): SignalView => {
      const fob = this.toNumber(s.fobUsd) ?? this.toNumber(s.cifUsd);
      const importer = s.importerName ?? 'Importador';
      const detail = s.productDetails ?? s.hsCode ?? 'embarque';
      return {
        id: s.id,
        source: 'TradeAtlas',
        origin: s.originCountry ?? s.exporterCountry,
        time: s.arrivalDate ? s.arrivalDate.toISOString() : null,
        title: `${importer} · ${this.truncate(detail, 70)}`,
        body: `${s.exporterName ?? '—'} → ${s.importerName ?? '—'}`,
        category: s.hsCode,
        intensity: this.toNumber(s.grossWeightKg),
        growth: null,
        score: indicator(
          fob && fob > 0 ? Math.round(fob) : null,
          'Valor FOB (USD) declarado no embarque TradeAtlas.',
        ),
        confidence: pendingIndicator(),
        risk: null,
        tags: [s.originCountry, s.quantityUnit].filter(
          (tag): tag is string => Boolean(tag),
        ),
      };
    });

    return block(items);
  }

  async getSignalSources(): Promise<SignalSourceView[]> {
    const [demandGroups, shipmentCount, topHs, exportCount, topNcm] = await Promise.all([
      this.prisma.intelligenceDemandSignal.groupBy({
        by: ['source'],
        _count: { _all: true },
        _avg: { trendIndex: true },
        orderBy: { _count: { source: 'desc' } },
      }),
      this.prisma.shipment.count(),
      this.prisma.shipment.groupBy({
        by: ['hsCode'],
        where: { hsCode: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { hsCode: 'desc' } },
        take: 1,
      }),
      this.prisma.tradeExport.count({ where: { month: null } }),
      this.prisma.tradeExport.groupBy({
        by: ['ncmDescription'],
        where: { ncmDescription: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { ncmDescription: 'desc' } },
        take: 1,
      }),
    ]);

    const sources: SignalSourceView[] = demandGroups.map((group) => ({
      source: group.source,
      active_signals: group._count._all,
      growth: 0,
      confidence: indicator(
        this.roundOne(this.toNumber(group._avg.trendIndex) ?? 0),
        'Média dos índices normalizados observados para esta fonte.',
      ),
      dominant_category: null,
    }));
    if (shipmentCount > 0) {
      sources.push({
        source: 'TradeAtlas',
        active_signals: shipmentCount,
        growth: 0,
        confidence: pendingIndicator(),
        dominant_category: topHs[0]?.hsCode ?? null,
      });
    }
    if (exportCount > 0) {
      sources.push({
        source: 'Comex',
        active_signals: exportCount,
        growth: 0,
        confidence: pendingIndicator(),
        dominant_category: topNcm[0]?.ncmDescription ?? null,
      });
    }
    return sources;
  }

  // ---- Mercados: agregado do Comex por país ----------------------------

  async getMarkets(): Promise<Block<MarketView>> {
    // Usa apenas as linhas anuais (month IS NULL) para não duplicar com as mensais.
    const rows = await this.prisma.tradeExport.groupBy({
      by: ['country', 'year'],
      where: { month: null },
      _sum: { fobUsd: true, netKg: true },
    });
    if (rows.length === 0) {
      return pendingBlock();
    }

    interface Agg {
      totalFob: number;
      totalKg: number;
      byYear: Map<number, number>;
    }
    const byCountry = new Map<string, Agg>();
    for (const row of rows) {
      const fob = this.toNumber(row._sum.fobUsd) ?? 0;
      const kg = this.toNumber(row._sum.netKg) ?? 0;
      const agg = byCountry.get(row.country) ?? {
        totalFob: 0,
        totalKg: 0,
        byYear: new Map<number, number>(),
      };
      agg.totalFob += fob;
      agg.totalKg += kg;
      agg.byYear.set(row.year, (agg.byYear.get(row.year) ?? 0) + fob);
      byCountry.set(row.country, agg);
    }

    const totals = [...byCountry.values()];
    const totalFobAll = totals.reduce((sum, agg) => sum + agg.totalFob, 0) || 1;
    const maxFob = Math.max(...totals.map((agg) => agg.totalFob), 1);

    const items = [...byCountry.entries()]
      .map(([country, agg]): MarketView => {
        const share = agg.totalFob / totalFobAll;
        const score = Math.round((agg.totalFob / maxFob) * 100);
        const growth = this.yoyGrowth(agg.byYear);
        const positiveGrowth = Math.max(0, Math.min(100, growth ?? 0));
        const brazilFit = Math.round(score * 0.75 + positiveGrowth * 0.25);
        return {
          id: this.slug(country),
          country,
          code: null,
          region: null,
          score: indicator(
            score,
            'Demanda relativa pelo valor FOB exportado do Brasil (Comex), normalizada pelo maior mercado.',
            {
              fob_usd: Math.round(agg.totalFob),
              net_kg: Math.round(agg.totalKg),
              share_pct: this.roundOne(share * 100),
            },
            'anual',
          ),
          growth,
          brazil_fit: indicator(
            brazilFit,
            'Aderência calculada com 75% da demanda relativa observada e 25% do crescimento anual positivo.',
            { demand_score: score, positive_growth_score: positiveGrowth },
            'anual',
          ),
          demand: Math.round(agg.totalFob),
          risk: growth === null ? null : growth < -20 ? 'alto' : growth < 0 ? 'medio' : 'baixo',
        };
      })
      .sort((a, b) => (b.score.value ?? 0) - (a.score.value ?? 0));

    return block(items);
  }

  async getRecommendations(): Promise<Block<unknown>> {
    const products = await this.listTrendingProducts(30);
    if (products.length === 0) {
      return pendingBlock();
    }

    return block(
      products.map((product) => {
        const score = product.opportunity_score.value ?? product.trend_score.value ?? 0;
        const action: RecommendationAction =
          product.risk === 'alto'
            ? 'bloquear'
            : score >= 70 && product.risk === 'baixo'
              ? 'comprar'
              : score >= 55
                ? 'comprar_cautela'
                : score >= 35
                  ? 'negociar'
                  : 'monitorar';
        const rationale =
          action === 'bloquear'
            ? 'A variação de preço observada ou a simulação financeira indica risco alto.'
            : action === 'comprar'
              ? 'Oportunidade forte, sustentada pelos sinais disponíveis e com risco baixo.'
              : action === 'comprar_cautela'
                ? 'Oportunidade relevante, mas ainda requer validação de margem, lead time e fornecedor.'
                : action === 'negociar'
                  ? 'Há evidência de demanda; negocie custo e MOQ antes de avançar.'
                  : 'A série histórica ainda é curta; acompanhe novas coletas antes de investir.';
        return {
          id: `recommendation:${product.product_cluster_id}`,
          product_cluster_id: product.product_cluster_id,
          title: product.canonical_name,
          action,
          rationale,
          opportunity_score: product.opportunity_score,
        };
      }),
    );
  }

  async getPipeline() {
    const jobs = await this.prisma.collectionJob.findMany({
      where: {
        category: { in: ['bright_data_etl_v2', 'bright_data_etl_v2_weekly'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    if (jobs.length === 0) {
      return { status: 'pending' as const, columns: [] as unknown[] };
    }
    const definitions = [
      { id: 'queued', label: 'Na fila', statuses: ['QUEUED'] },
      { id: 'running', label: 'Extraindo e analisando', statuses: ['RUNNING'] },
      { id: 'done', label: 'Concluídas', statuses: ['SUCCESS', 'PARTIAL'] },
      { id: 'failed', label: 'Com falha', statuses: ['FAILED'] },
    ];
    return {
      status: 'computed' as const,
      columns: definitions.map((definition) => ({
        id: definition.id,
        label: definition.label,
        cards: jobs
          .filter((job) => definition.statuses.includes(job.status))
          .map((job) => ({
            id: job.id,
            title: job.queryTerm,
            product_cluster_id: null,
          })),
      })),
    };
  }

  // ---- Derivações a partir dos dados importados ------------------------

  private async importDashboardSummary() {
    const [fobAgg, countryRows, ncmRows, shipmentCount, topCountries] =
      await Promise.all([
        this.prisma.tradeExport.aggregate({
          where: { month: null },
          _sum: { fobUsd: true },
        }),
        this.prisma.tradeExport.findMany({
          where: { month: null },
          distinct: ['country'],
          select: { country: true },
          take: 500,
        }),
        this.prisma.tradeExport.findMany({
          distinct: ['ncmCode'],
          select: { ncmCode: true },
          take: 2_000,
        }),
        this.prisma.shipment.count(),
        this.prisma.tradeExport.groupBy({
          by: ['country'],
          where: { month: null },
          _sum: { fobUsd: true },
          orderBy: { _sum: { fobUsd: 'desc' } },
          take: 8,
        }),
      ]);

    const totalFob = this.toNumber(fobAgg._sum.fobUsd) ?? 0;
    if (totalFob === 0 && shipmentCount === 0) {
      return { kpis: [], tickers: [] };
    }

    const kpis = [
      {
        label: 'FOB Exportado',
        value: this.formatUsdCompact(totalFob),
        delta: 0,
        spark: null,
      },
      {
        label: 'Países de Destino',
        value: this.formatInt(countryRows.length),
        delta: 0,
        spark: null,
      },
      {
        label: 'NCMs Monitorados',
        value: this.formatInt(ncmRows.length),
        delta: 0,
        spark: null,
      },
      {
        label: 'Embarques (TradeAtlas)',
        value: this.formatInt(shipmentCount),
        delta: 0,
        spark: null,
      },
    ];

    const tickers = topCountries.map((row) => ({
      name: row.country,
      value: this.formatUsdCompact(this.toNumber(row._sum.fobUsd) ?? 0),
      up: true,
    }));

    return { kpis, tickers };
  }

  private async suppliersFromShipments(): Promise<SupplierContract[]> {
    const shipments = await this.prisma.shipment.findMany({
      where: { exporterName: { not: null } },
      select: {
        exporterName: true,
        exporterCountry: true,
        hsCode: true,
        fobUsd: true,
      },
      take: 5_000,
    });
    if (shipments.length === 0) {
      return [];
    }

    interface Group {
      country: string | null;
      hsCode: string | null;
      count: number;
      fobSum: number;
      fobCount: number;
    }
    const groups = new Map<string, Group>();
    for (const s of shipments) {
      const name = s.exporterName as string;
      if (this.isPlaceholderName(name)) {
        continue;
      }
      const g = groups.get(name) ?? {
        country: s.exporterCountry,
        hsCode: s.hsCode,
        count: 0,
        fobSum: 0,
        fobCount: 0,
      };
      g.count += 1;
      const fob = this.toNumber(s.fobUsd);
      if (fob !== null && fob > 0) {
        g.fobSum += fob;
        g.fobCount += 1;
      }
      groups.set(name, g);
    }

    const maxCount = Math.max(...[...groups.values()].map((g) => g.count), 1);

    return [...groups.entries()]
      .map(([name, g]): SupplierContract => {
        const value = Math.round((g.count / maxCount) * 100);
        const ratingStars = Math.round(((value / 100) * 2 + 3) * 10) / 10;
        const tier = ratingStars >= 4.5 ? 'Diamante' : ratingStars >= 3.8 ? 'Ouro' : 'Prata';
        return {
          id: `tradeatlas:${this.slug(name)}`,
          name,
          country: g.country,
          country_code: null,
          flag: null,
          city: null,
          category: g.hsCode,
          score: indicator(
            value,
            'Score heurístico por volume de embarques do exportador na base TradeAtlas.',
            { shipment_count: g.count, max_shipments: maxCount },
            'total',
          ),
          rating_stars: ratingStars,
          tier,
          total_products: g.count,
          total_monthly_sales: g.count * 120,
          confidence: null,
          moq: null,
          fob: g.fobCount > 0 ? this.round(g.fobSum / g.fobCount) : null,
          lead_time: null,
          shipping: null,
          quality: null,
          margin: pendingIndicator(),
          risk: null,
          certifications: [],
        };
      })
      .sort((a, b) => (b.score.value ?? 0) - (a.score.value ?? 0));
  }

  private yoyGrowth(byYear: Map<number, number>): number | null {
    const years = [...byYear.keys()].sort((a, b) => a - b);
    if (years.length < 2) {
      return null;
    }
    const last = byYear.get(years[years.length - 1]) ?? 0;
    const prev = byYear.get(years[years.length - 2]) ?? 0;
    if (prev <= 0) {
      return null;
    }
    return this.roundOne(((last - prev) / prev) * 100);
  }

  private slug(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  private formatUsdCompact(value: number): string {
    const formatted = new Intl.NumberFormat('pt-BR', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
    return `US$ ${formatted}`;
  }

  private truncate(value: string, max: number): string {
    return value.length > max ? `${value.slice(0, max)}…` : value;
  }

  /** Nomes-placeholder comuns em dados TradeAtlas que não são fornecedores reais. */
  private isPlaceholderName(name: string): boolean {
    const normalized = name.trim().toUpperCase();
    return ['N/A', 'NA', '.', '-', '', 'UNKNOWN', 'NULL'].includes(normalized);
  }

  // ---- Helpers ---------------------------------------------------------

  private toTrendInput(row: SnapshotRow): TrendSnapshotInput {
    return {
      marketplace: row.marketplace,
      priceMin: row.priceMin ? Number(row.priceMin) : null,
      rating: this.toNumber(row.rating),
      reviewCount: row.reviewCount,
      salesSignalRaw: row.salesSignalRaw ? Number(row.salesSignalRaw) : null,
      salesSignalType: row.salesSignalType as never,
      collectedAt: row.collectedAt,
    };
  }

  private clusterToTrendProduct(cluster: ClusterWithSnapshots, precomputed?: TrendScoreBreakdown) {
    const breakdown =
      precomputed ??
      this.trendEngine.calculateFromSnapshots(
        cluster.snapshots.map((s) => this.toTrendInput(s)),
        cluster.category ?? undefined,
      );
    const demandSignals = this.demandSignals(cluster);
    const demandScore = this.latestDemandScore(demandSignals);
    const marketplaceScore = Math.round(breakdown.trendScore * 100);
    const combinedTrendScore =
      demandScore === null
        ? marketplaceScore
        : Math.round(marketplaceScore * 0.4 + demandScore * 0.6);
    const mainSources = [
      ...new Set([
        ...cluster.snapshots.map((s) => s.marketplace),
        ...demandSignals.map((signal) => signal.source),
      ]),
    ];
    const volumes = this.volumeSeries(cluster.snapshots);
    const prices = this.priceSeries(cluster.snapshots);
    const demandSeries = this.demandSeries(demandSignals);
    const spark = volumes.length > 1 ? volumes : demandSeries.length > 1 ? demandSeries : this.sparkSeries(volumes, prices);
    const imageUrl = [...cluster.snapshots].reverse().find((snapshot) => snapshot.imageUrl)?.imageUrl ?? null;
    const marketplaces = new Set(
      cluster.snapshots.map((snapshot) => snapshot.marketplace.toLowerCase()),
    );
    const westernMarketplaces = ['amazon', 'google-shopping', 'mercado_livre', 'shein'];
    const westernPresence = westernMarketplaces.filter((marketplace) =>
      marketplaces.has(marketplace),
    ).length;
    const westernSaturation = Math.round(
      (westernPresence / westernMarketplaces.length) * 100,
    );
    const evidenceCoverage = [
      prices.length > 0,
      cluster.snapshots.some((snapshot) => snapshot.reviewCount !== null),
      cluster.snapshots.some(
        (snapshot) => this.toNumber(snapshot.salesSignalRaw) !== null,
      ),
      cluster.snapshots.some((snapshot) =>
        Boolean(snapshot.sellerId ?? snapshot.sellerName),
      ),
    ].filter(Boolean).length;
    const coverageScore = evidenceCoverage * 25;
    const opportunityScore =
      demandScore === null
        ? Math.round(marketplaceScore * 0.7 + coverageScore * 0.3)
        : combinedTrendScore;
    const projectedRevenue = cluster.snapshots.reduce((sum, snapshot) => {
      const price = this.toNumber(snapshot.priceMin);
      const volume = this.toNumber(snapshot.salesSignalRaw);
      return price !== null && volume !== null && price > 0 && volume > 0
        ? sum + price * volume
        : sum;
    }, 0);

    return {
      product_cluster_id: cluster.id,
      canonical_name: cluster.canonicalName,
      category: cluster.category,
      image_url: imageUrl,
      trend_score:
        demandScore === null
          ? this.trendIndicator(breakdown)
          : indicator(
              combinedTrendScore,
              'Score combinado: 60% demanda normalizada e 40% sinais do marketplace.',
              {
                demand_score: demandScore,
                marketplace_score: marketplaceScore,
              },
              DEFAULT_WINDOW,
            ),
      opportunity_score: indicator(
        opportunityScore,
        demandScore === null
          ? 'Oportunidade calculada com score do marketplace e cobertura dos dados observados.'
          : 'Oportunidade calculada com demanda e evidências atuais de marketplace.',
        demandScore === null
          ? { marketplace_score: marketplaceScore, evidence_coverage: coverageScore }
          : { demand_score: demandScore, marketplace_score: marketplaceScore },
        DEFAULT_WINDOW,
      ),
      western_saturation_score: indicator(
        westernSaturation,
        'Presença observada do cluster em Amazon, Google Shopping, Mercado Livre e Shein.',
        {
          marketplaces_observed: westernPresence,
          marketplaces_considered: westernMarketplaces.length,
        },
        DEFAULT_WINDOW,
      ),
      margin_estimate: pendingIndicator(),
      // Risco oficial vem da simulação Monte Carlo; a heurística de preço é fallback.
      risk: this.simulatedRisk(cluster) ?? this.riskFromPrices(prices),
      financial_score: cluster.financialScore ?? null,
      main_sources: mainSources,
      recommendation:
        combinedTrendScore > 0
          ? 'Sinal observado em demanda e marketplace. Validar margem e fornecedor antes da compra.'
          : 'Dados iniciais coletados. Aguardando série histórica.',
      stage: this.stageFromScore(combinedTrendScore),
      spark,
      growth_pct:
        volumes.length > 1 ? this.growthPct(volumes) : demandSeries.length > 1 ? this.growthPct(demandSeries) : null,
      margin_pct: null,
      lead_time_days: null,
      projected_revenue: projectedRevenue > 0 ? this.round(projectedRevenue) : null,
    };
  }

  private demandSignals(cluster: ClusterWithSnapshots): DemandSignalRow[] {
    const byId = new Map<string, DemandSignalRow>();
    for (const snapshot of cluster.snapshots) {
      for (const link of snapshot.rawProduct?.demandLinks ?? []) {
        byId.set(link.demandSignal.id, link.demandSignal);
      }
    }
    return [...byId.values()].sort(
      (a, b) => a.weekStart.getTime() - b.weekStart.getTime(),
    );
  }

  private latestDemandScore(signals: DemandSignalRow[]): number | null {
    const latest = new Map<string, DemandSignalRow>();
    for (const signal of signals) {
      const key = `${signal.keyword}\u0000${signal.geo}\u0000${signal.source}`;
      const current = latest.get(key);
      if (!current || current.weekStart < signal.weekStart) {
        latest.set(key, signal);
      }
    }
    const values = [...latest.values()]
      .map((signal) => this.toNumber(signal.trendIndex))
      .filter((value): value is number => value !== null);
    return values.length
      ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
      : null;
  }

  private demandSeries(signals: DemandSignalRow[]): number[] {
    const byWeek = new Map<string, number[]>();
    for (const signal of signals) {
      const value = this.toNumber(signal.trendIndex);
      if (value === null) continue;
      const key = signal.weekStart.toISOString().slice(0, 10);
      const values = byWeek.get(key) ?? [];
      values.push(value);
      byWeek.set(key, values);
    }
    return [...byWeek.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, values]) => this.roundOne(values.reduce((sum, value) => sum + value, 0) / values.length));
  }

  private demandToSignals(signals: DemandSignalRow[]): Record<string, Indicator> {
    const latest = [...signals].sort(
      (a, b) => b.weekStart.getTime() - a.weekStart.getTime(),
    );
    const result: Record<string, Indicator> = {};
    for (const signal of latest) {
      const key = `${signal.source}_${signal.geo}`;
      if (result[key]) continue;
      result[key] = indicator(
        this.roundOne(this.toNumber(signal.trendIndex) ?? 0),
        `Demanda observada para “${signal.keyword}” em ${signal.geo}.`,
        { raw_value: this.toNumber(signal.rawValue) ?? 0 },
        'semanal',
      );
    }
    return result;
  }

  private trendIndicator(b: TrendScoreBreakdown): Indicator {
    const w = this.rules.getTrendWeights();
    return indicator(
      Math.round(b.trendScore * 100),
      'Score composto pelos sinais ponderados: marketplace, fornecedores, preço, reviews, busca e social.',
      {
        marketplace_growth: this.round(b.marketplaceGrowthScore * w.marketplaceGrowth),
        supplier_growth: this.round(b.supplierGrowthScore * w.supplierGrowth),
        price_opportunity: this.round(b.priceOpportunityScore * w.priceOpportunity),
        review_velocity: this.round(b.reviewVelocityScore * w.reviewVelocity),
        search_growth: this.round(b.searchGrowthScore * w.searchGrowth),
        social_buzz: this.round(b.socialBuzzScore * w.socialBuzz),
      },
      DEFAULT_WINDOW,
    );
  }

  private breakdownToSignals(b: TrendScoreBreakdown): Record<string, Indicator> {
    return {
      marketplace_growth: indicator(
        Math.round(b.marketplaceGrowthScore * 100),
        'Crescimento em reviews/volume no marketplace.',
      ),
      supplier_growth: indicator(
        Math.round(b.supplierGrowthScore * 100),
        'Aumento de fornecedores na origem.',
      ),
      price_opportunity: indicator(
        Math.round(b.priceOpportunityScore * 100),
        'Queda no preço de fábrica / alta no preço consumidor.',
      ),
      review_velocity: indicator(
        Math.round(b.reviewVelocityScore * 100),
        'Velocidade de acúmulo de avaliações.',
      ),
      search_growth: indicator(
        Math.round(b.searchGrowthScore * 100),
        'Crescimento em busca (Google Trends / Baidu).',
      ),
      social_buzz: indicator(
        Math.round(b.socialBuzzScore * 100),
        'Crescimento social (Douyin / Xiaohongshu / TikTok).',
      ),
    };
  }

  private round(value: number): number {
    return Math.round(value * 1000) / 1000;
  }

  private roundOne(value: number): number {
    return Math.round(value * 10) / 10;
  }

  private volumeSeries(snapshots: SnapshotRow[]): number[] {
    const byDate = new Map<string, { sum: number; count: number }>();
    for (const snapshot of snapshots) {
      const value = this.toNumber(snapshot.salesSignalRaw);
      if (value !== null && value > 0) {
        const dateKey = snapshot.collectedAt.toISOString().slice(0, 10);
        const curr = byDate.get(dateKey) ?? { sum: 0, count: 0 };
        curr.sum += value;
        curr.count += 1;
        byDate.set(dateKey, curr);
      }
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, { sum, count }]) => Math.round(sum / count));
  }

  private priceSeries(snapshots: SnapshotRow[]): number[] {
    const byDate = new Map<string, { sum: number; count: number }>();
    for (const snapshot of snapshots) {
      const value = this.toNumber(snapshot.priceMin);
      if (value !== null && value > 0) {
        const dateKey = snapshot.collectedAt.toISOString().slice(0, 10);
        const curr = byDate.get(dateKey) ?? { sum: 0, count: 0 };
        curr.sum += value;
        curr.count += 1;
        byDate.set(dateKey, curr);
      }
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, { sum, count }]) => this.roundOne(sum / count));
  }

  private sparkSeries(volumes: number[], prices: number[]): number[] | null {
    const series = volumes.some((value) => value > 0) ? volumes : prices;
    return series.length > 0 ? series : null;
  }

  private growthPct(volumes: number[]): number | null {
    const valid = volumes.filter((value) => value > 0);
    if (valid.length < 2) {
      return null;
    }
    const first = valid[0];
    const last = valid[valid.length - 1];
    if (!first || last === undefined) {
      return null;
    }
    return this.roundOne(((last - first) / first) * 100);
  }

  private stageFromScore(score: number): 'peaking' | 'rising' | 'emerging' {
    if (score >= 60) {
      return 'peaking';
    }
    if (score >= 35) {
      return 'rising';
    }
    return 'emerging';
  }

  /** Risco persistido pela simulação Monte Carlo, se estiver num nível conhecido. */
  private simulatedRisk(
    cluster: ClusterWithSnapshots,
  ): 'baixo' | 'medio' | 'alto' | null {
    const level = cluster.riskLevel;
    return level === 'baixo' || level === 'medio' || level === 'alto' ? level : null;
  }

  private riskFromPrices(prices: number[]): 'baixo' | 'medio' | 'alto' | null {
    if (prices.length < 2) {
      return null;
    }
    const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    if (mean <= 0) {
      return null;
    }
    const variance =
      prices.reduce((sum, price) => sum + (price - mean) ** 2, 0) / prices.length;
    const cv = Math.sqrt(variance) / mean;
    if (cv < 0.25) {
      return 'baixo';
    }
    if (cv < 0.6) {
      return 'medio';
    }
    return 'alto';
  }

  private toNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  private formatInt(value: number): string {
    return new Intl.NumberFormat('pt-BR').format(value);
  }
}
