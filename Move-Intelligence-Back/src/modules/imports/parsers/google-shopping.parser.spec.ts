import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImportSourceType } from '@prisma/client';
import { parseGoogleShopping } from './google-shopping.parser';

const FIXTURE_PATH = join(
  __dirname,
  '__fixtures__',
  'google-shopping.sample.csv',
);

/**
 * Cabeçalho mínimo usado nos testes de casos sintéticos (rejeição/dedupe/
 * categoria), cobrindo apenas as colunas efetivamente lidas pelo parser.
 */
const MINI_HEADER =
  'product_id,title,item_price,total_price,currency,rating,amount_of_stars,reviews_count,seller_name,store_name,brand,product_category,category_tree,url,images';

function miniRow(cells: Record<string, string>): string {
  const fields = MINI_HEADER.split(',');
  return fields
    .map((f) => {
      const v = cells[f] ?? '';
      return v.includes(',') || v.includes('"')
        ? `"${v.replace(/"/g, '""')}"`
        : v;
    })
    .join(',');
}

describe('parseGoogleShopping', () => {
  it('parses the fixture file: rowsTotal, row count and rejection', () => {
    const content = readFileSync(FIXTURE_PATH, 'utf-8');
    const result = parseGoogleShopping(content);

    expect(result.sourceType).toBe(ImportSourceType.GOOGLE_SHOPPING);
    expect(result.rowsTotal).toBe(5);
    // 5 registros na fixture, 1 sem title (rejeitado).
    expect(result.rows).toHaveLength(4);
    expect(result.errors).toHaveLength(1);
    expect(result.sellers).toEqual([]);
  });

  it('maps a plain-priced record correctly (no "$" in price)', () => {
    const content = readFileSync(FIXTURE_PATH, 'utf-8');
    const result = parseGoogleShopping(content);

    const listing = result.rows.find(
      (r) => r.externalProductId === 'catalogid:12094172361112023352',
    );
    expect(listing).toBeDefined();
    expect(listing?.marketplace).toBe('google_shopping');
    expect(listing?.naturalKey).toBe(
      'google_shopping|catalogid:12094172361112023352',
    );
    expect(listing?.title).toBe('Eaton 7513W-BOX Rocker Switch');
    expect(listing?.priceMin).toBe(15.38);
    expect(listing?.priceMax).toBe(15.38);
    expect(listing?.currency).toBe('USD'); // vem preenchida na coluna currency
    expect(listing?.salesSignalRaw).toBeNull();
    expect(listing?.salesSignalType).toBeNull();
    expect(listing?.sellerId).toBeNull();
    expect(listing?.stock).toBeNull();
    expect(listing?.moq).toBeNull();
  });

  it('infers currency as USD from the "$" symbol when currency column is empty', () => {
    const content = readFileSync(FIXTURE_PATH, 'utf-8');
    const result = parseGoogleShopping(content);

    const listing = result.rows.find(
      (r) => r.externalProductId === '10998024716837644856',
    );
    expect(listing).toBeDefined();
    expect(listing?.title).toBe(
      'Satin High Waist Solid Color Side Slit Midi Skirt, Caramel / Xs',
    );
    expect(listing?.priceMin).toBe(35.99);
    expect(listing?.priceMax).toBe(50.69);
    expect(listing?.currency).toBe('USD');
    expect(listing?.imageCount).toBeGreaterThan(0);
  });

  it('maps rating/reviewCount and brand/seller fields', () => {
    const content = readFileSync(FIXTURE_PATH, 'utf-8');
    const result = parseGoogleShopping(content);

    const rated = result.rows.find(
      (r) => r.externalProductId === '2714748051128243724?',
    );
    expect(rated).toBeDefined();
    expect(rated?.rating).toBe(3.7);
    expect(rated?.reviewCount).toBe(3);

    const branded = result.rows.find((r) =>
      r.externalProductId.startsWith('catalogid:9527507087812540020'),
    );
    expect(branded).toBeDefined();
    expect(branded?.brand).toBe("Frankie's Free Range Meats");
    expect(branded?.sellerName).toBe("Frankie's F**e R***e M***s");
  });

  it('rejects records without title, keeping the row index in the error', () => {
    const content = [
      MINI_HEADER,
      miniRow({ product_id: 'PID1', title: '' }),
    ].join('\n');

    const result = parseGoogleShopping(content);

    expect(result.rows).toHaveLength(0);
    expect(result.rowsTotal).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(2);
    expect(result.errors[0].reason).toMatch(/title/i);
  });

  it('rejects records without product_id', () => {
    const content = [
      MINI_HEADER,
      miniRow({ product_id: '', title: 'Some Product' }),
    ].join('\n');

    const result = parseGoogleShopping(content);

    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/product_id/);
  });

  it('deduplicates by product_id, keeping the first occurrence', () => {
    const content = [
      MINI_HEADER,
      miniRow({ product_id: 'DUP1', title: 'First title', brand: 'BrandA' }),
      miniRow({ product_id: 'DUP1', title: 'Second title', brand: 'BrandB' }),
      miniRow({ product_id: 'OTHER', title: 'Unrelated product' }),
    ].join('\n');

    const result = parseGoogleShopping(content);

    expect(result.rowsTotal).toBe(3);
    expect(result.rows).toHaveLength(2);
    const dup = result.rows.find((r) => r.externalProductId === 'DUP1');
    expect(dup?.title).toBe('First title');
    expect(dup?.brand).toBe('BrandA');
  });

  it('prefers the leaf of product_category over category_tree', () => {
    const content = [
      MINI_HEADER,
      miniRow({
        product_id: 'CAT1',
        title: 'Categorized product',
        product_category: 'Apparel & Accessories>Clothing>Skirts',
        category_tree: '[{"name":"Home"},{"name":"Ignored leaf"}]',
      }),
    ].join('\n');

    const result = parseGoogleShopping(content);

    expect(result.rows[0].category).toBe('Skirts');
  });

  it('falls back to category_tree leaf when product_category is absent', () => {
    const content = [
      MINI_HEADER,
      miniRow({
        product_id: 'CAT2',
        title: 'Fallback category product',
        category_tree: '[{"name":"Home"},{"name":"Electronics"}]',
      }),
    ].join('\n');

    const result = parseGoogleShopping(content);

    expect(result.rows[0].category).toBe('Electronics');
  });
});
