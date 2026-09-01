import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImportSourceType } from '@prisma/client';
import { parseShein } from './shein.parser';

const FIXTURE_PATH = join(__dirname, '__fixtures__', 'shein.sample.csv');

function loadFixture(): string {
  return readFileSync(FIXTURE_PATH, 'utf8');
}

describe('parseShein', () => {
  it('parses the fixture, rejecting rows without product_id and deduplicating repeated product_id', () => {
    const content = loadFixture();

    const result = parseShein(content);

    expect(result.sourceType).toBe(ImportSourceType.SHEIN);
    // 5 registros no CSV bruto (inclui 1 sem product_id e 1 product_id duplicado).
    expect(result.rowsTotal).toBe(5);
    // Rejeição (sem product_id) + dedupe (product_id repetido) → 3 anúncios válidos.
    expect(result.rows).toHaveLength(3);
    expect(result.sellers).toEqual([]);
  });

  it('maps fields of the first record correctly', () => {
    const content = loadFixture();

    const result = parseShein(content);

    const listing = result.rows[0];
    expect(listing.marketplace).toBe('shein');
    expect(listing.externalProductId).toBe('32583542');
    expect(listing.naturalKey).toBe('shein|32583542');
    expect(listing.title).toBe('1pc Stainless Steel Short Handle Sakura Spoon');
    expect(listing.priceMin).toBe(2.1);
    expect(listing.priceMax).toBe(2.1);
    expect(listing.currency).toBe('USD');
    expect(listing.rating).toBe(0);
    expect(listing.reviewCount).toBe(0);
    expect(listing.salesSignalRaw).toBeNull();
    expect(listing.salesSignalType).toBeNull();
    expect(listing.sellerId).toBeNull();
    // store_details vazio nesta linha.
    expect(listing.sellerName).toBeNull();
    expect(listing.stock).toBeNull();
    expect(listing.moq).toBeNull();
    expect(listing.brand).toBe('SHEIN');
    expect(listing.category).toBe('Coffee Scoops');
    expect(listing.productUrl).toBe(
      'https://us.shein.com/1pc-Stainless-Steel-Short-Handle-Sakura-Spoon-p-32583542.html?size=Love+Spoon+Gold',
    );
    expect(listing.imageCount).toBe(14);
  });

  it('extracts sellerName from the store_details JSON object', () => {
    const content = loadFixture();

    const result = parseShein(content);

    const listing = result.rows.find(
      (r) => r.externalProductId === '11443842',
    );
    expect(listing).toBeDefined();
    expect(listing?.sellerName).toBe('YUEHA');
  });

  it('rejects a row without product_id, recording a RowError', () => {
    const content = loadFixture();

    const result = parseShein(content);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/product_id/i);
    expect(
      result.rows.some((r) => r.title === 'Heart Pattern Phone Case With Hand Strap'),
    ).toBe(false);
  });

  it('deduplicates repeated product_id keeping the first occurrence', () => {
    const content = loadFixture();

    const result = parseShein(content);

    const matches = result.rows.filter(
      (r) => r.externalProductId === '32583542',
    );
    expect(matches).toHaveLength(1);
  });

  it('rejects a row missing product_id (with an explicit minimal CSV)', () => {
    const header = 'product_name,product_id,final_price,initial_price,currency';
    const missingProductId = 'Some Title,,1.00,1.00,USD';
    const content = [header, missingProductId].join('\n');

    const result = parseShein(content);

    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(2);
    expect(result.errors[0].reason).toMatch(/product_id/i);
  });

  it('rejects a row without product_name', () => {
    const header = 'product_name,product_id,final_price,initial_price,currency';
    const missingProductName = ',999,1.00,1.00,USD';
    const content = [header, missingProductName].join('\n');

    const result = parseShein(content);

    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/product_name/i);
  });

  it('falls back to category_tree leaf when category is empty', () => {
    const header =
      'product_name,product_id,category,category_tree,final_price,initial_price';
    const categoryTree = '"[{""name"":""Root""},{""name"":""Leaf Category""}]"';
    const row = `Some Title,123,,${categoryTree},1.00,1.00`;
    const content = [header, row].join('\n');

    const result = parseShein(content);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].category).toBe('Leaf Category');
  });

  it('falls back priceMin through final_price_usd and initial_price', () => {
    const header =
      'product_name,product_id,final_price,final_price_usd,initial_price';
    const row = 'Some Title,123,,9.99,15.00';
    const content = [header, row].join('\n');

    const result = parseShein(content);

    expect(result.rows[0].priceMin).toBe(9.99);
    expect(result.rows[0].priceMax).toBe(15);
  });
});
