import { Module } from '@nestjs/common';
import { ConnectorsModule } from '../connectors/connectors.module';
import { NormalizationModule } from '../normalization/normalization.module';
import { ProductMatchingModule } from '../product-matching/product-matching.module';
import { ProductsModule } from '../products/products.module';
import { SnapshotsModule } from '../snapshots/snapshots.module';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { IntelligenceCollectionService } from './intelligence-collection.service';
import { ExchangeRatesScheduler } from './exchange-rates.scheduler';
import { TrackListingsScheduler } from './track-listings.scheduler';
import { WeeklyCollectionScheduler } from './weekly-collection.scheduler';

@Module({
  imports: [
    ConnectorsModule,
    NormalizationModule,
    ProductMatchingModule,
    ProductsModule,
    SnapshotsModule,
  ],
  controllers: [IngestionController],
  providers: [
    IngestionService,
    IntelligenceCollectionService,
    WeeklyCollectionScheduler,
    TrackListingsScheduler,
    ExchangeRatesScheduler,
  ],
})
export class IngestionModule {}
