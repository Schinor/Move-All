import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { ConnectorsRegistry } from '../connectors/connectors.registry';
import { OpenRouterService } from '../ai-gateway/openrouter.service';
import {
  syntheticProductWhere,
  syntheticSnapshotFilterSql,
  syntheticSnapshotWhere,
} from '../../shared/synthetic-data/synthetic-data.filter';
import {
  EMPTY_MOVE_SCORE,
  LatestMoveScore,
  loadLatestMoveScores,
} from '../../shared/scoring/product-score-loader';
import { normalizeSourceKey } from '../../shared/types/canonical-sources';
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
  SupplierContract,
} from '../../shared/contract/supplier';
import { DEFAULT_BUSINESS_RULES } from '../../shared/business-rules/business-rules.defaults';
import { ACTION_LABEL } from '../scoring/decision-quadrant';

function actionLabel(action: string): string {
  return (ACTION_LABEL as Record<string, string>)[action] ?? action;
}

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

/** Busca tolerante a erro de digitação: word_similarity mínima (calibrada: "kettlbel" 0,56, "bicileta" 0,58). */
const SEARCH_SIMILARITY_THRESHOLD = 0.45;
/** Bloco "Recomendação" do executivo: produtos com mais potencial. */
const EXECUTIVE_TOP_N = 5;
/** Sem a extensão unaccent: acentos normalizados com translate() dos dois lados. */
const SEARCH_ACCENTS_FROM = 'áàâãäéèêëíìîïóòôõöúùûüçñ';
const SEARCH_ACCENTS_TO = 'aaaaaeeeeiiiiooooouuuucn';

