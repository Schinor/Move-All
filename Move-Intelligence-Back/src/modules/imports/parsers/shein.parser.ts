import { ImportSourceType } from '@prisma/client';
import {
  ParsedMarketplaceListing,
  MarketplaceParseResult,
  RowError,
} from './parser.types';
import {
  leafCategory,
  parseCsvRecords,
  parseIntSafe,
  parsePrice,
} from './csv-utils';

/**
 * Parser do CSV Shein (Bright Data).
 *
 * Particularidades do formato:
 *   - Campos com JSON embutido (`category_tree`, `store_details`, ...) e
 *     quebras de linha internas — usamos `parseCsvRecords` (nunca split por
 *     linha) para não quebrar registros no meio.
 *   - `store_details` é um objeto JSON (não array) com o nome da loja em
 *     `name`; a maioria das linhas traz o campo vazio.
 *   - `in_stock` vem como texto booleano ("true"/"false"), sem indicar
 *     quantidade — não inventamos `stock` numérico a partir dele.
 *   - `category` já vem como categoria folha; quando ausente, caímos para
 *     `category_tree` (JSON de nós com `name`).
 */
export function parseShein(content: string): MarketplaceParseResult {
  const records = parseCsvRecords(content);

  const rows: ParsedMarketplaceListing[] = [];
  const errors: RowError[] = [];
  const seenIds = new Set<string>();

  records.forEach((record, i) => {
    // +2: 1 (índice 0-based → 1-based) + 1 (linha de cabeçalho).
    const lineNo = i + 2;

    const productId = (record.product_id ?? '').trim();
    const title = (record.product_name ?? '').trim();

    if (!productId || !title) {
      errors.push({
        line: lineNo,
        reason: !productId
          ? 'Registro sem product_id.'
          : 'Registro sem product_name.',
      });
      return;
    }

    if (seenIds.has(productId)) {
      // Linha duplicada do mesmo produto — mantém apenas a primeira ocorrência.
      return;
    }
    seenIds.add(productId);

    const priceMin =
      parsePrice(record.final_price) ??
      parsePrice(record.final_price_usd) ??
      parsePrice(record.initial_price);
    const priceMax = parsePrice(record.initial_price) ?? priceMin;

    const category =
      nullableTrim(record.category) ?? leafCategory(record.category_tree);

    const listing: ParsedMarketplaceListing = {
      naturalKey: `shein|${productId}`,
      marketplace: 'shein',
      externalProductId: productId,
      title,
      priceMin,
      priceMax,
      currency: nullableTrim(record.currency),
      rating: parsePrice(record.rating),
      reviewCount: parseIntSafe(record.reviews_count),
      salesSignalRaw: null,
      salesSignalType: null,
      sellerId: null,
      sellerName: extractStoreName(record.store_details),
      stock: null,
      moq: null,
      brand: nullableTrim(record.brand),
      category,
      productUrl: nullableTrim(record.url),
      imageCount: parseIntSafe(record.image_count),
    };

    rows.push(listing);
  });

  return {
    sourceType: ImportSourceType.SHEIN,
    rows,
    sellers: [],
    errors,
    rowsTotal: records.length,
  };
}

/**
 * Extrai o nome da loja de `store_details` — objeto JSON no formato
 * `{ "code": "...", "name": "...", "followers": ..., "items": ... }`.
 * Retorna `null` em falha ou quando o campo `name` está vazio/ausente.
 */
function extractStoreName(value: string | undefined | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const name = (parsed as { name?: unknown }).name;
    if (typeof name === 'string' && name.trim() !== '') {
      return name.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/** Trima e retorna `null` para strings vazias/ausentes. */
function nullableTrim(value: string | undefined | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
