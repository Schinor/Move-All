/**
 * Fontes canônicas de marketplace (F1.8). Um único enum para backend e ETL
 * (espelho em `Move-Intelligence-Dados/app/etl/sources.py`): sem variantes
 * `mercadolivre` / `tiktok-shop` / `google-shopping` fora dos aliases abaixo.
 */
export const CANONICAL_SOURCES = [
  'amazon',
  'amazon_br',
  'mercado_livre',
  'shopee_br',
  'tiktok_shop',
  'google_shopping',
  'shein',
  'alibaba',
  '1688',
  'taobao',
  // A4: fonte de sourcing/custo (nunca preço de venda BR).
  'aliexpress',
] as const;

export type CanonicalSource = (typeof CANONICAL_SOURCES)[number];

/** Aliases históricos normalizados para a forma canônica. */
const SOURCE_ALIASES: Record<string, CanonicalSource> = {
  mercadolivre: 'mercado_livre',
  'mercado livre': 'mercado_livre',
  'tiktok-shop': 'tiktok_shop',
  tiktokshop: 'tiktok_shop',
  'google-shopping': 'google_shopping',
  googleshopping: 'google_shopping',
  'google shopping': 'google_shopping',
  shopee: 'shopee_br',
  amazonbr: 'amazon_br',
  'amazon br': 'amazon_br',
};

/**
 * Normaliza qualquer escrita de fonte para a canônica (ou minúsculas quando
 * desconhecida, ex.: conectores legados como `tradeatlas`).
 */
export function normalizeSourceKey(value: unknown): string {
  const lower = String(value ?? '').toLowerCase().trim();
  if (!lower) return lower;
  const alias = SOURCE_ALIASES[lower];
  if (alias) return alias;
  if (lower.includes('1688')) return '1688';
  return lower;
}

/** Verdadeiro quando a fonte já está na forma canônica. */
export function isCanonicalSource(value: unknown): value is CanonicalSource {
  return (CANONICAL_SOURCES as readonly string[]).includes(
    String(value ?? '').toLowerCase().trim(),
  );
}
