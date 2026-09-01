import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImportSourceType } from '@prisma/client';
import { parseAmazonSellers } from './amazon-sellers.parser';

const FIXTURE = readFileSync(
  join(__dirname, '__fixtures__', 'amazon-sellers.sample.csv'),
  'utf-8',
);

const HEADER =
  '"seller_id","url","seller_name","description","detailed_info","stars","feedbacks","return_policy","shipping_policies","privacy_security","privacy_policy","tax_info","help_content","products_link","business_name","business_address","rating_positive","brands","feedbacks_percentages","rating_count_m12","rating_count_m3","rating_count_lifetime","rating_count_m1","country","email","seller_phone_number","rating_count","delivery_rates","products_count"';

/** Monta uma linha CSV com defaults, sobrescrevendo apenas os campos informados. */
function row(overrides: Partial<Record<string, string>> = {}): string {
  const defaults: Record<string, string> = {
    seller_id: 'A1TEST0000001',
    url: 'https://www.amazon.com/sp?seller=A1TEST0000001',
    seller_name: 'Test Seller',
    description: 'desc',
    detailed_info:
      '[{"title":"Business Name","value":"Test Business Ltd"},{"title":"Business Address","value":"Somewhere"}]',
    stars: '4 out of 5 stars',
    feedbacks: '[]',
    return_policy: '[]',
    shipping_policies: 'policy',
    privacy_security: 'security',
    privacy_policy: 'policy',
    tax_info: '',
    help_content: 'help',
    products_link: 'https://www.amazon.com/s?me=A1TEST0000001',
    business_name: '',
    business_address: '',
    rating_positive: '83%',
    brands: '',
    feedbacks_percentages: '{}',
    rating_count_m12: '0',
    rating_count_m3: '0',
    rating_count_lifetime: '6',
    rating_count_m1: '0',
    country: 'US',
    email: '',
    seller_phone_number: '',
    rating_count: '6',
    delivery_rates: 'rates',
    products_count: '4',
  };
  const record = { ...defaults, ...overrides };
  const columns = HEADER.split(',').map((h) => h.replace(/"/g, ''));
  return columns
    .map((col) => `"${(record[col] ?? '').replace(/"/g, '""')}"`)
    .join(',');
}

describe('parseAmazonSellers', () => {
  it('parses the real Bright Data sample, producing sellers (no rows)', () => {
    const result = parseAmazonSellers(FIXTURE);

    expect(result.sourceType).toBe(ImportSourceType.AMAZON_SELLERS);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(0);
    expect(result.sellers).toHaveLength(5);
    expect(result.rowsTotal).toBe(5);
  });

  it('maps fields, parsing "N out of 5 stars" and percentual fields', () => {
    const result = parseAmazonSellers(FIXTURE);
    const seller = result.sellers.find(
      (s) => s.externalSellerId === 'A1UT7TDWAOYLBZ',
    );

    expect(seller).toMatchObject({
      marketplace: 'amazon',
      externalSellerId: 'A1UT7TDWAOYLBZ',
      name: 'Gud***wer***',
      sellerUrl: 'https://www.amazon.com/sp?seller=A1UT7TDWAOYLBZ',
      country: 'US',
      rating: 4,
      ratingCount: 6,
      positivePct: 83,
      productsCount: 4,
    });
  });

  it('parses a decimal rating ("4.5 out of 5 stars" → 4.5)', () => {
    const result = parseAmazonSellers(FIXTURE);
    const seller = result.sellers.find(
      (s) => s.externalSellerId === 'A1RIAYGOOJEMDN',
    );

    expect(seller?.rating).toBe(4.5);
  });

  it('returns rating null when stars is empty', () => {
    const result = parseAmazonSellers(FIXTURE);
    const seller = result.sellers.find(
      (s) => s.externalSellerId === 'A2HM4SYM2AVP9A',
    );

    expect(seller?.rating).toBeNull();
  });

  it('falls back to detailed_info "Business Name" when business_name column is empty', () => {
    const result = parseAmazonSellers(FIXTURE);
    const seller = result.sellers.find(
      (s) => s.externalSellerId === 'A1UT7TDWAOYLBZ',
    );

    expect(seller?.businessName).toBe(
      'Shenzhen chunfengchui trading co., ltd',
    );
  });

  it('prefers the business_name column over detailed_info when both are present', () => {
    const content = [
      HEADER,
      row({
        seller_id: 'ADIRECTBIZ',
        business_name: 'Direct Business Inc',
        detailed_info:
          '[{"title":"Business Name","value":"Should Not Be Used"}]',
      }),
    ].join('\n');

    const result = parseAmazonSellers(content);

    expect(result.sellers[0].businessName).toBe('Direct Business Inc');
  });

  it('returns businessName null when neither the column nor detailed_info has it', () => {
    const content = [
      HEADER,
      row({
        seller_id: 'ANOBIZ',
        business_name: '',
        detailed_info: '[{"title":"Business Address","value":"Somewhere"}]',
      }),
    ].join('\n');

    const result = parseAmazonSellers(content);

    expect(result.sellers[0].businessName).toBeNull();
  });

  it('rejects a record without seller_id, reporting a RowError', () => {
    const content = [HEADER, row({ seller_id: '' })].join('\n');

    const result = parseAmazonSellers(content);

    expect(result.sellers).toHaveLength(0);
    expect(result.rowsTotal).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/seller_id/);
    expect(result.errors[0].line).toBe(2);
  });

  it('deduplicates by externalSellerId, keeping the first occurrence', () => {
    const content = [
      HEADER,
      row({ seller_id: 'ADUP', seller_name: 'First' }),
      row({ seller_id: 'ADUP', seller_name: 'Second' }),
    ].join('\n');

    const result = parseAmazonSellers(content);

    expect(result.rowsTotal).toBe(2);
    expect(result.sellers).toHaveLength(1);
    expect(result.sellers[0].name).toBe('First');
  });

  it('falls back to rating_count when rating_count_lifetime is empty', () => {
    const content = [
      HEADER,
      row({
        seller_id: 'ACOUNTFALLBACK',
        rating_count_lifetime: '',
        rating_count: '42',
      }),
    ].join('\n');

    const result = parseAmazonSellers(content);

    expect(result.sellers[0].ratingCount).toBe(42);
  });
});
