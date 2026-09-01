import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../../shared/config/app-config.service';
import { HttpFetcher } from '../../../../shared/http/http-fetcher';
import {
  RawProduct,
  RawProductDetail,
  SearchParams,
  SourceType,
} from '../../../../shared/types/marketplace.types';
import { BaseHttpConnector } from '../../base-http.connector';

@Injectable()
export class AliexpressConnector extends BaseHttpConnector {
  sourceName = 'aliexpress';
  sourceType: SourceType = 'official_api';
  protected readonly credentialConfigKey = 'sources.aliexpress.apiKey';

  constructor(config: AppConfigService, http: HttpFetcher) {
    super(config, http);
  }

  async searchProducts(params: SearchParams): Promise<RawProduct[]> {
    if (!this.isEnabled()) {
      return [];
    }
    // TODO(DP5): definir o provedor, montar a chamada e mapear a resposta:
    //   const { body } = await this.http.getJson(this.requireCredential(), {
    //     query: { q: params.term, limit: params.limit },
    //   });
    //   return mapItemsToRawProducts(body); // preserve o cru em rawPayload
    return this.notWired(`term=${params.term}`);
  }

  async getProductDetails(productId: string): Promise<RawProductDetail> {
    if (!this.isEnabled()) {
      throw new Error(`aliexpress: conector desabilitado`);
    }
    return this.notWired(`productId=${productId}`);
  }
}
