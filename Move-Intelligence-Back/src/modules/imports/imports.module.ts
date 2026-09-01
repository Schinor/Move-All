import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { ImportsController } from './imports.controller';
import { ImportsProcessor } from './imports.processor';
import { ImportsQueue } from './imports.queue';
import { ImportsService } from './imports.service';
import { TradeDataController } from './trade-data.controller';
import { TradeDataService } from './trade-data.service';

@Module({
  imports: [ProductsModule],
  controllers: [ImportsController, TradeDataController],
  providers: [ImportsService, ImportsProcessor, ImportsQueue, TradeDataService],
  exports: [ImportsService, TradeDataService],
})
export class ImportsModule {}
