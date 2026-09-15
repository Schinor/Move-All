import { ImportSourceType } from '@prisma/client';
import {
  MarketplaceParseResult,
  ParsedMarketplaceListing,
  RowError,
} from './parser.types';
import {
  parseCsvRecords,
  parseIntSafe,
  parseJsonArray,
  parsePrice,
  parseSold,
} from './csv-utils';

/**
 * Parser do CSV TikTok Shop (Bright Data).
 *
 * Particularidades do formato:
 *   - JSON embutido (`store_details`, `images`) e quebras de linha internas
 *     em campos entre aspas — por isso usamos `parseCsvRecords` (csv-parse
 *     real) em vez de um split ingênuo por linha.
 *   - Arquivo real é "sujo": muitas linhas correspondem a produtos
 *     indisponíveis/removidos, sem `id` e sem `title`. Essas linhas são
 *     rejeitadas (RowError) — uma taxa alta de rejeição é esperada e correta.
 *   - `sold` é um sinal de vendas textual (ex.: "371", "1.2k", "10k+"),
 *     tratado por `parseSold`.
 *   - `seller_name` vem de dentro do JSON de `store_details` (campo `name`).
 *   - `prodct_rating` é o nome real da coluna no CSV de origem (com typo).
 */
export function parseTiktokShop(content: string): MarketplaceParseResult {
  const records = parseCsvRecords(content);

  const rows: ParsedMarketplaceListing[] = [];
  const errors: RowError[] = [];
  const seenIds = new Set<string>();

  records.forEach((record, i) => {
    // +2: linha 1 é o cabeçalho, o 1º registro de dados é a linha 2.
    const lineNo = i + 2;

    const externalProductId = (record.id ?? '').trim();
    const title = (record.title ?? '').trim();

    if (!externalProductId || !title) {
      errors.push({
        line: lineNo,
        reason: !externalProductId ? 'Registro sem id.' : 'Registro sem title.',
      });
      return;
    }

    if (seenIds.has(externalProductId)) {
      // Produto repetido no arquivo — mantém apenas a primeira ocorrência.
      return;
    }
    seenIds.add(externalProductId);

    const priceMin =
      parsePrice(record.final_price) ?? parsePrice(record.final_price_low);
    const priceMax =
      parsePrice(record.final_price_high) ??
      parsePrice(record.initial_price) ??
      priceMin;
    const currency = nonEmpty(record.currency);

    const rating = parsePrice(record.prodct_rating);
    const reviewCount = parseIntSafe(record.reviews_count);

    const salesSignalRaw = parseSold(record.sold);
    const salesSignalType = salesSignalRaw === null ? null : 'sales_count';

    const sellerId = nonEmpty(record.seller_id);
    const sellerName = extractStoreName(record.store_details);

    const category = nonEmpty(record.category);
    const imageCount = parseJsonArray(record.images).length;

    rows.push({
      // Fonte canônica com underscore (F1.8); imports antigos com hífen não
      // casam a chave natural e são reimportados uma vez.
      naturalKey: `tiktok_shop|${externalProductId}`,
      marketplace: 'tiktok_shop',
      externalProductId,
      title,
      priceMin,
      priceMax,
      currency,
      rating,
      reviewCount,
      salesSignalRaw,
      salesSignalType,
      sellerId,
      sellerName,
      stock: null,
      moq: null,
      brand: nonEmpty(record.brand),
      category,
      productUrl: nonEmpty(record.url),
      imageCount,
    });
  });

  return {
    sourceType: ImportSourceType.TIKTOK_SHOP,
    rows,
    sellers: [],
    errors,
    rowsTotal: records.length,
  };
}

/** Retorna o valor com trim, ou `null` quando vazio/ausente. */
function nonEmpty(value: string | undefined | null): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

/** Extrai `name` do JSON de `store_details`. `null` em falha ou ausência. */
function extractStoreName(value: string | undefined | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object') {
      const name = (parsed as { name?: unknown }).name;
      return typeof name === 'string' && name.trim() !== '' ? name.trim() : null;
    }
  } catch {
    return null;
  }
  return null;
}
