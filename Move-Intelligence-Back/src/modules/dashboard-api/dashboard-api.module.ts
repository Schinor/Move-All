import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { ConnectorsModule } from '../connectors/connectors.module';
import { AiGatewayModule } from '../ai-gateway/ai-gateway.module';
import { DashboardApiController } from './dashboard-api.controller';
import { DashboardApiService } from './dashboard-api.service';

@Module({
  imports: [ConnectorsModule, AiGatewayModule, CatalogModule],
  controllers: [DashboardApiController],
  providers: [DashboardApiService],
  exports: [DashboardApiService],
})
export class DashboardApiModule {}
