export type SourceName =
  | 'aliexpress'
  | '1688'
  | 'alibaba'
  | 'amazon'
  | 'google-shopping'
  | 'google-trends'
  | 'douyin'
  | 'xiaohongshu';

export type SourceType =
  | 'official_api'
  | 'third_party_scraper'
  | 'marketplace'
  | 'search'
  | 'social';

export type SalesSignalType =
  | 'sales_count'
  | 'latest_volume'
  | 'hot_value'
  | 'best_seller_rank'
  | 'review_count'
  | 'unknown';

export interface SearchParams {
  term: string;
  category?: string;
  language?: 'pt' | 'en' | 'zh';
  market?: string;
  limit?: number;
}

export interface RawProduct {
  source: SourceName | string;
  sourceType: SourceType;
  externalProductId: string;
  externalSellerId?: string;
  titleOriginal: string;
  categoryOriginal?: string;
  brand?: string;
  priceMin?: number;
  priceMax?: number;
  currency?: string;
  moq?: number;
  stock?: number;
  rating?: number;
  reviewCount?: number;
  salesSignalRaw?: number;
  salesSignalType?: SalesSignalType;
  sellerName?: string;
  sellerLocation?: string;
  sellerRating?: number;
  imageUrls?: string[];
  videoUrl?: string;
  productUrl?: string;
  collectedAt?: Date;
  rawPayload: Record<string, unknown>;
}

export interface RawProductDetail extends RawProduct {
  attributes?: Record<string, string | number | boolean>;
}

export interface RawSeller {
  source: SourceName | string;
  externalSellerId: string;
  name?: string;
  location?: string;
  rating?: number;
  certifications?: string[];
  rawPayload: Record<string, unknown>;
}

export interface CanonicalProductListing {
  marketplace: string;
  sourceType: SourceType;
  externalProductId: string;
  externalSellerId?: string;
  titleOriginal: string;
  titleTranslated?: string;
  titleNormalized: string;
  categoryOriginal?: string;
  categoryNormalized?: string;
  brand?: string;
  priceMin?: number;
  priceMax?: number;
  currency?: string;
  moq?: number;
  stock?: number;
  rating?: number;
  reviewCount?: number;
  salesSignalRaw?: number;
  salesSignalType?: SalesSignalType;
  sellerName?: string;
  sellerLocation?: string;
  sellerRating?: number;
  imageUrls: string[];
  videoUrl?: string;
  productUrl?: string;
  collectedAt: Date;
}
