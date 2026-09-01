import { parse } from 'csv-parse/sync';
import { stripBom } from './parse-utils';

/**
 * Utilidades de leitura dos CSVs Bright Data (marketplaces).
 *
 * Estes arquivos têm JSON embutido em várias colunas e quebras de linha dentro
 * dos campos entre aspas — `splitLines` não serve. Aqui centralizamos o parse
 * real de CSV e as normalizações reaproveitadas pelos parsers de cada fonte.
 */

/** Opções de leitura de CSV aceitas por `parseCsvRecords`. */
export interface CsvParseOptions {
  /** Remove espaços em volta de cada campo (padrão: true). */
  trim?: boolean;
}

/**
 * Lê o conteúdo CSV em registros indexados pelo cabeçalho.
 * Tolerante a BOM, linhas vazias e linhas com número de colunas divergente.
 */
export function parseCsvRecords(
  content: string,
  options: CsvParseOptions = {},
): Record<string, string>[] {
  const records = parse(stripBom(content), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    relax_quotes: true,
    trim: options.trim ?? true,
  }) as Record<string, string>[];
  return records;
}

/**
 * Lê apenas o cabeçalho (primeira linha lógica) do CSV. Retorna `[]` quando o
 * conteúdo não é um CSV legível — usado pelo detector de fonte.
 */
export function parseCsvHeader(content: string): string[] {
  try {
    const rows = parse(stripBom(content), {
      to_line: 1,
      skip_empty_lines: true,
      bom: true,
      relax_column_count: true,
      relax_quotes: true,
      trim: true,
    }) as string[][];
    return rows[0] ?? [];
  } catch {
    return [];
  }
}

/**
 * Converte um preço textual em número, removendo símbolo de moeda, espaços e
 * separadores de milhar. Ex.: "US$ 3.80" → 3.8, "R$ 1.234,56" → 1234.56,
 * "47,980" → 47980. Retorna `null` quando não há número reconhecível.
 */
export function parsePrice(value: string | undefined | null): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  // Mantém apenas dígitos, separadores e o sinal negativo.
  let cleaned = String(value)
    .replace(/[^\d,.-]/g, '')
    .trim();
  if (cleaned === '' || cleaned === '-') {
    return null;
  }

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma >= 0 && lastDot >= 0) {
    // Ambos presentes: o último separador é o decimal.
    if (lastComma > lastDot) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (lastComma >= 0) {
    const decimals = cleaned.length - lastComma - 1;
    // "1,234" → milhar; "3,80" → decimal.
    cleaned =
      decimals === 3 && /^\d{1,3}(,\d{3})+$/.test(cleaned)
        ? cleaned.replace(/,/g, '')
        : cleaned.replace(',', '.');
  } else if (lastDot >= 0) {
    // "1.234.567" (múltiplos pontos) → milhar; "3.80" → decimal.
    if ((cleaned.match(/\./g) ?? []).length > 1) {
      cleaned = cleaned.replace(/\./g, '');
    }
  }

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Converte um texto em inteiro (trunca), tolerando separadores. `null` se inválido. */
export function parseIntSafe(value: string | undefined | null): number | null {
  const n = parsePrice(value);
  return n === null ? null : Math.trunc(n);
}

/**
 * Lê uma coluna que contém um array JSON. Retorna `[]` em qualquer falha
 * (campo vazio, JSON inválido ou JSON que não é array).
 */
export function parseJsonArray(value: string | undefined | null): unknown[] {
  if (!value) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Extrai a categoria folha de um `category_tree` — array JSON no formato
 * `[{ "name": "...", "url": "..." }, ...]`. Retorna `null` em falha ou quando
 * o último elemento não tem `name`.
 */
export function leafCategory(
  categoryTreeJson: string | undefined | null,
): string | null {
  const items = parseJsonArray(categoryTreeJson);
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (typeof item === 'string' && item.trim() !== '') {
      return item.trim();
    }
    if (item && typeof item === 'object') {
      const name = (item as { name?: unknown }).name;
      if (typeof name === 'string' && name.trim() !== '') {
        return name.trim();
      }
    }
  }
  return null;
}

/** Multiplicadores dos sufixos de magnitude aceitos em `parseSold`. */
const SOLD_SUFFIXES: Array<[RegExp, number]> = [
  [/\b(?:bi|bilh(?:ão|oes|ões)|b)\b|b$/i, 1_000_000_000],
  [/\b(?:mi|milh(?:ão|oes|ões)|m)\b|m$/i, 1_000_000],
  [/\b(?:mil|k)\b|k$/i, 1_000],
];

/**
 * Converte um sinal de vendas textual em número.
 * Ex.: "1.2k" → 1200, "10K+" → 10000, "5,3 mil" → 5300, "1,234 sold" → 1234.
 * Retorna `null` quando não há número reconhecível.
 */
export function parseSold(value: string | undefined | null): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  const raw = String(value).trim();
  if (raw === '') {
    return null;
  }

  // Isola o primeiro número (com separadores) e o que vem logo depois dele.
  const match = raw.match(/(-?[\d.,]*\d)\s*([^\d]*)$/);
  if (!match) {
    return null;
  }
  const [, numberPart, tail = ''] = match;

  let multiplier = 1;
  for (const [pattern, factor] of SOLD_SUFFIXES) {
    if (pattern.test(tail.trim())) {
      multiplier = factor;
      break;
    }
  }

  // Com multiplicador, "1.2" e "5,3" são sempre decimais (não milhar).
  const base =
    multiplier > 1
      ? Number(numberPart.replace(',', '.'))
      : parsePrice(numberPart);
  if (base === null || !Number.isFinite(base)) {
    return null;
  }
  return Math.round(base * multiplier);
}
