import { Module } from '@nestjs/common';
import { NvidiaService } from './nvidia.service';
import { DatabaseModule } from '../../shared/database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [NvidiaService],
  exports: [NvidiaService],
})
export class AiGatewayModule {}
