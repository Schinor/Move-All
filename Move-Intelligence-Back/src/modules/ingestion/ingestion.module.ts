import { Module } from '@nestjs/common';
import { ConnectorsModule } from '../connectors/connectors.module';
import { CatalogModule } from '../catalog/catalog.module';
import { NormalizationModule } from '../normalization/normalization.module';
import { ProductsModule } from '../products/products.module';
import { RadarDiscoveryModule } from '../radar-discovery/radar-discovery.module';
import { SnapshotsModule } from '../snapshots/snapshots.module';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { IntelligenceCollectionService } from './intelligence-collection.service';
import { ExchangeRatesScheduler } from './exchange-rates.scheduler';
import { TrackListingsScheduler } from './track-listings.scheduler';
import { TrackingTiersService } from './tracking-tiers.service';
import { WeeklyCollectionScheduler } from './weekly-collection.scheduler';

@Module({
  imports: [
    ConnectorsModule,
    CatalogModule,
    NormalizationModule,
    ProductsModule,
    SnapshotsModule,
    RadarDiscoveryModule,
  ],
  controllers: [IngestionController],
  providers: [
    IngestionService,
    IntelligenceCollectionService,
    TrackingTiersService,
    WeeklyCollectionScheduler,
    TrackListingsScheduler,
    ExchangeRatesScheduler,
  ],
})
export class IngestionModule {}
