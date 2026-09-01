import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { ImportSourceType } from '@prisma/client';
import {
  ParsedShipment,
  RowError,
  TradeAtlasParseResult,
} from './parser.types';
import {
  nullableTrim,
  parseDmyDate,
  parseItemNo,
  stripBom,
  toDecimalString,
} from './parse-utils';

/**
 * Parser dos CSVs de shipments da TradeAtlas.
 *
 * Particularidades do formato:
 *   - Duas linhas de cabeçalho: a 1ª agrupa colunas ("NO & DATE", "BUYER
 *     DETAILS", ...) e deve ser pulada; a 2ª tem os nomes reais das colunas.
 *   - Mapeamento é feito por NOME de coluna (robusto a reordenação), não por
 *     índice fixo.
 *   - Números podem vir com vírgula de milhar (ex.: "47,980.00").
 *   - Datas no formato dd-mm-yyyy.
 *   - HS CODE pode conter múltiplos códigos separados por "|" (preservados).
 *   - Chave natural: hash estável do conteúdo da linha (exceto a coluna
 *     sequencial "NO"). O par (DECLARATION NUMBER, ITEM NO) NÃO é confiável
 *     como chave nos dados reais — o arquivo traz declarações placeholder
 *     ("000001") e em branco, todas com item 0, que colidiriam e descartariam
 *     linhas distintas. O hash de conteúdo garante idempotência na
 *     reimportação (linhas idênticas colapsam) sem perder shipments distintos.
 */

const HEADERS = {
  no: 'NO',
  arrivalDate: 'ARRIVAL DATE',
  importerName: 'IMPORTER NAME',
  importerCountry: 'IMPORTER COUNTRY',
  exporterName: 'EXPORTER NAME',
  exporterCountry: 'EXPORTER COUNTRY',
  originCountry: 'COUNTRY OF ORIGIN',
  hsCode: 'HS CODE',
  productDetails: 'PRODUCT DETAILS',
  fobUsd: 'USD FOB',
  cifUsd: 'USD CIF',
  grossWeight: 'GROSS WEIGHT',
  netWeight: 'NET WEIGHT',
  quantity: 'QUANTITY',
  quantityUnit: 'QUANTITY UNIT',
  portOfArrival: 'PORT OF ARRIVAL',
  portOfDeparture: 'PORT OF DEPARTURE',
  itemNo: 'ITEM NO',
  declarationNumber: 'DECLARATION NUMBER',
} as const;

export function parseTradeAtlas(rawContent: string): TradeAtlasParseResult {
  const content = stripBom(rawContent);

  const records = parse(content, {
    relax_column_count: true,
    skip_empty_lines: true,
    relax_quotes: true,
  }) as string[][];

  const rows: ParsedShipment[] = [];
  const errors: RowError[] = [];

  if (records.length < 2) {
    return {
      sourceType: ImportSourceType.TRADE_ATLAS,
      rows,
      errors: [
        {
          line: 1,
          reason: 'Arquivo sem linhas de dados (cabeçalho incompleto).',
        },
      ],
      rowsTotal: 0,
    };
  }

  // records[0] = agrupamento (ignorado); records[1] = cabeçalho real.
  const header = records[1].map((h) => h.trim().toUpperCase());
  const indexOf = (name: string) => header.indexOf(name);
  const columnIndex: Record<string, number> = {};
  for (const [field, headerName] of Object.entries(HEADERS)) {
    columnIndex[field] = indexOf(headerName);
  }

  const dataRows = records.slice(2);
  let rowsTotal = 0;

  dataRows.forEach((row, i) => {
    // +3: 1 (BOM/1ª linha) offset humano — records[0] é linha 1, header linha 2,
    // logo o 1º dado é a linha 3 do arquivo.
    const lineNo = i + 3;

    const get = (field: keyof typeof HEADERS): string | undefined => {
      const idx = columnIndex[field];
      return idx >= 0 ? row[idx] : undefined;
    };

    const isEmptyRow = row.every((cell) => (cell ?? '').trim() === '');
    if (isEmptyRow) {
      return;
    }

    rowsTotal += 1;

    const declarationNumber = nullableTrim(get('declarationNumber'));
    const itemNo = parseItemNo(get('itemNo'));
    const arrivalDate = parseDmyDate(get('arrivalDate'));
    const importerName = nullableTrim(get('importerName'));
    const exporterName = nullableTrim(get('exporterName'));
    const hsCode = nullableTrim(get('hsCode'));

    // Linha sem nenhum campo identificável é considerada malformada.
    if (
      !declarationNumber &&
      !importerName &&
      !exporterName &&
      !hsCode &&
      !arrivalDate
    ) {
      errors.push({
        line: lineNo,
        reason: 'Linha sem campos identificáveis (declaração/importador/HS).',
      });
      return;
    }

    const numericFields: Array<[string, string | null]> = [
      ['USD FOB', toDecimalString(get('fobUsd'))],
      ['USD CIF', toDecimalString(get('cifUsd'))],
      ['GROSS WEIGHT', toDecimalString(get('grossWeight'))],
      ['NET WEIGHT', toDecimalString(get('netWeight'))],
      ['QUANTITY', toDecimalString(get('quantity'))],
    ];
    const negative = numericFields.find(
      ([, value]) => value !== null && Number(value) < 0,
    );
    if (negative) {
      errors.push({
        line: lineNo,
        reason: `Valor numérico negativo em ${negative[0]}.`,
      });
      return;
    }

    const [fobUsd, cifUsd, grossWeightKg, netWeightKg, quantity] =
      numericFields.map(([, value]) => value);

    const shipment: ParsedShipment = {
      naturalKey: buildNaturalKey(row, columnIndex.no),
      arrivalDate,
      importerName,
      importerCountry: nullableTrim(get('importerCountry')),
      exporterName,
      exporterCountry: nullableTrim(get('exporterCountry')),
      originCountry: nullableTrim(get('originCountry')),
      hsCode,
      productDetails: nullableTrim(get('productDetails')),
      fobUsd,
      cifUsd,
      grossWeightKg,
      netWeightKg,
      quantity,
      quantityUnit: nullableTrim(get('quantityUnit')),
      portOfArrival: nullableTrim(get('portOfArrival')),
      portOfDeparture: nullableTrim(get('portOfDeparture')),
      declarationNumber,
      itemNo,
    };

    rows.push(shipment);
  });

  return {
    sourceType: ImportSourceType.TRADE_ATLAS,
    rows,
    errors,
    rowsTotal,
  };
}

/**
 * Chave natural estável = hash do conteúdo da linha, ignorando a coluna
 * sequencial "NO" (que muda entre exports do mesmo shipment). Linhas idênticas
 * produzem a mesma chave (idempotência); qualquer diferença de conteúdo gera
 * uma chave distinta.
 */
function buildNaturalKey(row: string[], noIndex: number): string {
  const canonical = row
    .map((cell, i) => (i === noIndex ? '' : (cell ?? '').trim()))
    .join('|');
  return `sha1:${createHash('sha1').update(canonical).digest('hex')}`;
}
