import { ImportSourceType } from '@prisma/client';
import {
  UnsupportedSourceError,
  detectSourceType,
  isXlsx,
} from './source-detector';

describe('detectSourceType', () => {
  it('detects Comex annual', () => {
    const content =
      'list\n' +
      "{'coNcm': '95069900', 'year': '2025', 'ncm': 'x', 'country': 'Brasil', 'metricFOB': '1', 'metricKG': '1'}";
    expect(detectSourceType(content)).toBe(ImportSourceType.COMEX_ANUAL);
  });

  it('detects Comex monthly via monthNumber', () => {
    const content =
      'list\n' +
      "{'coNcm': '95069900', 'year': '2025', 'monthNumber': '03', 'country': 'Brasil', 'metricFOB': '1', 'metricKG': '1'}";
    expect(detectSourceType(content)).toBe(ImportSourceType.COMEX_MENSAL);
  });

  it('detects TradeAtlas from the two-row header', () => {
    const content =
      '"NO & DATE","","BUYER DETAILS"\n' +
      '"NO","ARRIVAL DATE","IMPORTER NAME","IMPORTER COUNTRY"';
    expect(detectSourceType(content)).toBe(ImportSourceType.TRADE_ATLAS);
  });

  it('ignores the BOM', () => {
    const content =
      '﻿list\n' +
      "{'coNcm': '1', 'year': '2025', 'country': 'Brasil', 'metricFOB': '1', 'metricKG': '1'}";
    expect(detectSourceType(content)).toBe(ImportSourceType.COMEX_ANUAL);
  });

  it('throws on unknown formats', () => {
    expect(() => detectSourceType('foo,bar\n1,2')).toThrow(
      UnsupportedSourceError,
    );
  });
});

describe('isXlsx', () => {
  it('detects by extension', () => {
    expect(isXlsx('data.xlsx', undefined, Buffer.from(''))).toBe(true);
  });

  it('detects by zip magic bytes', () => {
    const zipMagic = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
    expect(isXlsx('data', undefined, zipMagic)).toBe(true);
  });

  it('returns false for plain csv', () => {
    expect(isXlsx('data.csv', 'text/csv', Buffer.from('a,b'))).toBe(false);
  });
});

/**
 * Cabeçalhos reais (linha 1) das amostras Bright Data — servem de fingerprint
 * para a detecção automática das fontes de marketplace.
 */
