import { readFileSync } from 'fs';
import { join } from 'path';
import { ImportSourceType } from '@prisma/client';
import { parseTiktokShop } from './tiktok-shop.parser';

const FIXTURE_PATH = join(__dirname, '__fixtures__', 'tiktok-shop.sample.csv');

describe('parseTiktokShop', () => {
  it('parses the real-sample fixture: counts, mapping and rejections', () => {
    const content = readFileSync(FIXTURE_PATH, 'utf-8');

    const result = parseTiktokShop(content);

    expect(result.sourceType).toBe(ImportSourceType.TIKTOK_SHOP);
    // 4 registros no arquivo: 2 válidos + 2 indisponíveis (sem id/title).
    expect(result.rowsTotal).toBe(4);
    expect(result.rows).toHaveLength(2);
    expect(result.errors).toHaveLength(2);

    // Todas as rejeições são por falta de id/title (produtos indisponíveis).
    for (const error of result.errors) {
      expect(error.reason).toMatch(/sem id|sem title/);
    }

    const listing = result.rows.find(
      (r) => r.externalProductId === '1729864276706495330',
    );
    expect(listing).toBeDefined();
    expect(listing?.naturalKey).toBe('tiktok-shop|1729864276706495330');
    expect(listing?.marketplace).toBe('tiktok-shop');
    expect(listing?.title).toContain('Đồng Hồ Đeo Tay M3');
    expect(listing?.priceMin).toBe(42.873);
    expect(listing?.priceMax).toBe(42.873);
    expect(listing?.currency).toBe('VND');
    expect(listing?.rating).toBe(4.3);
    expect(listing?.reviewCount).toBe(27);
    expect(listing?.salesSignalRaw).toBe(371);
    expect(listing?.salesSignalType).toBe('sales_count');
    expect(listing?.sellerId).toBe('864***249***588******');
    expect(listing?.sellerName).toBe('POEDAGAR.vn'); // extraído de store_details.name
    expect(listing?.stock).toBeNull();
    expect(listing?.moq).toBeNull();
    expect(listing?.brand).toBeNull();
    expect(listing?.category).toBe('Fashion Unisex Watches');
    expect(listing?.productUrl).toContain('tiktok.com/shop/vn/pdp');
    expect(listing?.imageCount).toBeGreaterThan(0);
  });

  it('maps the second valid record (distinct currency/rating/seller)', () => {
    const content = readFileSync(FIXTURE_PATH, 'utf-8');

    const result = parseTiktokShop(content);

    const listing = result.rows.find(
      (r) => r.externalProductId === '1729680740544911404',
    );
    expect(listing).toBeDefined();
    expect(listing?.currency).toBe('GBP');
    expect(listing?.rating).toBe(4.4);
    expect(listing?.reviewCount).toBe(19);
    expect(listing?.salesSignalRaw).toBe(285);
    expect(listing?.sellerName).toBe('Unfold Studio UK');
    expect(listing?.category).toBe('Costumes & Accessories');
  });

  it('accepts "1.2k" and "10k+" style sold values', () => {
    const header =
      'id,title,final_price,final_price_low,final_price_high,initial_price,currency,prodct_rating,reviews_count,sold,seller_id,store_details,brand,category,url,images';
    const row1 = [
      '1',
      'Produto A',
      '10',
      '',
      '',
      '',
      'USD',
      '4.5',
      '10',
      '1.2k',
      'seller-1',
      '{}',
      '',
      '',
      '',
      '[]',
    ].join(',');
    const row2 = [
      '2',
      'Produto B',
      '10',
      '',
      '',
      '',
      'USD',
      '4.5',
      '10',
      '10k+',
      'seller-2',
      '{}',
      '',
      '',
      '',
      '[]',
    ].join(',');
    const content = [header, row1, row2].join('\n');

    const result = parseTiktokShop(content);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].salesSignalRaw).toBe(1200);
    expect(result.rows[0].salesSignalType).toBe('sales_count');
    expect(result.rows[1].salesSignalRaw).toBe(10000);
  });

  it('rejects records missing id or title', () => {
    const header = 'id,title,url';
    const noId = ',Produto sem id,https://x';
    const noTitle = '123,,https://x';
    const content = [header, noId, noTitle].join('\n');

    const result = parseTiktokShop(content);

    expect(result.rowsTotal).toBe(2);
    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].reason).toMatch(/sem id/);
    expect(result.errors[1].reason).toMatch(/sem title/);
    expect(result.errors[0].line).toBe(2);
    expect(result.errors[1].line).toBe(3);
  });

  it('deduplicates by externalProductId, keeping the first occurrence', () => {
    const header = 'id,title,final_price,currency';
    const first = '1,Produto Original,10,USD';
    const duplicate = '1,Produto Duplicado,99,BRL';
    const content = [header, first, duplicate].join('\n');

    const result = parseTiktokShop(content);

    expect(result.rowsTotal).toBe(2);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].title).toBe('Produto Original');
    expect(result.rows[0].currency).toBe('USD');
  });

  it('falls back priceMax to initial_price and then priceMin', () => {
    const header =
      'id,title,final_price,final_price_low,final_price_high,initial_price,currency';
    const withInitial = '1,Produto A,10,,,15,USD';
    const withoutHigh = '2,Produto B,20,,,,USD';
    const content = [header, withInitial, withoutHigh].join('\n');

    const result = parseTiktokShop(content);

    expect(result.rows[0].priceMin).toBe(10);
    expect(result.rows[0].priceMax).toBe(15); // cai para initial_price
    expect(result.rows[1].priceMin).toBe(20);
    expect(result.rows[1].priceMax).toBe(20); // cai para priceMin
  });

  it('returns null sellerName when store_details is absent or has no name', () => {
    const header = 'id,title,store_details';
    const noStoreDetails = '1,Produto A,';
    const nameless = '2,Produto B,{"name":null}';
    const content = [header, noStoreDetails, nameless].join('\n');

    const result = parseTiktokShop(content);

    expect(result.rows[0].sellerName).toBeNull();
    expect(result.rows[1].sellerName).toBeNull();
  });

  it('has empty sellers array (marketplace listings only)', () => {
    const content = 'id,title\n1,Produto A';
    const result = parseTiktokShop(content);
    expect(result.sellers).toEqual([]);
  });
});
