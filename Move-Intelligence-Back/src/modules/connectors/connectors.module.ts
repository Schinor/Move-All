import { Module } from '@nestjs/common';
import { AliexpressConnector } from './sources/aliexpress/aliexpress.connector';
import { AmazonConnector } from './sources/amazon/amazon.connector';
import { Apify1688Connector } from './sources/apify-1688/apify-1688.connector';
import { DouyinConnector } from './sources/douyin/douyin.connector';
import { GoogleShoppingConnector } from './sources/google-shopping/google-shopping.connector';
import { GoogleTrendsConnector } from './sources/google-trends/google-trends.connector';
import { XiaohongshuConnector } from './sources/xiaohongshu/xiaohongshu.connector';
import { ConnectorsRegistry } from './connectors.registry';

@Module({
  providers: [
    ConnectorsRegistry,
    AliexpressConnector,
    Apify1688Connector,
    GoogleShoppingConnector,
    AmazonConnector,
    GoogleTrendsConnector,
    DouyinConnector,
    XiaohongshuConnector,
  ],
  exports: [ConnectorsRegistry],
})
export class ConnectorsModule {}
