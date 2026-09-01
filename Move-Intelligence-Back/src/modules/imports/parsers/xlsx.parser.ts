import { Workbook } from 'exceljs';
import { UnsupportedSourceError } from '../source-detector';

/**
 * Converte a 1ª aba de uma planilha .xlsx em um texto no MESMO formato que os
 * parsers de CSV já entendem, para reaproveitar toda a normalização/validação:
 *
 *   - Layout TradeAtlas (cabeçalho com ARRIVAL DATE / IMPORTER NAME) → CSV com
 *     uma linha de agrupamento sintética + cabeçalho + dados.
 *   - Layout Comex achatado (colunas coNcm, year, ...) → texto `list` +
 *     um dict Python por linha.
 *
 * Assim o `xlsx.parser` só transforma células → texto; a fonte de verdade da
 * normalização continua em `comex.parser`/`trade-atlas.parser`.
 */
export async function xlsxToText(buffer: Buffer): Promise<string> {
  const workbook = new Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new UnsupportedSourceError(
      'Planilha vazia (nenhuma aba encontrada).',
    );
  }

  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    // `row.values` é 1-indexado (posição 0 é vazia).
    const raw = row.values as unknown[];
    for (let i = 1; i < raw.length; i += 1) {
      values.push(cellToString(raw[i]));
    }
    rows.push(values);
  });

  if (rows.length === 0) {
    throw new UnsupportedSourceError('Planilha sem linhas.');
  }

  const upperHeaders = rows
    .slice(0, 2)
    .map((r) => r.join(',').toUpperCase())
    .join('\n');

  if (
    upperHeaders.includes('ARRIVAL DATE') &&
    upperHeaders.includes('IMPORTER NAME')
  ) {
    return buildTradeAtlasCsv(rows);
  }

  const headerRow = rows[0].map((c) => c.trim());
  if (headerRow.includes('coNcm') && headerRow.includes('year')) {
    return buildComexText(rows);
  }

  throw new UnsupportedSourceError(
    'Planilha não corresponde a um layout conhecido (Comex ou TradeAtlas).',
  );
}

/** Detecta se a 1ª linha é o cabeçalho real do TradeAtlas ou o agrupamento. */
function buildTradeAtlasCsv(rows: string[][]): string {
  const firstUpper = rows[0].join(',').toUpperCase();
  const hasRealHeaderFirst =
    firstUpper.includes('ARRIVAL DATE') && firstUpper.includes('IMPORTER NAME');

  // `parseTradeAtlas` pula a 1ª linha (agrupamento) e usa a 2ª como cabeçalho.
  // Se a planilha já começa pelo cabeçalho real, injeta um agrupamento sintético.
  const normalized = hasRealHeaderFirst
    ? [rows[0].map(() => ''), ...rows]
    : rows;

  return normalized.map(toCsvRow).join('\n');
}

function buildComexText(rows: string[][]): string {
  const header = rows[0].map((c) => c.trim());
  const dataRows = rows.slice(1);
  const lines = ['list'];
  for (const row of dataRows) {
    const entries: string[] = [];
    header.forEach((key, i) => {
      const value = (row[i] ?? '').toString().replace(/'/g, "\\'");
      if (value !== '') {
        entries.push(`'${key}': '${value}'`);
      }
    });
    lines.push(`{${entries.join(', ')}}`);
  }
  return lines.join('\n');
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    // TradeAtlas usa dd-mm-yyyy.
    const dd = String(value.getUTCDate()).padStart(2, '0');
    const mm = String(value.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = value.getUTCFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }
  if (typeof value === 'object') {
    const record = value as { text?: string; result?: unknown };
    if (typeof record.text === 'string') {
      return record.text;
    }
    if (record.result !== undefined) {
      return String(record.result);
    }
    return '';
  }
  return String(value);
}

function toCsvRow(cells: string[]): string {
  return cells.map((cell) => `"${(cell ?? '').replace(/"/g, '""')}"`).join(',');
}