const BRIGHT_DATA_HEADERS: Record<string, string> = {
  AMAZON_SELLERS:
    '"seller_id","url","seller_name","description","detailed_info","stars","feedbacks","return_policy","shipping_policies","privacy_security","privacy_policy","tax_info","help_content","products_link","business_name","business_address","rating_positive","brands","feedbacks_percentages","rating_count_m12","rating_count_m3","rating_count_lifetime","rating_count_m1","country","email","seller_phone_number","rating_count","delivery_rates","products_count"',
  AMAZON_PRODUCTS:
    '"title","seller_name","brand","description","initial_price","currency","availability","reviews_count","categories","parent_asin","asin","buybox_seller","number_of_sellers","root_bs_rank","ISBN10","answered_questions","domain","images_count","url","video_count","image_url","item_weight","rating","product_dimensions","seller_id","image","date_first_available","discount","model_number","manufacturer","department","plus_content","upc","video","top_review","final_price_high","final_price","variations","delivery","features","format","buybox_prices","input_asin","ingredients","origin_url","bought_past_month","is_available","root_bs_category","bs_category","bs_rank","badge","subcategory_rank","amazon_choice","images","product_details","prices_breakdown","country_of_origin","from_the_brand","product_description","seller_url","customer_says","sustainability_features","climate_pledge_friendly","videos","other_sellers_prices","downloadable_videos","editorial_reviews","about_the_author","zipcode","coupon","sponsored","store_url","ships_from","city","customers_say","max_quantity_available","variations_values","language","return_policy","inactive_buy_box","buybox_seller_rating","premium_brand","amazon_prime","coupon_description","all_badges","safety_information","subcategory_link","is_frequently_returned_item_badge","frequently_returned_item_message","is_customers_usually_keep","title_badge","review_images","review_videos","bought_past_month_text","is_high_price"',
  SHEIN:
    '"product_name","description","initial_price","final_price","currency","in_stock","color","size","reviews_count","main_image","category_url","url","category_tree","country_code","domain","image_count","image_urls","model_number","offers","other_attributes","product_id","rating","related_products","root_category","top_reviews","category","brand","all_available_sizes","category_details","initial_price_usd","final_price_usd","discount_price","discount_price_usd","colors","store_details","shipping_details","shipping_type","product_parent_id","tags","model_data","colors_images"',
  TIKTOK_SHOP:
    '"url","title","available","description","currency","initial_price","final_price","discount_percent","initial_price_low","initial_price_high","final_price_low","final_price_high","sold","colors","sizes","shipping_fee","specifications","reviews_count","reviews","store_details","images","domain","videos","category","category_url","id","seller_id","prodct_rating","position","variations","In_stock","promotion_items","desc_detail","related_videos","video_link","Shop_performance_metrics","variant_id","category_tree","brand","image_url","nai_price","sale_price","availability","availability_date","group_id","listing_has_variations","variant_attributes","nai_variants","store_name","seller_url","seller_privacy_policy","seller_tos","return_policy","return_window","target_countries","store_country","category_urls","nai_reviews","additional_image_urls"',
  GOOGLE_SHOPPING:
    '"url","product_id","title","product_description","rating","reviews_count","images","variations","tags","product_details","amount_of_stars","seller_name","delivery_price","item_price","total_price","currency","product_specifications","related_items","country","buying_options","variant_id","description","product_category","category_tree","brand","image_url","price","sale_price","availability","availability_date","group_id","listing_has_variations","variant_attributes","nai_variants","store_name","seller_url","seller_privacy_policy","seller_tos","return_window","target_countries","store_country","category_urls","reviews"',
  ALIBABA:
    '"url","item_id","variant_id","title","description","product_category","category_tree","brand","image_url","price","sale_price","availability","availability_date","group_id","listing_has_variations","variant_attributes","variants","store_name","seller_url","seller_privacy_policy","seller_tos","return_policy","return_window","target_countries","store_country","category_urls","star_rating","review_count","reviews","additional_image_urls"',
};

describe('detectSourceType — fontes Bright Data', () => {
  it('detects Amazon Sellers Info pelo cabeçalho real', () => {
    expect(detectSourceType(BRIGHT_DATA_HEADERS.AMAZON_SELLERS)).toBe(
      ImportSourceType.AMAZON_SELLERS,
    );
  });

  it('detects Amazon Products pelo cabeçalho real', () => {
    expect(detectSourceType(BRIGHT_DATA_HEADERS.AMAZON_PRODUCTS)).toBe(
      ImportSourceType.AMAZON_PRODUCTS,
    );
  });

  it('detects Shein pelo cabeçalho real', () => {
    expect(detectSourceType(BRIGHT_DATA_HEADERS.SHEIN)).toBe(
      ImportSourceType.SHEIN,
    );
  });

  it('detects TikTok Shop pelo cabeçalho real', () => {
    expect(detectSourceType(BRIGHT_DATA_HEADERS.TIKTOK_SHOP)).toBe(
      ImportSourceType.TIKTOK_SHOP,
    );
  });

  it('detects Google Shopping pelo cabeçalho real', () => {
    expect(detectSourceType(BRIGHT_DATA_HEADERS.GOOGLE_SHOPPING)).toBe(
      ImportSourceType.GOOGLE_SHOPPING,
    );
  });

  it('detects Alibaba pelo cabeçalho real', () => {
    expect(detectSourceType(BRIGHT_DATA_HEADERS.ALIBABA)).toBe(
      ImportSourceType.ALIBABA,
    );
  });

  it('detects TikTok Shop pela coluna com typo prodct_rating', () => {
    expect(detectSourceType('"id","prodct_rating","title"')).toBe(
      ImportSourceType.TIKTOK_SHOP,
    );
  });

  it('não confunde Amazon Products com Amazon Sellers', () => {
    expect(detectSourceType(BRIGHT_DATA_HEADERS.AMAZON_PRODUCTS)).not.toBe(
      ImportSourceType.AMAZON_SELLERS,
    );
  });
});
