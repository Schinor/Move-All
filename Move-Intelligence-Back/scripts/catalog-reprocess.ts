import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/shared/database/prisma.service';
import { FICHA_PROMPT_VERSION, PRIORITY } from '../src/modules/catalog/catalog.constants';
import { FichaService } from '../src/modules/catalog/ficha.service';
import { ProductsService } from '../src/modules/products/products.service';

/**
 * Enfileira TODOS os anúncios conhecidos para ficha (prioridade baixa) — spec 6.5.
 * Uso: npm run catalog:reprocess            (enfileira)
 *      npm run catalog:reprocess -- --prompt-version (reenvia fichas de outra versão)
 *      npm run catalog:reprocess -- --finalize   (recalcula scores quando a fila acabou)
 */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    if (process.argv.includes('--finalize')) {
      const pending = await prisma.listingFicha.count({ where: { status: 'pending', priority: PRIORITY.REPROCESS } });
      if (pending > 0) {
        console.log(`Ainda há ${pending} fichas de reprocessamento pendentes. Rode --finalize depois.`);
        return;
      }
      const products = app.get(ProductsService);
      let total = 0;
      for (let i = 0; i < 20; i += 1) {
        const batch = await products.simulateBatchForRanking(50);
        total += batch.simulated;
        if (batch.candidates === 0) break;
      }
      console.log(`Recalculados ${total} scores.`);
      return;
    }
    const modelIndex = process.argv.indexOf('--llm-model');
    if (modelIndex >= 0) {
      const llmModel = process.argv[modelIndex + 1];
      if (!llmModel) throw new Error('Informe o valor: --llm-model codex-manual');
      const result = await prisma.listingFicha.updateMany({
        where: { llmModel, status: { in: ['done', 'error'] } },
        data: { status: 'pending', priority: PRIORITY.REPROCESS, attempts: 0, lastError: null },
      });
      console.log(`catalog:reprocess --llm-model ${llmModel} — ${result.count} fichas voltaram para a fila.`);
      return;
    }
    const fichas = app.get(FichaService);
    const promptVersionOnly = process.argv.includes('--prompt-version');
    const seen = new Set<string>();
    let queued = 0;
    const register = async (marketplace: string, externalProductId: string, title: string, excerpt: string | null) => {
      const key = `${marketplace}::${externalProductId}`;
      if (seen.has(key)) return;
      seen.add(key);

      if (promptVersionOnly) {
        const existing = await prisma.listingFicha.findUnique({
          where: { marketplace_externalProductId: { marketplace, externalProductId } },
          select: { id: true, priority: true, promptVersion: true },
        });
        if (existing && existing.promptVersion !== FICHA_PROMPT_VERSION) {
          await prisma.listingFicha.update({
            where: { id: existing.id },
            data: {
              status: 'pending',
              priority: Math.max(existing.priority, PRIORITY.REPROCESS),
              attempts: 0,
              lastError: null,
            },
          });
          queued += 1;
          return;
        }
      }

      await fichas.registerListing({ marketplace, externalProductId, title, excerpt, priority: PRIORITY.REPROCESS });
      queued += 1;
      if (queued % 1000 === 0) console.log(`${queued} anúncios enfileirados…`);
    };
    let cursor: string | undefined;
    for (;;) {
      const products = await prisma.intelligenceProduct.findMany({
        orderBy: { id: 'asc' },
        take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, source: true, recordId: true, title: true, sourceSpecific: true },
      });
      if (products.length === 0) break;
      for (const p of products) {
        const specific = (p.sourceSpecific ?? {}) as Record<string, unknown>;
        await register(p.source, p.recordId, p.title, typeof specific['page_excerpt'] === 'string' ? (specific['page_excerpt'] as string) : null);
      }
      cursor = products.at(-1)?.id;
    }
    const items = await prisma.productClusterItem.findMany({ select: { marketplace: true, externalProductId: true } });
    for (const item of items) {
      const snap = await prisma.productListingSnapshot.findFirst({
        where: { marketplace: item.marketplace, externalProductId: item.externalProductId },
        orderBy: { collectedAt: 'desc' },
        select: { title: true },
      });
      await register(item.marketplace, item.externalProductId, snap?.title ?? item.externalProductId, null);
    }
    const mode = promptVersionOnly ? ` da versão ${FICHA_PROMPT_VERSION}` : '';
    console.log(`catalog:reprocess${mode} — ${queued} anúncios enfileirados. Ligue FICHA_ENABLED=true e acompanhe; depois rode --finalize.`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
