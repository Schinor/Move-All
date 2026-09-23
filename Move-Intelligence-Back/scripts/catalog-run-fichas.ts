import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { FichaService } from '../src/modules/catalog/ficha.service';

/** Processa a fila de fichas uma vez. --max-calls N (obrigatório) limita as chamadas à LLM; --hold segura sem atribuir card. */
async function main() {
  const index = process.argv.indexOf('--max-calls');
  const maxCalls = index >= 0 ? Number.parseInt(process.argv[index + 1] ?? '', 10) : NaN;
  if (!Number.isFinite(maxCalls) || maxCalls < 1) throw new Error('Informe --max-calls N (N ≥ 1)');
  const hold = process.argv.includes('--hold');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const summary = await app.get(FichaService).runOnce(undefined, { maxCalls, hold });
    console.log(JSON.stringify({ hold, maxCalls, ...summary }, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
