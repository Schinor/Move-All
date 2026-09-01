import { Module } from '@nestjs/common';
import { OpportunityEngineService } from './opportunity-engine.service';

@Module({
  providers: [OpportunityEngineService],
  exports: [OpportunityEngineService],
})
export class OpportunityEngineModule {}
