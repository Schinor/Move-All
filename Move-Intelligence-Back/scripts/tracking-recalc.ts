import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { TrackingTiersService } from '../src/modules/ingestion/tracking-tiers.service';

/** Subprojeto D: recalcula status e níveis de acompanhamento. --dry-run só mostra; --apply grava. */
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const apply = process.argv.includes('--apply');
  if (dryRun === apply) throw new Error('Use exatamente um: --dry-run ou --apply');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const summary = await app.get(TrackingTiersService).recalculate({ dryRun });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
