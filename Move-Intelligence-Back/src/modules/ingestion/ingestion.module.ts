import { Module } from '@nestjs/common';
import { ConnectorsModule } from '../connectors/connectors.module';
import { NormalizationModule } from '../normalization/normalization.module';
import { ProductMatchingModule } from '../product-matching/product-matching.module';
import { SnapshotsModule } from '../snapshots/snapshots.module';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { IntelligenceCollectionService } from './intelligence-collection.service';
import { WeeklyCollectionScheduler } from './weekly-collection.scheduler';

@Module({
  imports: [
    ConnectorsModule,
    NormalizationModule,
    ProductMatchingModule,
    SnapshotsModule,
  ],
  controllers: [IngestionController],
  providers: [IngestionService, IntelligenceCollectionService, WeeklyCollectionScheduler],
})
export class IngestionModule {}
