import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { CreateWatchlistItemDto } from './dto/create-watchlist-item.dto';
import {
  FillMonteCarloPremisesWithAiDto,
  RunMonteCarloBatchDto,
  RunMonteCarloDto,
} from './dto/run-monte-carlo.dto';
import { ProductsService } from './products.service';

@Public()
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /** Roda o Monte Carlo em lote para alimentar a coluna "Risco" do ranking. */
  @Post('monte-carlo/batch')
  runMonteCarloBatch(@Body() dto: RunMonteCarloBatchDto) {
    return this.products.simulateBatchForRanking(dto?.limit ?? 50);
  }

  @Get(':id/snapshots')
  getSnapshots(@Param('id') id: string) {
    return this.products.getSnapshots(id);
  }

  @Get(':id/suppliers')
  getSuppliers(@Param('id') id: string) {
    return this.products.getSuppliers(id);
  }

  @Get(':id/price-history')
  getPriceHistory(@Param('id') id: string, @Query('window') window?: string) {
    return this.products.getPriceHistory(id, window ?? '30d');
  }

  @Get(':id/review-history')
  getReviewHistory(@Param('id') id: string, @Query('window') window?: string) {
    return this.products.getReviewHistory(id, window ?? '30d');
  }

  @Get(':id/volume-history')
  getVolumeHistory(@Param('id') id: string, @Query('window') window?: string) {
    return this.products.getVolumeHistory(id, window ?? '30d');
  }

  @Get(':id/opportunity-score')
  getOpportunityScore(@Param('id') id: string) {
    return this.products.getOpportunityScore(id);
  }

  @Get(':id/monte-carlo/defaults')
  getMonteCarloDefaults(@Param('id') id: string) {
    return this.products.getMonteCarloDefaults(id);
  }

  @Post(':id/monte-carlo')
  runMonteCarlo(@Param('id') id: string, @Body() dto: RunMonteCarloDto) {
    return this.products.runMonteCarloSimulation(id, dto);
  }

  @Post(':id/monte-carlo/ai-premises')
  fillMonteCarloPremisesWithAi(
    @Param('id') id: string,
    @Body() dto: FillMonteCarloPremisesWithAiDto,
  ) {
    return this.products.fillMonteCarloPremisesWithAi(id, dto);
  }

  @Get(':id/ai-recommendation')
  getAiRecommendation(@Param('id') id: string) {
    return this.products.getAiRecommendation(id);
  }

  @Get(':id/export/pdf')
  exportPdf(@Param('id') id: string) {
    return this.products.exportPdf(id);
  }

  @Get(':id/export/csv')
  exportCsv(@Param('id') id: string) {
    return this.products.exportCsv(id);
  }

  @Get('compare')
  compareProducts(@Query('ids') ids?: string) {
    const list = ids ? ids.split(',').map((id) => id.trim()) : [];
    return this.products.compareProducts(list);
  }

  @Get(':id/unit-economics/defaults')
  getUnitEconomicsDefaults(@Param('id') id: string) {
    return this.products.getUnitEconomicsDefaults(id);
  }

  @Post(':id/unit-economics/simulate')
  simulateUnitEconomics(@Param('id') id: string, @Body() dto: any) {
    return this.products.simulateUnitEconomics(id, dto);
  }

  @Get(':id/competitors')
  getCompetitorMatrix(@Param('id') id: string) {
    return this.products.getCompetitorMatrix(id);
  }

  @Get(':id/seasonality-forecast')
  getSeasonalityForecast(@Param('id') id: string) {
    return this.products.getSeasonalityForecast(id);
  }

  @Post('watchlist')
  addToWatchlist(@Body() dto: CreateWatchlistItemDto) {
    return this.products.addToWatchlist(dto);
  }
}
