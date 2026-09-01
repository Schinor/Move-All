import { Module } from '@nestjs/common';
import { MarginEngineModule } from '../margin-engine/margin-engine.module';
import { OpportunityEngineModule } from '../opportunity-engine/opportunity-engine.module';
import { TrendEngineModule } from '../trend-engine/trend-engine.module';
import { AiGatewayModule } from '../ai-gateway/ai-gateway.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [TrendEngineModule, OpportunityEngineModule, MarginEngineModule, AiGatewayModule],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
