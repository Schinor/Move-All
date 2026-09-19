import { readFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { OpenRouterService } from '../src/modules/ai-gateway/openrouter.service';
import { FICHA_PROMPT_VERSION, fichaConfig } from '../src/modules/catalog/catalog.constants';
import { buildFichaInput } from '../src/modules/catalog/ficha-input';
import { parseFichaJsonLines, validateFicha } from '../src/modules/catalog/ficha-parser';
import { buildFichaSystemPrompt, buildFichaUserMessage } from '../src/modules/catalog/ficha-prompt';
import { TaxonomyService } from '../src/modules/catalog/taxonomy.service';

interface GoldItem {
  id: number; lang: string; title: string; gold_type: string; gold_ambiguous: boolean;
  gold_is_accessory_or_part: boolean; gold_is_kit_or_bundle: boolean;
}

/** Mapeamento do gabarito do teste cego para a taxonomia final (spec 5.5). */
function expected(item: GoldItem): { type: string | null; inScope: boolean } {
  if (item.gold_type === 'unknown') return { type: null, inScope: false };
  if (item.gold_is_accessory_or_part && item.gold_type === 'adjustable_dumbbell') return { type: 'dumbbell_handle', inScope: true };
  if (item.gold_is_accessory_or_part) return { type: null, inScope: true };
  return { type: item.gold_type, inScope: true };
}

async function main() {
  const gold = JSON.parse(readFileSync(join(__dirname, '../test/fixtures/catalog-eval/listings-gold.json'), 'utf-8')).items as GoldItem[];
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const cfg = fichaConfig();
    const types = await app.get(TaxonomyService).getTypeMap();
    const llm = app.get(OpenRouterService);
    const system = buildFichaSystemPrompt([...types.values()]);
    const results = new Map<number, ReturnType<typeof validateFicha>>();
    for (let i = 0; i < gold.length; i += cfg.batchSize) {
      const batch = gold.slice(i, i + cfg.batchSize);
      const response = await llm.chatCompletion(
        [{ role: 'system', content: system },
         { role: 'user', content: buildFichaUserMessage(batch.map((g, j) => ({ ref: `L${j + 1}`, text: buildFichaInput(g.title) }))) }],
        { endpointName: 'catalog-eval', model: cfg.model, maxTokens: cfg.maxTokens, timeoutMs: cfg.timeoutMs, temperature: 0.2 },
      );
      const byRef = new Map(parseFichaJsonLines(response.content).map((l) => [l.ref, l]));
      batch.forEach((g, j) => {
        const line = byRef.get(`L${j + 1}`);
        if (line) results.set(g.id, validateFicha(line, types));
      });
      console.log(`lote ${i / cfg.batchSize + 1}: ${byRef.size}/${batch.length} respostas`);
    }
    const row = { clear: [0, 0], ambiguous: [0, 0], scope: [0, 0], accessory: [0, 0, 0], missing: 0 };
    const byLang: Record<string, [number, number]> = {};
    for (const g of gold) {
      const r = results.get(g.id);
      if (!r) { row.missing += 1; continue; }
      const exp = expected(g);
      if (!exp.inScope) { row.scope[1] += 1; if (!r.inScope) row.scope[0] += 1; continue; }
      if (g.gold_is_accessory_or_part) { row.accessory[1] += 1; if (r.isAccessoryOrPart) row.accessory[0] += 1; }
      else if (r.isAccessoryOrPart) row.accessory[2] += 1;
      if (exp.type === null) continue;
      const ok = r.typeKey === exp.type ? 1 : 0;
      const bucket = g.gold_ambiguous ? row.ambiguous : row.clear;
      bucket[0] += ok; bucket[1] += 1;
      if (!g.gold_ambiguous) { byLang[g.lang] ??= [0, 0]; byLang[g.lang][0] += ok; byLang[g.lang][1] += 1; }
    }
    console.log(`\ncatalog:eval (${FICHA_PROMPT_VERSION}, modelo ${cfg.model ?? process.env.OPENROUTER_MODEL})`);
    console.log(`Tipo — casos claros: ${row.clear[0]}/${row.clear[1]} · ambíguos: ${row.ambiguous[0]}/${row.ambiguous[1]}`);
    console.log(`Por idioma (claros): ${Object.entries(byLang).map(([l, [a, b]]) => `${l} ${a}/${b}`).join(' · ')}`);
    console.log(`Fora do escopo detectado: ${row.scope[0]}/${row.scope[1]}`);
    console.log(`Acessório detectado: ${row.accessory[0]}/${row.accessory[1]} (falsos positivos: ${row.accessory[2]})`);
    console.log(`Sem resposta: ${row.missing}`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
