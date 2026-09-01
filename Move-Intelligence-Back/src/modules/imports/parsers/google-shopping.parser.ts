import { ImportSourceType } from '@prisma/client';
import {
  MarketplaceParseResult,
  ParsedMarketplaceListing,
  RowError,
} from './parser.types';
import {
  leafCategory,
  parseCsvRecords,
  parseIntSafe,
  parseJsonArray,
  parsePrice,
} from './csv-utils';

/**
 * Parser do CSV Google Shopping (Bright Data).
 *
 * Particularidades do formato:
 *   - JSON embutido (ex.: `images`) e quebras de linha internas em campos
 *     entre aspas — por isso usamos `parseCsvRecords` (csv-parse real) em vez
 *     de um split ingênuo por linha.
 *   - Arquivo real é "sujo": muitas linhas sem `product_id` e/ou sem `title`
 *     utilizáveis. Essas linhas são rejeitadas (RowError) — uma taxa alta de
 *     rejeição é esperada e correta.
 *   - `product_category` (quando presente) vem no formato "A>B>C"; usamos o
 *     último segmento como categoria folha. Na ausência, caímos para
 *     `leafCategory(category_tree)` (JSON `[{ name, url }, ...]`).
 *   - `currency` costuma vir vazia; quando isso ocorre, inferimos 'USD' pela
 *     presença do símbolo "$" em `item_price`/`total_price`.
 */
export function parseGoogleShopping(content: string): MarketplaceParseResult {
  const records = parseCsvRecords(content);
  const rows: ParsedMarketplaceListing[] = [];
  const errors: RowError[] = [];
  const seenIds = new Set<string>();

  records.forEach((record, i) => {
    // +2: linha 1 é o cabeçalho, o 1º registro de dados é a linha 2.
    const lineNo = i + 2;

    const productId = (record.product_id ?? '').trim();
    const title = (record.title ?? '').trim();

    if (!productId || !title) {
      errors.push({
        line: lineNo,
        reason: !productId ? 'Linha sem product_id.' : 'Linha sem title.',
      });
      return;
    }

    if (seenIds.has(productId)) {
      return;
    }
    seenIds.add(productId);

    const itemPriceRaw = record.item_price ?? '';
    const totalPriceRaw = record.total_price ?? '';
    const priceMin = parsePrice(itemPriceRaw);
    const priceMax = parsePrice(totalPriceRaw) ?? priceMin;

    const currencyRaw = (record.currency ?? '').trim();
    const hadDollarSign = itemPriceRaw.includes('$') || totalPriceRaw.includes('$');
    const currency =
      currencyRaw !== '' ? currencyRaw : hadDollarSign ? 'USD' : null;

    const rating =
      parsePrice(record.rating) ?? parsePrice(record.amount_of_stars);
    const reviewCount = parseIntSafe(record.reviews_count);

    const sellerName = nonEmpty(record.seller_name) ?? nonEmpty(record.store_name);

    const category =
      leafFromCategoryPath(record.product_category) ??
      leafCategory(record.category_tree);

    const imageCount = parseJsonArray(record.images).length;

    rows.push({
      naturalKey: `google-shopping|${productId}`,
      marketplace: 'google-shopping',
      externalProductId: productId,
      title,
      priceMin,
      priceMax,
      currency,
      rating,
      reviewCount,
      salesSignalRaw: null,
      salesSignalType: null,
      sellerId: null,
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
    sourceType: ImportSourceType.GOOGLE_SHOPPING,
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

/** Extrai a folha de um `product_category` no formato "A>B>C". */
function leafFromCategoryPath(
  value: string | undefined | null,
): string | null {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') {
    return null;
  }
  const parts = trimmed
    .split('>')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  return parts.length > 0 ? parts[parts.length - 1] : null;
}
