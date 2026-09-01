import { ImportSourceType } from '@prisma/client';
import {
  ParsedMarketplaceListing,
  MarketplaceParseResult,
  RowError,
} from './parser.types';
import {
  leafCategory,
  parseCsvRecords,
  parseJsonArray,
  parsePrice,
} from './csv-utils';

/**
 * Parser do CSV Alibaba (Bright Data).
 *
 * Particularidades do formato:
 *   - Campos com JSON embutido (`category_tree`, `additional_image_urls`, ...)
 *     e quebras de linha internas — usamos `parseCsvRecords` (nunca split por
 *     linha) para não quebrar registros no meio.
 *   - O arquivo traz múltiplas linhas por `item_id` (variantes do mesmo
 *     produto) — deduplicamos mantendo a primeira ocorrência.
 *   - `product_category` vem no formato "A>B>C"; a categoria folha é o último
 *     segmento. Quando ausente, cai para `category_tree` (JSON de nós com
 *     `name`).
 */
export function parseAlibaba(content: string): MarketplaceParseResult {
  const records = parseCsvRecords(content);

  const rows: ParsedMarketplaceListing[] = [];
  const errors: RowError[] = [];
  const seenIds = new Set<string>();

  records.forEach((record, i) => {
    // +2: 1 (índice 0-based → 1-based) + 1 (linha de cabeçalho).
    const lineNo = i + 2;

    const itemId = (record.item_id ?? '').trim();
    const title = (record.title ?? '').trim();

    if (!itemId || !title) {
      errors.push({
        line: lineNo,
        reason: !itemId ? 'Registro sem item_id.' : 'Registro sem title.',
      });
      return;
    }

    if (seenIds.has(itemId)) {
      // Linha de variante do mesmo item — mantém apenas a primeira ocorrência.
      return;
    }
    seenIds.add(itemId);

    const priceRaw = record.price ?? '';
    const priceMin = parsePrice(priceRaw);
    const priceMax = parsePrice(record.sale_price) ?? priceMin;
    const currency = priceRaw.includes('$') ? 'USD' : null;

    const rating = parsePrice(record.star_rating);
    const reviewCount = parsePrice(record.review_count);
    const reviewCountInt =
      reviewCount === null ? null : Math.trunc(reviewCount);

    const category =
      leafFromProductCategory(record.product_category) ??
      leafCategory(record.category_tree);

    // A imagem principal (`image_url`) só conta quando realmente existe.
    const hasMainImage = (record.image_url ?? '').trim() !== '';
    const imageCount =
      (hasMainImage ? 1 : 0) +
      parseJsonArray(record.additional_image_urls).length;

    const listing: ParsedMarketplaceListing = {
      naturalKey: `alibaba|${itemId}`,
      marketplace: 'alibaba',
      externalProductId: itemId,
      title,
      priceMin,
      priceMax,
      currency,
      rating,
      reviewCount: reviewCountInt,
      salesSignalRaw: null,
      salesSignalType: null,
      sellerId: null,
      sellerName: nullableTrim(record.store_name),
      stock: null,
      moq: null,
      brand: nullableTrim(record.brand),
      category,
      productUrl: nullableTrim(record.url),
      imageCount,
    };

    rows.push(listing);
  });

  return {
    sourceType: ImportSourceType.ALIBABA,
    rows,
    sellers: [],
    errors,
    rowsTotal: records.length,
  };
}

/** Extrai o último segmento de "A>B>C" (formato de `product_category`). */
function leafFromProductCategory(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const parts = value
    .split('>')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (parts.length === 0) {
    return null;
  }
  return parts[parts.length - 1];
}

/** Trima e retorna `null` para strings vazias/ausentes. */
function nullableTrim(value: string | undefined | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
