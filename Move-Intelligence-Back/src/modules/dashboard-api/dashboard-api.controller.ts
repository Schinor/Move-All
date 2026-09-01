import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { DashboardApiService } from './dashboard-api.service';

@Public()
@Controller()
export class DashboardApiController {
  constructor(private readonly dashboard: DashboardApiService) {}

  @Get('trends/products')
  listTrendingProducts(@Query('limit') limit?: string) {
    return this.dashboard.listTrendingProducts(Number(limit ?? 50));
  }

  @Get('trends/products/:id')
  getTrendProduct(@Param('id') id: string) {
    return this.dashboard.getTrendProduct(id);
  }

  @Get('dashboard/summary')
  getDashboardSummary() {
    return this.dashboard.getDashboardSummary();
  }

  @Get('suppliers')
  getSuppliers(@Query('limit') limit?: string) {
    return this.dashboard.getSuppliers(Number(limit ?? 100));
  }

  @Get('sourcing/summary')
  getSourcingSummary() {
    return this.dashboard.getSourcingSummary();
  }

  @Get('sources/status')
  getSourcesStatus() {
    return this.dashboard.getSourcesStatus();
  }

  @Get('signals')
  getSignals() {
    return this.dashboard.getSignals();
  }

  @Get('signals/sources')
  getSignalSources() {
    return this.dashboard.getSignalSources();
  }

  @Get('markets')
  getMarkets() {
    return this.dashboard.getMarkets();
  }

  @Get('recommendations')
  getRecommendations() {
    return this.dashboard.getRecommendations();
  }

  @Get('pipeline')
  getPipeline() {
    return this.dashboard.getPipeline();
  }
}
