import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { CardAssignerService } from '../src/modules/catalog/card-assigner.service';
import { importManualFichas, parseFichaJsonLines } from '../src/modules/catalog/ficha-importer';
import { TaxonomyService } from '../src/modules/catalog/taxonomy.service';
import { PrismaService } from '../src/shared/database/prisma.service';

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Uso: npm run catalog:import-fichas -- <arquivo.jsonl>');
  if (process.env.FICHA_ENABLED === 'true') {
    throw new Error('FICHA_ENABLED=true detectado; mantenha FICHA_ENABLED=false antes do import manual');
  }
  process.env.FICHA_ENABLED = 'false';

  const content = await readFile(resolve(file), 'utf8');
  const lines = parseFichaJsonLines(content);
  if (lines.length === 0) throw new Error(`Nenhuma ficha JSON válida em ${file}`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const summary = await importManualFichas(lines, {
      prisma: app.get(PrismaService),
      taxonomy: app.get(TaxonomyService),
      assigner: app.get(CardAssignerService),
    });
    console.log(`catalog:import-fichas — ${JSON.stringify(summary)}`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
