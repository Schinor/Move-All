import { ImportSourceType } from '@prisma/client';
import { ComexParseResult, ParsedTradeExport, RowError } from './parser.types';
import { parseNumeric, splitLines, stripBom } from './parse-utils';

/**
 * Parser do formato Comex "dict-por-linha".
 *
 * Formato de origem (frágil — mantido isolado deliberadamente):
 *   - Linha 1: o marcador literal `list`.
 *   - Demais linhas: um dict Python serializado por linha, com aspas simples,
 *     ex.: {'coNcm': '95069900', 'year': '2025', 'ncm': '...', 'country': '...',
 *          'metricFOB': '3365332', 'metricKG': '320674'}
 *   - Variante mensal acrescenta 'monthNumber', 'state' e 'metricStatistic'.
 *
 * Estratégia: extração por chave via regex, tolerante a aspas simples OU duplas
 * no valor (o repr do Python alterna para aspas duplas quando o valor contém
 * apóstrofo, ex.: country "Côte d'Ivoire"). Linha malformada é rejeitada e
 * registrada em `errors` sem abortar o job.
 */

const REQUIRED_KEYS = ['coNcm', 'year', 'country', 'metricFOB', 'metricKG'];

const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

/**
 * Extrai o valor textual de uma chave num dict serializado.
 * Aceita valor entre aspas simples ou duplas; a captura não-gulosa combinada
 * com o lookahead `(?=,|})` permite apóstrofos internos em valores com aspas
 * simples (ex.: 'Côte d'Ivoire').
 */
function extractValue(line: string, key: string): string | undefined {
  const re = new RegExp(`'${key}'\\s*:\\s*(['"])(.*?)\\1\\s*(?=,|})`);
  const match = line.match(re);
  return match ? match[2] : undefined;
}

export function parseComex(rawContent: string): ComexParseResult {
  const content = stripBom(rawContent);
  const sourceType = content.includes("'monthNumber'")
    ? ImportSourceType.COMEX_MENSAL
    : ImportSourceType.COMEX_ANUAL;

  const rows: ParsedTradeExport[] = [];
  const errors: RowError[] = [];
  const seenKeys = new Set<string>();
  let rowsTotal = 0;

  const lines = splitLines(content);

  lines.forEach((rawLine, index) => {
    const lineNo = index + 1;
    const line = rawLine.trim();

    // Linhas vazias e o marcador `list` do cabeçalho são ignorados sem erro.
    if (line === '' || line === 'list') {
      return;
    }

    rowsTotal += 1;

    if (!line.startsWith('{') || !line.endsWith('}')) {
      errors.push({
        line: lineNo,
        reason: 'Linha não é um registro válido (não delimitada por { }).',
        raw: truncate(line),
      });
      return;
    }

    const coNcm = extractValue(line, 'coNcm');
    const yearRaw = extractValue(line, 'year');
    const country = extractValue(line, 'country');
    const metricFobRaw = extractValue(line, 'metricFOB');
    const metricKgRaw = extractValue(line, 'metricKG');

    const missing = REQUIRED_KEYS.filter((key) => !extractValue(line, key));
    if (missing.length > 0) {
      errors.push({
        line: lineNo,
        reason: `Colunas obrigatórias ausentes/ilegíveis: ${missing.join(', ')}.`,
        raw: truncate(line),
      });
      return;
    }

    const year = Number(yearRaw);
    if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
      errors.push({
        line: lineNo,
        reason: `Ano inválido: "${yearRaw ?? ''}".`,
        raw: truncate(line),
      });
      return;
    }

    let month: number | null = null;
    const monthRaw = extractValue(line, 'monthNumber');
    if (monthRaw !== undefined) {
      const parsedMonth = Number(monthRaw);
      if (
        !Number.isInteger(parsedMonth) ||
        parsedMonth < 1 ||
        parsedMonth > 12
      ) {
        errors.push({
          line: lineNo,
          reason: `Mês inválido: "${monthRaw}".`,
          raw: truncate(line),
        });
        return;
      }
      month = parsedMonth;
    }

    const fob = parseNumeric(metricFobRaw);
    const kg = parseNumeric(metricKgRaw);
    if (fob === null || fob < 0 || kg === null || kg < 0) {
      errors.push({
        line: lineNo,
        reason: `Valores numéricos inválidos (metricFOB="${metricFobRaw ?? ''}", metricKG="${metricKgRaw ?? ''}").`,
        raw: truncate(line),
      });
      return;
    }

    const state = extractValue(line, 'state')?.trim() || null;
    const ncmDescription = extractValue(line, 'ncm')?.trim() || null;
    const countryTrimmed = (country as string).trim();

    const naturalKey = [
      coNcm,
      year,
      month ?? '',
      countryTrimmed,
      state ?? '',
    ].join('|');

    // Deduplica dentro do próprio arquivo (a última ocorrência prevalece).
    if (seenKeys.has(naturalKey)) {
      const existingIndex = rows.findIndex((r) => r.naturalKey === naturalKey);
      if (existingIndex >= 0) {
        rows.splice(existingIndex, 1);
      }
    }
    seenKeys.add(naturalKey);

    rows.push({
      naturalKey,
      ncmCode: (coNcm as string).trim(),
      ncmDescription,
      year,
      month,
      country: countryTrimmed,
      state,
      fobUsd: fob.toFixed(2),
      netKg: kg.toFixed(2),
    });
  });

  return { sourceType, rows, errors, rowsTotal };
}

function truncate(value: string, max = 200): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
