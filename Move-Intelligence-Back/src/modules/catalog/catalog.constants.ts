export const FICHA_PROMPT_VERSION = 'ficha-v1';
export const FICHA_ENDPOINT_NAME = 'catalog-ficha';
export const PRIORITY = { REPROCESS: 10, DISCOVERY: 100, REVIEW_MERGE: 200 } as const;
export const MAX_FICHA_ATTEMPTS = 3;
export const UNKNOWN_TYPE = 'unknown';
export const MISSING_VALUE = '?';
export const NONE_VALUE = 'nenhum';
export const DIFFERENTIAL_ATTR = 'diferencial';
/** Lojas brasileiras: preço de venda BR (mediana/faixa do card). */
export const BR_MARKETPLACES = ['amazon_br', 'mercado_livre', 'mercadolivre', 'shopee_br'] as const;
export const ACTIVE_CARD_STATUSES = ['provisional', 'confirmed'] as const;
/** Status de item que entra em score, métricas e confirmação do card. */
export const COUNTED_ITEM_STATUSES = ['confirmed', 'auto'] as const;

export interface FichaConfig {
  enabled: boolean;
  cron: string;
  dailyCallLimit: number;
  batchSize: number;
  maxTokens: number;
  timeoutMs: number;
  model: string | undefined;
}

export interface AutoAssignConfig {
  enabled: boolean;
  minSimilarity: number;
  minMargin: number;
  diffMinListings: number;
  diffMinMarketplaces: number;
  maxRequeues: number;
}

function intEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function floatEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function fichaConfig(env: NodeJS.ProcessEnv = process.env): FichaConfig {
  return {
    enabled: env.FICHA_ENABLED === 'true',
    cron: env.FICHA_CRON || '*/30 * * * *',
    dailyCallLimit: intEnv(env.FICHA_DAILY_CALL_LIMIT, 35, 0, 100_000),
    batchSize: intEnv(env.FICHA_BATCH_SIZE, 20, 1, 60),
    maxTokens: intEnv(env.FICHA_MAX_TOKENS, 20_000, 1_000, 32_768),
    timeoutMs: intEnv(env.FICHA_TIMEOUT_MS, 120_000, 10_000, 600_000),
    model: env.FICHA_MODEL?.trim() || undefined,
  };
}

export function autoAssignConfig(env: NodeJS.ProcessEnv = process.env): AutoAssignConfig {
  return {
    enabled: env.CATALOG_AUTO_ASSIGN_ENABLED !== 'false',
    minSimilarity: floatEnv(env.CATALOG_AUTO_MIN_SIMILARITY, 0.35, 0, 1),
    minMargin: floatEnv(env.CATALOG_AUTO_MIN_MARGIN, 0.10, 0, 1),
    diffMinListings: intEnv(env.CATALOG_AUTO_DIFF_MIN_LISTINGS, 3, 1, 100_000),
    diffMinMarketplaces: intEnv(env.CATALOG_AUTO_DIFF_MIN_MARKETPLACES, 2, 1, 100_000),
    maxRequeues: intEnv(env.CATALOG_AUTO_MAX_REQUEUES, 2, 0, 100_000),
  };
}
