import { Module } from '@nestjs/common';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';
import { AiGatewayModule } from '../ai-gateway/ai-gateway.module';
import { TrendEngineModule } from '../trend-engine/trend-engine.module';
import { OpportunityEngineModule } from '../opportunity-engine/opportunity-engine.module';
import { MarginEngineModule } from '../margin-engine/margin-engine.module';
import { DatabaseModule } from '../../shared/database/database.module';

@Module({
  imports: [
    DatabaseModule,
    AiGatewayModule,
    TrendEngineModule,
    OpportunityEngineModule,
    MarginEngineModule,
  ],
  controllers: [CopilotController],
  providers: [CopilotService],
  exports: [CopilotService],
})
export class CopilotModule {}
