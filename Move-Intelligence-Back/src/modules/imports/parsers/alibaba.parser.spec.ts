import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImportSourceType } from '@prisma/client';
import { parseAlibaba } from './alibaba.parser';

const FIXTURE_PATH = join(
  __dirname,
  '__fixtures__',
  'alibaba.sample.csv',
);

function loadFixture(): string {
  return readFileSync(FIXTURE_PATH, 'utf8');
}

describe('parseAlibaba', () => {
  it('parses the fixture, deduplicating variants and rejecting rows without title', () => {
    const content = loadFixture();

    const result = parseAlibaba(content);

    expect(result.sourceType).toBe(ImportSourceType.ALIBABA);
    // 5 registros de dados no CSV bruto (inclui 1 variante duplicada e 1 sem title).
    expect(result.rowsTotal).toBe(5);
    // Deduplicação (item_id repetido) + rejeição (sem title) → 3 anúncios válidos.
    expect(result.rows).toHaveLength(3);
    expect(result.sellers).toEqual([]);
  });

  it('maps fields of the first record correctly', () => {
    const content = loadFixture();

    const result = parseAlibaba(content);

    const listing = result.rows[0];
    expect(listing.marketplace).toBe('alibaba');
    expect(listing.externalProductId).toBe('60795133945');
    expect(listing.naturalKey).toBe('alibaba|60795133945');
    expect(listing.title).toBe(
      'Hm-cb36 Hannah Martin Factory Wholesale Price Minimalist Style Japan Quartz Movement Watch For Ladies Women With Leather Strap - Buy  Product on Alibaba.com',
    );
    expect(listing.priceMin).toBe(3.8);
    expect(listing.priceMax).toBe(3.8); // sale_price vazio → cai para priceMin
    expect(listing.currency).toBe('USD');
    expect(listing.rating).toBe(4.5);
    expect(listing.reviewCount).toBe(10);
    expect(listing.salesSignalRaw).toBeNull();
    expect(listing.salesSignalType).toBeNull();
    expect(listing.sellerId).toBeNull();
    expect(listing.sellerName).toBe(
      'Guangzhou Workabee Intelligent Technology Co., Ltd.',
    );
    expect(listing.stock).toBeNull();
    expect(listing.moq).toBeNull();
    expect(listing.brand).toBe(
      'Guangzhou Workabee Intelligent Technology Co., Ltd.',
    );
    expect(listing.category).toBe('Quartz Watches');
    expect(listing.productUrl).toBe(
      'https://www.alibaba.com/product-detail/HM-CB36-Hannah-Martin-Factory-Wholesale_60795133945.html?sku=105676457684',
    );
    // 1 (image_url) + 5 (additional_image_urls) = 6.
    expect(listing.imageCount).toBe(6);
  });

  it('rejects a row without title, recording a RowError', () => {
    const content = loadFixture();

    const result = parseAlibaba(content);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/title/i);
    expect(result.rows.some((r) => r.externalProductId === '999888777')).toBe(
      false,
    );
  });

  it('deduplicates repeated item_id keeping the first occurrence', () => {
    const content = loadFixture();

    const result = parseAlibaba(content);

    const matches = result.rows.filter(
      (r) => r.externalProductId === '60795133945',
    );
    expect(matches).toHaveLength(1);
  });

  it('rejects rows missing item_id or title', () => {
    const header =
      'url,item_id,variant_id,title,description,product_category,category_tree,brand,image_url,price,sale_price,availability,availability_date,group_id,listing_has_variations,variant_attributes,variants,store_name,seller_url,seller_privacy_policy,seller_tos,return_policy,return_window,target_countries,store_country,category_urls,star_rating,review_count,reviews,additional_image_urls';
    const missingItemId =
      'https://x.test,,v1,Some Title,,,,,,"$1.00",,in_stock,,,,,,,,,,,,,,,,,,';
    const content = [header, missingItemId].join('\n');

    const result = parseAlibaba(content);

    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(2);
    expect(result.errors[0].reason).toMatch(/item_id/i);
  });

  it('falls back to category_tree leaf when product_category is empty', () => {
    const header =
      'url,item_id,variant_id,title,description,product_category,category_tree,brand,image_url,price,sale_price,availability,availability_date,group_id,listing_has_variations,variant_attributes,variants,store_name,seller_url,seller_privacy_policy,seller_tos,return_policy,return_window,target_countries,store_country,category_urls,star_rating,review_count,reviews,additional_image_urls';
    const categoryTree =
      '"[{""name"":""Root""},{""name"":""Leaf Category""}]"';
    const row = `https://x.test,123,v1,Some Title,,,${categoryTree},,,"$5.00",,in_stock,,,,,,,,,,,,,,,,,,`;
    const content = [header, row].join('\n');

    const result = parseAlibaba(content);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].category).toBe('Leaf Category');
  });
});
