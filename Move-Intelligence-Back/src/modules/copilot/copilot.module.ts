import { Module } from '@nestjs/common';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';
import { AiGatewayModule } from '../ai-gateway/ai-gateway.module';
import { DashboardApiModule } from '../dashboard-api/dashboard-api.module';
import { DatabaseModule } from '../../shared/database/database.module';

@Module({
  imports: [
    DatabaseModule,
    AiGatewayModule,
    DashboardApiModule,
  ],
  controllers: [CopilotController],
  providers: [CopilotService],
  exports: [CopilotService],
})
export class CopilotModule {}
