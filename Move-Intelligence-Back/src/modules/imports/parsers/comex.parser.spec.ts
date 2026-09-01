import { ImportSourceType } from '@prisma/client';
import { parseComex } from './comex.parser';

const BOM = '﻿';

describe('parseComex', () => {
  it('parses the annual (macro) format', () => {
    const content =
      BOM +
      'list\n' +
      "{'coNcm': '95069900', 'year': '2025', 'ncm': 'Artigos e equipamentos para outros esportes e piscinas', 'country': 'Estados Unidos', 'metricFOB': '3365332', 'metricKG': '320674'}\n" +
      "{'coNcm': '95069900', 'year': '2025', 'ncm': 'Artigos', 'country': 'Paraguai', 'metricFOB': '2318582', 'metricKG': '420768'}\n";

    const result = parseComex(content);

    expect(result.sourceType).toBe(ImportSourceType.COMEX_ANUAL);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      ncmCode: '95069900',
      year: 2025,
      month: null,
      state: null,
      country: 'Estados Unidos',
      fobUsd: '3365332.00',
      netKg: '320674.00',
    });
    expect(result.rows[0].naturalKey).toBe('95069900|2025||Estados Unidos|');
  });

  it('parses the monthly (detailed) format with month and state', () => {
    const content =
      BOM +
      'list\n' +
      "{'coNcm': '95069100', 'year': '2026', 'monthNumber': '03', 'ncm': 'Artigos e equipamentos para cultura física', 'country': 'Colômbia', 'state': 'São Paulo', 'metricFOB': '242499', 'metricKG': '41796', 'metricStatistic': '41796'}\n";

    const result = parseComex(content);

    expect(result.sourceType).toBe(ImportSourceType.COMEX_MENSAL);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      ncmCode: '95069100',
      year: 2026,
      month: 3,
      state: 'São Paulo',
      country: 'Colômbia',
    });
    expect(result.rows[0].naturalKey).toBe(
      '95069100|2026|3|Colômbia|São Paulo',
    );
  });

  it('handles apostrophes in country names (single-quoted value)', () => {
    const content =
      'list\n' +
      "{'coNcm': '95069900', 'year': '2024', 'ncm': 'x', 'country': 'Côte d'Ivoire', 'metricFOB': '100', 'metricKG': '50'}\n";

    const result = parseComex(content);

    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].country).toBe("Côte d'Ivoire");
  });

  it('handles apostrophes in country names (double-quoted value, Python repr style)', () => {
    const content =
      'list\n' +
      "{'coNcm': '95069900', 'year': '2024', 'ncm': 'x', 'country': \"Côte d'Ivoire\", 'metricFOB': '100', 'metricKG': '50'}\n";

    const result = parseComex(content);

    expect(result.errors).toHaveLength(0);
    expect(result.rows[0].country).toBe("Côte d'Ivoire");
  });

  it('rejects a malformed line without aborting the rest', () => {
    const content =
      'list\n' +
      "{'coNcm': '95069900', 'year': '2025', 'ncm': 'x', 'country': 'Brasil', 'metricFOB': '10', 'metricKG': '5'}\n" +
      'linha corrompida sem chaves\n' +
      "{'coNcm': '95069900', 'year': '2025', 'ncm': 'x', 'country': 'China', 'metricFOB': '20', 'metricKG': '8'}\n";

    const result = parseComex(content);

    expect(result.rows).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(3);
  });

  it('rejects a line missing required columns', () => {
    const content =
      'list\n' +
      "{'coNcm': '95069900', 'year': '2025', 'ncm': 'x', 'metricFOB': '10', 'metricKG': '5'}\n";

    const result = parseComex(content);

    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toContain('country');
  });

  it('rejects negative or invalid numeric values', () => {
    const content =
      'list\n' +
      "{'coNcm': '95069900', 'year': '2025', 'ncm': 'x', 'country': 'Brasil', 'metricFOB': '-10', 'metricKG': '5'}\n";

    const result = parseComex(content);

    expect(result.rows).toHaveLength(0);
    expect(result.errors[0].reason).toContain('numéricos');
  });

  it('rejects implausible years', () => {
    const content =
      'list\n' +
      "{'coNcm': '95069900', 'year': '1200', 'ncm': 'x', 'country': 'Brasil', 'metricFOB': '10', 'metricKG': '5'}\n";

    const result = parseComex(content);

    expect(result.rows).toHaveLength(0);
    expect(result.errors[0].reason).toContain('Ano');
  });

  it('deduplicates rows sharing the same natural key (last wins)', () => {
    const content =
      'list\n' +
      "{'coNcm': '95069900', 'year': '2025', 'ncm': 'x', 'country': 'Brasil', 'metricFOB': '10', 'metricKG': '5'}\n" +
      "{'coNcm': '95069900', 'year': '2025', 'ncm': 'x', 'country': 'Brasil', 'metricFOB': '99', 'metricKG': '9'}\n";

    const result = parseComex(content);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].fobUsd).toBe('99.00');
  });
});
