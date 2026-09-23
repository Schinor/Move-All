import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/shared/database/prisma.service';
import { ConnectorsRegistry } from '../src/modules/connectors/connectors.registry';
import { TaxonomyService } from '../src/modules/catalog/taxonomy.service';
import { ProductsService } from '../src/modules/products/products.service';
import { AlertsService } from '../src/modules/alerts/alerts.service';
import { CatalogReviewService } from '../src/modules/catalog/catalog-review.service';
import { cardRollupsIfAvailable, newDashboard, pickProbeCards } from './perf-shared';

/** Mede cada chamada 2x sem cache Redis e sem LLM (serviços montados sem cache e sem OpenRouter). */
async function time(label: string, fn: () => Promise<unknown>, runs = 2) {
  const out: number[] = [];
  let size = 0;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    const r = await fn();
    size = JSON.stringify(r ?? null).length;
    out.push(Math.round(performance.now() - t));
  }
  console.log(`${label.padEnd(44)} ${out.map((v) => `${v}ms`).join(' / ').padEnd(18)} ${(size / 1024).toFixed(0)} KB`);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const dash = newDashboard(prisma, app.get(ConnectorsRegistry), app.get(TaxonomyService), cardRollupsIfAvailable(app));
    const products = new ProductsService(prisma, undefined as never, undefined);
    const review = app.get(CatalogReviewService);
    const [big] = await pickProbeCards(prisma);
    console.log(`card de teste: ${big}\n`);
    await time('trends/products?limit=200 (tela inicial)', () => dash.listTrendingProducts({ limit: 200 } as never));
    await time('trends/products paginado (Ranking)', () => dash.listTrendingProducts({ page: 1, pageSize: 20 } as never));
    await time('dashboard/summary', () => dash.getDashboardSummary());
    await time('recommendations', () => dash.getRecommendations());
    await time('sources/status', () => dash.getSourcesStatus());
    await time('alerts', () => app.get(AlertsService).list());
    await time('trends/products/:id', () => dash.getTrendProduct(big));
    await time('products/:id/price-history 30d', () => products.getPriceHistory(big, '30d' as never, undefined as never));
    await time('products/:id/price-history all', () => products.getPriceHistory(big, 'all' as never, undefined as never));
    await time('products/:id/review-history 30d', () => products.getReviewHistory(big, '30d' as never, undefined as never));
    await time('products/:id/volume-history 30d prev', () => products.getVolumeHistory(big, '30d' as never, 'previous' as never));
    await time('products/:id/suppliers', () => products.getSuppliers(big));
    await time('products/:id/monte-carlo/defaults', () => products.getMonteCarloDefaults(big));
    await time('products/:id/offers', () => products.getOffers(big));
    await time('catalog/cards/:id/listings', () => review.listCardListings(big));
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
