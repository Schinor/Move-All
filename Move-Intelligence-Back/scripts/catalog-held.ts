import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { FichaService } from '../src/modules/catalog/ficha.service';

/** Fichas seguradas (status held): --report mostra o que mudaria; --apply atribui (com proteção das decisões de ADMIN). */
async function main() {
  const report = process.argv.includes('--report');
  const apply = process.argv.includes('--apply');
  if (report === apply) throw new Error('Use exatamente um: --report ou --apply');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const fichas = app.get(FichaService);
    console.log(JSON.stringify(report ? await fichas.previewHeld() : await fichas.applyHeld(), null, 2));
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
