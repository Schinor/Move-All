import { ImportSourceType } from '@prisma/client';
import { parseCsvRecords, parseIntSafe, parseJsonArray } from './csv-utils';
import { MarketplaceParseResult, ParsedMarketplaceSeller, RowError } from './parser.types';

/**
 * Parser do CSV Amazon Sellers Info (Bright Data).
 *
 * Particularidades do formato:
 *   - JSON embutido em `detailed_info` (lista de `{ title, value }`), usado
 *     como fallback de `business_name` quando a coluna vem vazia.
 *   - `stars` traz texto livre e multi-idioma (ex.: "4 out of 5 stars",
 *     "4.5 de 5 estrellas", "4/5 yıldız") — extraímos apenas o número inicial.
 *   - `rating_positive` traz percentual como texto (ex.: "83%").
 *   - Não há linha de anúncio aqui: cada registro é um SELLER, não um
 *     produto — `rows` fica vazio e o resultado vai em `sellers`.
 */
export function parseAmazonSellers(content: string): MarketplaceParseResult {
  const records = parseCsvRecords(content);

  const sellers: ParsedMarketplaceSeller[] = [];
  const errors: RowError[] = [];
  const seen = new Set<string>();
  let rowsTotal = 0;

  records.forEach((record, i) => {
    // +2: registros começam após a linha de cabeçalho (linha 1).
    const lineNo = i + 2;

    const isEmptyRow = Object.values(record).every(
      (value) => (value ?? '').trim() === '',
    );
    if (isEmptyRow) {
      return;
    }

    rowsTotal += 1;

    const externalSellerId = (record.seller_id ?? '').trim();
    if (!externalSellerId) {
      errors.push({
        line: lineNo,
        reason: 'Registro sem seller_id.',
      });
      return;
    }

    if (seen.has(externalSellerId)) {
      return;
    }
    seen.add(externalSellerId);

    sellers.push({
      marketplace: 'amazon',
      externalSellerId,
      name: nullableTrim(record.seller_name),
      businessName: resolveBusinessName(record.business_name, record.detailed_info),
      country: nullableTrim(record.country),
      rating: parseStars(record.stars),
      ratingCount:
        parseIntSafe(record.rating_count_lifetime) ?? parseIntSafe(record.rating_count),
      positivePct: parsePercent(record.rating_positive),
      productsCount: parseIntSafe(record.products_count),
      sellerUrl: nullableTrim(record.url),
    });
  });

  return {
    sourceType: ImportSourceType.AMAZON_SELLERS,
    rows: [],
    sellers,
    errors,
    rowsTotal,
  };
}

/** Aparada de string, convertendo vazio em `null`. */
function nullableTrim(value: string | undefined | null): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Resolve `businessName`: usa a coluna direta quando preenchida; senão
 * procura o item com título "Business Name" dentro do JSON de `detailed_info`.
 */
function resolveBusinessName(
  businessName: string | undefined,
  detailedInfoJson: string | undefined,
): string | null {
  const direct = nullableTrim(businessName);
  if (direct) {
    return direct;
  }

  const items = parseJsonArray(detailedInfoJson);
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const title = (item as { title?: unknown }).title;
    const value = (item as { value?: unknown }).value;
    if (typeof title === 'string' && title.trim() === 'Business Name') {
      return nullableTrim(typeof value === 'string' ? value : null);
    }
  }
  return null;
}

/**
 * Extrai o número inicial de `stars` (ex.: "4 out of 5 stars" → 4,
 * "4.5 de 5 estrellas" → 4.5). Retorna `null` quando o campo está vazio ou
 * não começa com um número reconhecível.
 */
function parseStars(value: string | undefined): number | null {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') {
    return null;
  }
  const match = trimmed.match(/^(\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/** Converte um percentual textual (ex.: "83%") em número. `null` se inválido. */
function parsePercent(value: string | undefined): number | null {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') {
    return null;
  }
  const cleaned = trimmed.replace('%', '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
