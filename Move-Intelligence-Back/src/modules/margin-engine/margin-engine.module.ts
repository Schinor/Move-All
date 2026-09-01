import { Module } from '@nestjs/common';
import { MarginEngineService } from './margin-engine.service';

@Module({
  providers: [MarginEngineService],
  exports: [MarginEngineService],
})
export class MarginEngineModule {}
