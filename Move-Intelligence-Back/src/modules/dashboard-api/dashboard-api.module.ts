import { Module } from '@nestjs/common';
import { ConnectorsModule } from '../connectors/connectors.module';
import { TrendEngineModule } from '../trend-engine/trend-engine.module';
import { DashboardApiController } from './dashboard-api.controller';
import { DashboardApiService } from './dashboard-api.service';

@Module({
  imports: [ConnectorsModule, TrendEngineModule],
  controllers: [DashboardApiController],
  providers: [DashboardApiService],
  exports: [DashboardApiService],
})
export class DashboardApiModule {}
