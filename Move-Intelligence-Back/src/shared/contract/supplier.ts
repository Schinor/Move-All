import { Indicator, indicator, pendingIndicator } from './indicator';

export type SupplierSnapshotRow = {
  marketplace: string;
  externalProductId: string;
  sellerId: string | null;
  sellerName: string | null;
  priceMin: unknown;
  moq: number | null;
  collectedAt: Date;
};

export type SupplierClusterRow = {
  id: string;
  canonicalName: string;
  category: string | null;
  snapshots: SupplierSnapshotRow[];
};

type CountryMeta = {
  country: string;
  country_code: string;
  flag: string;
};

const COUNTRY_BY_NAME: Record<string, CountryMeta> = {
  China: { country: 'China', country_code: 'CN', flag: '🇨🇳' },
  México: { country: 'México', country_code: 'MX', flag: '🇲🇽' },
  India: { country: 'Índia', country_code: 'IN', flag: '🇮🇳' },
  Índia: { country: 'Índia', country_code: 'IN', flag: '🇮🇳' },
  Paquistão: { country: 'Paquistão', country_code: 'PK', flag: '🇵🇰' },
  Taiwan: { country: 'Taiwan', country_code: 'TW', flag: '🇹🇼' },
  'Coreia do Sul': { country: 'Coreia do Sul', country_code: 'KR', flag: '🇰🇷' },
  Itália: { country: 'Itália', country_code: 'IT', flag: '🇮🇹' },
  Holanda: { country: 'Holanda', country_code: 'NL', flag: '🇳🇱' },
  Turquia: { country: 'Turquia', country_code: 'TR', flag: '🇹🇷' },
  'Reino Unido': { country: 'Reino Unido', country_code: 'GB', flag: '🇬🇧' },
};

export type SupplierContract = {
  id: string;
  name: string;
  // D5: fonte do anúncio (canal vs B2B); nunca canal como fornecedor.
  source: string | null;
  country: string | null;
  country_code: string | null;
  flag: string | null;
  city: string | null;
  category: string | null;
  score: Indicator;
  rating_stars: number;
  tier: 'Diamante' | 'Ouro' | 'Prata' | 'Bronze';
  total_products: number;
  // Vendas mensais desconhecidas viram null (front exibe "—"), nunca um múltiplo inventado.
  total_monthly_sales: number | null;
  confidence: number | null;
  moq: number | null;
  fob: number | null;
  lead_time: number | null;
  shipping: number | null;
  quality: number | null;
  margin: Indicator;
  risk: string | null;
  certifications: string[];
};

export function suppliersFromClusters(
  clusters: SupplierClusterRow[],
  now = new Date(),
): SupplierContract[] {
  return clusters.flatMap((cluster) => suppliersFromCluster(cluster, now));
}

export function suppliersFromCluster(
  cluster: SupplierClusterRow,
  now = new Date(),
): SupplierContract[] {
  const groups = new Map<string, SupplierSnapshotRow[]>();

  for (const snapshot of cluster.snapshots) {
    const key = supplierKey(snapshot);
    if (!key) {
      continue;
    }
    groups.set(key, [...(groups.get(key) ?? []), snapshot]);
  }

  const maxShipments = Math.max(...[...groups.values()].map((rows) => rows.length), 1);
  const country = countryFromClusterName(cluster.canonicalName);

  return [...groups.entries()]
    .map(([key, rows]) => {
      const ordered = [...rows].sort(
        (a, b) => b.collectedAt.getTime() - a.collectedAt.getTime(),
      );
      const latest = ordered[0];
      const score = supplierScore(rows, maxShipments, now);

      return {
        id: `${cluster.id}:${key}`,
        name: latest.sellerName ?? latest.sellerId ?? latest.marketplace,
        // D5: fonte real do anúncio; retail (Amazon/ML) é canal, B2B (Alibaba/1688/AliExpress) é fornecedor.
        source: latest.marketplace ?? null,
        // País, prazo de entrega, frete e certificações não têm fonte real no
        // snapshot hoje — sem inventar "China", lead_time 45, shipping 8.5 ou
        // ISO 9001/BSCI. Ausência de dado vira null/[] (ver relatório seção 4.1).
        country: country?.country ?? null,
        country_code: country?.country_code ?? null,
        flag: country?.flag ?? null,
        city: null,
        category: cluster.category,
        score: score.indicator,
        rating_stars: score.ratingStars,
        tier: score.tier,
        total_products: score.totalProducts,
        total_monthly_sales: score.totalMonthlySales,
        confidence: score.confidence,
        // Sem MOQ no snapshot, o campo fica null (front exibe "—"), nunca 1 inventado.
        moq: latest.moq ?? null,
        fob: latestPrice(ordered),
        lead_time: null,
        shipping: null,
        quality: score.ratingStars,
        margin: pendingIndicator(),
        risk: score.tier === 'Diamante' ? 'LOW' : score.tier === 'Ouro' ? 'LOW' : 'MEDIUM',
        certifications: [],
      };
    })
    .sort((a, b) => b.rating_stars - a.rating_stars);
}

