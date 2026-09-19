import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatalogReviewService } from './catalog-review.service';

@Controller('catalog/cards')
export class CatalogCardsController {
  constructor(private readonly review: CatalogReviewService) {}

  @Get()
  search(@Query('q') q = '') {
    return this.review.searchCards(q);
  }

  @Get(':id/listings')
  listings(@Param('id') id: string) {
    return this.review.listCardListings(id);
  }
}
