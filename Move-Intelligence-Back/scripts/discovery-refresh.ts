import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DiscoveryTermsService } from '../src/modules/radar-discovery/discovery-terms.service';

/** Subprojeto D: atualiza a lista de termos em alta. `--dry-run` só mostra o que entraria. */
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const summary = await app.get(DiscoveryTermsService).refresh({ dryRun });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
