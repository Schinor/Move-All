import { Prisma } from '@prisma/client';
import { COUNTED_ITEM_STATUSES } from '../../modules/catalog/catalog.constants';
import { PrismaService } from '../database/prisma.service';
import { syntheticSnapshotFilterSql } from '../synthetic-data/synthetic-data.filter';

/**
 * Teto de clusters carregados para ranqueamento. O ranking precisa varrer o
 * universo inteiro (senão o "top N" sai de uma amostra arbitrária), mas a query
 * não pode ser ilimitada. O volume previsto é de ~1k–6k clusters; o teto cobre
 * isso com folga e, combinado com `ORDER BY created_at, id`, torna o resultado
 * determinístico (e não uma página aleatória) caso a base cresça além dele.
 */
const MAX_RANKED_CLUSTERS = 20000;

export type ClusterRollupRow = {
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
  card_status: string | null;
  card_key_values: unknown;
  type_name: string | null;
  card_key_attrs: unknown;
  family_name: string | null;
  listing_count: unknown;
  store_count: unknown;
  brand_count: unknown;
  price_median_br: unknown;
  price_min_br: unknown;
  price_max_br: unknown;
};

/** Retorna as linhas cruas da consulta usada pelo ranking e pelo pré-cálculo dos cards. */
export async function queryCardRollupRows(
  prisma: PrismaService,
  category?: string,
): Promise<ClusterRollupRow[]> {
    const categoryFilter = category
      ? Prisma.sql`AND c.category = ${category}`
      : Prisma.empty;
    // Com INCLUDE_SYNTHETIC_DATA=false (default), exclui snapshots do
    // pipeline sintético de TODAS as CTEs que leem product_listing_snapshots
    // — senão o ranking mistura curva inventada com coleta real.
    const syntheticFilterNoAlias = syntheticSnapshotFilterSql();
    const syntheticFilterS = syntheticSnapshotFilterSql('s');

    const rows = await prisma.$queryRaw<ClusterRollupRow[]>(Prisma.sql`
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
            ARRAY_AGG(s.image_url ORDER BY s.collected_at DESC, s.id DESC)
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
      ),
      card_stats AS (
        SELECT
          i.cluster_id AS product_cluster_id,
          COUNT(*)::int AS listing_count,
          COUNT(DISTINCT i.marketplace)::int AS store_count,
          (COUNT(DISTINCT lf.brand) FILTER (WHERE lf.brand IS NOT NULL))::int AS brand_count
        FROM product_cluster_items i
        LEFT JOIN listing_fichas lf
          ON lf.marketplace = i.marketplace AND lf.external_product_id = i.external_product_id
        WHERE i.status IN (${Prisma.join(COUNTED_ITEM_STATUSES)})
        GROUP BY i.cluster_id
      ),
      br_price AS (
        SELECT
          latest.product_cluster_id,
          (percentile_cont(0.5) WITHIN GROUP (ORDER BY latest.price_min))::float8 AS price_median_br,
          MIN(latest.price_min)::float8 AS price_min_br,
          MAX(latest.price_min)::float8 AS price_max_br
        FROM (
          SELECT DISTINCT ON (s.product_cluster_id, s.marketplace, s.external_product_id)
            s.product_cluster_id, s.price_min
          FROM product_listing_snapshots s
          JOIN product_cluster_items i
            ON i.cluster_id = s.product_cluster_id
            AND i.marketplace = s.marketplace
            AND i.external_product_id = s.external_product_id
          WHERE s.product_cluster_id IS NOT NULL
            AND s.price_min > 0
            AND s.marketplace IN ('amazon_br', 'mercado_livre', 'mercadolivre', 'shopee_br')
            AND i.status IN (${Prisma.join(COUNTED_ITEM_STATUSES)})
            ${syntheticFilterS}
          ORDER BY s.product_cluster_id, s.marketplace, s.external_product_id, s.collected_at DESC
        ) latest
        GROUP BY latest.product_cluster_id
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
        w.sellers,
        c.card_status,
        c.card_key_values,
        t.name_pt AS type_name,
        t.card_key_attrs,
        f.name_pt AS family_name,
        cs.listing_count,
        cs.store_count,
        cs.brand_count,
        bp.price_median_br,
        bp.price_min_br,
        bp.price_max_br
      FROM product_clusters c
      JOIN bounds b ON b.product_cluster_id = c.id
      JOIN windowed w ON w.product_cluster_id = c.id
      JOIN latest_row lr ON lr.product_cluster_id = c.id
      JOIN first_row fr ON fr.product_cluster_id = c.id
      LEFT JOIN volume_spark vs ON vs.product_cluster_id = c.id
      LEFT JOIN demand_agg da ON da.product_cluster_id = c.id
      LEFT JOIN demand_spark dsp ON dsp.product_cluster_id = c.id
      LEFT JOIN tiktok_growth tg ON tg.product_cluster_id = c.id
      LEFT JOIN catalog_types t ON t.id = c.type_id
      LEFT JOIN catalog_families f ON f.id = t.family_id
      LEFT JOIN card_stats cs ON cs.product_cluster_id = c.id
      LEFT JOIN br_price bp ON bp.product_cluster_id = c.id
      WHERE 1 = 1
        ${categoryFilter}
        AND c.card_status <> 'merged'
      ORDER BY c.created_at ASC, c.id ASC
      LIMIT ${MAX_RANKED_CLUSTERS}
    `);

    return rows;
}
