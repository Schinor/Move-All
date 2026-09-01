import { Injectable } from '@nestjs/common';
import { SourceName } from '../../shared/types/marketplace.types';
import { MarketplaceConnector } from './marketplace-connector.interface';
import { AliexpressConnector } from './sources/aliexpress/aliexpress.connector';
import { AmazonConnector } from './sources/amazon/amazon.connector';
import { Apify1688Connector } from './sources/apify-1688/apify-1688.connector';
import { DouyinConnector } from './sources/douyin/douyin.connector';
import { GoogleShoppingConnector } from './sources/google-shopping/google-shopping.connector';
import { GoogleTrendsConnector } from './sources/google-trends/google-trends.connector';
import { XiaohongshuConnector } from './sources/xiaohongshu/xiaohongshu.connector';

@Injectable()
export class ConnectorsRegistry {
  private readonly connectors: MarketplaceConnector[];

  constructor(
    aliexpress: AliexpressConnector,
    apify1688: Apify1688Connector,
    googleShopping: GoogleShoppingConnector,
    amazon: AmazonConnector,
    googleTrends: GoogleTrendsConnector,
    douyin: DouyinConnector,
    xiaohongshu: XiaohongshuConnector,
  ) {
    this.connectors = [
      aliexpress,
      apify1688,
      googleShopping,
      amazon,
      googleTrends,
      douyin,
      xiaohongshu,
    ];
  }

  getAll(): MarketplaceConnector[] {
    return this.connectors;
  }

  getEnabledSources() {
    return this.connectors.map((connector) => ({
      sourceName: connector.sourceName,
      sourceType: connector.sourceType,
      enabled: connector.isEnabled(),
    }));
  }

  getByName(sourceName: SourceName | string): MarketplaceConnector | undefined {
    return this.connectors.find(
      (connector) => connector.sourceName === sourceName,
    );
  }
}
