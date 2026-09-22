import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { RunIntelligenceCollectionDto } from '../src/modules/ingestion/dto/run-intelligence-collection.dto';
import { IntelligenceCollectionService } from '../src/modules/ingestion/intelligence-collection.service';
import { DiscoverySearchService } from '../src/modules/radar-discovery/discovery-search.service';

/**
 * Subprojeto D: busca os termos aprovados agora (mesmo caminho da coleta semanal).
 * --dry-run lista; --apply busca (chama a Bright Data: só com o ok do usuário). --max-terms N limita.
 */
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const apply = process.argv.includes('--apply');
  if (dryRun === apply) throw new Error('Use exatamente um: --dry-run ou --apply');
  const index = process.argv.indexOf('--max-terms');
  const maxTerms = index >= 0 ? Number.parseInt(process.argv[index + 1] ?? '', 10) : undefined;
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const intelligence = app.get(IntelligenceCollectionService);
    const summary = await app.get(DiscoverySearchService).runApproved({
      dryRun,
      maxTerms: Number.isFinite(maxTerms) ? maxTerms : undefined,
      runTerm: (request, category) =>
        intelligence.runTermAndWait(request as unknown as RunIntelligenceCollectionDto, category),
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
