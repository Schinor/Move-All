import {
  RawProduct,
  RawProductDetail,
  RawSeller,
  SearchParams,
  SourceName,
  SourceType,
} from '../../shared/types/marketplace.types';

export interface MarketplaceConnector {
  sourceName: SourceName | string;
  sourceType: SourceType;
  isEnabled(): boolean;
  searchProducts(params: SearchParams): Promise<RawProduct[]>;
  getProductDetails(productId: string): Promise<RawProductDetail>;
  getSellerDetails?(sellerId: string): Promise<RawSeller>;
}
