import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImportSourceType } from '@prisma/client';
import { parseAmazonProducts } from './amazon-products.parser';

const FIXTURE_PATH = join(
  __dirname,
  '__fixtures__',
  'amazon-products.sample.csv',
);

/**
 * Cabeçalho mínimo usado nos testes de casos sintéticos (rejeição/dedupe),
 * cobrindo apenas as colunas efetivamente lidas pelo parser.
 */
const MINI_HEADER =
  'asin,title,final_price,initial_price,final_price_high,currency,rating,reviews_count,bought_past_month,root_bs_rank,seller_id,seller_name,brand,categories,url,images_count';

function miniRow(cells: Record<string, string>): string {
  const fields = MINI_HEADER.split(',');
  return fields
    .map((f) => {
      const v = cells[f] ?? '';
      return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
    })
    .join(',');
}

describe('parseAmazonProducts', () => {
  it('parses the fixture file: rowsTotal and row count', () => {
    const content = readFileSync(FIXTURE_PATH, 'utf-8');
    const result = parseAmazonProducts(content);

    expect(result.sourceType).toBe(ImportSourceType.AMAZON_PRODUCTS);
    expect(result.rowsTotal).toBe(5);
    expect(result.rows).toHaveLength(5);
    expect(result.errors).toHaveLength(0);
    expect(result.sellers).toEqual([]);
  });

  it('maps the first record correctly', () => {
    const content = readFileSync(FIXTURE_PATH, 'utf-8');
    const result = parseAmazonProducts(content);

    const listing = result.rows[0];
    expect(listing.marketplace).toBe('amazon');
    expect(listing.externalProductId).toBe('B01E578ZQ4');
    expect(listing.naturalKey).toBe('amazon|B01E578ZQ4');
    expect(listing.title).toBe("Geoffrey Beene Men's Cotton Chambray Short");
    expect(listing.priceMin).toBeNull(); // final_price e initial_price ambos vazios
    expect(listing.priceMax).toBeNull();
    expect(listing.currency).toBe('USD');
    expect(listing.rating).toBe(3.6);
    expect(listing.reviewCount).toBe(7);
    expect(listing.salesSignalRaw).toBeNull();
    expect(listing.salesSignalType).toBeNull();
    expect(listing.sellerId).toBeNull();
    expect(listing.sellerName).toBeNull();
    expect(listing.stock).toBeNull();
    expect(listing.moq).toBeNull();
    expect(listing.brand).toBe('Geoffrey Beene');
    expect(listing.category).toBe('Flat Front');
    expect(listing.productUrl).toBe(
      'https://www.amazon.com/dp/B01E578ZQ4?language=en_US&currency=USD',
    );
    expect(listing.imageCount).toBe(2);
  });

  it('maps bought_past_month into salesSignalRaw/salesSignalType', () => {
    const content = readFileSync(FIXTURE_PATH, 'utf-8');
    const result = parseAmazonProducts(content);

    const listing = result.rows.find((r) => r.externalProductId === 'B0DTFMHL13');
    expect(listing).toBeDefined();
    expect(listing?.salesSignalRaw).toBe(100);
    expect(listing?.salesSignalType).toBe('sales_count');
  });

  it('usa root_bs_rank como sinal quando não há bought_past_month', () => {
    const content = readFileSync(FIXTURE_PATH, 'utf-8');
    const result = parseAmazonProducts(content);

    const listing = result.rows.find((r) => r.externalProductId === 'B0FX4XL734');
    expect(listing).toBeDefined();
    expect(listing?.salesSignalRaw).toBe(5734621);
    expect(listing?.salesSignalType).toBe('best_seller_rank');
  });

  it('prioriza bought_past_month sobre root_bs_rank quando ambos existem', () => {
    const content = [
      MINI_HEADER,
      miniRow({
        asin: 'BOTH1',
        title: 'Produto com ambos os sinais',
        bought_past_month: '200',
        root_bs_rank: '1500',
      }),
    ].join('\n');

    const result = parseAmazonProducts(content);

    expect(result.rows[0].salesSignalRaw).toBe(200);
    expect(result.rows[0].salesSignalType).toBe('sales_count');
  });

  it('deixa o sinal nulo quando não há bought_past_month nem root_bs_rank', () => {
    const content = [
      MINI_HEADER,
      miniRow({ asin: 'NOSIG', title: 'Produto sem sinal de vendas' }),
    ].join('\n');

    const result = parseAmazonProducts(content);

    expect(result.rows[0].salesSignalRaw).toBeNull();
    expect(result.rows[0].salesSignalType).toBeNull();
  });

  it('ignora root_bs_rank zerado ou inválido', () => {
    const content = [
      MINI_HEADER,
      miniRow({ asin: 'ZERO', title: 'Rank zero', root_bs_rank: '0' }),
      miniRow({ asin: 'JUNK', title: 'Rank inválido', root_bs_rank: 'n/a' }),
    ].join('\n');

    const result = parseAmazonProducts(content);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].salesSignalType).toBeNull();
    expect(result.rows[1].salesSignalType).toBeNull();
  });

  it('rejects records without title, keeping the row index in the error', () => {
    const content = [
      MINI_HEADER,
      miniRow({ asin: 'ASIN1', title: '' }),
    ].join('\n');

    const result = parseAmazonProducts(content);

    expect(result.rows).toHaveLength(0);
    expect(result.rowsTotal).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(2);
    expect(result.errors[0].reason).toMatch(/título/i);
  });

  it('rejects records without asin', () => {
    const content = [
      MINI_HEADER,
      miniRow({ asin: '', title: 'Some Product' }),
    ].join('\n');

    const result = parseAmazonProducts(content);

    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/ASIN/);
  });

  it('deduplicates by asin, keeping the first occurrence', () => {
    const content = [
      MINI_HEADER,
      miniRow({ asin: 'DUP1', title: 'First title', brand: 'BrandA' }),
      miniRow({ asin: 'DUP1', title: 'Second title', brand: 'BrandB' }),
      miniRow({ asin: 'OTHER', title: 'Unrelated product' }),
    ].join('\n');

    const result = parseAmazonProducts(content);

    expect(result.rowsTotal).toBe(3);
    expect(result.rows).toHaveLength(2);
    const dup = result.rows.find((r) => r.externalProductId === 'DUP1');
    expect(dup?.title).toBe('First title');
    expect(dup?.brand).toBe('BrandA');
  });
});
