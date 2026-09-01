import { ImportSourceType } from '@prisma/client';
import { parseCsvHeader } from './parsers/csv-utils';
import { splitLines, stripBom } from './parsers/parse-utils';

/** Erro lançado quando o formato do arquivo não é reconhecido. */
export class UnsupportedSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedSourceError';
  }
}

/** Extensões de arquivo aceitas no upload. */
export const ALLOWED_EXTENSIONS = ['.csv', '.xlsx'] as const;

/** Retorna true quando o arquivo é (ou aparenta ser) uma planilha .xlsx. */
export function isXlsx(
  filename: string,
  mimeType: string | undefined,
  buffer: Buffer,
): boolean {
  if (filename.toLowerCase().endsWith('.xlsx')) {
    return true;
  }
  if (
    mimeType ===
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return true;
  }
  // .xlsx é um zip → assinatura "PK\x03\x04".
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  );
}

/**
 * Detecta o tipo de fonte a partir do conteúdo textual (CSV ou o texto já
 * derivado de uma planilha). Lança `UnsupportedSourceError` se não reconhecer.
 */
export function detectSourceType(rawContent: string): ImportSourceType {
  const content = stripBom(rawContent);
  const lines = splitLines(content).filter((l) => l.trim() !== '');
  const first = (lines[0] ?? '').trim();
  const second = (lines[1] ?? '').trim();

  // Comex: marcador `list` seguido de dicts por linha.
  if (first.toLowerCase() === 'list' && second.startsWith('{')) {
    return content.includes("'monthNumber'")
      ? ImportSourceType.COMEX_MENSAL
      : ImportSourceType.COMEX_ANUAL;
  }

  // TradeAtlas: cabeçalho (na 1ª ou 2ª linha) contém as colunas características.
  const headerCandidates = `${first}\n${second}`.toUpperCase();
  if (
    headerCandidates.includes('ARRIVAL DATE') &&
    headerCandidates.includes('IMPORTER NAME')
  ) {
    return ImportSourceType.TRADE_ATLAS;
  }

  // Fontes Bright Data: fingerprint das colunas do cabeçalho (linha única).
  const marketplace = detectMarketplaceSource(content);
  if (marketplace) {
    return marketplace;
  }

  throw new UnsupportedSourceError(
    'Formato de arquivo não reconhecido (esperado Comex, TradeAtlas, ' +
      'TikTok Shop, Shein, Google Shopping, Amazon Products, ' +
      'Amazon Sellers ou Alibaba).',
  );
}

/**
 * Fingerprints das fontes Bright Data, avaliados nesta ordem — as combinações
 * são escolhidas para não colidir entre si (ex.: Amazon Sellers antes de
 * Amazon Products; TikTok antes de Alibaba, pois compartilham `variant_id`).
 */
const MARKETPLACE_FINGERPRINTS: Array<{
  sourceType: ImportSourceType;
  /** Colunas que precisam existir simultaneamente. */
  all?: string[];
  /** Basta uma destas colunas existir. */
  any?: string[];
}> = [
  {
    sourceType: ImportSourceType.AMAZON_SELLERS,
    all: ['seller_id', 'feedbacks_percentages'],
  },
  {
    sourceType: ImportSourceType.AMAZON_PRODUCTS,
    all: ['asin', 'root_bs_rank'],
  },
  {
    sourceType: ImportSourceType.SHEIN,
    all: ['product_name', 'all_available_sizes'],
  },
  {
    sourceType: ImportSourceType.TIKTOK_SHOP,
    any: ['shop_performance_metrics', 'prodct_rating'],
  },
  {
    sourceType: ImportSourceType.GOOGLE_SHOPPING,
    all: ['amount_of_stars', 'buying_options'],
  },
  {
    sourceType: ImportSourceType.ALIBABA,
    all: ['item_id', 'variant_id', 'star_rating'],
  },
];

/**
 * Detecta uma fonte de marketplace pelas colunas do cabeçalho.
 * Retorna `null` quando nenhum fingerprint casa.
 */
function detectMarketplaceSource(content: string): ImportSourceType | null {
  const header = new Set(
    parseCsvHeader(content).map((column) => column.trim().toLowerCase()),
  );
  if (header.size === 0) {
    return null;
  }

  for (const fingerprint of MARKETPLACE_FINGERPRINTS) {
    const hasAll = (fingerprint.all ?? []).every((column) =>
      header.has(column),
    );
    const hasAny =
      fingerprint.any === undefined ||
      fingerprint.any.some((column) => header.has(column));
    if (hasAll && hasAny) {
      return fingerprint.sourceType;
    }
  }

  return null;
}
