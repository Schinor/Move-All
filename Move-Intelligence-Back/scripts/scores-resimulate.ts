import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/shared/database/prisma.service';
import { ProductsService } from '../src/modules/products/products.service';

/**
 * Subprojeto B: força o lote oficial a recalcular todos os cards ativos (B-D7 muda
 * o custo mediano) e imprime a comparação de scores antes/depois.
 * Uso: npm run scores:resimulate            (só mostra quantos cards seriam resimulados)
 *      npm run scores:resimulate -- --apply (resimula)
 */
async function latestScores(prisma: PrismaService): Promise<Map<string, number | null>> {
  const rows = await prisma.productScore.findMany({
    orderBy: { computedAt: 'desc' },
    select: { productClusterId: true, score: true },
  });
  const map = new Map<string, number | null>();
  for (const row of rows) if (!map.has(row.productClusterId)) map.set(row.productClusterId, row.score);
  return map;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const active = await prisma.productCluster.count({ where: { cardStatus: { notIn: ['provisional', 'merged'] } } });
    if (!process.argv.includes('--apply')) {
      console.log(`${active} cards ativos seriam resimulados. Rode com --apply para executar.`);
      return;
    }
    const before = await latestScores(prisma);
    await prisma.productCluster.updateMany({
      where: { cardStatus: { notIn: ['provisional', 'merged'] } },
      data: { simulatedAt: null },
    });
    const products = app.get(ProductsService);
    let total = 0;
    for (let i = 0; i < 40; i += 1) {
      const batch = await products.simulateBatchForRanking(50);
      total += batch.simulated;
      if (batch.candidates === 0) break;
    }
    const after = await latestScores(prisma);
    let changed = 0;
    let deltaSum = 0;
    for (const [id, score] of after) {
      const prev = before.get(id);
      if (prev === undefined || prev === null || score === null || prev === score) continue;
      changed += 1;
      deltaSum += score - prev;
    }
    const offers = await prisma.offerScore.groupBy({ by: ['state'], _count: { _all: true } });
    console.log(`Resimulados: ${total}. Cards com score alterado: ${changed}. Variação média: ${changed ? (deltaSum / changed).toFixed(1) : '0'} pontos.`);
    console.log('offer_scores por estado:', offers.map((o) => `${o.state}=${o._count._all}`).join(', '));
  } finally {
    await app.close();
  }
}

void main();
