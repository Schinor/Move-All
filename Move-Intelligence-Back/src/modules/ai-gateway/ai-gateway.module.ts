import { Module } from '@nestjs/common';
import { OpenRouterService } from './openrouter.service';
import { DatabaseModule } from '../../shared/database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [OpenRouterService],
  exports: [OpenRouterService],
})
export class AiGatewayModule {}
