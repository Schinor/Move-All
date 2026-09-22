import { Module } from '@nestjs/common';
import { DiscoveryTermsController } from './discovery-terms.controller';
import { DiscoveryTermsScheduler } from './discovery-terms.scheduler';
import { DiscoveryTermsService } from './discovery-terms.service';
import { DiscoverySearchService } from './discovery-search.service';

@Module({
  controllers: [DiscoveryTermsController],
  providers: [DiscoveryTermsService, DiscoveryTermsScheduler, DiscoverySearchService],
  exports: [DiscoveryTermsService, DiscoverySearchService],
})
export class RadarDiscoveryModule {}