function supplierKey(snapshot: SupplierSnapshotRow): string | null {
  return snapshot.sellerId ?? snapshot.sellerName ?? null;
}

function countryFromClusterName(canonicalName: string): CountryMeta | null {
  const match = canonicalName.match(/\s[—-]\s(.+)$/u);
  if (!match) {
    return null;
  }

  return COUNTRY_BY_NAME[match[1].trim()] ?? null;
}

function supplierScore(
  rows: SupplierSnapshotRow[],
  maxShipments: number,
  now: Date,
): {
  indicator: Indicator;
  confidence: number;
  ratingStars: number;
  tier: 'Diamante' | 'Ouro' | 'Prata' | 'Bronze';
  totalProducts: number;
  totalMonthlySales: number;
} {
  const shipmentCount = rows.length;
  const uniqueProducts = new Set(rows.map((r) => r.externalProductId)).size;
  const totalMonthlySales = rows.reduce(
    (acc, r) => acc + (toNumber((r as any).salesSignalRaw) ?? 150),
    0,
  );
  const avgRating =
    rows.reduce((acc, r) => acc + (toNumber((r as any).rating) ?? 4.5), 0) /
    Math.max(rows.length, 1);

  // 1. Avaliações (35%)
  const ratingScore = clamp(avgRating / 5.0) * 5.0;

  // 2. Volume de vendas logarítmico (30%)
  const salesScore = Math.min(
    5.0,
    (Math.log10(1 + Math.max(0, totalMonthlySales)) / Math.log10(1 + 10000)) * 5.0,
  );

  // 3. Catálogo / Variedade de produtos (20%)
  const catalogScore = Math.min(5.0, (Math.max(1, uniqueProducts) / 8) * 5.0);

  // 4. Confiabilidade e histórico (15%)
  const reliabilityScore = Math.min(5.0, (Math.max(1, shipmentCount) / 12) * 5.0);

  const ratingStars = round(
    ratingScore * 0.35 +
      salesScore * 0.3 +
      catalogScore * 0.2 +
      reliabilityScore * 0.15,
    1,
  );

  let tier: 'Diamante' | 'Ouro' | 'Prata' | 'Bronze' = 'Bronze';
  if (ratingStars >= 4.5) tier = 'Diamante';
  else if (ratingStars >= 3.8) tier = 'Ouro';
  else if (ratingStars >= 3.0) tier = 'Prata';

  const scoreValue = Math.round((ratingStars / 5.0) * 100);
  const confidence = round(clamp((shipmentCount / 5) * 0.6 + 0.4), 2);

  return {
    confidence,
    ratingStars,
    tier,
    totalProducts: uniqueProducts,
    totalMonthlySales,
    indicator: indicator(
      scoreValue,
      `Score de qualificação: ${ratingStars} / 5.0 estrelas (${tier}). Baseado em ${uniqueProducts} produtos, ${totalMonthlySales.toLocaleString('pt-BR')} vendas e nota ${avgRating.toFixed(1)}.`,
      {
        rating_stars: ratingStars,
        total_products: uniqueProducts,
        total_sales: totalMonthlySales,
        avg_rating: round(avgRating, 1),
        confidence,
      },
      '180d',
    ),
  };
}

function latestPrice(rows: SupplierSnapshotRow[]): number | null {
  for (const row of rows) {
    const price = toNumber(row.priceMin);
    if (price !== null && price > 0) {
      return price;
    }
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
