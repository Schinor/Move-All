import { Module } from '@nestjs/common';
import { SnapshotsService } from './snapshots.service';

@Module({
  providers: [SnapshotsService],
  exports: [SnapshotsService],
})
export class SnapshotsModule {}