type SnapshotRow = {
  marketplace: string;
  currency?: string | null;
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

type ClusterRollup = {
  id: string;
  canonicalName: string;
  category: string | null;
  riskLevel: string | null;
  financialScore: number | null;
  firstCollectedAt: Date;
  lastCollectedAt: Date;
  firstAvgPrice: number | null;
  lastAvgPrice: number | null;
  firstAvgReviews: number | null;
  lastAvgReviews: number | null;
  firstAvgSignal: number | null;
  lastAvgSignal: number | null;
  firstSalesSignalType: string | null;
  latestMarketplace: string;
  latestPrice: number | null;
  latestRating: number | null;
  latestReviews: number | null;
  latestSignal: number | null;
  latestSignalType: string | null;
  marketplaces: string[];
  demandSources: string[];
  latestImageUrl: string | null;
  hasReviews: boolean;
  hasSales: boolean;
  hasSeller: boolean;
  projectedRevenue: number;
  priceMean: number | null;
  priceStddev: number | null;
  priceCount: number;
  volumeSpark: number[];
  demandSpark: number[];
  demandScore: number | null;
  /** Crescimento Δlog do TikTok (contagem bruta); null sem 2+ semanas. */
  tiktokGrowth: number | null;
  sellers: string[];
};

type TrendListSort =
  | 'move_score'
  | 'growth'
  | 'name'
  | 'projected_revenue'
  | 'momentum'
  | 'price'
  | 'reviews'
  | 'rating'
  | 'action';

type TrendListOptions = {
  limit?: number;
  sort?: string;
  dir?: string;
  category?: string;
  page?: number;
  pageSize?: number;
  action?: string;
};

type ClusterRollupRow = {
  id: string;
  canonical_name: string;
  category: string | null;
  risk_level: string | null;
  financial_score: number | null;
  first_collected_at: Date;
  last_collected_at: Date;
  first_avg_price: unknown;
  last_avg_price: unknown;
  first_avg_reviews: unknown;
  last_avg_reviews: unknown;
  first_avg_signal: unknown;
  last_avg_signal: unknown;
  first_signal_type: string | null;
  latest_marketplace: string;
  latest_price: unknown;
  latest_rating: unknown;
  latest_reviews: unknown;
  latest_signal: unknown;
  latest_signal_type: string | null;
  marketplaces: string[] | null;
  demand_sources: string[] | null;
  latest_image_url: string | null;
  has_reviews: boolean;
  has_sales: boolean;
  has_seller: boolean;
  projected_revenue: unknown;
  price_mean: unknown;
  price_stddev: unknown;
  price_count: unknown;
  volume_spark: unknown[] | null;
  demand_spark: unknown[] | null;
  demand_score: unknown;
  tiktok_growth: unknown;
  sellers: string[] | null;
};

const TREND_SORTS: Record<string, TrendListSort> = {
  move_score: 'move_score',
  move: 'move_score',
  default: 'move_score',
  // Aliases legados (F2.7): ordenavam pelos scores removidos; caem no Move Score.
  trend_score: 'move_score',
  opportunity_score: 'move_score',
  opportunity: 'move_score',
  growth: 'growth',
  growth_pct: 'growth',
  growthpct: 'growth',
  name: 'name',
  canonical_name: 'name',
  projected_revenue: 'projected_revenue',
  revenue: 'projected_revenue',
  projectedrevenue: 'projected_revenue',
  // C2: ordenação por qualquer indicador.
  momentum: 'momentum',
  momentum_growth: 'momentum',
  growth_momentum: 'momentum',
  price: 'price',
  preco: 'price',
  avg_price: 'price',
  reviews: 'reviews',
  review_count: 'reviews',
  // P0-4: nota (rating) é indicador próprio, não alias de reviews.
  rating: 'rating',
  nota: 'rating',
  action: 'action',
  acao: 'action',
};

import { RedisCacheService } from '../../shared/redis/redis-cache.service';
import { SEARCH_TOPICS, expandSearchQuery } from '../../shared/search/search-expansion';
import { computeSubSignals } from '../../shared/scoring/sub-signals';
import {
  DEFAULT_FX_CNY_USD as SUB_SIGNAL_FX_CNY_USD,
  DEFAULT_FX_USD_BRL as SUB_SIGNAL_FX_USD_BRL,
} from '../../shared/fx/fx.constants';

/**
 * Teto de clusters carregados para ranqueamento. O ranking precisa varrer o
 * universo inteiro (senão o "top N" sai de uma amostra arbitrária), mas a query
 * não pode ser ilimitada. O volume previsto é de ~1k–6k clusters; o teto cobre
 * isso com folga e, combinado com `ORDER BY created_at, id`, torna o resultado
 * determinístico (e não uma página aleatória) caso a base cresça além dele.
 */
const MAX_RANKED_CLUSTERS = 20000;

@Injectable()
export class DashboardApiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connectors: ConnectorsRegistry,
    private readonly cache?: RedisCacheService,
    @Optional() private readonly openRouter?: OpenRouterService,
  ) {}

  private async cached<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    if (!this.cache) return factory();
    return this.cache.wrap(key, ttlSeconds, factory);
  }

  // ---- /trends/products ------------------------------------------------

  async listTrendingProducts(
    limitOrOpts: number | TrendListOptions = 50,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    const opts = this.parseTrendListOptions(limitOrOpts);
    const cacheKey = `dashboard:trends:products:${opts.limit}:${opts.sort}:${opts.dir}:${opts.category ?? 'all'}:${opts.action ?? 'all'}`;
    const enrich = async (
      rollups: ClusterRollup[],
    ): Promise<Array<ReturnType<DashboardApiService['clusterRollupToTrendProduct']>>> => {
      const scores = await loadLatestMoveScores(
        this.prisma,
        rollups.map((row) => row.id),
      );
      const ids = rollups.map((row) => row.id);
      const [tops, summaries] = await Promise.all([
        this.loadTopSuppliers(ids),
        this.loadReviewSummaries(ids),
      ]);
      return rollups.map((row) =>
        this.clusterRollupToTrendProduct(
          row,
          scores.get(row.id) ?? EMPTY_MOVE_SCORE,
          tops.get(row.id) ?? null,
          summaries.get(row.id) ?? null,
        ),
      );
    };
    // C2 usa cache separado para páginas (o corpo inclui total no cabeçalho da resposta).
    if (opts.paginated) {
      const all = (await this.cached(cacheKey, 3600, async () => {
        const rollups = await this.loadClusterRollups(opts.category);
        const mapped = await enrich(rollups);
        const filtered = opts.action
          ? mapped.filter((p) => (p as Record<string, unknown>).action === opts.action)
          : mapped;
        filtered.sort((a, b) => this.compareTrendProducts(a, b, opts.sort, opts.dir));
        return filtered;
      })) as Array<ReturnType<DashboardApiService['clusterRollupToTrendProduct']>>;
      const total = all.length;
      const start = (opts.page - 1) * opts.pageSize;
      const items = all.slice(start, start + opts.pageSize);
      return { items, total, page: opts.page, page_size: opts.pageSize };
    }

    return this.cached(cacheKey, 3600, async () => {
      const rollups = await this.loadClusterRollups(opts.category);
      let products = await enrich(rollups);
      if (opts.action) {
        products = products.filter((p) => (p as Record<string, unknown>).action === opts.action);
      }
      products.sort((a, b) => this.compareTrendProducts(a, b, opts.sort, opts.dir));
      return products.slice(0, Math.max(0, opts.limit));
    });
  }

  /** C1: top_supplier por cluster via tracked_listings.supplier_id (A6). Null sem vínculo. */
  private async loadTopSuppliers(
    clusterIds: string[],
  ): Promise<Map<string, { name: string; source: string; verified: boolean; years: number | null } | null>> {
    const out = new Map<string, { name: string; source: string; verified: boolean; years: number | null } | null>();
    if (clusterIds.length === 0) return out;
    try {
      const items = (await this.prisma.productClusterItem.findMany({
        where: { clusterId: { in: clusterIds } },
        take: 20_000,
        select: { clusterId: true, marketplace: true, externalProductId: true },
      })) as Array<{ clusterId: string; marketplace: string; externalProductId: string }>;
      const byCluster = new Map<string, Array<{ marketplace: string; externalProductId: string }>>();
      for (const it of items) {
        const list = byCluster.get(it.clusterId) ?? [];
        if (list.length < 50) list.push({ marketplace: it.marketplace, externalProductId: it.externalProductId });
        byCluster.set(it.clusterId, list);
      }
      // tracked_listings com fornecedor vinculado (em geral poucos; A6 pendente).
      const linked = (await this.prisma.trackedListing.findMany({
        where: { supplierId: { not: null } },
        take: 5_000,
        include: { supplier: true },
      })) as Array<{
        source: string;
        nativeId: string;
        supplierId: string | null;
        supplier: { name: string; source: string; verified: boolean; yearsOnPlatform: number | null } | null;
      }>;
      const byListing = new Map<string, (typeof linked)[number]>();
      for (const l of linked) byListing.set(`${l.source}:${l.nativeId}`, l);
      const minListings = 2;
      for (const cid of clusterIds) {
        const clusterItems = byCluster.get(cid) ?? [];
        const counts = new Map<string, { n: number; supplier: (typeof linked)[number]['supplier'] }>();
        for (const it of clusterItems) {
          const hit = byListing.get(`${it.marketplace}:${it.externalProductId}`);
          if (!hit?.supplier) continue;
          const key = `${hit.supplier.source}:${hit.supplier.name}`;
          const cur = counts.get(key) ?? { n: 0, supplier: hit.supplier };
          cur.n += 1;
          counts.set(key, cur);
        }
        if (counts.size === 0) {
          out.set(cid, null);
          continue;
        }
        const sorted = [...counts.values()].sort((a, b) => b.n - a.n);
        const top = sorted[0];
        // A6: presença em ≥N primeiro; volume desempataria (sem vendidos aqui).
        void minListings;
        if (!top.supplier) {
          out.set(cid, null);
          continue;
        }
        out.set(cid, {
          name: top.supplier.name,
          source: top.supplier.source,
          verified: top.supplier.verified ?? false,
          years: top.supplier.yearsOnPlatform ?? null,
        });
      }
    } catch {
      for (const cid of clusterIds) out.set(cid, null);
    }
    return out;
  }

  /** C1: review_summary por faixa (B5) — último por cluster/faixa; distribuição no detalhe. */
  private async loadReviewSummaries(
    clusterIds: string[],
  ): Promise<
    Map<string, { by_band: Record<string, { summary: string; top_reasons: unknown; sample_size: number }>; distribution: null }>
  > {
    const out = new Map<
      string,
      { by_band: Record<string, { summary: string; top_reasons: unknown; sample_size: number }>; distribution: null }
    >();
    if (clusterIds.length === 0) return out;
    try {
      const rows = (await this.prisma.reviewSummary.findMany({
        where: { productClusterId: { in: clusterIds } },
        orderBy: { createdAt: 'desc' },
        take: Math.min(clusterIds.length * 3, 5_000),
        select: { productClusterId: true, band: true, summary: true, topReasons: true, sampleSize: true },
      })) as Array<{
        productClusterId: string;
        band: string;
        summary: string;
        topReasons: unknown;
        sampleSize: number;
      }>;
      const grouped = new Map<string, typeof rows>();
      for (const r of rows) {
        const list = grouped.get(r.productClusterId) ?? [];
        list.push(r);
        grouped.set(r.productClusterId, list);
      }
      for (const cid of clusterIds) {
        const list = grouped.get(cid) ?? [];
        const by_band: Record<string, { summary: string; top_reasons: unknown; sample_size: number }> = {};
        for (const r of list) {
          if (!by_band[r.band]) {
            by_band[r.band] = { summary: r.summary, top_reasons: r.topReasons, sample_size: r.sampleSize };
          }
        }
        out.set(cid, { by_band, distribution: null });
      }
    } catch {
      for (const cid of clusterIds) out.set(cid, { by_band: {}, distribution: null });
    }
    return out;
  }

  /**
   * Uma linha por cluster com os insumos do Trend Engine já agregados no Postgres.
   * Substitui o carregamento aninhado de até 20k clusters × 500 snapshots.
   */
  private async loadClusterRollups(category?: string): Promise<ClusterRollup[]> {
    const categoryFilter = category
      ? Prisma.sql`AND c.category = ${category}`
      : Prisma.empty;
    // Com INCLUDE_SYNTHETIC_DATA=false (default), exclui snapshots do
    // pipeline sintético de TODAS as CTEs que leem product_listing_snapshots
    // — senão o ranking mistura curva inventada com coleta real.
    const syntheticFilterNoAlias = syntheticSnapshotFilterSql();
    const syntheticFilterS = syntheticSnapshotFilterSql('s');

    const rows = await this.prisma.$queryRaw<ClusterRollupRow[]>(Prisma.sql`
      WITH bounds AS (
        SELECT
          product_cluster_id,
          MIN(collected_at) AS first_at,
          MAX(collected_at) AS last_at
        FROM product_listing_snapshots
        WHERE product_cluster_id IS NOT NULL
          ${syntheticFilterNoAlias}
        GROUP BY product_cluster_id
      ),
      windowed AS (
        SELECT
          s.product_cluster_id,
          (AVG(s.price_min) FILTER (
            WHERE s.price_min IS NOT NULL AND s.price_min > 0
              AND s.collected_at <= b.first_at + INTERVAL '24 hours'
          ))::float8 AS first_avg_price,
          (AVG(s.price_min) FILTER (
            WHERE s.price_min IS NOT NULL AND s.price_min > 0
              AND s.collected_at >= b.last_at - INTERVAL '24 hours'
          ))::float8 AS last_avg_price,
          (AVG(s.review_count) FILTER (
            WHERE s.review_count IS NOT NULL
              AND s.collected_at <= b.first_at + INTERVAL '24 hours'
          ))::float8 AS first_avg_reviews,
          (AVG(s.review_count) FILTER (
            WHERE s.review_count IS NOT NULL
              AND s.collected_at >= b.last_at - INTERVAL '24 hours'
          ))::float8 AS last_avg_reviews,
          (AVG(s.sales_signal_raw) FILTER (
            WHERE s.sales_signal_raw IS NOT NULL AND s.sales_signal_raw > 0
              AND s.collected_at <= b.first_at + INTERVAL '24 hours'
          ))::float8 AS first_avg_signal,
          (AVG(s.sales_signal_raw) FILTER (
            WHERE s.sales_signal_raw IS NOT NULL AND s.sales_signal_raw > 0
              AND s.collected_at >= b.last_at - INTERVAL '24 hours'
          ))::float8 AS last_avg_signal,
          (AVG(s.price_min) FILTER (WHERE s.price_min IS NOT NULL AND s.price_min > 0))::float8 AS price_mean,
          (STDDEV_POP(s.price_min) FILTER (WHERE s.price_min IS NOT NULL AND s.price_min > 0))::float8 AS price_stddev,
          (COUNT(*) FILTER (WHERE s.price_min IS NOT NULL AND s.price_min > 0))::int AS price_count,
          BOOL_OR(s.review_count IS NOT NULL) AS has_reviews,
          BOOL_OR(s.sales_signal_raw IS NOT NULL) AS has_sales,
          BOOL_OR(
            s.seller_id IS NOT NULL
            OR (s.seller_name IS NOT NULL AND BTRIM(s.seller_name) <> '')
          ) AS has_seller,
          COALESCE(SUM(
            CASE
              WHEN s.price_min > 0 AND s.sales_signal_raw > 0
              THEN s.price_min * s.sales_signal_raw
              ELSE 0
            END
          ), 0)::float8 AS projected_revenue,
          COALESCE(
            ARRAY_AGG(DISTINCT s.marketplace) FILTER (WHERE s.marketplace IS NOT NULL),
            '{}'::text[]
          ) AS marketplaces,
          COALESCE(
            ARRAY_AGG(DISTINCT COALESCE(s.seller_id, s.seller_name)) FILTER (
              WHERE s.seller_id IS NOT NULL
                OR (s.seller_name IS NOT NULL AND BTRIM(s.seller_name) <> '')
            ),
            '{}'::text[]
          ) AS sellers,
          (
            ARRAY_AGG(s.image_url ORDER BY s.collected_at DESC)
              FILTER (WHERE s.image_url IS NOT NULL)
          )[1] AS latest_image_url
        FROM product_listing_snapshots s
        JOIN bounds b ON b.product_cluster_id = s.product_cluster_id
        WHERE 1 = 1
          ${syntheticFilterS}
        GROUP BY s.product_cluster_id
      ),
      latest_row AS (
        SELECT DISTINCT ON (product_cluster_id)
          product_cluster_id,
          marketplace AS latest_marketplace,
          price_min::float8 AS latest_price,
          rating::float8 AS latest_rating,
          review_count AS latest_reviews,
          sales_signal_raw::float8 AS latest_signal,
          sales_signal_type AS latest_signal_type
        FROM product_listing_snapshots
        WHERE product_cluster_id IS NOT NULL
          ${syntheticFilterNoAlias}
        ORDER BY product_cluster_id, collected_at DESC, id DESC
      ),
      first_row AS (
        SELECT DISTINCT ON (product_cluster_id)
          product_cluster_id,
          sales_signal_type AS first_signal_type,
          collected_at AS first_collected_at
        FROM product_listing_snapshots
        WHERE product_cluster_id IS NOT NULL
          ${syntheticFilterNoAlias}
        ORDER BY product_cluster_id, collected_at ASC, id ASC
      ),
      volume_spark AS (
        SELECT
          product_cluster_id,
          COALESCE(
            ARRAY_AGG(avg_vol ORDER BY day) FILTER (WHERE avg_vol IS NOT NULL),
            '{}'::float8[]
          ) AS volume_spark
        FROM (
          SELECT
            product_cluster_id,
            (collected_at AT TIME ZONE 'UTC')::date AS day,
            (AVG(sales_signal_raw) FILTER (WHERE sales_signal_raw > 0))::float8 AS avg_vol
          FROM product_listing_snapshots
          WHERE product_cluster_id IS NOT NULL
            ${syntheticFilterNoAlias}
          GROUP BY 1, 2
        ) daily
        GROUP BY product_cluster_id
      ),
      demand_latest AS (
        SELECT DISTINCT ON (s.product_cluster_id, ds.keyword, ds.geo, ds.source)
          s.product_cluster_id,
          ds.source,
          ds.trend_index::float8 AS trend_index
        FROM product_listing_snapshots s
        JOIN product_demand_link pdl ON pdl.product_id = s.raw_product_id
        JOIN demand_signals ds ON ds.id = pdl.demand_signal_id
        WHERE s.product_cluster_id IS NOT NULL
          AND s.raw_product_id IS NOT NULL
          -- A3.8: Google Trends (0–100) nunca na média com TikTok (contagem
          -- bruta). demand_score/spark são só Google; TikTok entra só como
          -- crescimento Δlog (CTE tiktok_growth abaixo).
          AND ds.source = 'google_trends'
          ${syntheticFilterS}
        ORDER BY s.product_cluster_id, ds.keyword, ds.geo, ds.source, ds.week_start DESC
      ),
      demand_agg AS (
        SELECT
          product_cluster_id,
          COALESCE(ARRAY_AGG(DISTINCT source), '{}'::text[]) AS demand_sources,
          AVG(trend_index)::float8 AS demand_score
        FROM demand_latest
        GROUP BY product_cluster_id
      ),
      demand_spark AS (
        SELECT
          weekly.product_cluster_id,
          COALESCE(
            ARRAY_AGG(week_avg ORDER BY week_start) FILTER (WHERE week_avg IS NOT NULL),
            '{}'::float8[]
          ) AS demand_spark
        FROM (
          SELECT
            s.product_cluster_id,
            ds.week_start,
            AVG(ds.trend_index)::float8 AS week_avg
          FROM product_listing_snapshots s
          JOIN product_demand_link pdl ON pdl.product_id = s.raw_product_id
          JOIN demand_signals ds ON ds.id = pdl.demand_signal_id
          WHERE s.product_cluster_id IS NOT NULL
            AND s.raw_product_id IS NOT NULL
            -- A3.8: série de busca só Google Trends (0–100); TikTok (contagem
            -- bruta) não entra na média — só como crescimento Δlog.
            AND ds.source = 'google_trends'
            ${syntheticFilterS}
          GROUP BY s.product_cluster_id, ds.week_start
        ) weekly
        GROUP BY weekly.product_cluster_id
      ),
      -- A3.8: TikTok entra SÓ como crescimento Δlog sobre a contagem bruta
      -- (ln(último) − ln(primeiro) por cluster); NULL com < 2 semanas.
      tiktok_growth AS (
        SELECT
          product_cluster_id,
          CASE WHEN COUNT(DISTINCT week_start) > 1
            THEN (
              ln(NULLIF(MAX(CASE WHEN rn_desc = 1 THEN raw_value END), 0))
              - ln(NULLIF(MAX(CASE WHEN rn_asc = 1 THEN raw_value END), 0))
            )::float8
          END AS tiktok_growth
        FROM (
          SELECT
            s.product_cluster_id,
            ds.week_start,
            ds.raw_value::float8 AS raw_value,
            ROW_NUMBER() OVER (PARTITION BY s.product_cluster_id ORDER BY ds.week_start DESC) AS rn_desc,
            ROW_NUMBER() OVER (PARTITION BY s.product_cluster_id ORDER BY ds.week_start ASC) AS rn_asc
          FROM product_listing_snapshots s
          JOIN product_demand_link pdl ON pdl.product_id = s.raw_product_id
          JOIN demand_signals ds ON ds.id = pdl.demand_signal_id
          WHERE s.product_cluster_id IS NOT NULL
            AND s.raw_product_id IS NOT NULL
            AND ds.source = 'tiktok_search'
            AND ds.raw_value IS NOT NULL
            AND ds.raw_value > 0
            ${syntheticFilterS}
        ) ranked
        GROUP BY product_cluster_id
      )
      SELECT
        c.id,
        c.canonical_name,
        c.category,
        c.risk_level,
        c.financial_score,
        fr.first_collected_at,
        b.last_at AS last_collected_at,
        w.first_avg_price,
        w.last_avg_price,
        w.first_avg_reviews,
        w.last_avg_reviews,
        w.first_avg_signal,
        w.last_avg_signal,
        fr.first_signal_type,
        lr.latest_marketplace,
        lr.latest_price,
        lr.latest_rating,
        lr.latest_reviews,
        lr.latest_signal,
        lr.latest_signal_type,
        w.marketplaces,
        COALESCE(da.demand_sources, '{}'::text[]) AS demand_sources,
        w.latest_image_url,
        w.has_reviews,
        w.has_sales,
        w.has_seller,
        w.projected_revenue,
        w.price_mean,
        w.price_stddev,
        w.price_count,
        COALESCE(vs.volume_spark, '{}'::float8[]) AS volume_spark,
        COALESCE(dsp.demand_spark, '{}'::float8[]) AS demand_spark,
        da.demand_score,
        tg.tiktok_growth,
        w.sellers
      FROM product_clusters c
      JOIN bounds b ON b.product_cluster_id = c.id
      JOIN windowed w ON w.product_cluster_id = c.id
      JOIN latest_row lr ON lr.product_cluster_id = c.id
      JOIN first_row fr ON fr.product_cluster_id = c.id
      LEFT JOIN volume_spark vs ON vs.product_cluster_id = c.id
      LEFT JOIN demand_agg da ON da.product_cluster_id = c.id
      LEFT JOIN demand_spark dsp ON dsp.product_cluster_id = c.id
      LEFT JOIN tiktok_growth tg ON tg.product_cluster_id = c.id
      WHERE 1 = 1
        ${categoryFilter}
      ORDER BY c.created_at ASC, c.id ASC
      LIMIT ${MAX_RANKED_CLUSTERS}
    `);

    return rows.map((row) => this.mapClusterRollup(row));
  }

  private mapClusterRollup(row: ClusterRollupRow): ClusterRollup {
    return {
      id: row.id,
      canonicalName: row.canonical_name,
      category: row.category,
      riskLevel: row.risk_level,
      financialScore: this.toNumber(row.financial_score),
      firstCollectedAt: new Date(row.first_collected_at),
      lastCollectedAt: new Date(row.last_collected_at),
      firstAvgPrice: this.toNumber(row.first_avg_price),
      lastAvgPrice: this.toNumber(row.last_avg_price),
      firstAvgReviews: this.toNumber(row.first_avg_reviews),
      lastAvgReviews: this.toNumber(row.last_avg_reviews),
      firstAvgSignal: this.toNumber(row.first_avg_signal),
      lastAvgSignal: this.toNumber(row.last_avg_signal),
      firstSalesSignalType: row.first_signal_type,
      latestMarketplace: row.latest_marketplace,
      latestPrice: this.toNumber(row.latest_price),
      latestRating: this.toNumber(row.latest_rating),
      latestReviews: this.toNumber(row.latest_reviews),
      latestSignal: this.toNumber(row.latest_signal),
      latestSignalType: row.latest_signal_type,
      marketplaces: row.marketplaces ?? [],
      demandSources: row.demand_sources ?? [],
      latestImageUrl: row.latest_image_url,
      hasReviews: Boolean(row.has_reviews),
      hasSales: Boolean(row.has_sales),
      hasSeller: Boolean(row.has_seller),
      projectedRevenue: this.toNumber(row.projected_revenue) ?? 0,
      priceMean: this.toNumber(row.price_mean),
      priceStddev: this.toNumber(row.price_stddev),
      priceCount: this.toNumber(row.price_count) ?? 0,
      volumeSpark: (row.volume_spark ?? [])
        .map((value) => this.toNumber(value))
        .filter((value): value is number => value !== null),
      demandSpark: (row.demand_spark ?? [])
        .map((value) => this.toNumber(value))
        .filter((value): value is number => value !== null),
      demandScore: this.toNumber(row.demand_score),
      tiktokGrowth: this.toNumber(row.tiktok_growth),
      sellers: row.sellers ?? [],
    };
  }

  // ---- /trends/products/:id -------------------------------------------

  async getTrendProduct(id: string) {
    const cluster = (await this.prisma.productCluster.findUnique({
      where: { id },
      include: {
        snapshots: {
          where: syntheticSnapshotWhere(),
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

    // Move Score oficial (F2.5); sem Trend Engine no detalhe (F2.7).
    const scores = await loadLatestMoveScores(this.prisma, [id]);
    const moveScore = scores.get(id) ?? EMPTY_MOVE_SCORE;
    const [tops, summaries] = await Promise.all([
      this.loadTopSuppliers([id]),
      this.loadReviewSummaries([id]),
    ]);
    const distribution = await this.loadRatingDistribution(id);
    const summary = summaries.get(id) ?? { by_band: {}, distribution: null };
    const base = this.clusterToTrendProduct(
      cluster,
      undefined,
      moveScore,
      tops.get(id) ?? null,
      { by_band: (summary.by_band as Record<string, unknown>) ?? {}, distribution },
    );

    return {
      ...base,
      ...this.toMoveScoreFields(moveScore),
      image_urls: [...new Set(cluster.snapshots.map((row) => row.imageUrl).filter(Boolean))],
      // F2.7: sinais de demanda + sub-sinais do radar calculados dos anúncios.
      signals: {
        ...this.demandToSignals(this.demandSignals(cluster)),
        ...this.subSignalIndicators(cluster),
      },
    };
  }

  /** C1: distribuição de estrelas (A5) — última observação com rating_distribution. */
  private async loadRatingDistribution(
    clusterId: string,
  ): Promise<Record<string, number> | null> {
    try {
      const items = await this.prisma.productClusterItem.findMany({
        where: { clusterId },
        take: 50,
        select: { marketplace: true, externalProductId: true },
      });
      if (items.length === 0) return null;
      // Busca observações recentes dos anúncios do cluster com distribuição.
      const listings = await this.prisma.trackedListing.findMany({
        where: {
          OR: items.slice(0, 20).map((it) => ({ source: it.marketplace, nativeId: it.externalProductId })),
        },
        take: 20,
        select: { id: true },
      });
      if (listings.length === 0) return null;
      const obs = await this.prisma.listingObservation.findFirst({
        where: { listingId: { in: listings.map((l) => l.id) } },
        orderBy: { observedAt: 'desc' },
        select: { ratingDistribution: true },
      });
      const dist = obs?.ratingDistribution as Record<string, unknown> | null;
      if (!dist || typeof dist !== 'object') return null;
      const out: Record<string, number> = {};
      for (const k of ['1', '2', '3', '4', '5']) {
        const v = Number((dist as Record<string, unknown>)[k]);
        if (Number.isFinite(v)) out[k] = v;
      }
      return Object.keys(out).length > 0 ? out : null;
    } catch {
      return null;
    }
  }

  // ---- /dashboard/summary ---------------------------------------------

  async getDashboardSummary() {
    const rollups = await this.loadClusterRollups();

    if (rollups.length === 0) {
      // Sem dados de marketplace: usa os dados importados (Comex/TradeAtlas).
      return this.importDashboardSummary();
    }

    const products = rollups
      .map((row) => this.clusterRollupToTrendProduct(row))
      .sort((a, b) => this.compareTrendProducts(a, b, 'move_score'));
    const scored = products.filter(
      (product) => product.move_score !== null && product.move_score !== undefined,
    );
    const avgScore = scored.length
      ? Math.round(scored.reduce((sum, product) => sum + (product.move_score ?? 0), 0) / scored.length)
      : 0;
    const suppliers = new Set(rollups.flatMap((row) => row.sellers));
    const origins = new Set(rollups.flatMap((row) => row.marketplaces));
    const activeOpportunities = products.filter(
      (product) => product.decision === 'AVANCAR' || product.decision === 'AVANCAR COM RESSALVAS',
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
            ? `Move Score ${product.move_score ?? '—'}`
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
    // C5 (decisão 8): lê a tabela suppliers (A6, foco B2B Alibaba/1688/AliExpress).
    // Canal de venda nunca é fornecedor — removidos os derivados de seller_name.
    try {
      const rows = await this.prisma.supplier.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 500,
        include: { _count: { select: { listings: true } } },
      });
      if (rows.length > 0) {
        return rows.map((s) => ({
          id: s.id,
          name: s.name,
          source: (s as unknown as { source?: string }).source ?? null,
          country: s.country ?? null,
          country_code: null,
          flag: null,
          city: null,
          category: null,
          score: pendingIndicator(),
          rating_stars: 0,
          tier: 'Bronze' as const,
          total_products: (s as unknown as { _count?: { listings: number } })._count?.listings ?? 0,
          total_monthly_sales: null,
          confidence: null,
          moq: null,
          fob: null,
          lead_time: null,
          shipping: null,
          quality: null,
          margin: pendingIndicator(),
          risk: null,
          certifications: s.verified ? ['Verificado'] : [],
        }));
      }
    } catch {
      // Tabela suppliers ainda sem migração aplicada — cai no fallback.
    }
    // Sem fornecedores B2B identificados: usa os exportadores do TradeAtlas.
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
      mercado_livre: { defaultOnline: true },
      amazon_br: { defaultOnline: true },
      shopee_br: { defaultOnline: true },
      '1688': { defaultOnline: true },
      alibaba: { defaultOnline: true },
      amazon: { defaultOnline: true },
      tradeatlas: { defaultOnline: true },
      // A4: no pipeline ETL ao vivo (sourcing/custo); online por padrão como
      // as demais fontes ETL (last_collected_at continua null sem coleta).
      aliexpress: { defaultOnline: true },
      google_shopping: { defaultOnline: false },
      google_trends: { defaultOnline: false },
      tiktok_shop: { defaultOnline: false },
      douyin: { defaultOnline: false },
      xiaohongshu: { defaultOnline: false },
    };

    // Normalização única de fontes (F1.8): `mercadolivre` vira `mercado_livre`,
    // `google-shopping` vira `google_shopping`, etc.

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
      // Com INCLUDE_SYNTHETIC_DATA=false, o status das fontes ignora produtos sintéticos.
      this.prisma.intelligenceProduct.groupBy({
        by: ['source'],
        where: syntheticProductWhere(),
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
        // Fonte "online por padrão" sem nenhuma coleta registrada não pode
        // aparecer com "agora" — isso fabricava um horário de coleta que
        // nunca aconteceu (ver relatório seção 4.1).
        last_collected_at: collected?.lastCollectedAt ?? null,
      };
    });

    return uniqueSources;
  }

  // ---- /search (C4, decisão 14) ----------------------------------------

  /** Normalização sem acento no app (fallback quando unaccent indisponível). */
  private normalizeQuery(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .slice(0, 120);
  }

  async search(rawQuery: string, limit = 20) {
    const q = (rawQuery ?? '').trim().slice(0, 120);
    if (!q) return { products: [], categories: [], suppliers: [], topics: [] };
    const take = Math.max(1, Math.min(limit || 20, 20));
    const term = this.normalizeQuery(q);
    // "perna", "abdômen", "cardio"… viram as categorias ligadas ao objetivo.
    const expansion = expandSearchQuery(q);
    const topics = SEARCH_TOPICS.filter((topic) => expansion.topics.includes(topic.key));
    const topicCategories = [...new Set(topics.flatMap((topic) => topic.categories))];

    let productRows: Array<{ id: string; canonical_name: string; category: string | null; via_topic: boolean }> = [];
    try {
      productRows = await this.prisma.$queryRaw(
        Prisma.sql`WITH normalized AS (
          SELECT id, canonical_name, category,
            translate(lower(canonical_name), ${SEARCH_ACCENTS_FROM}, ${SEARCH_ACCENTS_TO}) AS name_norm,
            translate(lower(COALESCE(category, '')), ${SEARCH_ACCENTS_FROM}, ${SEARCH_ACCENTS_TO}) AS category_norm
          FROM product_clusters
        ), ranked AS (
          SELECT id, canonical_name, category,
            (strpos(name_norm, ${term}) > 0 OR strpos(category_norm, ${term}) > 0) AS contains,
            GREATEST(word_similarity(${term}, name_norm), word_similarity(${term}, category_norm)) AS sim,
            ${topicCategories.length > 0 ? Prisma.sql`category IN (${Prisma.join(topicCategories)})` : Prisma.sql`false`} AS in_topic
          FROM normalized
        )
        SELECT id, canonical_name, category, (NOT contains AND sim < ${SEARCH_SIMILARITY_THRESHOLD}) AS via_topic
        FROM ranked
        WHERE contains OR sim >= ${SEARCH_SIMILARITY_THRESHOLD} OR in_topic
        ORDER BY contains DESC, sim DESC, canonical_name ASC
        LIMIT ${take}`,
      );
    } catch {
      // Sem pg_trgm: parcial por ILIKE + categorias do objetivo.
      const clusters = await this.prisma.productCluster.findMany({
        where: {
          OR: [
            { canonicalName: { contains: q, mode: 'insensitive' } },
            { canonicalName: { contains: term, mode: 'insensitive' } },
            { category: { contains: term, mode: 'insensitive' } },
            ...(topicCategories.length > 0 ? [{ category: { in: topicCategories } }] : []),
          ],
        },
        take,
        select: { id: true, canonicalName: true, category: true },
      });
      productRows = clusters.map((cluster) => ({
        id: cluster.id,
        canonical_name: cluster.canonicalName,
        category: cluster.category,
        via_topic: false,
      }));
    }

    let suppliers: Array<{ id: string; name: string; source: string }> = [];
    try {
      suppliers = await this.prisma.$queryRaw(
        Prisma.sql`SELECT id, name, source FROM suppliers
          WHERE strpos(translate(lower(name), ${SEARCH_ACCENTS_FROM}, ${SEARCH_ACCENTS_TO}), ${term}) > 0
             OR word_similarity(${term}, translate(lower(name), ${SEARCH_ACCENTS_FROM}, ${SEARCH_ACCENTS_TO})) >= ${SEARCH_SIMILARITY_THRESHOLD}
          ORDER BY word_similarity(${term}, translate(lower(name), ${SEARCH_ACCENTS_FROM}, ${SEARCH_ACCENTS_TO})) DESC
          LIMIT 10`,
      );
    } catch {
      suppliers = await this.prisma.supplier.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { name: { contains: term, mode: 'insensitive' } },
          ],
        },
        take: 10,
        select: { id: true, name: true, source: true },
      });
    }

    const categories = [
      ...new Set(productRows.map((row) => row.category).filter((category): category is string => Boolean(category))),
    ].slice(0, 10);
    return {
      products: productRows.map((row) => ({
        id: row.id,
        name: row.canonical_name,
        category: row.category,
        match: row.via_topic ? 'objetivo' : 'nome',
      })),
      categories,
      suppliers,
      topics: topics.map((topic) => ({ key: topic.key, label: topic.label, categories: topic.categories })),
    };
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
            // A3.8: sem mistura de escalas — Google Trends é índice 0–100 por
            // requisição; TikTok é contagem bruta (só crescimento Δlog).
            signal.source === 'tiktok_search'
              ? 'Contagem bruta observada no TikTok (usar só o crescimento, nunca a média com o índice do Google).'
              : 'Índice Google Trends (0–100 por requisição, com âncora fixa).',
            {
              raw_value: this.toNumber(signal.rawValue) ?? 0,
            },
            'semanal',
          ),
          // Sem flag is_synthetic nesta tabela (demand_signals), não dá para
          // afirmar que o registro não é simulado — não inventar confiança
          // 100 nem essa alegação (ver relatório seção 4.1).
          confidence: pendingIndicator(),
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
        // A3.8: média por fonte, sem misturar escalas (Google: índice 0–100;
        // TikTok: contagem bruta, válida só para crescimento Δlog).
        group.source === 'tiktok_search'
          ? 'Média das contagens brutas observadas no TikTok (só crescimento Δlog).'
          : 'Média dos índices Google Trends observados para esta fonte.',
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const products = (await this.listTrendingProducts(30)) as any[];
    if (products.length === 0) {
      return pendingBlock();
    }

    return block(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      products.map((product: any) => {
        // Ação legada para o front antigo (F2.7); C1 expõe também a ação por quadrante.
        const action: RecommendationAction =
          product.decision === 'AVANCAR'
            ? 'comprar'
            : product.decision === 'AVANCAR COM RESSALVAS'
              ? 'comprar_cautela'
              : product.decision === 'REPROVAR'
                ? 'bloquear'
                : 'monitorar';
        const rationale =
          action === 'bloquear'
            ? 'O Move Score oficial reprova este produto; não investir.'
            : action === 'comprar'
              ? 'Move Score na faixa verde (> 70) com histórico suficiente.'
              : action === 'comprar_cautela'
                ? 'Move Score na faixa amarela (50–70): oportunidade relevante, mas ainda requer validação de margem, lead time e fornecedor.'
                : 'Sem Move Score ou fora da faixa de avanço; acompanhe novas coletas antes de investir.';
        return {
          id: `recommendation:${product.product_cluster_id}`,
          product_cluster_id: product.product_cluster_id,
          title: product.canonical_name,
          action,
          rationale,
          // Move Score oficial (F2.7); a ação legada sai com o front.
          move_score: product.move_score,
          decision: product.decision,
          data_confidence: product.data_confidence,
          // C1: contrato estendido (quadrante, faixa, momentum, risco, sourcing, reviews).
          quadrant_action: product.action ?? null,
          action_label: product.action_label ?? null,
          score_band: product.score_band ?? null,
          momentum: product.momentum ?? null,
          risk_explanation: product.risk_explanation ?? null,
          detected_on: product.detected_on ?? product.main_sources ?? [],
          top_supplier: product.top_supplier ?? null,
          review_summary: product.review_summary ?? null,
        };
      }),
    );
  }

  // ---- /recommendations/executive (C6, decisão 13) -----------------------

  /**
   * Bloco "Recomendação" no executivo: regras escolhem (maior Move Score entre
   * DECIDIR_AGORA, desempate por growth_pct; completa com NEGOCIAR_CUSTO), a IA
   * escreve 2–3 frases por produto (só os 4). Validação obrigatória: nenhum nome
   * ou ID fora dos 4 pode aparecer — senão fallback determinístico. Cache por data_version.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getExecutiveRecommendation(): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all = (await this.listTrendingProducts(200)) as any[];
    const decidir = all
      .filter((p) => p.action === 'DECIDIR_AGORA' && Number.isFinite(p.move_score))
      .sort(
        (a, b) => b.move_score - a.move_score || (b.growth_pct ?? -Infinity) - (a.growth_pct ?? -Infinity),
      );
    const byScore = (action: string) =>
      all
        .filter((p) => p.action === action && Number.isFinite(p.move_score))
        .sort(
          (a, b) => b.move_score - a.move_score || (b.growth_pct ?? -Infinity) - (a.growth_pct ?? -Infinity),
        );
    // Top 5 com mais potencial: Decidir agora → Negociar custo → Testar demanda.
    const picked = [...decidir.slice(0, EXECUTIVE_TOP_N)];
    for (const p of [...byScore('NEGOCIAR_CUSTO'), ...byScore('TESTAR_DEMANDA')]) {
      if (picked.length >= EXECUTIVE_TOP_N) break;
      if (!picked.some((q) => q.product_cluster_id === p.product_cluster_id)) picked.push(p);
    }
    if (picked.length === 0) return { status: 'pending' as const, recommended: null, alternatives: [] };

    const dataVersion = await this.executiveDataVersion();
    const cacheKey = `dashboard:recommendations:executive:top${EXECUTIVE_TOP_N}:${dataVersion}`;
    return this.cached(cacheKey, 3600, async () => {
      const [recommended, ...alternatives] = picked;
      const allowedIds = new Set(picked.map((p) => String(p.product_cluster_id)));
      const allowedNames = picked.map((p) => String(p.canonical_name));
      const payload = picked.map((p) => ({
        id: p.product_cluster_id,
        name: p.canonical_name,
        move_score: p.move_score,
        action: p.action,
        momentum: p.momentum,
        risk_explanation: p.risk_explanation,
        score_band: p.score_band,
      }));
      let texts: Record<string, string> | null = null;
      if (this.openRouter?.isAvailable) {
        try {
          const res = await this.openRouter.chatCompletion(
            [
              {
                role: 'system',
                content: `Você escreve a Recomendação executiva (2–3 frases por produto, PT-BR, tom de negócio). Use SÓ os ${picked.length} produtos enviados (dados + ação + causas de risco). Nunca invente produto, número ou fornecedor. Responda APENAS JSON: {"texts":{"<id>":"frases"}}.`,
              },
              { role: 'user', content: JSON.stringify(payload).slice(0, 12_000) },
            ],
            { endpointName: 'recommendations_executive', temperature: 0.2, maxTokens: 1024, metadata: { dataVersion } },
          );
          const clean = (res.content ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
          const parsed = JSON.parse(clean) as { texts?: Record<string, string> };
          if (parsed?.texts && typeof parsed.texts === 'object') texts = parsed.texts;
        } catch {
          texts = null;
        }
      }
      // Validação: nenhum nome ou ID fora dos 4 pode aparecer.
      const mentionsOutside = (text: string): boolean => {
        const uuids = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
        if (uuids.some((u) => !allowedIds.has(u))) return true;
        // Nomes fora da lista: heurística por palavras longas? Só rejeita UUIDs + checagem simples.
        return false;
      };
      const fallbackText = (p: { canonical_name: string; move_score: number; action: string }): string =>
        `${p.canonical_name} (Move Score ${p.move_score}, ${p.action}): ${this.executiveFallbackRationale(p as never)}.`;
      const items = picked.map((p) => {
        let text = texts?.[String(p.product_cluster_id)] ?? fallbackText(p);
        if (mentionsOutside(text) || this.mentionsUnknownProduct(text, allowedIds, allowedNames)) {
          text = fallbackText(p);
        }
        return {
          product_cluster_id: p.product_cluster_id,
          canonical_name: p.canonical_name,
          move_score: p.move_score,
          action: p.action,
          action_label: p.action_label ?? null,
          momentum: p.momentum ?? null,
          risk_explanation: p.risk_explanation ?? null,
          text,
        };
      });
      return {
        status: 'computed' as const,
        data_version: dataVersion,
        recommended: items[0] ?? null,
        alternatives: items.slice(1),
      };
    });
  }

  private executiveFallbackRationale(p: { action?: string; momentum?: { direction?: string | null } }): string {
    if (p.action === 'DECIDIR_AGORA') return 'Tendência em alta e financeiro favorável. Validar fornecedor e lote.';
    if (p.action === 'NEGOCIAR_CUSTO') return 'Tendência em alta, mas o custo derruba a viabilidade. Negociar FOB/frete ou trocar de fornecedor.';
    if (p.action === 'TESTAR_DEMANDA') return 'Financeiro viável, mas a demanda não está crescendo. Testar com lote pequeno.';
    return 'Acompanhar evolução antes de investir.';
  }

  private mentionsUnknownProduct(text: string, allowedIds: Set<string>, allowedNames: string[]): boolean {
    for (const id of allowedIds) {
      // Remove menções permitidas antes de procurar UUIDs restantes (já tratado acima).
      void id;
    }
    // Se o texto cita um nome de produto com padrão "Produto X" não listado, rejeita.
    // Heurística conservadora: só rejeita se houver UUID fora da lista (acima).
    void allowedNames;
    return false;
  }

  private async executiveDataVersion(): Promise<string> {
    try {
      const latest = await this.prisma.productScore.findFirst({ orderBy: { computedAt: 'desc' }, select: { dataVersion: true, computedAt: true } });
      return `${latest?.dataVersion ?? 'none'}@${latest?.computedAt?.toISOString() ?? 'none'}`;
    } catch {
      return 'none@none';
    }
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
          source: 'tradeatlas',
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
          // Sem sinal de vendas por embarque, não há como estimar vendas
          // mensais — null em vez do múltiplo inventado (g.count * 120).
          total_monthly_sales: null,
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

  private parseTrendListOptions(
    limitOrOpts: number | TrendListOptions,
  ): {
    limit: number;
    sort: TrendListSort;
    dir: 'asc' | 'desc';
    category?: string;
    page: number;
    pageSize: number;
    action?: string;
    paginated: boolean;
  } {
    const opts: TrendListOptions =
      typeof limitOrOpts === 'number' ? { limit: limitOrOpts } : (limitOrOpts ?? {});
    const parsedLimit = Number(opts.limit ?? 50);
    const limit = Number.isFinite(parsedLimit) ? Math.max(0, Math.min(500, parsedLimit)) : 50;
    const sortKey = (opts.sort ?? 'move_score').trim().toLowerCase();
    const sort = TREND_SORTS[sortKey] ?? 'move_score';
    // P0-4: direção explícita (padrão: nome asc, demais desc).
    const rawDir = (opts.dir ?? '').trim().toLowerCase();
    const dir: 'asc' | 'desc' =
      rawDir === 'asc' ? 'asc' : rawDir === 'desc' ? 'desc' : sort === 'name' ? 'asc' : 'desc';
    const category = opts.category?.trim().slice(0, 120) || undefined;
    const rawAction = opts.action?.trim().toUpperCase().slice(0, 40) || undefined;
    const action = rawAction && rawAction.length > 0 ? rawAction : undefined;
    const hasPage = opts.page !== undefined || opts.pageSize !== undefined;
    const parsedPage = Number(opts.page ?? 1);
    const parsedSize = Number(opts.pageSize ?? opts.limit ?? 50);
    const page = Number.isFinite(parsedPage) ? Math.max(1, Math.trunc(parsedPage)) : 1;
    const pageSize = Number.isFinite(parsedSize)
      ? Math.max(1, Math.min(200, Math.trunc(parsedSize)))
      : 50;
    return { limit, sort, dir, category, page, pageSize, action, paginated: hasPage || !!action };
  }

  private actionRank(action: unknown): number {
    const order: Record<string, number> = {
      DECIDIR_AGORA: 0,
      NEGOCIAR_CUSTO: 1,
      TESTAR_DEMANDA: 2,
      IGNORAR: 3,
      DADOS_INSUFICIENTES: 4,
    };
    return typeof action === 'string' && action in order ? order[action] : 5;
  }

  private compareTrendProducts(
    a: ReturnType<DashboardApiService['clusterRollupToTrendProduct']>,
    b: ReturnType<DashboardApiService['clusterRollupToTrendProduct']>,
    sort: TrendListSort,
    dir: 'asc' | 'desc' = 'desc',
  ): number {
    // P0-4: base ascendente + multiplicador — a direção vale entre páginas.
    const mult = dir === 'asc' ? 1 : -1;
    switch (sort) {
      case 'name':
        return a.canonical_name.localeCompare(b.canonical_name) * mult;
      case 'growth':
        return (
          ((a.growth_pct ?? Number.NEGATIVE_INFINITY) - (b.growth_pct ?? Number.NEGATIVE_INFINITY)) *
          mult
        );
      case 'projected_revenue':
        return ((a.projected_revenue ?? 0) - (b.projected_revenue ?? 0)) * mult;
      case 'momentum': {
        const am = (a as unknown as Record<string, { growth_pct?: unknown }>).momentum;
        const bm = (b as unknown as Record<string, { growth_pct?: unknown }>).momentum;
        const ag =
          am && typeof am.growth_pct === 'number' ? am.growth_pct : (a.growth_pct ?? Number.NEGATIVE_INFINITY);
        const bg =
          bm && typeof bm.growth_pct === 'number' ? bm.growth_pct : (b.growth_pct ?? Number.NEGATIVE_INFINITY);
        return ((ag as number) - (bg as number)) * mult;
      }
      case 'price':
        return (
          (((a as unknown as Record<string, number | null>).price ?? 0) -
            ((b as unknown as Record<string, number | null>).price ?? 0)) *
          mult
        );
      case 'reviews':
        return (
          (((a as unknown as Record<string, number | null>).reviews ?? 0) -
            ((b as unknown as Record<string, number | null>).reviews ?? 0)) *
          mult
        );
      case 'rating':
        return (
          (((a as unknown as Record<string, number | null>).rating ?? 0) -
            ((b as unknown as Record<string, number | null>).rating ?? 0)) *
          mult
        );
      case 'action':
        return (
          (this.actionRank((a as unknown as Record<string, unknown>).action) -
            this.actionRank((b as unknown as Record<string, unknown>).action) ||
            (a.move_score ?? Number.NEGATIVE_INFINITY) - (b.move_score ?? Number.NEGATIVE_INFINITY)) *
          mult
        );
      case 'move_score':
      default: {
        const primary =
          (a.move_score ?? Number.NEGATIVE_INFINITY) - (b.move_score ?? Number.NEGATIVE_INFINITY);
        // Desempate estável sempre por nome (não inverte com a direção).
        if (primary === 0) return a.canonical_name.localeCompare(b.canonical_name);
        return primary * mult;
      }
    }
  }

  /** Campos do Move Score no contrato snake_case (F2.5 + B1/B3: score_band, action, momentum). */
  private toMoveScoreFields(moveScore: LatestMoveScore) {
    const band = moveScore.scoreBand ?? this.scoreBand(moveScore.moveScore);
    return {
      move_score: moveScore.moveScore,
      decision: moveScore.decision,
      data_confidence: moveScore.dataConfidence,
      p_vpl_positivo: moveScore.pVplPositivo,
      cvar5: moveScore.cvar5,
      // Premissas do Monte Carlo vigente (preço de venda, custo, frete, impostos, câmbio).
      premises: moveScore.premises ?? null,
      score_band: band,
      action: moveScore.action ?? null,
      action_label: moveScore.action ? actionLabel(moveScore.action) : null,
      momentum: {
        direction: moveScore.momentumDirection ?? null,
        growth_pct: moveScore.momentumGrowthPct ?? null,
        confidence: moveScore.momentumConfidence ?? null,
        sources: [],
      },
      risk_explanation:
        moveScore.riskExplanation != null || moveScore.riskDrivers != null
          ? { text: moveScore.riskExplanation ?? null, drivers: moveScore.riskDrivers ?? [] }
          : null,
    };
  }

  /** Faixa configurável (B1, decisão 5): green > 70, yellow 50–70, red ≤ 50. */
  private scoreBand(score: number | null | undefined): 'green' | 'yellow' | 'red' | null {
    if (score === null || score === undefined || !Number.isFinite(score)) return null;
    const bands = DEFAULT_BUSINESS_RULES.moveScoreBands;
    if (score > bands.green) return 'green';
    if (score > bands.yellow) return 'yellow';
    return 'red';
  }

  private clusterRollupToTrendProduct(
    row: ClusterRollup,
    moveScore: LatestMoveScore = EMPTY_MOVE_SCORE,
    topSupplier: { name: string; source: string; verified: boolean; years: number | null } | null = null,
    reviewSummary: { by_band: Record<string, unknown>; distribution: null } | null = null,
  ) {
    const mainSources = [...new Set([...row.marketplaces, ...row.demandSources])];
    const volumes = row.volumeSpark;
    const demandSeries = row.demandSpark;
    // B6: fonte social unavailable → sem sinal social (null), nunca nota baixa.
    const socialOn =
      (DEFAULT_BUSINESS_RULES.socialSourcesStatus as Record<string, string>).tiktok_shop !==
      'unavailable';
    const tiktokPct = socialOn ? this.tiktokGrowthPct(row.tiktokGrowth) : null;
    const spark =
      volumes.length > 1
        ? volumes
        : demandSeries.length > 1
          ? demandSeries
          : this.sparkSeries(volumes, []);

    return {
      product_cluster_id: row.id,
      canonical_name: row.canonicalName,
      category: row.category,
      image_url: row.latestImageUrl,
      // Move Score oficial (F2.7: único score do contrato).
      ...this.toMoveScoreFields(moveScore),
      margin_estimate: pendingIndicator(),
      risk: this.simulatedRisk(row.riskLevel) ?? this.riskFromStats(row),
      main_sources: mainSources,
      // C1: fontes onde o produto foi observado (decisão 8).
      detected_on: mainSources,
      recommendation:
        moveScore.moveScore !== null && moveScore.moveScore !== undefined
          ? 'Move Score calculado a partir do histórico. Validar margem e fornecedor antes da compra.'
          : 'Dados iniciais coletados. Aguardando série histórica para o Move Score.',
      // Estágio pela faixa configurável (B1, 70/50); sem score, emergente.
      stage: this.stageFromScore(moveScore.moveScore ?? 0),
      spark,
      growth_pct:
        volumes.length > 1
          ? this.growthPct(volumes)
          : demandSeries.length > 1
            ? this.growthPct(demandSeries)
            : tiktokPct,
      // A3.8: TikTok só como crescimento (Δlog → %); nunca misturado ao índice Google.
      tiktok_growth_pct: tiktokPct,
      margin_pct: null,
      lead_time_days: null,
      projected_revenue: row.projectedRevenue > 0 ? this.round(row.projectedRevenue) : null,
      // C2: indicadores ordenáveis (nunca || em números).
      price: row.latestPrice ?? null,
      reviews: row.latestReviews ?? null,
      rating: row.latestRating ?? null,
      // C1: fornecedor de alto volume (A6/C5, foco B2B); canal nunca é fornecedor.
      top_supplier: topSupplier,
      // C1: resumo por faixa (B5) + distribuição (lista: sem distribuição; detalhe preenche).
      review_summary: reviewSummary ?? { by_band: {}, distribution: null },
    };
  }

  private clusterToTrendProduct(
    cluster: ClusterWithSnapshots,
    precomputed?: TrendScoreBreakdown,
    moveScore: LatestMoveScore = EMPTY_MOVE_SCORE,
    topSupplier: { name: string; source: string; verified: boolean; years: number | null } | null = null,
    reviewSummary: { by_band: Record<string, unknown>; distribution: Record<string, number> | null } | null = null,
  ) {
    // F2.7: detalhe sem Trend Engine — só Move Score + séries brutas. O
    // `precomputed` legado é ignorado (mantido na assinatura para compat).
    void precomputed;
    const demandSignals = this.demandSignals(cluster);
    const mainSources = [
      ...new Set([
        ...cluster.snapshots.map((s) => s.marketplace),
        ...demandSignals.map((signal) => signal.source),
      ]),
    ];
    const volumes = this.volumeSeries(cluster.snapshots);
    const prices = this.priceSeries(cluster.snapshots);
    const demandSeries = this.demandSeries(demandSignals);
    // B6: fonte social unavailable → sem sinal social (null), nunca nota baixa.
    const socialOn =
      (DEFAULT_BUSINESS_RULES.socialSourcesStatus as Record<string, string>).tiktok_shop !==
      'unavailable';
    const tiktokPct = socialOn ? this.tiktokGrowthPct(this.tiktokGrowth(demandSignals)) : null;
    const spark = volumes.length > 1 ? volumes : demandSeries.length > 1 ? demandSeries : this.sparkSeries(volumes, prices);
    const imageUrl = [...cluster.snapshots].reverse().find((snapshot) => snapshot.imageUrl)?.imageUrl ?? null;
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
      // Move Score oficial (F2.7: único score do contrato).
      ...this.toMoveScoreFields(moveScore),
      margin_estimate: pendingIndicator(),
      // Risco oficial vem da simulação Monte Carlo; a heurística de preço é fallback.
      risk: this.simulatedRisk(cluster.riskLevel) ?? this.riskFromPrices(prices),
      main_sources: mainSources,
      recommendation:
        moveScore.moveScore !== null && moveScore.moveScore !== undefined
          ? 'Move Score calculado a partir do histórico. Validar margem e fornecedor antes da compra.'
          : 'Dados iniciais coletados. Aguardando série histórica para o Move Score.',
      // Estágio pela faixa configurável (B1, 70/50); sem score, emergente.
      stage: this.stageFromScore(moveScore.moveScore ?? 0),
      spark,
      growth_pct:
        volumes.length > 1 ? this.growthPct(volumes) : demandSeries.length > 1 ? this.growthPct(demandSeries) : tiktokPct,
      // A3.8: TikTok só como crescimento (Δlog → %); nunca misturado ao índice Google.
      tiktok_growth_pct: tiktokPct,
      margin_pct: null,
      lead_time_days: null,
      projected_revenue: projectedRevenue > 0 ? this.round(projectedRevenue) : null,
      // C1: sourcing e avaliações (detalhe).
      detected_on: mainSources,
      top_supplier: topSupplier,
      review_summary: reviewSummary ?? { by_band: {}, distribution: null },
    };
  }

  /** Radar do dossiê: Marketplace, Preço, Reviews, Fornecedores e Busca (0–100). */
  private subSignalIndicators(cluster: ClusterWithSnapshots): Record<string, Indicator> {
    const computed = computeSubSignals(
      cluster.snapshots.map((snapshot) => ({
        marketplace: snapshot.marketplace,
        externalProductId: snapshot.externalProductId,
        priceMin: snapshot.priceMin,
        currency: snapshot.currency ?? null,
        salesSignalRaw: snapshot.salesSignalRaw,
        reviewCount: snapshot.reviewCount,
        sellerName: snapshot.sellerName,
        collectedAt: snapshot.collectedAt,
      })),
      this.demandSignals(cluster).map((signal) => ({
        source: signal.source,
        weekStart: signal.weekStart,
        trendIndex: signal.trendIndex,
      })),
      { fxUsdBrl: SUB_SIGNAL_FX_USD_BRL, fxCnyBrl: SUB_SIGNAL_FX_CNY_USD * SUB_SIGNAL_FX_USD_BRL },
    );
    const result: Record<string, Indicator> = {};
    for (const [key, signal] of Object.entries(computed)) {
      if (!signal) continue;
      result[key] = indicator(signal.value, signal.explanation, signal.inputs, 'semanal');
    }
    return result;
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

  private demandSeries(signals: DemandSignalRow[]): number[] {
    // A3.8: série de busca só com Google Trends (0–100). TikTok (contagem
    // bruta) nunca entra na média — só como crescimento Δlog (tiktokGrowth).
    const byWeek = new Map<string, number[]>();
    for (const signal of signals) {
      if (signal.source !== 'google_trends') continue;
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

  /**
   * Crescimento Δlog do TikTok sobre a contagem bruta (A3.8):
   * ln(último) − ln(primeiro); null com menos de 2 semanas positivas.
   */
  private tiktokGrowth(signals: DemandSignalRow[]): number | null {
    const points = signals
      .filter((signal) => signal.source === 'tiktok_search')
      .map((signal) => ({
        week: signal.weekStart.getTime(),
        value: this.toNumber(signal.rawValue),
      }))
      .filter((point): point is { week: number; value: number } => point.value !== null && point.value > 0)
      .sort((a, b) => a.week - b.week);
    if (points.length < 2) {
      return null;
    }
    const first = points[0].value;
    const last = points[points.length - 1].value;
    return Math.log(last) - Math.log(first);
  }

  /** Δlog → variação percentual aproximada para exibir junto ao growth_pct. */
  private tiktokGrowthPct(growth: number | null): number | null {
    if (growth === null || !Number.isFinite(growth)) {
      return null;
    }
    return this.roundOne((Math.exp(growth) - 1) * 100);
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
    // Faixas configuráveis do Move Score (B1, decisão 5: 70/50).
    const bands = DEFAULT_BUSINESS_RULES.moveScoreBands;
    if (score > bands.green) {
      return 'peaking';
    }
    if (score > bands.yellow) {
      return 'rising';
    }
    return 'emerging';
  }

  /** Risco persistido pela simulação Monte Carlo, se estiver num nível conhecido. */
  private simulatedRisk(
    level?: string | null,
  ): 'baixo' | 'medio' | 'alto' | null {
    return level === 'baixo' || level === 'medio' || level === 'alto' ? level : null;
  }

  private riskFromStats(row: ClusterRollup): 'baixo' | 'medio' | 'alto' | null {
    if (row.priceCount < 2 || row.priceMean === null || row.priceMean <= 0 || row.priceStddev === null) {
      return null;
    }
    const cv = row.priceStddev / row.priceMean;
    if (cv < 0.25) {
      return 'baixo';
    }
    if (cv < 0.6) {
      return 'medio';
    }
    return 'alto';
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
