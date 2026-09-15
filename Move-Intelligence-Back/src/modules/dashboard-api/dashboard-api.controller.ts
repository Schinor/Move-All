import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { DashboardApiService } from './dashboard-api.service';

@Controller()
export class DashboardApiController {
  constructor(private readonly dashboard: DashboardApiService) {}

  @Get('trends/products')
  async listTrendingProducts(
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
    @Query('dir') dir?: string,
    @Query('category') category?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
    @Query('action') action?: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Res({ passthrough: true }) res?: any,
  ) {
    const result = await this.dashboard.listTrendingProducts({
      limit: Number(limit ?? 50),
      sort,
      dir,
      category,
      page: page !== undefined ? Number(page) : undefined,
      pageSize: pageSize !== undefined ? Number(pageSize) : undefined,
      action,
    });
    // C2: total no cabeçalho da resposta (e no corpo para clientes sem acesso ao header).
    if (result && typeof result === 'object' && Array.isArray((result as { items?: unknown }).items)) {
      const total = (result as { total: number }).total;
      // Fastify: FastifyReply.header (não existe setHeader como no Express).
      if (res) res.header('X-Total-Count', String(total));
      return result;
    }
    return result;
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

  @Get('search')
  search(@Query('q') q?: string, @Query('limit') limit?: string) {
    return this.dashboard.search(q ?? '', Number(limit ?? 20));
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

  @Get('recommendations/executive')
  getExecutiveRecommendation() {
    return this.dashboard.getExecutiveRecommendation();
  }

  @Get('pipeline')
  getPipeline() {
    return this.dashboard.getPipeline();
  }
}
