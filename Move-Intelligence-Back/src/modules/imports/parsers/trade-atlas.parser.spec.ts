import { ImportSourceType } from '@prisma/client';
import { parseTradeAtlas } from './trade-atlas.parser';

const GROUPING =
  '"NO & DATE","","BUYER DETAILS","SELLER DETAILS","PRODUCT DETAILS","PRICE","QUANTITY","OTHER"';

const HEADER =
  '"NO","ARRIVAL DATE","IMPORTER NAME","IMPORTER COUNTRY","EXPORTER NAME","EXPORTER COUNTRY","COUNTRY OF ORIGIN","HS CODE","PRODUCT DETAILS","USD FOB","USD CIF","GROSS WEIGHT","NET WEIGHT","QUANTITY","QUANTITY UNIT","PORT OF ARRIVAL","PORT OF DEPARTURE","ITEM NO","DECLARATION NUMBER"';

function row(cells: string[]): string {
  return cells.map((c) => `"${c}"`).join(',');
}

describe('parseTradeAtlas', () => {
  it('skips the grouping header row and maps by the second header row', () => {
    const content = [
      GROUPING,
      HEADER,
      row([
        '1',
        '16-07-2022',
        'IFIT, INC.',
        'United States',
        'ZHEJIANG EVERBRIGHT',
        'China',
        'China',
        '950691',
        'EXERCISE EQUIPMENT',
        '0.00',
        '0.00',
        '47,980.00',
        '392.00',
        '0.00',
        'Kilogram',
        '2709, LONG BEACH, CA',
        '57020, CN, NINGPO',
        '8.0',
        '578059',
      ]),
    ].join('\n');

    const result = parseTradeAtlas(content);

    expect(result.sourceType).toBe(ImportSourceType.TRADE_ATLAS);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    const s = result.rows[0];
    expect(s.importerName).toBe('IFIT, INC.'); // vírgula interna preservada
    expect(s.importerCountry).toBe('United States');
    expect(s.grossWeightKg).toBe('47980.00'); // separador de milhar removido
    expect(s.netWeightKg).toBe('392.00');
    expect(s.itemNo).toBe(8);
    expect(s.declarationNumber).toBe('578059');
    expect(s.naturalKey).toMatch(/^sha1:[0-9a-f]{40}$/);
    expect(s.arrivalDate?.toISOString().slice(0, 10)).toBe('2022-07-16');
  });

  it('preserves pipe-separated HS codes', () => {
    const content = [
      GROUPING,
      HEADER,
      row([
        '2',
        '21-10-2022',
        'LIFE WEAR',
        'United States',
        'CAPITAL SPORTS',
        'Pakistan',
        'Pakistan',
        '950691|870210|870510',
        'GYM ITEMS',
        '0.00',
        '0.00',
        '12,754.00',
        '7,500.00',
        '0.00',
        'Pieces',
        '5201, MIAMI, FL',
        '53551, PK',
        '2.0',
        '000001',
      ]),
    ].join('\n');

    const result = parseTradeAtlas(content);

    expect(result.rows[0].hsCode).toBe('950691|870210|870510');
    expect(result.rows[0].naturalKey).toMatch(/^sha1:[0-9a-f]{40}$/);
  });

  it('keeps distinct shipments that share a placeholder declaration number', () => {
    // Reproduz o caso real: mesma declaração "000001"/item 0, mas importadores
    // diferentes → devem ser tratados como shipments distintos (chaves distintas).
    const mk = (importer: string) =>
      row([
        '1',
        '01-01-2023',
        importer,
        'Brazil',
        'EXP',
        'China',
        'China',
        '950691',
        'X',
        '0.00',
        '0.00',
        '1.00',
        '1.00',
        '0.00',
        'Pieces',
        'A',
        'B',
        '0.0',
        '000001',
      ]);
    const content = [GROUPING, HEADER, mk('IMPORTER A'), mk('IMPORTER B')].join(
      '\n',
    );

    const result = parseTradeAtlas(content);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].naturalKey).not.toBe(result.rows[1].naturalKey);
  });

  it('produces a stable key across reimports of an identical row', () => {
    const base = [
      '3',
      '01-01-2023',
      'IMPORTER X',
      'Brazil',
      'EXPORTER Y',
      'China',
      'China',
      '950691',
      'DETAILS',
      '10.00',
      '12.00',
      '5.00',
      '4.00',
      '1.00',
      'Pieces',
      'PORT A',
      'PORT B',
      '', // ITEM NO vazio
      '', // DECLARATION NUMBER vazio
    ];
    const content = [GROUPING, HEADER, row(base)].join('\n');

    const first = parseTradeAtlas(content);
    const second = parseTradeAtlas(content);

    expect(first.rows[0].naturalKey).toMatch(/^sha1:[0-9a-f]{40}$/);
    // idempotente: mesma entrada → mesma chave
    expect(first.rows[0].naturalKey).toBe(second.rows[0].naturalKey);
  });

  it('skips fully empty rows', () => {
    const content = [
      GROUPING,
      HEADER,
      row([
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ]),
    ].join('\n');

    const result = parseTradeAtlas(content);

    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.rowsTotal).toBe(0);
  });

  it('strips BOM before parsing', () => {
    const content =
      '﻿' +
      [
        GROUPING,
        HEADER,
        row([
          '1',
          '16-07-2022',
          'IFIT',
          'United States',
          'EXP',
          'China',
          'China',
          '950691',
          'X',
          '0.00',
          '0.00',
          '1.00',
          '1.00',
          '0.00',
          'Kilogram',
          'A',
          'B',
          '1.0',
          '999',
        ]),
      ].join('\n');

    const result = parseTradeAtlas(content);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].naturalKey).toMatch(/^sha1:[0-9a-f]{40}$/);
    expect(result.rows[0].declarationNumber).toBe('999');
  });
});
