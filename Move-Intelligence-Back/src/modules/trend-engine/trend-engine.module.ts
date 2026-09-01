import { Module } from '@nestjs/common';
import { TrendEngineService } from './trend-engine.service';

@Module({
  providers: [TrendEngineService],
  exports: [TrendEngineService],
})
export class TrendEngineModule {}
