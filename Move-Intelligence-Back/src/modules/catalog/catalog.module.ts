import { Module } from '@nestjs/common';
import { AiGatewayModule } from '../ai-gateway/ai-gateway.module';
import { CardAssignerService } from './card-assigner.service';
import { CatalogCardsController } from './catalog-cards.controller';
import { CatalogReviewController } from './catalog-review.controller';
import { CatalogReviewService } from './catalog-review.service';
import { FichaScheduler } from './ficha.scheduler';
import { FichaService } from './ficha.service';
import { TaxonomyService } from './taxonomy.service';

@Module({
  imports: [AiGatewayModule],
  controllers: [CatalogReviewController, CatalogCardsController],
  providers: [TaxonomyService, CardAssignerService, FichaService, FichaScheduler, CatalogReviewService],
  exports: [TaxonomyService, CardAssignerService, FichaService],
})
export class CatalogModule {}
