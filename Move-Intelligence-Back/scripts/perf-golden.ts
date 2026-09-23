import { NestFactory } from '@nestjs/core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/shared/database/prisma.service';
import { ConnectorsRegistry } from '../src/modules/connectors/connectors.registry';
import { TaxonomyService } from '../src/modules/catalog/taxonomy.service';
import { ProductsService } from '../src/modules/products/products.service';
import { CatalogReviewService } from '../src/modules/catalog/catalog-review.service';
import { cardRollupsIfAvailable, newDashboard, pickProbeCards } from './perf-shared';

/** Primeiro caminho em que a e b diferem (null se iguais). */
export function firstDiff(a: unknown, b: unknown, path = '$'): string | null {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array vs objeto`;
  const ka = Object.keys(a as object).sort();
  const kb = Object.keys(b as object).sort();
  if (ka.join('|') !== kb.join('|')) return `${path}: chaves [${ka.join(',')}] ≠ [${kb.join(',')}]`;
  for (const k of ka) {
    const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

async function main() {
  const save = process.argv.indexOf('--save');
  const compare = process.argv.indexOf('--compare');
  const dir = process.argv[(save >= 0 ? save : compare) + 1];
  if ((save < 0) === (compare < 0) || !dir) throw new Error('Use --save <pasta> ou --compare <pasta>');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const results: Record<string, unknown> = {};
  try {
    const prisma = app.get(PrismaService);
    const dash = newDashboard(prisma, app.get(ConnectorsRegistry), app.get(TaxonomyService), cardRollupsIfAvailable(app));
    const products = new ProductsService(prisma, undefined as never, undefined);
    const review = app.get(CatalogReviewService);
    const cards = await pickProbeCards(prisma);
    results['trends_200'] = await dash.listTrendingProducts({ limit: 200 } as never);
    results['ranking_p1'] = await dash.listTrendingProducts({ page: 1, pageSize: 20 } as never);
    results['ranking_p2_growth'] = await dash.listTrendingProducts({ page: 2, pageSize: 20, sort: 'growth_pct', dir: 'desc' } as never);
    results['summary'] = await dash.getDashboardSummary();
    results['recommendations'] = await dash.getRecommendations();
    for (const id of cards) {
      results[`product_${id}`] = await dash.getTrendProduct(id);
      for (const w of ['30d', '1y', 'all']) {
        results[`price_${w}_${id}`] = await products.getPriceHistory(id, w as never, undefined as never);
        results[`reviews_${w}_${id}`] = await products.getReviewHistory(id, w as never, undefined as never);
        results[`volume_${w}_${id}`] = await products.getVolumeHistory(id, w as never, undefined as never);
      }
      results[`price_30d_prev_${id}`] = await products.getPriceHistory(id, '30d' as never, 'previous' as never);
      results[`suppliers_${id}`] = await products.getSuppliers(id);
      results[`mc_defaults_${id}`] = await products.getMonteCarloDefaults(id);
      results[`listings_${id}`] = await review.listCardListings(id);
    }
  } finally {
    await app.close();
  }
  const normalized = JSON.parse(JSON.stringify(results)) as Record<string, unknown>;
  if (save >= 0) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    for (const [k, v] of Object.entries(normalized)) writeFileSync(join(dir, `${k}.json`), JSON.stringify(v, null, 1));
    console.log(`gravadas ${Object.keys(normalized).length} respostas em ${dir}`);
    return;
  }
  let failures = 0;
  for (const [k, v] of Object.entries(normalized)) {
    const file = join(dir, `${k}.json`);
    if (!existsSync(file)) { console.log(`FALTA ${k}`); failures += 1; continue; }
    const diff = firstDiff(JSON.parse(readFileSync(file, 'utf-8')), v);
    if (diff) { console.log(`DIFERENTE ${k} → ${diff.slice(0, 300)}`); failures += 1; }
  }
  console.log(failures === 0 ? `OK: ${Object.keys(normalized).length} respostas idênticas` : `${failures} diferença(s)`);
  if (failures) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
