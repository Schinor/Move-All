import { ImportSourceType } from '@prisma/client';
import {
  parseCsvRecords,
  parseIntSafe,
  parseJsonArray,
  parsePrice,
  parseSold,
} from './csv-utils';
import {
  MarketplaceParseResult,
  ParsedMarketplaceListing,
  RowError,
} from './parser.types';

/**
 * Parser do CSV Amazon Products (Bright Data).
 *
 * Particularidades do formato:
 *   - JSON embutido em colunas (ex.: `categories`) e quebras de linha dentro
 *     de campos entre aspas — o parse é feito via `parseCsvRecords`, nunca
 *     por split de linha.
 *   - `categories` é um array JSON de strings (não de objetos); a categoria
 *     folha é o último elemento não vazio.
 *   - `bought_past_month` vem como texto livre (ex.: "50+") — convertido via
 *     `parseSold`. Quando ausente (maioria das linhas), o `root_bs_rank` é
 *     usado como sinal de vendas alternativo (`best_seller_rank`).
 *   - Linhas sem `asin` ou sem `title` são rejeitadas (não há como formar a
 *     chave natural nem exibir o anúncio).
 *   - Deduplicação por `asin`, mantendo a primeira ocorrência.
 */
export function parseAmazonProducts(content: string): MarketplaceParseResult {
  const records = parseCsvRecords(content);

  const rows: ParsedMarketplaceListing[] = [];
  const errors: RowError[] = [];
  const seenAsins = new Set<string>();

  records.forEach((record, i) => {
    // +2: 1-based e primeira linha é o cabeçalho.
    const lineNo = i + 2;

    const asin = (record.asin ?? '').trim();
    const title = (record.title ?? '').trim();

    if (!asin || !title) {
      errors.push({
        line: lineNo,
        reason: !asin
          ? 'Registro sem ASIN.'
          : 'Registro sem título (title).',
      });
      return;
    }

    if (seenAsins.has(asin)) {
      return;
    }
    seenAsins.add(asin);

    const priceMin = parsePrice(record.final_price) ?? parsePrice(record.initial_price);
    const priceMax = parsePrice(record.final_price_high) ?? priceMin;

    // `bought_past_month` é o melhor sinal, mas vem preenchido em pouquíssimas
    // linhas (~0,6% da amostra de 1000). Quando falta, `root_bs_rank` (~30% de
    // preenchimento) entra como sinal alternativo — com semântica invertida
    // (rank menor = melhor), tratada em BusinessRulesService.normalizeSalesSignal.
    const boughtPastMonth = parseSold(record.bought_past_month);
    const bestSellerRank = parseIntSafe(record.root_bs_rank);
    const hasRank = bestSellerRank !== null && bestSellerRank > 0;
    const salesSignalRaw =
      boughtPastMonth ?? (hasRank ? bestSellerRank : null);
    let salesSignalType: string | null = null;
    if (boughtPastMonth !== null) {
      salesSignalType = 'sales_count';
    } else if (hasRank) {
      salesSignalType = 'best_seller_rank';
    }

    const categories = parseJsonArray(record.categories).filter(
      (c): c is string => typeof c === 'string' && c.trim() !== '',
    );
    const category = categories.length > 0 ? categories[categories.length - 1] : null;

    const listing: ParsedMarketplaceListing = {
      naturalKey: `amazon|${asin}`,
      marketplace: 'amazon',
      externalProductId: asin,
      title,
      priceMin,
      priceMax,
      currency: record.currency?.trim() || null,
      rating: parsePrice(record.rating),
      reviewCount: parseIntSafe(record.reviews_count),
      salesSignalRaw,
      salesSignalType,
      sellerId: record.seller_id?.trim() || null,
      sellerName: record.seller_name?.trim() || null,
      stock: null,
      moq: null,
      brand: record.brand?.trim() || null,
      category,
      productUrl: record.url?.trim() || null,
      imageCount: parseIntSafe(record.images_count),
    };

    rows.push(listing);
  });

  return {
    sourceType: ImportSourceType.AMAZON_PRODUCTS,
    rows,
    sellers: [],
    errors,
    rowsTotal: records.length,
  };
}
