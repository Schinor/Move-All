import { Module } from '@nestjs/common';
import { ConnectorsModule } from '../connectors/connectors.module';
import { AiGatewayModule } from '../ai-gateway/ai-gateway.module';
import { DashboardApiController } from './dashboard-api.controller';
import { DashboardApiService } from './dashboard-api.service';

@Module({
  imports: [ConnectorsModule, AiGatewayModule],
  controllers: [DashboardApiController],
  providers: [DashboardApiService],
  exports: [DashboardApiService],
})
export class DashboardApiModule {}
