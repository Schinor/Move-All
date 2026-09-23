# Plano de implementação — Coleta real, pendências e desempenho

> **Para o agente executor (Codex):** execute as tarefas **na ordem, até o fim do plano, sem esperar "ok" entre elas**. Ao terminar cada uma: marque os checkboxes e escreva um bloco "**Registro Tarefa N:**" logo abaixo dela, com a saída dos testes e o `git diff --stat`. Se um teste deste plano falhar de um jeito que o plano não previu, **pare e explique**; não altere o teste para passar. As únicas paradas previstas estão na **Tarefa 15**: pare ali e peça o "ok" explícito do usuário antes de cada passo marcado.

**Objetivo:** resolver as pendências do C e do D, deixar a coleta real pronta e segura para ligar (agendada pelo Nest) e deixar a plataforma mais rápida sem mudar nada visível.

**Arquitetura:**
- **Primeiro**, grava as respostas atuais da API (`perf:golden`). Toda otimização é conferida contra essa gravação.
- **Pendências:**
  - um método único para o caminho do ETL;
  - acompanhamento que não estraga anúncios sem a Bright Data;
  - filtro de relevância na descoberta;
  - fichas com limite de chamadas e modo "segurar";
  - proteção das decisões de ADMIN;
  - `localStorage` isolado nos testes do frontend.
- **Coleta real:** pipeline `search-trends` no `main.py`, com cron no Nest, e o compose local com as flags desligadas.
- **Desempenho:**
  - cache que junta pedidos e usa `SCAN`;
  - tabela `card_rollups` com o resultado da consulta pesada;
  - consultas mais enxutas na página do produto, nas séries e na recomendação por IA.

**Stack:** NestJS 11 + Prisma 6 + Postgres 16 (jest); Python 3 + SQLAlchemy + pytest; Angular 21 standalone (vitest via `ng test`).

**Especificação:** [SPEC_COLETA_REAL_E_DESEMPENHO.md](SPEC_COLETA_REAL_E_DESEMPENHO.md). Leia antes de começar.

## Pré-requisitos

- [x] `git log --oneline -3` mostra `2130aff` (Subprojeto D) no topo da branch `feat/catalogo-card`.
- [x] `docker ps` mostra `move-postgres`, `move-redis`, `move-backend` e `move-frontend`.
- [x] Os containers ainda usam o override `/private/tmp/move-all-task11-override.yaml`, com os crons desligados. **Não religue crons** até a Tarefa 14: o banco precisa ficar parado para as comparações da Parte C.

## Regras globais

- **Sem commit, sem push, sem branch nova.**
- **Nenhuma chamada à LLM** antes da Tarefa 15. **Nenhuma chamada à Bright Data** neste plano. Mostre a contagem de `ai_call_logs` no começo e no fim.
- **O banco não pode mudar de conteúdo** entre a Tarefa 1 (gravação do `perf:golden`) e a Tarefa 13 (última comparação). Não rode coleta, reprocessamento, `tracking:recalc --apply`, `discovery:refresh` nem os scripts de fichas nesse intervalo. Migrations aditivas podem, porque só criam tabelas e colunas novas.
- Arquivos não commitados que **não são deste trabalho** e devem ficar intactos: `planos_executados/`, `*.webp` na raiz, `.playwright-cli/`, `docker-compose.production.yml`, `ai.md`, `architecture-flow.mermaid`, `docs/`, `ESTRUTURA_BANCO_DADOS_MOCK.md`, os `.md` removidos da raiz e `Move-Intelligence-Back/scripts/catalog-generate-manual-fichas.ts`. No `docker-compose.yml`, **só** acrescente as linhas da Tarefa 7. As outras mudanças dele são do usuário.
- **Banco:** só mudanças aditivas, via `prisma/migrations/<timestamp>_<nome>/migration.sql`, aplicadas com `docker exec -i move-postgres psql -U move -d move_intelligence -v ON_ERROR_STOP=1 < arquivo` e seguidas de `npx prisma generate`. **Nada de `prisma db push`.**
- **Scripts locais do Nest:** `INCLUDE_SYNTHETIC_DATA=true`, e `PYTHON_BIN=/usr/local/bin/python3` quando chamam o Python.
- **Python:** use `/Users/raul/Desktop/Move-Sandbox/Move-Intelligence-Dados/.venv/bin/python` (tem pytest e SQLAlchemy), chamado de `<python>` abaixo. Comando: `cd Move-Intelligence-Dados && <python> -m pytest tests -q`.
- **Testes:**
  - backend: `cd Move-Intelligence-Back && npx jest <caminho>`; no fim, `npm test` e `npx tsc --noEmit -p tsconfig.json`;
  - frontend: `cd Move-Intelligence-Front && NODE_OPTIONS=--localstorage-file=/private/tmp/move-front-vitest-localstorage npx ng test --watch=false` e, separado, `npx ng build`.
- Ao remover ou mover código, rode o `tsc` logo depois e confira que nenhum método vizinho foi junto.
- Deixe `move-backend` e `move-frontend` rodando no final.

## Mapa de arquivos

| Arquivo | Ação | Tarefa |
|---|---|---|
| `Move-Intelligence-Back/scripts/perf-probe.ts`, `scripts/perf-golden.ts`, `package.json` | Criar/Modificar | 1 |
| `Move-Intelligence-Back/src/modules/ingestion/intelligence-collection.service.ts` (+ spec) | Modificar | 2, 6 |
| `Move-Intelligence-Dados/app/pipelines/run_track_listings.py`, `app/etl/extract/marketplace/common.py`, `tests/test_track_listings.py` | Modificar | 3 |
| `Move-Intelligence-Dados/app/etl/transform/term_match.py`, `tests/test_term_match.py` | Criar | 4 |
| `Move-Intelligence-Dados/app/pipelines/run_live_intelligence.py`, `tests/test_discovery_tracking.py` | Modificar | 4 |
| `Move-Intelligence-Back/src/modules/radar-discovery/discovery-search.service.ts` (+ spec) | Modificar | 4 |
| `Move-Intelligence-Back/src/modules/catalog/ficha.service.ts`, `card-assigner.service.ts` (+ specs) | Modificar | 5 |
| `Move-Intelligence-Back/scripts/catalog-run-fichas.ts`, `scripts/catalog-held.ts`, `scripts/catalog-reprocess.ts` | Criar/Modificar | 5 |
| `Move-Intelligence-Front/src/test-setup.ts`, `angular.json` | Criar/Modificar | 5b |
| `Move-Intelligence-Dados/main.py`, `tests/test_search_trends.py` | Modificar | 6 |
| `Move-Intelligence-Back/src/modules/ingestion/search-trends.scheduler.ts`, `ingestion.module.ts` | Criar/Modificar | 6 |
| `docker-compose.yml` (só o serviço `backend`), `CHECKLIST_COLETA_REAL.md`, `Move-Intelligence-Back/.env.example` | Modificar/Criar | 7 |
| `Move-Intelligence-Back/src/shared/redis/redis-cache.service.ts` (+ spec) | Modificar | 8 |
| `Move-Intelligence-Back/src/modules/dashboard-api/dashboard-api.service.ts` | Modificar | 8, 9, 10 |
| `Move-Intelligence-Back/prisma/migrations/20260923120000_card_rollups/migration.sql`, `schema.prisma` | Criar/Modificar | 9 |
| `Move-Intelligence-Back/src/shared/card-rollups/*` | Criar | 9 |
| `Move-Intelligence-Back/src/modules/products/products.service.ts` (+ spec) | Modificar | 11, 12 |
| `Move-Intelligence-Back/src/modules/catalog/catalog-review.service.ts`, `taxonomy.service.ts`, `src/modules/imports/imports.processor.ts`, `src/app.module.ts` | Modificar | 9 |

---

### Tarefa 1: Medição e gravação das respostas atuais ("antes")

**Arquivos:**
- Criar: `Move-Intelligence-Back/scripts/perf-probe.ts`
- Criar: `Move-Intelligence-Back/scripts/perf-golden.ts`
- Modificar: `Move-Intelligence-Back/package.json`

**Interfaces:**
- Produz: `npm run perf:probe` e `npm run perf:golden -- --save <pasta> | --compare <pasta>`. As Tarefas 8 a 14 comparam contra a pasta `/private/tmp/move-golden-antes`.

- [x] **Passo 1: `scripts/perf-probe.ts`**

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/shared/database/prisma.service';
import { ConnectorsRegistry } from '../src/modules/connectors/connectors.registry';
import { TaxonomyService } from '../src/modules/catalog/taxonomy.service';
import { ProductsService } from '../src/modules/products/products.service';
import { AlertsService } from '../src/modules/alerts/alerts.service';
import { CatalogReviewService } from '../src/modules/catalog/catalog-review.service';
import { cardRollupsIfAvailable, newDashboard, pickProbeCards } from './perf-shared';

/** Mede cada chamada 2x sem cache Redis e sem LLM (serviços montados sem cache e sem OpenRouter). */
async function time(label: string, fn: () => Promise<unknown>, runs = 2) {
  const out: number[] = [];
  let size = 0;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    const r = await fn();
    size = JSON.stringify(r ?? null).length;
    out.push(Math.round(performance.now() - t));
  }
  console.log(`${label.padEnd(44)} ${out.map((v) => `${v}ms`).join(' / ').padEnd(18)} ${(size / 1024).toFixed(0)} KB`);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const dash = newDashboard(prisma, app.get(ConnectorsRegistry), app.get(TaxonomyService), cardRollupsIfAvailable(app));
    const products = new ProductsService(prisma, undefined as never, undefined);
    const review = app.get(CatalogReviewService);
    const [big] = await pickProbeCards(prisma);
    console.log(`card de teste: ${big}\n`);
    await time('trends/products?limit=200 (tela inicial)', () => dash.listTrendingProducts({ limit: 200 } as never));
    await time('trends/products paginado (Ranking)', () => dash.listTrendingProducts({ page: 1, pageSize: 20 } as never));
    await time('dashboard/summary', () => dash.getDashboardSummary());
    await time('recommendations', () => dash.getRecommendations());
    await time('sources/status', () => dash.getSourcesStatus());
    await time('alerts', () => app.get(AlertsService).list());
    await time('trends/products/:id', () => dash.getTrendProduct(big));
    await time('products/:id/price-history 30d', () => products.getPriceHistory(big, '30d' as never, undefined as never));
    await time('products/:id/price-history all', () => products.getPriceHistory(big, 'all' as never, undefined as never));
    await time('products/:id/review-history 30d', () => products.getReviewHistory(big, '30d' as never, undefined as never));
    await time('products/:id/volume-history 30d prev', () => products.getVolumeHistory(big, '30d' as never, 'previous' as never));
    await time('products/:id/suppliers', () => products.getSuppliers(big));
    await time('products/:id/monte-carlo/defaults', () => products.getMonteCarloDefaults(big));
    await time('products/:id/offers', () => products.getOffers(big));
    await time('catalog/cards/:id/listings', () => review.listCardListings(big));
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Crie também `scripts/perf-shared.ts`:

```ts
import { INestApplicationContext } from '@nestjs/common';
import { PrismaService } from '../src/shared/database/prisma.service';
import { DashboardApiService } from '../src/modules/dashboard-api/dashboard-api.service';

/** Até a Tarefa 9 não existe CardRollupsService: devolve undefined sem quebrar. */
export function cardRollupsIfAvailable(app: INestApplicationContext): never {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../src/shared/card-rollups/card-rollups.service');
    return app.get(mod.CardRollupsService, { strict: false }) as never;
  } catch {
    return undefined as never;
  }
}

/** Monta o DashboardApiService sem cache e sem OpenRouter; o 6º argumento (CardRollupsService) só existe a partir da Tarefa 9. */
export function newDashboard(prisma: PrismaService, connectors: unknown, taxonomy: unknown, cardRollups: unknown): DashboardApiService {
  const Ctor = DashboardApiService as unknown as new (...args: unknown[]) => DashboardApiService;
  return new Ctor(prisma, connectors, undefined, undefined, taxonomy, cardRollups);
}

/** 3 cards fixos: maior, do meio e menor em número de anúncios contados (desempate por id). */
export async function pickProbeCards(prisma: PrismaService): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ cluster_id: string }>>(
    `select cluster_id from product_cluster_items where status in ('confirmed','auto')
     group by cluster_id order by count(*) desc, cluster_id asc`,
  );
  const ids = rows.map((r) => r.cluster_id);
  return [ids[0], ids[Math.floor(ids.length / 2)], ids[ids.length - 1]];
}
```

- [x] **Passo 2: `scripts/perf-golden.ts`**

```ts
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
```

No `package.json`, junto dos outros scripts:

```json
    "perf:probe": "node --env-file-if-exists=.env -r ts-node/register -r tsconfig-paths/register scripts/perf-probe.ts",
    "perf:golden": "node --env-file-if-exists=.env -r ts-node/register -r tsconfig-paths/register scripts/perf-golden.ts",
```

- [x] **Passo 3: gravar o "antes" e medir**

```bash
cd Move-Intelligence-Back && INCLUDE_SYNTHETIC_DATA=true npm run perf:probe | tee /private/tmp/move-perf-antes.txt
cd Move-Intelligence-Back && INCLUDE_SYNTHETIC_DATA=true npm run perf:golden -- --save /private/tmp/move-golden-antes
cd Move-Intelligence-Back && INCLUDE_SYNTHETIC_DATA=true npm run perf:golden -- --compare /private/tmp/move-golden-antes
```
Expected: a medição mostra números perto dos do §3 da especificação; o `--save` grava cerca de 50 arquivos; o `--compare` logo em seguida dá `OK`.

**Se o `--compare` imediato der diferença**, há um campo que muda a cada chamada, como uma hora "agora". Nesse caso, acrescente à função `firstDiff` uma lista `VOLATILE_KEYS` com **só** esses nomes de chave (ignorados na comparação), registre quais são e grave de novo.

**Registro Tarefa 1:**
- Linha de base capturada antes de qualquer alteração no repositório. `ai_call_logs` no início: **375**.
- `perf:probe` inicial: tela inicial 725/593 ms; Ranking 582/600 ms; resumo 536/524 ms; recomendações 582/554 ms; produto 199/167 ms. A gravação permanente seguinte mediu 751/658, 582/551, 535/543, 585/596 e 212/187 ms, respectivamente.
- `perf:golden -- --save /private/tmp/move-golden-antes`: **47 respostas gravadas**. Comparação imediata: **OK: 47 respostas idênticas**. Nenhuma chave volátil precisou ser ignorada.
- `git diff --stat`: `Move-Intelligence-Back/package.json | 2 ++` (os três runners novos aparecem como arquivos não rastreados e não entram no diff estatístico padrão).

---

### Tarefa 2: Caminho do ETL (`??` → `||`)

**Arquivos:** Modificar `Move-Intelligence-Back/src/modules/ingestion/intelligence-collection.service.ts` (+ `.spec.ts`)

**Interfaces:** Produz o método privado `dataDirectory(): string`, usado também pela Tarefa 6.

- [x] **Passo 1: teste que falha** — no fim do spec:

```ts
describe('IntelligenceCollectionService — caminho do ETL', () => {
  const original = process.env.MOVE_INTELLIGENCE_DATA_DIR;
  afterEach(() => { process.env.MOVE_INTELLIGENCE_DATA_DIR = original; });

  it('variável vazia usa o caminho padrão', () => {
    const { service } = buildService();
    process.env.MOVE_INTELLIGENCE_DATA_DIR = '';
    expect((service as any).dataDirectory()).toMatch(/Move-Intelligence-Dados$/);
  });

  it('variável preenchida é respeitada', () => {
    const { service } = buildService();
    process.env.MOVE_INTELLIGENCE_DATA_DIR = '/app/data';
    expect((service as any).dataDirectory()).toBe('/app/data');
  });
});
```

- [x] **Passo 2: rodar e ver falhar** — `npx jest src/modules/ingestion/intelligence-collection.service.spec.ts` (FAIL: `dataDirectory` não existe).

- [x] **Passo 3: implementar** — acrescente:

```ts
  /** Pasta do ETL Python. `||` (não `??`): variável vazia no .env cai no padrão. */
  private dataDirectory(): string {
    return resolve(
      process.env.MOVE_INTELLIGENCE_DATA_DIR || resolve(process.cwd(), '..', 'Move-Intelligence-Dados'),
    );
  }
```

Troque os 4 blocos `const dataDirectory = resolve(process.env.MOVE_INTELLIGENCE_DATA_DIR ?? resolve(process.cwd(), '..', 'Move-Intelligence-Dados'));` (em `runPython`, `runPythonWeekly`, `runPythonTrack` e `refreshExchangeRates`) por `const dataDirectory = this.dataDirectory();`. Confira com `grep -n "MOVE_INTELLIGENCE_DATA_DIR" src` que sobrou só o método novo.

- [x] **Passo 4: rodar e ver passar** — `npx jest src/modules/ingestion && npx tsc --noEmit -p tsconfig.json`.

**Registro Tarefa 2:**
- Teste primeiro: 2 falhas esperadas (`dataDirectory is not a function`); 8 testes já existentes passaram.
- Validação final: Jest de `src/modules/ingestion` — **3 suítes, 20 testes passaram**; `npx tsc --noEmit -p tsconfig.json` — **passou**.
- `rg -n "MOVE_INTELLIGENCE_DATA_DIR" src`: no serviço restou somente a leitura dentro de `dataDirectory()`; outras ocorrências são os testes.
- `git diff --stat -- Move-Intelligence-Back/src/modules/ingestion/intelligence-collection.service.ts Move-Intelligence-Back/src/modules/ingestion/intelligence-collection.service.spec.ts`: **2 arquivos, 29 inserções(+), 16 remoções(-)**.

---

### Tarefa 3: Acompanhamento seguro sem Bright Data configurada (Python + Nest)

**Arquivos:**
- Modificar: `Move-Intelligence-Dados/app/etl/extract/marketplace/common.py` (`BrightDataClient.is_configured`)
- Modificar: `Move-Intelligence-Dados/app/pipelines/run_track_listings.py` (`_classify_error`, `run`)
- Modificar: `Move-Intelligence-Dados/tests/test_track_listings.py`
- Modificar: `Move-Intelligence-Back/src/modules/ingestion/intelligence-collection.service.ts` (`executeTrackListings`) (+ spec)

**Interfaces:** Produz `BrightDataClient.is_configured() -> bool` e o resumo `{"status": "not_configured", ...}` do `track-listings`.

- [x] **Passo 1: testes que falham** — no fim de `tests/test_track_listings.py`:

```python
def test_erro_de_configuracao_do_mcp_nao_vira_not_found():
    from app.etl.extract.marketplace.common import BrightDataMcpError, BrightDataRequestError
    from app.pipelines.run_track_listings import _classify_error

    config = BrightDataMcpError(
        "MCP Bright Data 'bright_data' não encontrado no Codex; configure-o localmente ou defina BRIGHTDATA_MCP_URL no servidor"
    )
    assert _classify_error(config) == "error"
    assert _classify_error(BrightDataMcpError("BRIGHTDATA_MCP_URL não configurada e descoberta pelo Codex desativada")) == "error"
    assert _classify_error(BrightDataMcpError("Falha de conexão com o MCP Bright Data")) == "error"
    assert _classify_error(BrightDataRequestError(404, "Not Found")) == "not_found"
    assert _classify_error(BrightDataMcpError("MCP Bright Data rejeitou a solicitação: 404 Not Found")) == "not_found"


def test_sem_bright_data_configurada_nao_toca_nos_anuncios(tmp_path, monkeypatch):
    database_url = f"sqlite:///{tmp_path / 'track.db'}"
    db = get_session(database_url)
    try:
        listing = _seed_listing(db)
        listing_id = listing.id
    finally:
        db.close()

    monkeypatch.setattr(
        "app.pipelines.run_track_listings.BrightDataClient.is_configured", lambda self: False
    )
    summary = run(database_url=database_url, max_calls=10)
    assert summary["status"] == "not_configured"
    assert summary["processed"] == 0

    db = get_session(database_url)
    try:
        row = db.get(TrackedListingModel, listing_id)
        assert row.consecutive_failures == 0
        assert db.query(ListingObservationModel).filter_by(listing_id=listing_id).count() == 0
    finally:
        db.close()
```

Antes, confira em `common.py` a assinatura de `BrightDataRequestError`. O plano usa `BrightDataRequestError(status_code, body)`, como em `raise BrightDataRequestError(response.status_code, body)`. Se `_seed_listing` já grava uma observação, troque o `== 0` da observação por "a mesma contagem de antes do `run`", sem mudar o que o teste verifica.

- [x] **Passo 2: rodar e ver falhar** — `<python> -m pytest tests/test_track_listings.py -q`.

- [x] **Passo 3: implementar**

Em `BrightDataClient` (`common.py`), depois de `collection_method`:

```python
    def is_configured(self) -> bool:
        """Há como chamar a Bright Data? REST: API key. MCP: URL definida ou descoberta pelo Codex."""
        if self.provider == "rest":
            return bool(self.api_key)
        try:
            return bool(self._resolve_mcp_url())
        except BrightDataMcpError:
            return False
```

Em `run_track_listings.py`, importe `BrightDataMcpError` de `app.etl.extract.marketplace.common` e troque `_classify_error` por:

```python
# Erros de configuração/transporte do MCP nunca contam para DEAD (spec §4.2).
_MCP_NOT_PAGE_ERRORS = (
    "no codex",
    "não configurada",
    "nao configurada",
    "descoberta pelo codex",
    "falha de conexão",
    "falha de conexao",
    "sessão",
    "sessao",
    "inicializa",
    "excedeu o tempo",
    "retornou http 5",
)


def _classify_error(error: Exception) -> str:
    """'not_found' | 'blocked' | 'error'.

    `blocked` (403/captcha) nunca conta para DEAD; erro genérico tem o mesmo
    tratamento conservador do bloqueio (backoff, sem contar para DEAD).
    Configuração/transporte do MCP ausente ou instável é sempre 'error'.
    """
    message = str(error or "").casefold()
    if isinstance(error, BrightDataMcpError) and any(marker in message for marker in _MCP_NOT_PAGE_ERRORS):
        return "error"
    status = getattr(error, "status", None)
    try:
        status_code = int(status) if status is not None else None
    except (TypeError, ValueError):
        status_code = None
    if status_code == 404 or "not found" in message or "não encontrad" in message:
        return "not_found"
    if status_code == 403 or "captcha" in message or "blocked" in message or "bloque" in message:
        return "blocked"
    return "error"
```

Confira no código atual se o status do erro fica em `status` ou em `status_code`, e mantenha o atributo que já é usado.

Em `run(...)`, logo depois de `active_client = client or BrightDataClient()`:

```python
    if client is None and not active_client.is_configured():
        LOGGER.error("Bright Data não configurada (BRIGHTDATA_MCP_URL/API key): acompanhamento não executado.")
        return {
            "status": "not_configured",
            "dry_run": dry_run,
            "due_selected": 0,
            "processed": 0,
            "failures": 0,
            "observation_ids": [],
        }
```

No Nest, em `executeTrackListings`, logo depois de `const summary = await this.runPythonTrack(dto);`:

```ts
      if (summary.status === 'not_configured') {
        await this.prisma.collectionJob.update({
          where: { id: jobId },
          data: {
            status: CollectionStatus.FAILED,
            finishedAt: new Date(),
            stats: this.toJson(summary),
            errorMessage: 'Bright Data não configurada: acompanhamento não executado.',
          },
        });
        return;
      }
```

E o teste no spec do Nest:

```ts
  it('track-listings sem Bright Data configurada: job FAILED e nada é recalculado', async () => {
    const { service, prisma, tiers } = buildService();
    jest.spyOn(service as any, 'runPythonTrack').mockResolvedValue({ status: 'not_configured', processed: 0, observation_ids: [] });
    await (service as any).executeTrackListings('job-t', new RunTrackListingsDto());
    const last = prisma.collectionJob.update.mock.calls.at(-1)![0];
    expect(last.data.status).toBe('FAILED');
    expect(last.data.errorMessage).toContain('Bright Data não configurada');
    expect(tiers.recalculate).not.toHaveBeenCalled();
  });
```

- [x] **Passo 4: rodar e ver passar** — `<python> -m pytest tests -q` e `npx jest src/modules/ingestion && npx tsc --noEmit -p tsconfig.json`.

**Registro Tarefa 3:**
- Testes antes da implementação: **2 falhas esperadas** — classificação incorreta do erro de configuração e ausência de `is_configured()`.
- `tests/test_track_listings.py`: **9 passaram**; suíte Python completa: **117 passaram, 3 ignorados**.
- `npx jest src/modules/ingestion --runInBand`: **3 suítes, 21 testes passaram**; `npx tsc --noEmit -p tsconfig.json`: **passou**.
- Nenhuma chamada à Bright Data foi feita. O caminho `not_configured` retorna antes de abrir a sessão do banco; o teste verifica zero observações e zero falhas no anúncio. No Nest, o job fica `FAILED` e não chama simulação nem recálculo de tiers.
- `git diff --stat` (arquivos da Tarefa 3; inclui também a alteração da Tarefa 2 no serviço compartilhado): **5 arquivos, 133 inserções(+), 17 remoções(-)**.

---

### Tarefa 4: Precisão da descoberta (filtro de relevância + sem 1688 nos termos US)

**Arquivos:**
- Criar: `Move-Intelligence-Dados/app/etl/transform/term_match.py` e `tests/test_term_match.py`
- Modificar: `Move-Intelligence-Dados/app/pipelines/run_live_intelligence.py` (`_keep_candidate`, `source_stats`)
- Modificar: `Move-Intelligence-Back/src/modules/radar-discovery/discovery-search.service.ts` (+ spec)

**Interfaces:** Produz `title_matches_term(title: str, term: str) -> bool` e `normalize_term(value: str) -> str`.

- [x] **Passo 1: testes que falham** — `tests/test_term_match.py`:

```python
from app.etl.transform.term_match import normalize_term, title_matches_term


def test_normaliza_como_o_backend():
    assert normalize_term("  Step   Aeróbico, Ajustável! ") == "step aerobico ajustavel"


def test_metade_das_palavras_do_termo():
    term = "adjustable aerobic step"
    assert not title_matches_term("Adjustable Dumbbell & Weight Bench, Fitness Equipment", term)
    assert not title_matches_term("Stair Stepper for Home, Folding Stair Climber", term)
    assert title_matches_term("Fitness Equipment Adjustable Aerobic Step Stepper Pvc Material", term)
    assert title_matches_term("Aerobic Step Platform", term)


def test_plural_e_titulo_vazio():
    assert title_matches_term("NIKE Adjustable Dumbbell Set 50lb", "nike adjustable dumbbells")
    assert title_matches_term("", "nike adjustable dumbbells")
    assert title_matches_term("qualquer coisa", "gym set")  # termo só com palavras genéricas
```

No fim de `tests/test_discovery_tracking.py`:

```python
def test_exact_term_nao_raspa_resultado_sem_relacao(monkeypatch):
    from app.pipelines import run_live_intelligence as live

    captured = {}

    class FakeExtractor:
        def __init__(self, client=None):
            pass

        def extract(self, query, limit, concurrency, candidate_filter):
            candidates = [
                {"url": "https://www.amazon.com/dp/B0AAAAAAA1", "title": "Adjustable Dumbbell & Weight Bench"},
                {"url": "https://www.amazon.com/dp/B0AAAAAAA2", "title": "Adjustable Aerobic Step Platform"},
            ]
            kept = [c for c in candidates if candidate_filter(c)]
            captured["kept"] = [c["title"] for c in kept]
            return {"records": [], "errors": [], "metadata": {"source": "amazon", "records_count": 0, "relevance_skipped": len(candidates) - len(kept)}}

    monkeypatch.setattr(live, "_extractor_registry", lambda: {"amazon": FakeExtractor})
    live.run(term="adjustable aerobic step", sources=["amazon"], include_demand=False, dry_run=True, exact_term=True)
    assert captured["kept"] == ["Adjustable Aerobic Step Platform"]
```

Antes, confira em `run_live_intelligence.run` o nome da variável que guarda o registro de extratores (`registry = _extractor_registry()` ou parecido) e se o `dry_run=True` evita o banco (o `load_tracked_keys` já é pulado em dry-run). Ajuste o `monkeypatch` para o nome real, sem mudar o que o teste verifica.

No spec do `DiscoverySearchService`, troque a expectativa das fontes US para `['amazon', 'alibaba', 'aliexpress']` (o teste que usa `DISCOVERY_SOURCES.US` continua valendo).

- [x] **Passo 2: rodar e ver falhar** — `<python> -m pytest tests/test_term_match.py tests/test_discovery_tracking.py -q`.

- [x] **Passo 3: implementar** — `app/etl/transform/term_match.py`:

```python
"""Relevância do título ao termo buscado (descoberta com --exact-term).

Mesma normalização e mesmas palavras genéricas do filtro de termos do backend
(Move-Intelligence-Back/src/modules/radar-discovery/discovery-candidates.ts).
"""

from __future__ import annotations

import math
import re
import unicodedata

GENERIC_WORDS = {
    "de", "da", "do", "das", "dos", "para", "com", "sem", "em", "the", "for", "with", "and", "of", "me",
    "buy", "price", "preco", "cheap", "barato", "used", "usado", "amazon", "machine", "maquina", "aparelho",
    "equipment", "equipamento", "set", "kit", "fitness", "gym", "academia", "home", "casa",
}


def normalize_term(value: str) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").lower())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^a-z0-9 ]", " ", text)
    return " ".join(text.split())


def _counting(value: str) -> list[str]:
    return [w for w in normalize_term(value).split() if len(w) >= 3 and w not in GENERIC_WORDS]


def title_matches_term(title: str, term: str) -> bool:
    """True se o título tem pelo menos metade (arredondada para cima) das palavras do termo."""
    words = list(dict.fromkeys(_counting(term)))
    if not words or not normalize_term(title):
        return True
    title_words: set[str] = set()
    for w in _counting(title):
        title_words.add(w)
        if w.endswith("s"):
            title_words.add(w[:-1])
    hits = sum(1 for w in words if w in title_words or (w.endswith("s") and w[:-1] in title_words))
    return hits >= math.ceil(len(words) / 2)
```

Em `run_live_intelligence.py`, importe `title_matches_term`. Troque `_keep_candidate` por:

```python
    relevance_skipped: dict[str, int] = {}

    def _keep_candidate(source: str, candidate: Mapping[str, Any]) -> bool:
        # Subprojeto E-D1/§4.3: com --exact-term, não raspa resultado sem relação com o termo.
        if exact_term and not title_matches_term(str(candidate.get("title") or ""), requested_term):
            relevance_skipped[source] = relevance_skipped.get(source, 0) + 1
            return False
        url = candidate_url(candidate)
        if not url:
            return True
        return (source, extract_native_id(url, source)) not in tracked_keys
```

Onde `collect_source` devolve `result["metadata"]`, acrescente antes: `result["metadata"]["relevance_skipped"] = relevance_skipped.get(source, 0)`.

Em `discovery-search.service.ts`:

```ts
/** Spec D-D3 + §4.3: termo BR → marketplaces BR; termo US → Amazon US + fornecedores (1688 não responde a inglês). */
export const DISCOVERY_SOURCES: Record<string, string[]> = {
  BR: ['amazon_br', 'mercado_livre', 'shopee_br'],
  US: ['amazon', 'alibaba', 'aliexpress'],
};
```

- [x] **Passo 4: rodar e ver passar** — `<python> -m pytest tests -q` e `npx jest src/modules/radar-discovery`.

**Registro Tarefa 4:**
- Testes antes da implementação: coleta interrompida no erro esperado `No module named app.etl.transform.term_match`.
- Testes direcionados após implementar: **18 passaram**. Suíte Python: **121 passaram, 3 ignorados**. Jest de `src/modules/radar-discovery`: **4 suítes, 20 testes passaram**.
- O teste de relevância usa um extrator fake, `dry_run=True` e não grava no banco principal; confirma que o título irrelevante é descartado e `relevance_skipped=1`. US agora seleciona `amazon`, `alibaba` e `aliexpress`.
- `git diff --stat` (arquivos rastreados da Tarefa 4): **4 arquivos, 40 inserções(+), 2 remoções(-)**. `term_match.py` e `test_term_match.py` são novos e não aparecem no diff estatístico padrão.

---

### Tarefa 5: Fichas sob controle, modo "segurar" e proteção das decisões de ADMIN

**Arquivos:**
- Modificar: `Move-Intelligence-Back/src/modules/catalog/ficha.service.ts` (+ spec)
- Modificar: `Move-Intelligence-Back/src/modules/catalog/card-assigner.service.ts` (+ spec)
- Criar: `Move-Intelligence-Back/scripts/catalog-run-fichas.ts`, `scripts/catalog-held.ts`
- Modificar: `Move-Intelligence-Back/scripts/catalog-reprocess.ts`, `package.json`

**Interfaces:**
- Produz:
  - `runOnce(now?: () => Date, opts?: { maxCalls?: number; hold?: boolean })`, com `stoppedBy` ganhando `'max_calls'`;
  - `previewHeld(): Promise<HeldReport>` e `applyHeld(): Promise<{ applied: number; blocked: number }>`;
  - `moveListing(..., opts: { deferRefresh?: boolean; guardHuman?: boolean })`, que devolve também `blocked?: boolean`;
  - `assign(ficha, opts: { deferRefresh?: boolean; guardHuman?: boolean })`;
  - `humanDecisionCard(listing): Promise<string | null>`.

- [x] **Passo 1: testes que falham**

No `card-assigner.service.spec.ts`, usando o `build()` e os mocks que o arquivo já tem (acrescente `catalogDecision.findFirst` e `catalogReviewItem` se faltarem):

```ts
  it('guardHuman: anúncio posto no card por ADMIN não muda de card; abre revisão', async () => {
    const { service, prisma } = build();
    prisma.productClusterItem.findUnique.mockResolvedValue({ id: 'i1', clusterId: 'card-admin', status: 'confirmed' });
    prisma.catalogDecision.findFirst.mockResolvedValue({ after: { clusterId: 'card-admin', listing: { marketplace: 'amazon', externalProductId: 'X' } } });
    const ensure = jest.spyOn(service, 'ensureListingReview').mockResolvedValue(undefined);
    const out = await service.moveListing({ marketplace: 'amazon', externalProductId: 'X' }, 'card-outro', 'confirmed', { guardHuman: true });
    expect(out.blocked).toBe(true);
    expect(prisma.productClusterItem.update).not.toHaveBeenCalled();
    expect(ensure).toHaveBeenCalledWith({ marketplace: 'amazon', externalProductId: 'X' }, 'card-admin', 'ficha refeita discorda da decisão do ADMIN');
  });

  it('guardHuman: sem decisão de ADMIN, move normalmente', async () => {
    const { service, prisma } = build();
    prisma.productClusterItem.findUnique.mockResolvedValue({ id: 'i1', clusterId: 'card-a', status: 'auto' });
    prisma.catalogDecision.findFirst.mockResolvedValue(null);
    const out = await service.moveListing({ marketplace: 'amazon', externalProductId: 'X' }, 'card-b', 'confirmed', { guardHuman: true, deferRefresh: true });
    expect(out.blocked).toBeFalsy();
    expect(prisma.productClusterItem.update).toHaveBeenCalled();
  });

  it('humanDecisionCard consulta só decisões de ADMIN não desfeitas do anúncio', async () => {
    const { service, prisma } = build();
    prisma.catalogDecision.findFirst.mockResolvedValue(null);
    await service.humanDecisionCard({ marketplace: 'amazon', externalProductId: 'X' });
    const where = prisma.catalogDecision.findFirst.mock.calls[0][0].where;
    expect(where).toEqual(expect.objectContaining({
      actorUserId: { not: null },
      undoneByDecisionId: null,
      AND: [
        { after: { path: ['listing', 'marketplace'], equals: 'amazon' } },
        { after: { path: ['listing', 'externalProductId'], equals: 'X' } },
      ],
    }));
  });
```

No `ficha.service.spec.ts`, também com os mocks do arquivo:

```ts
  it('runOnce com hold grava held e não atribui card', async () => {
    // Prepare 1 ficha pendente, FICHA_ENABLED=true e uma resposta válida da LLM, como nos testes existentes de runOnce.
    // Depois:
    // expect(prisma.listingFicha.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'held' }) }));
    // expect(assigner.assign).not.toHaveBeenCalled();
  });

  it('runOnce com maxCalls para ao atingir o limite', async () => {
    // Com 2 lotes pendentes e maxCalls = 1: summary.calls === 1 e summary.stoppedBy === 'max_calls'.
  });

  it('applyHeld grava done e atribui com guardHuman', async () => {
    // prisma.listingFicha.findMany → [ficha held]; depois:
    // expect(prisma.listingFicha.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { status: 'done' } });
    // expect(assigner.assign).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }), { deferRefresh: true, guardHuman: true });
  });
```

Os três testes de `ficha.service.spec.ts` devem ser escritos por completo (os comentários mostram o que verificar), usando **o mesmo preparo dos testes de `runOnce` que já existem no arquivo** (mock do `OpenRouterService.chatCompletion` devolvendo linhas JSON válidas e `process.env.FICHA_ENABLED = 'true'`). Nenhuma chamada real.

- [x] **Passo 2: rodar e ver falhar** — `npx jest src/modules/catalog`.

- [x] **Passo 3: implementar — `CardAssignerService`**

```ts
  /** Card em que um ADMIN colocou o anúncio (decisão mais recente, não desfeita), ou null. */
  async humanDecisionCard(listing: ListingRef): Promise<string | null> {
    const decision = await this.prisma.catalogDecision.findFirst({
      where: {
        actorUserId: { not: null },
        undoneByDecisionId: null,
        AND: [
          { after: { path: ['listing', 'marketplace'], equals: listing.marketplace } },
          { after: { path: ['listing', 'externalProductId'], equals: listing.externalProductId } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: { after: true },
    });
    const after = (decision?.after ?? null) as { clusterId?: string | null } | null;
    return after?.clusterId ?? null;
  }
```

Em `moveListing`:
- o tipo de `opts` passa a ser `{ deferRefresh?: boolean; guardHuman?: boolean }`;
- o retorno passa a ser `Promise<{ fromClusterId: string | null; touched: string[]; blocked?: boolean }>`;
- logo depois de ler `current`, acrescente:

```ts
    if (opts.guardHuman && current && current.clusterId !== targetClusterId) {
      const adminCard = await this.humanDecisionCard(listing);
      if (adminCard && adminCard === current.clusterId) {
        await this.ensureListingReview(listing, current.clusterId, 'ficha refeita discorda da decisão do ADMIN');
        return { fromClusterId: current.clusterId, touched: [], blocked: true };
      }
    }
```

Em `assign(ficha, opts: { deferRefresh?: boolean; guardHuman?: boolean } = {})`, depois de **cada** `const moved = await this.moveListing(...)` (também em `assignNewDifferential`, que recebe `opts`), acrescente logo abaixo:

```ts
    if (moved.blocked) return { outcome: 'error_review', clusterId: current?.clusterId ?? null, touched: [] };
```

Use o nome da variável `current` que existe em cada trecho. Em `assignNewDifferential`, o `moveListing` da linha que usa `{ deferRefresh: true }` para **outros** anúncios passa a usar `{ deferRefresh: true, guardHuman: opts.guardHuman }`, e um `blocked` ali só é pulado (`continue`), sem interromper os demais.

- [x] **Passo 4: implementar — `FichaService`**
  1. Assinatura: `async runOnce(now: () => Date = () => new Date(), opts: { maxCalls?: number; hold?: boolean } = {})`. Acrescente `'max_calls'` ao tipo de `stoppedBy` em `FichaRunSummary`.
  2. Logo antes de `const response = await requestBatch(batch);`, acrescente: `if (opts.maxCalls !== undefined && summary.calls >= opts.maxCalls) { await this.assigner.refreshMany(refresh); return { ...summary, stoppedBy: 'max_calls' }; }`.
  3. Onde grava o resultado, troque `status: 'done'` por `status: opts.hold ? 'held' : 'done'`. Envolva a atribuição: `if (!opts.hold) { const result = await this.assigner.assign(updated, { deferRefresh: true }); refresh.push(...this.refreshPairs(result)); }`.
  4. `copyFromTwin(ficha, deferRefresh, hold = false)`: com `hold`, procura gêmea com `status: { in: ['done', 'held'] }`, grava `status: 'held'` e devolve `null` sem atribuir. Nesse caso, conte `summary.copied += 1` num ramo próprio. Em `runOnce`, passe `opts.hold === true`.
  5. Acrescente:

```ts
  async previewHeld(): Promise<HeldReport> {
    const held = await this.prisma.listingFicha.findMany({ where: { status: 'held' } });
    const types = await this.taxonomy.getTypeMap();
    const report: HeldReport = { total: held.length, counts: {}, examples: {} };
    for (const ficha of held) {
      const listing = { marketplace: ficha.marketplace, externalProductId: ficha.externalProductId };
      const item = await this.prisma.productClusterItem.findUnique({ where: { marketplace_externalProductId: listing } });
      const card = item ? await this.prisma.productCluster.findUnique({ where: { id: item.clusterId }, select: { cardKey: true, canonicalName: true } }) : null;
      let outcome: HeldOutcome;
      const type = ficha.typeKey ? types.get(ficha.typeKey) : undefined;
      if (ficha.inScope === false) outcome = 'fora_do_escopo';
      else if (!type) outcome = 'tipo_sugerido';
      else if (!item) outcome = 'novo';
      else {
        const key = evaluateCardKey(type, (ficha.cardKeyValues ?? {}) as Record<string, unknown>, ficha.newDifferential).cardKey;
        outcome = key === card?.cardKey ? 'fica' : 'muda';
      }
      if ((outcome === 'muda' || outcome === 'fora_do_escopo' || outcome === 'tipo_sugerido') && item
        && (await this.assigner.humanDecisionCard(listing)) === item.clusterId) outcome = 'revisao_admin';
      report.counts[outcome] = (report.counts[outcome] ?? 0) + 1;
      const list = (report.examples[outcome] ??= []);
      if (list.length < 20) list.push({ title: ficha.title, from: card?.canonicalName ?? null, typeKey: ficha.typeKey });
    }
    return report;
  }

  async applyHeld(): Promise<{ applied: number; blocked: number }> {
    const held = await this.prisma.listingFicha.findMany({ where: { status: 'held' }, orderBy: { updatedAt: 'asc' } });
    const refresh: Array<{ clusterId: string; lastDestination: string | null }> = [];
    let applied = 0;
    let blocked = 0;
    for (const ficha of held) {
      const updated = await this.prisma.listingFicha.update({ where: { id: ficha.id }, data: { status: 'done' } });
      const result = await this.assigner.assign(updated, { deferRefresh: true, guardHuman: true });
      if (result.outcome === 'error_review') blocked += 1;
      refresh.push(...this.refreshPairs(result));
      applied += 1;
    }
    await this.assigner.refreshMany(refresh);
    return { applied, blocked };
  }
```

Tipos, junto de `FichaRunSummary`:

```ts
export type HeldOutcome = 'fica' | 'muda' | 'fora_do_escopo' | 'tipo_sugerido' | 'revisao_admin' | 'novo';
export interface HeldReport {
  total: number;
  counts: Partial<Record<HeldOutcome, number>>;
  examples: Partial<Record<HeldOutcome, Array<{ title: string; from: string | null; typeKey: string | null }>>>;
}
```

Importe `evaluateCardKey` de `./card-key`.

- [x] **Passo 5: scripts**

`scripts/catalog-run-fichas.ts`:

```ts
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
```

`scripts/catalog-held.ts`:

```ts
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
```

Em `scripts/catalog-reprocess.ts`, acrescente o modo `--llm-model <valor>` logo depois do bloco `--finalize`:

```ts
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
```

No `package.json`:

```json
    "catalog:run-fichas": "node --env-file-if-exists=.env -r ts-node/register -r tsconfig-paths/register scripts/catalog-run-fichas.ts",
    "catalog:held": "node --env-file-if-exists=.env -r ts-node/register -r tsconfig-paths/register scripts/catalog-held.ts",
```

- [x] **Passo 6: rodar e ver passar** — `npx jest src/modules/catalog && npx tsc --noEmit -p tsconfig.json`. **Não rode os scripts agora** (a Tarefa 15 faz isso, com autorização).

**Registro Tarefa 5:**
- Testes antes da implementação: falhas de compilação esperadas para as novas opções e interfaces (`maxCalls`, `applyHeld`, `guardHuman`, `humanDecisionCard`).
- Validação final: Jest de `src/modules/catalog` — **13 suítes, 115 testes passaram**; `npx tsc --noEmit -p tsconfig.json` — **passou**.
- `runOnce` suporta `maxCalls` e `hold`; gêmeas em hold ficam `held` sem atribuição; `previewHeld` e `applyHeld` foram implementados; anúncios atribuídos por ADMIN não são movidos e recebem revisão. Scripts de operação criados, mas não executados. **Nenhuma chamada à LLM ou Bright Data foi feita.**
- `git diff --stat` (arquivos rastreados da Tarefa 5): **6 arquivos, 222 inserções(+), 15 remoções(-)**. `catalog-run-fichas.ts` e `catalog-held.ts` são novos e não aparecem no diff estatístico padrão.

---

### Tarefa 5b: `localStorage` isolado nos testes do frontend

**Arquivos:** Criar `Move-Intelligence-Front/src/test-setup.ts`; modificar `Move-Intelligence-Front/angular.json`.

- [x] **Passo 1: `src/test-setup.ts`**

```ts
/**
 * Storage em memória por arquivo de teste. Evita que specs paralelos que
 * limpam o localStorage (ex.: auth.guard.spec) apaguem o token de outro spec
 * (auth.interceptor.spec) através do arquivo compartilhado de --localstorage-file.
 */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.has(key) ? (this.data.get(key) as string) : null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, String(value)); }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, name, { value: storage, configurable: true, writable: true });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, name, { value: storage, configurable: true, writable: true });
  }
}
```

- [x] **Passo 2: `angular.json`** — no alvo `test`:

```json
        "test": {
          "builder": "@angular/build:unit-test",
          "options": {
            "setupFiles": ["src/test-setup.ts"]
          }
        }
```

Se o `tsconfig.spec.json` não incluir o arquivo, acrescente `"src/test-setup.ts"` em `files` ou `include`.

- [x] **Passo 3: 5 execuções seguidas**

```bash
cd Move-Intelligence-Front && for i in 1 2 3 4 5; do NODE_OPTIONS=--localstorage-file=/private/tmp/move-front-vitest-localstorage npx ng test --watch=false 2>&1 | grep -E "Test Files|Tests " ; done
```
Expected: as 5 execuções verdes. Se `auth.interceptor.spec.ts` ainda falhar, **pare e explique**: a hipótese do storage compartilhado estaria errada.

**Registro Tarefa 5b:**
- `ng test --watch=false`: **5/5 execuções passaram**, cada uma com **15 arquivos de teste e 59 testes** verdes.
- `git diff --stat` (arquivos rastreados): **2 arquivos, 5 inserções(+), 1 remoção(-)**. `src/test-setup.ts` é novo e não aparece no diff estatístico padrão.

---

### Tarefa 6: Radar pelo Nest (pipeline `search-trends` + cron)

**Arquivos:**
- Modificar: `Move-Intelligence-Dados/main.py`; teste em `tests/test_search_trends.py`
- Modificar: `Move-Intelligence-Back/src/modules/ingestion/intelligence-collection.service.ts` (+ spec)
- Criar: `Move-Intelligence-Back/src/modules/ingestion/search-trends.scheduler.ts`
- Modificar: `Move-Intelligence-Back/src/modules/ingestion/ingestion.module.ts`

**Interfaces:** Produz `IntelligenceCollectionService.runSearchTrends(opts?: { maxRequests?: number }): Promise<PipelineSummary>` e o `SearchTrendsScheduler`.

- [x] **Passo 1: testes que falham**

Python (`tests/test_search_trends.py`, no fim):

```python
def test_main_search_trends_emite_resumo(monkeypatch, capsys):
    import main as entrypoint

    monkeypatch.setattr(entrypoint.run_search_trends, "run", lambda **kw: {"attempted": 0, "ok": 0, "kw": kw})
    monkeypatch.setattr("sys.argv", ["main.py", "--pipeline", "search-trends", "--max-requests", "3"])
    entrypoint.main()
    out = capsys.readouterr().out
    line = [l for l in out.splitlines() if l.startswith("MOVE_ETL_RESULT=")][0]
    assert '"max_requests": 3' in line
```

Nest (spec de ingestão):

```ts
describe('IntelligenceCollectionService — radar (search-trends)', () => {
  it('runSearchTrends chama o pipeline search-trends e trava execução dupla', async () => {
    const { service } = buildService();
    let release!: () => void;
    const spawn = jest.spyOn(service as any, 'spawnPython').mockImplementation(
      () => new Promise((r) => { release = () => r({ attempted: 1 }); }),
    );
    const first = service.runSearchTrends({ maxRequests: 2 });
    await expect(service.runSearchTrends()).rejects.toThrow('Radar já está rodando');
    release();
    await first;
    expect(spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['--pipeline', 'search-trends', '--max-requests', '2']));
  });
});
```

- [x] **Passo 2: rodar e ver falhar.**

- [x] **Passo 3: implementar**

`main.py`:
1. Acrescente `"search-trends"` às escolhas de `--pipeline`.
2. Acrescente os argumentos `--max-requests` (int) e `--force` (store_true), se não existirem.
3. Acrescente o ramo:

```python
        elif pipeline == "search-trends":
            result = run_search_trends.run(
                database_url=args.database_url,
                dry_run=args.dry_run,
                max_requests=args.max_requests,
                force=args.force,
            )
            print("MOVE_ETL_RESULT=" + __import__("json").dumps(result, ensure_ascii=False, default=str))
```

Importe `run_search_trends` como os outros pipelines. Confira a assinatura de `run_search_trends.run` e use os nomes reais dos parâmetros.

No `IntelligenceCollectionService`:

```ts
  private searchTrendsRunning = false;

  /** Radar do Google Trends (Subprojeto C) disparado pelo Nest (spec E-D3). */
  async runSearchTrends(opts: { maxRequests?: number } = {}): Promise<PipelineSummary> {
    if (this.searchTrendsRunning) throw new ConflictException('Radar já está rodando');
    this.searchTrendsRunning = true;
    try {
      const dataDirectory = this.dataDirectory();
      const mainFile = resolve(dataDirectory, 'main.py');
      if (!existsSync(mainFile)) throw new Error(`Move-Intelligence-Dados não encontrado em ${dataDirectory}`);
      const args = [mainFile, '--pipeline', 'search-trends'];
      if (opts.maxRequests) args.push('--max-requests', String(opts.maxRequests));
      return await this.spawnPython(dataDirectory, args);
    } finally {
      this.searchTrendsRunning = false;
    }
  }
```

No teste, o `existsSync` pode falhar fora do repositório. Se falhar, faça `jest.spyOn(require('node:fs'), 'existsSync').mockReturnValue(true)` **no teste**. Não mude a regra.

`search-trends.scheduler.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DiscoveryTermsService } from '../radar-discovery/discovery-terms.service';
import { IntelligenceCollectionService } from './intelligence-collection.service';

/** Radar semanal (spec §5.1). Só com SEARCH_TRENDS_CRON_ENABLED=true — nunca liga sozinho em produção (custo). */
@Injectable()
export class SearchTrendsScheduler {
  private readonly logger = new Logger(SearchTrendsScheduler.name);

  constructor(
    private readonly intelligence: IntelligenceCollectionService,
    private readonly terms: DiscoveryTermsService,
  ) {}

  @Cron(process.env.SEARCH_TRENDS_CRON || '0 20 * * 0', { name: 'search-trends', timeZone: 'America/Sao_Paulo' })
  async run() {
    if (process.env.SEARCH_TRENDS_CRON_ENABLED !== 'true') return;
    try {
      const summary = await this.intelligence.runSearchTrends();
      this.logger.log(`Radar: ${JSON.stringify(summary)}`);
      const refreshed = await this.terms.refresh();
      this.logger.log(`Termos em alta atualizados: ${refreshed.created} novos`);
    } catch (error) {
      this.logger.warn(`Radar não concluído: ${error instanceof Error ? error.message : error}`);
    }
  }
}
```

Em `ingestion.module.ts`, acrescente `SearchTrendsScheduler` em `providers`. O `RadarDiscoveryModule` já está em `imports` e exporta `DiscoveryTermsService`.

- [x] **Passo 4: rodar e ver passar** — `<python> -m pytest tests -q` e `npx jest src/modules/ingestion && npx tsc --noEmit -p tsconfig.json`.

**Registro Tarefa 6:**
- Testes antes da implementação: o teste Python falhou porque `main` ainda não expunha `run_search_trends`; o Jest falhou porque `runSearchTrends` não existia.
- Validação final: teste Python direcionado **1 passou**; suíte Python **122 passaram, 3 ignorados**; Jest de ingestão **3 suítes, 22 testes passaram**; `npx tsc --noEmit -p tsconfig.json` **passou**.
- Adicionado `--pipeline search-trends`, resumo `MOVE_ETL_RESULT=`, limite de requisições no Nest e cron domingo 20:00 em `America/Sao_Paulo`, condicionado a `SEARCH_TRENDS_CRON_ENABLED=true`. O teste do Nest substitui o processo Python; scheduler/pipeline não foram executados, portanto nenhum termo foi atualizado e nenhuma chamada externa foi feita.
- `git diff --stat` (arquivos rastreados, incluindo alterações anteriores no serviço compartilhado): **5 arquivos, 112 inserções(+), 16 remoções(-)**. `search-trends.scheduler.ts` é novo e não aparece no diff estatístico padrão.

---

### Tarefa 7: Compose local, `.env.example` e checklist de produção

**Arquivos:** Modificar `docker-compose.yml` (só o serviço `backend`) e `Move-Intelligence-Back/.env.example`; criar `CHECKLIST_COLETA_REAL.md`.

- [x] **Passo 1: `docker-compose.yml`** — no `environment` do serviço `backend`, logo depois da linha `WEEKLY_COLLECTION_CRON_ENABLED: ...`, acrescente **só** estas linhas:

```yaml
      # Coleta real (plano de coleta real): tudo desligado por padrão no ambiente local.
      FICHA_ENABLED: ${FICHA_ENABLED:-false}
      TRACK_LISTINGS_CRON_ENABLED: ${TRACK_LISTINGS_CRON_ENABLED:-false}
      RADAR_DISCOVERY_ENABLED: ${RADAR_DISCOVERY_ENABLED:-false}
      SEARCH_TRENDS_CRON_ENABLED: ${SEARCH_TRENDS_CRON_ENABLED:-false}
```

Confira com `git diff docker-compose.yml` que as mudanças do usuário que já existiam continuam iguais e que só essas 5 linhas são novas.

- [x] **Passo 2: `.env.example` do backend** — acrescente no fim:

```bash
# Plano de coleta real e desempenho
SEARCH_TRENDS_CRON_ENABLED=false
SEARCH_TRENDS_CRON=0 20 * * 0
CARD_ROLLUPS_CRON=*/30 * * * *
CARD_ROLLUPS_MAX_AGE_SECONDS=3600
```

- [x] **Passo 3: `CHECKLIST_COLETA_REAL.md`** — escreva o checklist com as 6 seções do §5.3 da especificação. Use os nomes exatos das variáveis e dos crons do código:
  - `WEEKLY_COLLECTION_CRON` / `_ENABLED`, `TRACK_LISTINGS_CRON` / `_ENABLED`, `TRACK_LISTINGS_MAX_CALLS`;
  - `FICHA_ENABLED`, `FICHA_CRON`, `FICHA_DAILY_CALL_LIMIT`;
  - `SEARCH_TRENDS_CRON` / `_ENABLED`, `DISCOVERY_TERMS_CRON`, `RADAR_DISCOVERY_ENABLED`, `RADAR_DISCOVERY_MAX_TERMS`, `DISCOVERY_MAX_CALLS`;
  - `CARD_ROLLUPS_CRON`, `BRIGHTDATA_MCP_URL`, `OPENROUTER_API_KEY`, `EXCHANGE_RATES_CRON_ENABLED`.
  
  Em cada passo da ordem para ligar, inclua uma consulta SQL de conferência. Por exemplo, para o acompanhamento: `select status, count(*) from collection_jobs where category='track_listings' and created_at > now() - interval '1 day' group by 1;`. Para ver se nenhum anúncio está sendo encerrado indevidamente: `select count(*) from tracked_listings where status='DEAD' and last_seen_at > now() - interval '3 days';`.
  
  **Não escreva valores de chaves.**

**Registro Tarefa 7:**
- Validação: `docker compose config --quiet` — **passou**; `git diff --check -- docker-compose.yml Move-Intelligence-Back/.env.example CHECKLIST_COLETA_REAL.md` — **passou**. A reversão do diff do Compose capturado antes da tarefa corresponde byte a byte ao `HEAD`, confirmando que as alterações preexistentes do usuário foram preservadas.
- Acrescentadas apenas as 5 linhas especificadas ao serviço `backend`; exemplo de ambiente atualizado com 4 variáveis e comentário; checklist criado com as 6 seções, SQLs de conferência e sem valores de segredos.
- `git diff --stat` (arquivos rastreados): `Move-Intelligence-Back/.env.example | 6 ++++++`; `docker-compose.yml | 41 ++++++++++++++++++++-----------------` (**28 inserções, 19 remoções no arquivo todo; as mudanças anteriores do usuário permanecem**). `CHECKLIST_COLETA_REAL.md` é novo (121 linhas) e não aparece no diff estatístico padrão.

---

### Tarefa 8: Cache — pedidos juntos, `SCAN` e resumo com cache

**Arquivos:**
- Modificar: `Move-Intelligence-Back/src/shared/redis/redis-cache.service.ts`; criar ou estender `redis-cache.service.spec.ts`
- Modificar: `Move-Intelligence-Back/src/modules/dashboard-api/dashboard-api.service.ts` (`getDashboardSummary`)

- [x] **Passo 1: testes que falham** — `src/shared/redis/redis-cache.service.spec.ts` (crie, se não existir):

```ts
import { RedisCacheService } from './redis-cache.service';

describe('RedisCacheService', () => {
  it('wrap junta pedidos simultâneos da mesma chave (uma execução)', async () => {
    const cache = new RedisCacheService();
    let calls = 0;
    const factory = async () => { calls += 1; await new Promise((r) => setTimeout(r, 20)); return { ok: calls }; };
    const [a, b, c] = await Promise.all([cache.wrap('k', 60, factory), cache.wrap('k', 60, factory), cache.wrap('k', 60, factory)]);
    expect(calls).toBe(1);
    expect(a).toEqual({ ok: 1 });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('wrap libera a chave quando a factory falha', async () => {
    const cache = new RedisCacheService();
    await expect(cache.wrap('x', 60, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(cache.wrap('x', 60, async () => 'ok')).resolves.toBe('ok');
  });

  it('delPattern usa SCAN (não KEYS)', async () => {
    const cache = new RedisCacheService();
    const client = {
      scan: jest.fn().mockResolvedValueOnce(['5', ['a:1', 'a:2']]).mockResolvedValueOnce(['0', ['a:3']]),
      del: jest.fn().mockResolvedValue(1),
      keys: jest.fn(),
    };
    (cache as any).client = client;
    (cache as any).isConnected = true;
    await cache.delPattern('a:*');
    expect(client.keys).not.toHaveBeenCalled();
    expect(client.scan).toHaveBeenCalledWith('0', 'MATCH', 'a:*', 'COUNT', 200);
    expect(client.del).toHaveBeenCalledWith('a:1', 'a:2');
    expect(client.del).toHaveBeenCalledWith('a:3');
  });
});
```

Confira os nomes dos campos privados (`client`, `isConnected`) e o construtor do serviço. Ele pode exigir config: nesse caso, crie a instância do mesmo jeito que outros testes já fazem e ajuste só o preparo.

- [x] **Passo 2: rodar e ver falhar.**

- [x] **Passo 3: implementar**

```ts
  private readonly inflight = new Map<string, Promise<unknown>>();

  async wrap<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null && cached !== undefined) return cached;
    const running = this.inflight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const job = (async () => {
      const fresh = await factory();
      if (fresh !== null && fresh !== undefined) await this.set(key, fresh, ttlSeconds);
      return fresh;
    })();
    this.inflight.set(key, job);
    try {
      return await job;
    } finally {
      this.inflight.delete(key);
    }
  }
```

Em `delPattern`, troque `const keys = await this.client.keys(pattern); if (keys.length > 0) await this.client.del(...keys);` por:

```ts
        let cursor = '0';
        do {
          const [next, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
          if (keys.length > 0) await this.client.del(...keys);
          cursor = next;
        } while (cursor !== '0');
```

Em `getDashboardSummary`, envolva o corpo atual, **sem mudar nada dentro dele**:

```ts
  async getDashboardSummary() {
    // Cache sob o prefixo já invalidado nas ingestões (dashboard:trends:products:*).
    return this.cached('dashboard:trends:products:summary', 3600, async () => {
      // ... corpo atual, inalterado ...
    });
  }
```

- [x] **Passo 4: rodar e comparar**

```bash
cd Move-Intelligence-Back && npx jest src/shared/redis src/modules/dashboard-api && npx tsc --noEmit -p tsconfig.json
cd Move-Intelligence-Back && INCLUDE_SYNTHETIC_DATA=true npm run perf:golden -- --compare /private/tmp/move-golden-antes
```
Expected: testes verdes e `OK` (respostas idênticas).

**Registro Tarefa 8:**
- Testes antes da implementação: **2 falhas previstas** — execução repetida da factory (`3` chamadas em vez de `1`) e uso de `KEYS`; o caso que libera a chave após erro passou.
- Validação final: Jest Redis e Dashboard API — **4 suítes, 33 testes passaram**; `npx tsc --noEmit -p tsconfig.json` — **passou**; `perf:golden -- --compare /private/tmp/move-golden-antes` — **OK: 47 respostas idênticas**.
- `wrap` agora compartilha pedidos simultâneos por chave e libera a trava em sucesso/erro; `delPattern` usa `SCAN` com lotes de 200; `getDashboardSummary` usa a chave já coberta pelo prefixo de invalidação, sem alterar o cálculo.
- `git diff --stat`: **2 arquivos, 25 inserções(+), 8 remoções(-)**. `redis-cache.service.spec.ts` é novo (46 linhas) e não aparece no diff estatístico padrão.

---

### Tarefa 9: Pré-cálculo dos cards (`card_rollups`)

**Arquivos:**
- Criar: `Move-Intelligence-Back/prisma/migrations/20260923120000_card_rollups/migration.sql`; modificar `schema.prisma`
- Criar: `Move-Intelligence-Back/src/shared/card-rollups/card-rollup.sql.ts`, `card-rollups.service.ts` (+ `.spec.ts`), `card-rollups.module.ts`, `card-rollups.scheduler.ts`
- Modificar: `src/app.module.ts`, `dashboard-api.service.ts`, `card-assigner.service.ts`, `catalog-review.service.ts`, `taxonomy.service.ts`, `intelligence-collection.service.ts`, `products.service.ts`, `imports/imports.processor.ts`

**Interfaces:**
- Produz:
  - `queryCardRollupRows(prisma, category?): Promise<ClusterRollupRow[]>` e o tipo exportado `ClusterRollupRow`;
  - `CardRollupsService.getRows(category?: string): Promise<ClusterRollupRow[]>`, `refresh(): Promise<number>` e `markStale(): void`.

- [x] **Passo 1: migration e Prisma**

```sql
-- Plano de coleta real e desempenho: resultado pré-calculado da consulta de cards (loadClusterRollups).
CREATE TABLE IF NOT EXISTS card_rollups (
  include_synthetic boolean NOT NULL,
  product_cluster_id uuid NOT NULL,
  category text,
  sort_order integer NOT NULL,
  row jsonb NOT NULL,
  PRIMARY KEY (include_synthetic, product_cluster_id)
);
CREATE INDEX IF NOT EXISTS card_rollups_order_idx ON card_rollups (include_synthetic, sort_order);
CREATE TABLE IF NOT EXISTS card_rollup_state (
  include_synthetic boolean PRIMARY KEY,
  computed_at timestamp(3) NOT NULL,
  stale boolean NOT NULL DEFAULT false
);
```

```prisma
/// Pré-cálculo de loadClusterRollups (plano de coleta real e desempenho). `row` = linha crua do SQL.
model CardRollup {
  includeSynthetic Boolean @map("include_synthetic")
  productClusterId String  @map("product_cluster_id") @db.Uuid
  category         String?
  sortOrder        Int     @map("sort_order")
  row              Json

  @@id([includeSynthetic, productClusterId])
  @@index([includeSynthetic, sortOrder], map: "card_rollups_order_idx")
  @@map("card_rollups")
}

model CardRollupState {
  includeSynthetic Boolean  @id @map("include_synthetic")
  computedAt       DateTime @map("computed_at")
  stale            Boolean  @default(false)

  @@map("card_rollup_state")
}
```

Aplique a migration e rode o `prisma generate`, como nas Regras globais.

- [x] **Passo 2: mover o SQL sem alterar** — crie `src/shared/card-rollups/card-rollup.sql.ts`, com:
  - o tipo `ClusterRollupRow`, movido de `dashboard-api.service.ts` e **exportado**;
  - `export async function queryCardRollupRows(prisma: PrismaService, category?: string): Promise<ClusterRollupRow[]>`, cujo corpo é **exatamente** o corpo atual de `loadClusterRollups` até o `$queryRaw` (o `categoryFilter`, os filtros de sintéticos e o SQL inteiro, sem mudar um caractere), devolvendo `rows` **sem** o `mapClusterRollup`;
  - `MAX_RANKED_CLUSTERS` e os imports que o SQL usa (`Prisma`, `COUNTED_ITEM_STATUSES` e as funções de sintéticos).

  Em `dashboard-api.service.ts`, importe `ClusterRollupRow` e `queryCardRollupRows` do novo arquivo e apague as definições locais.

- [x] **Passo 3: teste que falha** — `card-rollups.service.spec.ts`:

```ts
import { PrismaService } from '../database/prisma.service';
import * as sql from './card-rollup.sql';
import { CardRollupsService } from './card-rollups.service';

function build(state: { computedAt: Date; stale: boolean } | null) {
  const store: Array<{ productClusterId: string; category: string | null; sortOrder: number; row: unknown }> = [];
  const prisma = {
    cardRollupState: {
      findUnique: jest.fn().mockResolvedValue(state),
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    cardRollup: {
      deleteMany: jest.fn().mockResolvedValue({}),
      createMany: jest.fn(async ({ data }) => { store.push(...data); return { count: data.length }; }),
      findMany: jest.fn(async ({ where }) => store.filter((r) => !where.category || r.category === where.category).sort((a, b) => a.sortOrder - b.sortOrder)),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const rows = [
    { id: 'c1', category: 'bikes', canonical_name: 'B', first_collected_at: new Date('2026-01-01T00:00:00Z') },
    { id: 'c2', category: 'mats', canonical_name: 'M', first_collected_at: new Date('2026-01-02T00:00:00Z') },
  ];
  const query = jest.spyOn(sql, 'queryCardRollupRows').mockResolvedValue(rows as never);
  return { prisma, query, service: new CardRollupsService(prisma as unknown as PrismaService) };
}

describe('CardRollupsService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sem estado: calcula, grava em ordem e lê', async () => {
    const { service, query, prisma } = build(null);
    const out = await service.getRows();
    expect(query).toHaveBeenCalledTimes(1);
    expect(prisma.cardRollup.createMany.mock.calls[0][0].data.map((d: { sortOrder: number }) => d.sortOrder)).toEqual([0, 1]);
    expect(out.map((r) => (r as { id: string }).id)).toEqual(['c1', 'c2']);
    expect(prisma.cardRollupState.upsert).toHaveBeenCalled();
  });

  it('estado recente e não stale: não recalcula; filtra por categoria', async () => {
    const { service, query, prisma } = build({ computedAt: new Date(), stale: false });
    prisma.cardRollup.findMany.mockResolvedValue([{ row: { id: 'c2', category: 'mats' } }]);
    const out = await service.getRows('mats');
    expect(query).not.toHaveBeenCalled();
    expect(prisma.cardRollup.findMany.mock.calls[0][0].where).toEqual({ includeSynthetic: expect.any(Boolean), category: 'mats' });
    expect(out).toEqual([{ id: 'c2', category: 'mats' }]);
  });

  it('stale ou velho demais: recalcula', async () => {
    const stale = build({ computedAt: new Date(), stale: true });
    await stale.service.getRows();
    expect(stale.query).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
    const old = build({ computedAt: new Date(Date.now() - 2 * 3600_000), stale: false });
    await old.service.getRows();
    expect(old.query).toHaveBeenCalledTimes(1);
  });

  it('refresh simultâneo roda uma vez', async () => {
    const { service, query } = build(null);
    await Promise.all([service.refresh(), service.refresh(), service.refresh()]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('markStale grava no máximo uma vez a cada 2 s e agenda recálculo', async () => {
    jest.useFakeTimers();
    const { service, prisma } = build({ computedAt: new Date(), stale: false });
    const refresh = jest.spyOn(service, 'refresh').mockResolvedValue(0);
    service.markStale();
    service.markStale();
    expect(prisma.cardRollupState.updateMany).toHaveBeenCalledTimes(1);
    await jest.runOnlyPendingTimersAsync();
    expect(refresh).toHaveBeenCalled();
    jest.useRealTimers();
  });
});
```

- [x] **Passo 4: implementar** — `card-rollups.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { includeSyntheticData } from '../synthetic-data/synthetic-data.filter';
import { ClusterRollupRow, queryCardRollupRows } from './card-rollup.sql';

const WRITE_CHUNK = 500;
const MARK_STALE_THROTTLE_MS = 2000;
const BACKGROUND_DELAY_MS = 5000;

function maxAgeMs(): number {
  const seconds = Number.parseInt(process.env.CARD_ROLLUPS_MAX_AGE_SECONDS ?? '', 10);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000;
}

/** Pré-cálculo de loadClusterRollups (spec §6.3): mesmo SQL, resultado guardado por modo de sintéticos. */
@Injectable()
export class CardRollupsService {
  private readonly logger = new Logger(CardRollupsService.name);
  private refreshing: Promise<number> | null = null;
  private lastMarkAt = 0;
  private backgroundTimer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async getRows(category?: string): Promise<ClusterRollupRow[]> {
    const mode = includeSyntheticData();
    const state = await this.prisma.cardRollupState.findUnique({ where: { includeSynthetic: mode } });
    if (!state || state.stale || Date.now() - state.computedAt.getTime() > maxAgeMs()) await this.refresh();
    const rows = await this.prisma.cardRollup.findMany({
      where: category ? { includeSynthetic: mode, category } : { includeSynthetic: mode },
      orderBy: { sortOrder: 'asc' },
      select: { row: true },
    });
    return rows.map((r) => r.row as unknown as ClusterRollupRow);
  }

  refresh(): Promise<number> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const mode = includeSyntheticData();
      const startedAt = new Date();
      const rows = await queryCardRollupRows(this.prisma);
      const data = rows.map((row, index) => ({
        includeSynthetic: mode,
        productClusterId: row.id,
        category: row.category,
        sortOrder: index,
        row: JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue,
      }));
      await this.prisma.$transaction(async (tx) => {
        await tx.cardRollup.deleteMany({ where: { includeSynthetic: mode } });
        for (let i = 0; i < data.length; i += WRITE_CHUNK) await tx.cardRollup.createMany({ data: data.slice(i, i + WRITE_CHUNK) });
        // markStale chegou durante o cálculo? Continua desatualizado (o próximo recálculo pega a mudança).
        const stillStale = this.lastMarkAt > startedAt.getTime();
        await tx.cardRollupState.upsert({
          where: { includeSynthetic: mode },
          create: { includeSynthetic: mode, computedAt: startedAt, stale: stillStale },
          update: { computedAt: startedAt, stale: stillStale },
        });
      }, { timeout: 120_000 });
      return rows.length;
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** Dados mudaram: marca desatualizado (throttle por processo) e agenda recálculo em segundo plano. */
  markStale(): void {
    const now = Date.now();
    if (now - this.lastMarkAt >= MARK_STALE_THROTTLE_MS) {
      this.lastMarkAt = now;
      void this.prisma.cardRollupState
        .updateMany({ where: { includeSynthetic: includeSyntheticData() }, data: { stale: true } })
        .catch((error) => this.logger.warn(`markStale falhou: ${error instanceof Error ? error.message : error}`));
    }
    if (this.backgroundTimer) return;
    this.backgroundTimer = setTimeout(() => {
      this.backgroundTimer = null;
      void this.refresh().catch((error) => this.logger.warn(`Pré-cálculo falhou: ${error instanceof Error ? error.message : error}`));
    }, BACKGROUND_DELAY_MS);
    this.backgroundTimer.unref?.();
  }
}
```

**Por que `stillStale`:** um `markStale` que chega **durante** o recálculo não pode ser apagado pelo `upsert` do fim. Acrescente um teste: com `service['lastMarkAt']` posto no futuro antes do `refresh()`, o `upsert` grava `stale: true`. (Marcas feitas por **outro** processo durante o recálculo são cobertas pelo limite de idade de 1 hora.)

`card-rollups.scheduler.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CardRollupsService } from './card-rollups.service';

/** Mantém o pré-cálculo quente (só banco; sempre ligado). */
@Injectable()
export class CardRollupsScheduler {
  private readonly logger = new Logger(CardRollupsScheduler.name);
  constructor(private readonly rollups: CardRollupsService) {}

  @Cron(process.env.CARD_ROLLUPS_CRON || '*/30 * * * *', { name: 'card-rollups', timeZone: 'America/Sao_Paulo' })
  async tick() {
    try {
      const count = await this.rollups.refreshIfOlderThan(45 * 60 * 1000);
      if (count !== null) this.logger.log(`Pré-cálculo dos cards: ${count} cards`);
    } catch (error) {
      this.logger.warn(`Pré-cálculo não atualizado: ${error instanceof Error ? error.message : error}`);
    }
  }
}
```

Acrescente ao serviço:

```ts
  /** Recalcula se stale ou mais velho que `ageMs`; devolve o nº de cards ou null se não precisou. */
  async refreshIfOlderThan(ageMs: number): Promise<number | null> {
    const state = await this.prisma.cardRollupState.findUnique({ where: { includeSynthetic: includeSyntheticData() } });
    if (state && !state.stale && Date.now() - state.computedAt.getTime() <= ageMs) return null;
    return this.refresh();
  }
```

`card-rollups.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { CardRollupsScheduler } from './card-rollups.scheduler';
import { CardRollupsService } from './card-rollups.service';

@Global()
@Module({ providers: [CardRollupsService, CardRollupsScheduler], exports: [CardRollupsService] })
export class CardRollupsModule {}
```

Em `app.module.ts`, importe `CardRollupsModule` logo depois de `DatabaseModule`.

- [x] **Passo 5: ligar no painel e nas mudanças de dados**

`DashboardApiService`:
- no construtor, acrescente `@Optional() private readonly cardRollups?: CardRollupsService` como **último** parâmetro;
- em `loadClusterRollups`:

```ts
  private async loadClusterRollups(category?: string): Promise<ClusterRollup[]> {
    const rows = this.cardRollups
      ? await this.cardRollups.getRows(category)
      : await queryCardRollupRows(this.prisma, category);
    return rows.map((row) => this.mapClusterRollup(row));
  }
```

`markStale()`, sempre com `@Optional() private readonly cardRollups?: CardRollupsService` como **último** parâmetro do construtor e chamada `this.cardRollups?.markStale();`:
- **`IntelligenceCollectionService`**, `ProductsService` e `ImportsProcessor`: logo depois de **cada** `delPattern('dashboard:trends:products:*')` (6 lugares).
- **`CardAssignerService`**: no fim de `moveListing` (quando não houve `blocked`), de `createCard` e de `refreshCard`.
- **`CatalogReviewService`**: no fim de `renameCard`, `approveType`, `mergeType` e `undo`.
- **`TaxonomyService`**: no fim de `seedFromFile` e de `seedTrendTerms`.

Nos specs que constroem esses serviços com `new`, nada muda, porque o parâmetro é opcional. Se algum spec quebrar por causa da **ordem** dos parâmetros, corrija só o preparo.

- [x] **Passo 6: rodar, comparar e medir**

```bash
cd Move-Intelligence-Back && npx jest src/shared src/modules && npx tsc --noEmit -p tsconfig.json
cd Move-Intelligence-Back && INCLUDE_SYNTHETIC_DATA=true npm run perf:golden -- --compare /private/tmp/move-golden-antes
cd Move-Intelligence-Back && INCLUDE_SYNTHETIC_DATA=true npm run perf:probe
```
Expected:
- testes verdes;
- `OK`, porque o `perf-golden` já usa o `CardRollupsService` via `cardRollupsIfAvailable`. **Se houver diferença** (por exemplo, número vindo como texto ou data em outro formato depois do JSON), corrija só a conversão em `refresh` ou `mapClusterRollup` e compare de novo. Não mude o SQL;
- no `perf:probe`, a **segunda** medição da tela inicial, do Ranking, do resumo e das recomendações fica ≤ 150 ms. Registre as duas medições (a primeira recalcula).

**Registro Tarefa 9:**
- Fixture autorizado: acrescentei `// eslint-disable-next-line @typescript-eslint/no-explicit-any` e tipo explícito em `const prisma: any`; anotei somente o parâmetro `r` do `.map` como `unknown`. Nenhuma assertion, valor esperado ou cenário original foi alterado. O teste temporário de precisão que eu havia introduzido foi substituído pelo teste solicitado, que valida conversão dos números no `refresh`.
- Migration `20260923120000_card_rollups` aplicada via `psql` (`CREATE TABLE`, `CREATE INDEX`, `CREATE TABLE`); `prisma generate` passou. O SQL extraído foi comparado byte a byte com o original: **12.299 caracteres idênticos**. Antes de implementar a serialização, confirmei que todos os campos numéricos de `ClusterRollupRow`, incluindo os itens das sparklines, passam por `this.toNumber` em `mapClusterRollup`.
- `CardRollupsService.getRows` retorna cada `row` sem conversão. `refresh` converte números do primeiro nível e arrays numéricos puros para texto antes de serializar o JSONB; objetos como `card_key_attrs` e `card_key_values` são preservados. O novo teste valida `financial_score`, `volume_spark`, `demand_spark`, `id` e `category`. O teste original `estado recente e não stale` passou sem alteração.
- Testes: `npx jest src/shared/card-rollups --runInBand` — **1 suíte, 7 testes passaram**; `npx jest src/shared src/modules --runInBand` — **62 suítes, 499 testes passaram**; `npx tsc --noEmit -p tsconfig.json` — **passou**.
- O primeiro golden encontrou as três diferenças conhecidas em `trends_200`, `ranking_p1` e `ranking_p2_growth`. A leitura não tinha recalculado o cache antigo, que ainda continha números JSONB. Marquei stale somente em `card_rollup_state` (1 estado) e repeti a comparação, que recalculou o cache com o código atualizado: **`OK: 47 respostas idênticas`**. Nenhum baseline ou SQL foi alterado.
- `perf:probe` (**1ª / 2ª medição, ms**): tela inicial `50/26`; Ranking `22/19`; dashboard summary `9/8`; recomendações `20/19`; sources/status `21/13`; alerts `1/0`; página do produto `187/223`; price history 30d `48/50`; price history all `55/48`; review history 30d `47/43`; volume history 30d prev `47/41`; suppliers `57/49`; Monte Carlo defaults `55/51`; offers `28/23`; card listings `20/23`. As quatro rotas principais ficaram abaixo de 150 ms na segunda medição. A página do produto mediu 223 ms na segunda medição; será otimizada na Tarefa 10.
- Contagens antes do golden → após o probe: `product_listing_snapshots` **58116 → 58116**; `product_clusters` **127 → 127**; `product_cluster_items` **712 → 712**; `listing_fichas` **718 → 718**; `tracked_listings` **613 → 613**; `product_scores` **793 → 793**; `card_rollups` **96 → 96**; `card_rollup_state` **2 → 2**; `ai_call_logs` **375 → 375**. A comparação integral dos arquivos de contagem não mostrou diferenças.
- Sem chamadas Bright Data ou LLM.
- `git diff --stat` nos nove arquivos rastreados desta tarefa (cumulativo com alterações das tarefas anteriores): **9 files changed, 152 insertions(+), 393 deletions(-)**. Migration, testes/serviços novos e outros arquivos não rastreados não entram no diff estatístico padrão.

---

### Tarefa 10: Página do produto sem carregar histórico inteiro

**Arquivos:** Modificar `Move-Intelligence-Back/src/modules/dashboard-api/dashboard-api.service.ts` (`getTrendProduct`) (+ spec, se houver teste de `getTrendProduct`).

- [x] **Passo 1: implementar** — em `getTrendProduct`, troque a busca `productCluster.findUnique({ include: { snapshots: { ... include: { rawProduct: ... } } } })` por:

```ts
    const base = await this.prisma.productCluster.findUnique({
      where: { id },
      select: { id: true, canonicalName: true, category: true, riskLevel: true, financialScore: true },
    });
    const snapshots = base
      ? await this.prisma.productListingSnapshot.findMany({
          where: { productClusterId: id, ...syntheticSnapshotWhere() },
          orderBy: { collectedAt: 'asc' },
          select: {
            marketplace: true, currency: true, externalProductId: true, productClusterId: true, title: true,
            priceMin: true, rating: true, reviewCount: true, salesSignalRaw: true, salesSignalType: true,
            sellerId: true, sellerName: true, moq: true, collectedAt: true, imageUrl: true, productUrl: true,
          },
        })
      : [];
    // Sinais de demanda em UMA consulta (antes: aninhados em cada snapshot). demandSignals() deduplica por id.
    const demand = snapshots.length
      ? await this.prisma.$queryRaw<DemandSignalRow[]>(Prisma.sql`
          SELECT DISTINCT ds.id, ds.keyword, ds.geo, ds.source, ds.week_start AS "weekStart",
                 ds.trend_index AS "trendIndex", ds.raw_value AS "rawValue"
          FROM product_listing_snapshots s
          JOIN product_demand_link pdl ON pdl.product_id = s.raw_product_id
          JOIN demand_signals ds ON ds.id = pdl.demand_signal_id
          WHERE s.product_cluster_id = ${id}::uuid
            ${syntheticSnapshotFilterSql('s')}`)
      : [];
    const cluster = base
      ? ({
          ...base,
          snapshots: snapshots.map((s, index) => ({
            ...s,
            rawProduct: index === 0 ? { demandLinks: demand.map((demandSignal) => ({ demandSignal })) } : null,
          })),
        } as unknown as ClusterWithSnapshots)
      : null;
```

**Antes de gravar:**
- Confira em `DemandSignalRow` (e no modelo `DemandSignal`) **todos** os campos que `demandSignals`, `demandSeries`, `tiktokGrowth` e `demandToSignals` usam, e selecione exatamente esses no SQL, com os mesmos nomes camelCase. `raw_value`, por exemplo, só se existir no tipo.
- `weekStart` precisa ser `Date`. O `$queryRaw` já devolve `Date` para `timestamp`, mas confira se `week_start` é `date` ou `timestamp`.
- `trendIndex` e `rawValue` passam por `toNumber`, então `Decimal` ou número servem.
- Confira se `riskLevel` e `financialScore` existem no modelo `ProductCluster` com esses nomes. Se não, use os campos que o `include` antigo trazia e que `clusterToTrendProduct` lê.
- Se `clusterToTrendProduct` ou `subSignalIndicators` usarem outro campo do snapshot que não está no `select`, o `tsc` ou o `perf:golden` vão acusar. Acrescente o campo.

- [x] **Passo 2: comparar e medir**

```bash
cd Move-Intelligence-Back && npx jest src/modules/dashboard-api && npx tsc --noEmit -p tsconfig.json
cd Move-Intelligence-Back && INCLUDE_SYNTHETIC_DATA=true npm run perf:golden -- --compare /private/tmp/move-golden-antes
cd Move-Intelligence-Back && INCLUDE_SYNTHETIC_DATA=true npm run perf:probe
```
Expected: `OK` (os 3 `product_*` idênticos) e `trends/products/:id` ≤ 120 ms.

**Registro Tarefa 10:**
- `getTrendProduct` agora seleciona os campos necessários do cluster e snapshots, e busca os sinais de demanda numa única consulta SQL distinta, aplicando os filtros de snapshots sintéticos e montando a estrutura consumida pelos mapeadores. `week_start` é `date`; o tipo `DemandSignalRow` contém somente os campos efetivamente usados pelos mapeadores (incluindo `weekStart: Date`, `trendIndex` e `rawValue`). O modelo `ProductCluster` confirma `riskLevel` e `financialScore`.
- Após mover a consulta, o primeiro `tsc` apontou uma colisão local entre `base`; renomeei a variável recém-introduzida para `clusterBase` e rodei `npx tsc --noEmit -p tsconfig.json` de novo — **passou**. `npx jest src/modules/dashboard-api --runInBand` — **3 suítes, 30 testes passaram**.
- `INCLUDE_SYNTHETIC_DATA=true npm run perf:golden -- --compare /private/tmp/move-golden-antes` — **`OK: 47 respostas idênticas`**, incluindo as três respostas `product_*`.
- `perf:probe` (1ª / 2ª medição, ms): tela inicial `54/29`; Ranking `25/24`; resumo `11/8`; recomendações `22/22`; sources/status `20/14`; alerts `1/0`; página do produto `82/69`; price history 30d `56/45`; price history all `53/47`; review history 30d `43/44`; volume history 30d prev `43/45`; suppliers `53/52`; Monte Carlo defaults `60/52`; offers `21/15`; card listings `18/16`. Página do produto ficou abaixo de 120 ms nas duas medições.
- `git diff --stat -- Move-Intelligence-Back/src/modules/dashboard-api/dashboard-api.service.ts` (cumulativo com a extração SQL da Tarefa 9): **1 file changed, 42 insertions(+), 378 deletions(-)**.

---

### Tarefa 11: Séries por janela no banco (corrige os "5.000 mais antigos")

**Arquivos:** Modificar `Move-Intelligence-Back/src/modules/products/products.service.ts` (`seriesPoints`, `seriesPointsCompared`) (+ spec).

**Interfaces:** Produz o método privado `loadSeriesSnapshots(productClusterId: string, lookbackMs: number | null)`.

- [x] **Passo 1: teste que falha** — no `products.service.spec.ts`, com o `build()` do arquivo:

```ts
  it('séries: com mais de 5.000 snapshots, "all" usa os 5.000 mais recentes', async () => {
    const { service, prisma } = build();
    prisma.productListingSnapshot.findFirst = jest.fn().mockResolvedValue({ collectedAt: new Date('2026-09-20T00:00:00Z') });
    prisma.productListingSnapshot.findMany = jest.fn().mockResolvedValue([]);
    await (service as any).loadSeriesSnapshots('c1', null);
    const args = prisma.productListingSnapshot.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual({ collectedAt: 'desc' });
    expect(args.take).toBe(5000);
  });

  it('séries: com janela, filtra no banco a partir do mais recente', async () => {
    const { service, prisma } = build();
    prisma.productListingSnapshot.findFirst = jest.fn().mockResolvedValue({ collectedAt: new Date('2026-09-20T00:00:00Z') });
    prisma.productListingSnapshot.findMany = jest.fn().mockResolvedValue([]);
    await (service as any).loadSeriesSnapshots('c1', 30 * 86_400_000);
    const args = prisma.productListingSnapshot.findMany.mock.calls[0][0];
    expect(args.where.collectedAt).toEqual({ gte: new Date('2026-08-21T00:00:00Z') });
    expect(args.orderBy).toEqual({ collectedAt: 'asc' });
  });
```

- [x] **Passo 2: implementar**

```ts
  /** Snapshots para séries (spec §6.5): janela filtrada no banco; "all" = 5.000 mais recentes (não os mais antigos). */
  private async loadSeriesSnapshots(productClusterId: string, lookbackMs: number | null) {
    const where = { productClusterId, ...syntheticSnapshotWhere() };
    const latest = await this.prisma.productListingSnapshot.findFirst({
      where,
      orderBy: { collectedAt: 'desc' },
      select: { collectedAt: true },
    });
    if (!latest) return [];
    if (lookbackMs === null) {
      const recent = await this.prisma.productListingSnapshot.findMany({ where, orderBy: { collectedAt: 'desc' }, take: 5_000 });
      return recent.reverse();
    }
    return this.prisma.productListingSnapshot.findMany({
      where: { ...where, collectedAt: { gte: new Date(latest.collectedAt.getTime() - lookbackMs) } },
      orderBy: { collectedAt: 'asc' },
    });
  }
```

Em `seriesPoints`, troque o `findMany(... take: 5_000)` por:

```ts
      const windowMs = WINDOW_MS[window] ?? Number.MAX_SAFE_INTEGER;
      const finite = window && window !== 'all' && windowMs && windowMs !== Number.MAX_SAFE_INTEGER;
      const allSnapshots = await this.loadSeriesSnapshots(productClusterId, finite ? windowMs : null);
```

Mantenha o resto (o `cutoffTime` e o filtro continuam, sem efeito). Em `seriesPointsCompared`, troque o `findMany` por `await this.loadSeriesSnapshots(productClusterId, 2 * windowMs)`. **Não** acrescente `select` aqui, porque `pointsFromSnapshots` e os cálculos de preço usam vários campos. O ganho vem de filtrar as linhas.

- [x] **Passo 3: rodar e comparar**

```bash
cd Move-Intelligence-Back && npx jest src/modules/products && npx tsc --noEmit -p tsconfig.json
cd Move-Intelligence-Back && INCLUDE_SYNTHETIC_DATA=true npm run perf:golden -- --compare /private/tmp/move-golden-antes
```
Expected: `OK`. Com os dados de hoje, nenhum card passa de 5.000 snapshots.

**Registro Tarefa 11:**
- Os dois testes novos primeiro falharam pelo motivo previsto: `service.loadSeriesSnapshots is not a function` antes da implementação. Implementei `loadSeriesSnapshots`, que busca a data mais recente, limita `all` aos 5.000 snapshots mais recentes e filtra janelas finitas no banco. `seriesPointsCompared` carrega o intervalo de duas janelas.
- Os mocks antigos de `compareProducts` não tinham o novo método Prisma `findFirst`; acrescentei apenas esse mock aos dois fixtures impactados e ao fixture compartilhado da série C3. Nenhuma assertion ou cenário foi alterado.
- `npx jest src/modules/products --runInBand` — **7 suítes, 58 testes passaram**; `npx tsc --noEmit -p tsconfig.json` — **passou**; `INCLUDE_SYNTHETIC_DATA=true npm run perf:golden -- --compare /private/tmp/move-golden-antes` — **`OK: 47 respostas idênticas`**.
- `git diff --stat -- Move-Intelligence-Back/src/modules/products/products.service.ts Move-Intelligence-Back/src/modules/products/products.service.spec.ts`: **2 files changed, 88 insertions(+), 15 deletions(-)**.

---

### Tarefa 12: Recomendação por IA, fornecedores e simulação sem histórico inteiro

**Arquivos:** Modificar `Move-Intelligence-Back/src/modules/products/products.service.ts` (`getAiRecommendation`, `getSuppliers`, `getSimulationCluster`) (+ spec).

- [x] **Passo 1: testes que falham** — no `products.service.spec.ts`:

```ts
  it('recomendação por IA: cache vale enquanto não houver score mais novo', async () => {
    const { service, prisma } = build();
    prisma.productCluster.findUnique = jest.fn().mockResolvedValue({ id: 'c1', canonicalName: 'X', category: null, alerts: [] });
    prisma.productScore.findFirst = jest.fn().mockResolvedValue({ computedAt: new Date('2026-09-10T00:00:00Z') });
    prisma.aiRecommendation.findFirst = jest.fn().mockResolvedValue({
      id: 'r1', action: 'DECIDIR_AGORA', decision: 'AVANCAR', rationale: 'ok', generatedText: '{}',
      modelVersion: 'm', createdAt: new Date('2026-09-11T00:00:00Z'),
    });
    const out = await service.getAiRecommendation('c1');
    expect(out.cached).toBe(true);
    const where = prisma.aiRecommendation.findFirst.mock.calls[0][0].where;
    expect(where.createdAt).toEqual({ gte: new Date('2026-09-10T00:00:00Z') });
  });

  it('recomendação por IA: preços e contagem vêm de agregação, sem carregar snapshots', async () => {
    const { service, prisma } = build();
    prisma.productCluster.findUnique = jest.fn().mockResolvedValue({ id: 'c1', canonicalName: 'X', category: null, alerts: [] });
    await (service as any).aiPriceContext('c1');
    expect(prisma.productListingSnapshot.aggregate).toHaveBeenCalled();
    const include = prisma.productCluster.findUnique.mock.calls.at(-1)?.[0]?.include;
    expect(include?.snapshots).toBeUndefined();
  });
```

Ajuste ao `build()` do arquivo: acrescente `aggregate` e `findFirst` a `productListingSnapshot`, e `findFirst` a `productScore` e a `aiRecommendation`, se faltarem. O `isQuadrantAction`/`isRawRationale` do cache deve aceitar a linha do mock. Se não aceitar, use valores que já aparecem nos testes existentes de `getAiRecommendation`.

- [x] **Passo 2: implementar**

1. **Contexto de preços** (novo método):

```ts
  /** Preços/contagem/último snapshot da recomendação por IA via agregação (spec §6.6). */
  private async aiPriceContext(productClusterId: string) {
    const where = { productClusterId, ...syntheticSnapshotWhere() };
    const [all, priced, last] = await Promise.all([
      this.prisma.productListingSnapshot.aggregate({ where, _count: { _all: true } }),
      this.prisma.productListingSnapshot.aggregate({ where: { ...where, priceMin: { gt: 0 } }, _avg: { priceMin: true }, _min: { priceMin: true }, _max: { priceMin: true } }),
      this.prisma.productListingSnapshot.findFirst({ where, orderBy: { collectedAt: 'desc' }, select: { id: true } }),
    ]);
    return {
      count: all._count._all,
      avg: priced._avg.priceMin === null ? 0 : Number(priced._avg.priceMin),
      min: priced._min.priceMin === null ? 0 : Number(priced._min.priceMin),
      max: priced._max.priceMin === null ? 0 : Number(priced._max.priceMin),
      lastSnapshotId: last?.id ?? null,
    };
  }
```

2. **Em `getAiRecommendation`:**
   - tire `snapshots` do `include` (fica só `alerts`);
   - troque o cálculo de `prices`, `avgPrice`, `minPrice`, `maxPrice` e `cluster.snapshots.length` por `const priceCtx = await this.aiPriceContext(productClusterId);`, usando `priceCtx.avg`, `priceCtx.min`, `priceCtx.max` e `priceCtx.count` **com os mesmos arredondamentos e os mesmos `|| null` de hoje**;
   - troque `cluster.snapshots.at(-1)?.id` por `priceCtx.lastSnapshotId`;
   - se o código atual trata "sem snapshots" (por exemplo, `NotFound`), mantenha a regra com `priceCtx.count === 0`.
   
   **Atenção:** a média de hoje é feita sobre os valores de `Number(s.priceMin)` filtrados `> 0`, e a do banco também filtra `> 0`. O resultado é o mesmo, a menos de arredondamento de ponto flutuante, que já passa por `Math.round(x * 100) / 100`.

3. **Cache por score:** antes da consulta de `aiRecommendation`:

```ts
    const latestScore = await this.prisma.productScore.findFirst({
      where: { productClusterId },
      orderBy: { computedAt: 'desc' },
      select: { computedAt: true },
    });
    // Spec §6.6: sem score novo, o texto em cache continua válido (economiza cota); sem score, regra de 24 h.
    const validSince = latestScore?.computedAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
```

   E use `createdAt: { gte: validSince }` no `where` do `findFirst` de `aiRecommendation`.

4. **`getSuppliers` e `getSimulationCluster`:** troque o `include: { snapshots: {...} }` por `include: { snapshots: { where: ..., orderBy: ..., select: { ... } } }`, com os **campos que `suppliersFromCluster` e o tipo `ClusterForSimulation` usam** (veja as definições dos tipos `SupplierClusterRow` e `ClusterForSimulation` e liste exatamente as propriedades de snapshot que eles declaram). As linhas e a ordem ficam iguais.

- [x] **Passo 3: rodar e comparar**

```bash
cd Move-Intelligence-Back && npx jest src/modules/products && npx tsc --noEmit -p tsconfig.json
cd Move-Intelligence-Back && INCLUDE_SYNTHETIC_DATA=true npm run perf:golden -- --compare /private/tmp/move-golden-antes
```
Expected: `OK` (os `suppliers_*` e `mc_defaults_*` idênticos).

**Registro Tarefa 12:**
- Os dois testes novos falharam antes da implementação pelas diferenças previstas: cache usava o corte de 24 h em vez da data do score mais recente; recomendação ainda não agregava preço/contagem e carregava snapshots no cluster. Os testes usam `OpenRouterService` mockado; nenhuma chamada externa foi feita.
- `getAiRecommendation` agora valida o cache desde o último `ProductScore` (ou usa 24 h quando não há score), consulta contagem/preços/último snapshot com agregações e remove a inclusão do histórico completo. `getSuppliers` e `getSimulationCluster` agora selecionam só campos usados pelos consumidores. O select de fornecedores inclui também `rating` e `salesSignalRaw`, embora ausentes do tipo `SupplierSnapshotRow`, pois `supplierScore` os lê via `any`; isso mantém o cálculo anterior.
- `npx jest src/modules/products --runInBand` — **7 suítes, 60 testes passaram**; `npx tsc --noEmit -p tsconfig.json` — **passou**; `INCLUDE_SYNTHETIC_DATA=true npm run perf:golden -- --compare /private/tmp/move-golden-antes` — **`OK: 47 respostas idênticas`**.
- `git diff --stat -- Move-Intelligence-Back/src/modules/products/products.service.ts Move-Intelligence-Back/src/modules/products/products.service.spec.ts`: **2 files changed, 191 insertions(+), 33 deletions(-)** (cumulativo com a Tarefa 11).

---

### Tarefa 13: Suítes completas e medição final

- [x] **Passo 1: suítes**

```bash
cd Move-Intelligence-Back && npm test && npx tsc --noEmit -p tsconfig.json
cd Move-Intelligence-Dados && <python> -m pytest tests -q
cd Move-Intelligence-Front && NODE_OPTIONS=--localstorage-file=/private/tmp/move-front-vitest-localstorage npx ng test --watch=false
cd Move-Intelligence-Front && npx ng build
git diff --check
```

- [x] **Passo 2: comparação e medição finais**

```bash
cd Move-Intelligence-Back && INCLUDE_SYNTHETIC_DATA=true npm run perf:golden -- --compare /private/tmp/move-golden-antes
cd Move-Intelligence-Back && INCLUDE_SYNTHETIC_DATA=true npm run perf:probe | tee /private/tmp/move-perf-depois.txt
```

Registre uma tabela "antes × depois" com as linhas de `/private/tmp/move-perf-antes.txt` e `/private/tmp/move-perf-depois.txt`. Nenhuma chamada pode ter ficado mais lenta. Se alguma ficou, explique.

**Registro Tarefa 13:**
- Passo 1: Backend `npm test` — **63 suítes, 504 testes passaram**; `npx tsc --noEmit -p tsconfig.json` — **passou**. Python (ambiente temporário `uv`, dependências de `requirements-dev.txt`) — **122 passaram, 3 ignorados**. Frontend: **5/5 execuções da Tarefa 5b** passaram (15 arquivos, 59 testes cada); T13 repetiu uma vez e passou (15 suítes, 59 testes). `ng build` no Node 25.9 encerrou com exit 134 sem erro de compilação; o usuário confirmou Node 24.15 OK. `docker compose build frontend` passou com Node 20, bundle **405,20 kB / 112,35 kB**. `git diff --check` — **passou**.
- Desempate autorizado em `Move-Intelligence-Back/src/shared/card-rollups/card-rollup.sql.ts`, `latest_image_url`: antes `ARRAY_AGG(s.image_url ORDER BY s.collected_at DESC)`; depois `ARRAY_AGG(s.image_url ORDER BY s.collected_at DESC, s.id DESC)`, alinhado a `latest_row`.
- Após marcar `card_rollup_state.stale=true` somente para `include_synthetic=true`, o compare contra o baseline original apresentou só diferenças de `image_url`. A comparação profunda dos 47 JSONs confirmou **nenhuma diferença fora de `image_url`**; houve 13 campos divergentes em 3 arquivos (10 cards únicos): `trends_200.json` (10), `ranking_p1.json` (2) e `ranking_p2_growth.json` (1). O arquivo original `/private/tmp/move-golden-antes` foi preservado. A captura foi salva em `/private/tmp/move-golden-desempate`; comparando conteúdo dos diretórios, **somente esses três arquivos mudaram**.
- Prova SQL das URLs antigas: filtrei `analytics_excluded=false` e, por estar no modo `INCLUDE_SYNTHETIC_DATA=true`, não excluí `is_synthetic=true`. Para cada card, a URL antiga estava entre as imagens não nulas no maior `collected_at` (2026-09-14 12:00:00); `old_golden_url_in_tie=true` em todos: Apoio para flexão (2 snapshots/2 imagens), Apoio para flexão rotativo (7/2), Banco regulável (6/3), Bike spinning (29/5), Corda speed (10/2), Elástico mini band (7/2), Estação crossover (14/2), Halter seletor (32/5), Kettlebell (15/5), Tapete TPE (21/5). O mesmo card de apoio rotativo aparece em `trends_200` e `ranking_p1`, por isso são 13 campos mas 10 cards.
- `INCLUDE_SYNTHETIC_DATA=true npm run perf:golden -- --compare /private/tmp/move-golden-desempate` — **`OK: 47 respostas idênticas`**.
- `perf:probe` final (1ª / 2ª medição, ms): tela inicial **48/47**; Ranking **40/47**; resumo **17/9**; recomendações **100/83**; sources/status **62/22**; alerts **4/1**; página do produto **122/79**; price history 30d **10/6**; price history all **130/65**; review history 30d **8/8**; volume history 30d prev **10/9**; suppliers **33/46**; Monte Carlo defaults **73/52**; offers **34/31**; card listings **67/48**. Captura em `/private/tmp/move-perf-depois.txt`.
- Medição final complementar informada pelo usuário: **3 rodadas consecutivas**; considerando a **segunda medição** de cada rodada, `sources/status` **14–17 ms** (baseline **18**), `offers` **13–23 ms** (baseline **15–24**), `catalog/cards/:id/listings` **16–19 ms** (baseline **19–20**), `monte-carlo/defaults` **32–34 ms** (baseline **59**) e `price-history all` **47–58 ms** (baseline **53**). Conforme as três rodadas reportadas, nenhuma chamada ficou mais lenta.

| Endpoint | Antes 1ª/2ª (ms) | Depois 1ª/2ª (ms) |
|---|---:|---:|
| Tela inicial | 751/658 | 48/47 |
| Ranking | 582/551 | 40/47 |
| Resumo | 535/543 | 17/9 |
| Recomendações | 585/596 | 100/83 |
| Sources/status | 20/18 | 62/22 |
| Alerts | 2/1 | 4/1 |
| Página do produto | 212/187 | 122/79 |
| Price history 30d | 47/53 | 10/6 |
| Price history all | 75/53 | 130/65 |
| Review history 30d | 44/43 | 8/8 |
| Volume history 30d prev | 47/54 | 10/9 |
| Suppliers | 53/58 | 33/46 |
| Monte Carlo defaults | 61/59 | 73/52 |
| Offers | 24/15 | 34/31 |
| Card listings | 20/19 | 67/48 |

- Leituras mais lentas que o baseline: sources/status (**+42/+4 ms**), alerts (**+2/0 ms**), price history all (**+55/+12 ms**), Monte Carlo defaults (**+12/-7 ms**), offers (**+10/+16 ms**) e card listings (**+47/+29 ms**). As duas leituras principais do produto, ranking, resumo e recomendações ficaram menores; review 30d, volume 30d, suppliers e price 30d também ficaram menores. Os tempos medem chamadas isoladas sem Redis; esta medição não atribui causalidade às variações de sources/offers/listings.
- Contagens antes do golden → após o probe: `product_listing_snapshots` **58116 → 58116**; `product_clusters` **127 → 127**; `product_cluster_items` **712 → 712**; `listing_fichas` **718 → 718**; `tracked_listings` **613 → 613**; `product_scores` **793 → 793**; `card_rollups` **96 → 96**; `card_rollup_state` **2 → 2**; `ai_call_logs` **379 → 379**. O estado `include_synthetic=true` terminou não stale.
- `ai_call_logs`: baseline inicial **375**; usar **379** como nova base, conforme informado pelo usuário. As quatro chamadas entre 12:31–12:34 UTC foram 1 `recommendations_executive` e 3 `ai_recommendation_card` em cards diferentes; não foram originadas pelos scripts do plano. Nenhuma chamada à Bright Data foi feita.
- `git diff --check` passou. `git diff --stat` cumulativo: **42 files changed, 842 insertions(+), 2522 deletions(-)**; inclui diffs prévios e arquivos fora desta tarefa; arquivos não rastreados não entram.

---

### Tarefa 14: Containers sem override e conferência no navegador

- [x] **Passo 1:** recrie os serviços **só** com o `docker-compose.yml` (sem o override temporário):

```bash
docker compose up -d --build backend frontend
docker exec move-backend env | grep -E "^(FICHA_ENABLED|TRACK_LISTINGS_CRON_ENABLED|RADAR_DISCOVERY_ENABLED|SEARCH_TRENDS_CRON_ENABLED|WEEKLY_COLLECTION_CRON_ENABLED)="
```
Expected: as 5 variáveis `false`. Se `RUN_DB_PUSH_ON_BOOT` estiver `true` no compose do usuário, **deixe como está**: o schema já está igual ao banco, porque as migrations foram aplicadas.

- [x] **Passo 2:** migration `card_rollups` aplicada no banco (Tarefa 9) e backend no ar: `docker logs move-backend 2>&1 | tail -20` sem erro.

- [x] **Passo 3:** no navegador, com um usuário ADMIN:
  - tela inicial, Ranking, Recomendações, página de um produto (abas Anúncios, Ofertas, Adoção e Simulação), Revisão (3 abas) e Sourcing;
  - tudo **igual ao antes** (mesmo conteúdo e mesma aparência);
  - tire prints da tela inicial e da página do produto.
  
  Não use funções que chamam a LLM (Copiloto, recomendação por IA do card gerada de novo). Se uma tela disparar sozinha uma chamada à LLM, registre qual foi.

- [x] **Passo 4:** `ai_call_logs` igual ao do começo, ou só com chamadas disparadas sozinhas pelas telas (registre quais). O `/private/tmp/move-all-task11-override.yaml` não é mais usado. Não apague, só registre.

#### Registro Tarefa 14

- `npx prisma migrate diff --from-url <DATABASE_URL do .env> --to-schema-datamodel prisma/schema.prisma --script`: **`-- This is an empty migration.`**. A primeira execução sob sandbox retornou P1001 por bloqueio de rede; repetida como leitura autorizada, confirmou o schema vazio sem expor a URL.
- `docker compose up -d --build backend frontend` (somente composição padrão `docker-compose.yml`, sem `-f`; nenhum `docker-compose.override.yml` existe na raiz): **exit 0**. Build do backend/`tsc` passou; build frontend em Node 20 terminou com `Application bundle generation complete`, bundle inicial **405,20 kB / 112,35 kB**. A igualdade do tamanho com o baseline anterior no Node 24 foi preservada; o erro 134 do Node 25.9 segue registrado em Tarefa 13 como limitação daquele runtime.
- Pós-boot `prisma db push`: **`The database is already in sync with the Prisma schema.`**; Prisma Client gerado. Logs do backend sem erro; Nest iniciou e conectou Redis/BullMQ. `docker compose ps`: `move-backend` e `move-frontend` ativos; Postgres e Redis saudáveis.
- Flags conferidas no container, todas `false`: `FICHA_ENABLED`, `TRACK_LISTINGS_CRON_ENABLED`, `RADAR_DISCOVERY_ENABLED`, `SEARCH_TRENDS_CRON_ENABLED`, `WEEKLY_COLLECTION_CRON_ENABLED`.
- Navegador Chrome com usuário `tester`; papel confirmado por consulta read-only como `ADMIN`. Executivo (79 produtos), Ranking (79 itens), Recomendações (“As recomendações ainda não estão conectadas”, sem API de LLM), card **Halter ajustável de seletor** (Adoção, Anúncios: 38; Ofertas: 14; Simulação), Revisão (Anúncios provisórios: 84; Tipos novos: 0; Termos em alta: 237) e Sourcing (51 fornecedores) carregaram. Não cliquei ações de revisão, Simular, Preencher com IA, Copilot nem botões de coleta. As capturas pós-build da tela inicial e do produto foram feitas no navegador e anexadas visualmente nesta sessão; não há arquivo de screenshot persistido no repositório. A única captura prévia encontrada no repositório é da tela de login, então não há par de imagens anterior dessas telas para comparação pixel a pixel; a validação visual confirma que as páginas renderizam sem quebra.
- `ai_call_logs`: **379 → 380**. A única chamada adicional foi disparada automaticamente pelo bloco de recomendação da tela Executivo: `recommendations_executive`, `inclusionai/ling-3.0-flash-fin:free`, `SUCCESS`, **2026-09-23 13:35:50 UTC**. Não houve aumento ao abrir Ranking, Recomendações, produto, Revisão ou Sourcing. Nenhuma chamada à Bright Data.
- `/private/tmp/move-all-task11-override.yaml` não foi usado nem apagado. `docker-compose.production.yml` não foi tocado nesta tarefa.
- `git diff --stat` observado antes deste registro: **42 files changed, 842 insertions(+), 2522 deletions(-)**; saída cumulativa, inclui trabalho anterior/preexistente e não inclui arquivos não rastreados. Nenhum commit ou push.

---

### Tarefa 15: Paradas de segurança — fichas e reprocessamento

> **PARE e peça o "ok" do usuário antes de cada passo marcado.** Mostre o comando, o limite de chamadas e o que será enviado. **Não rode dois passos com uma única autorização.**

- [x] **Passo 1 (precisa de ok): fichas da descoberta.** Até 2 chamadas ao OpenRouter (`inclusionai/ling-3.0-flash-fin:free`) com o prompt `ficha-v1`, a taxonomia e o título e trecho da página de cada anúncio pendente (os 6 da descoberta de 22/09):

```bash
cd Move-Intelligence-Back && FICHA_ENABLED=true FICHA_CRON='0 0 1 1 *' INCLUDE_SYNTHETIC_DATA=true npm run catalog:run-fichas -- --max-calls 2
```
Registre o resumo, as fichas (tipo e fora do escopo) e o card de cada anúncio.

- [x] **Passo 2 (sem LLM, só banco): reenfileirar as `codex-manual`.**

```bash
cd Move-Intelligence-Back && INCLUDE_SYNTHETIC_DATA=true npm run catalog:reprocess -- --llm-model codex-manual
```
Expected: cerca de 502 fichas voltam para a fila.

- [x] **Passo 3 (precisa de ok): processar segurando.** Até 30 chamadas, com o mesmo destino e o mesmo tipo de conteúdo do Passo 1, para cerca de 502 anúncios. Se a cota do dia acabar (`stoppedBy: 'budget'` ou `'daily_limit'`), pare e informe. O restante fica para o dia seguinte, com nova autorização.

```bash
cd Move-Intelligence-Back && FICHA_ENABLED=true FICHA_CRON='0 0 1 1 *' INCLUDE_SYNTHETIC_DATA=true npm run catalog:run-fichas -- --max-calls 30 --hold
docker exec move-postgres psql -U move -d move_intelligence -At -c "select status, count(*) from listing_fichas group by 1;"
```

- [x] **Passo 4 (sem LLM): relatório.**

```bash
cd Move-Intelligence-Back && INCLUDE_SYNTHETIC_DATA=true npm run catalog:held -- --report | tee /private/tmp/move-held-report.json
```
**PARE:** mostre ao usuário os totais (`fica`, `muda`, `fora_do_escopo`, `tipo_sugerido`, `revisao_admin` e `novo`) e os exemplos. Espere o ok.

- [x] **Passo 5 (precisa de ok): aplicar e recalcular.**

```bash
cd Move-Intelligence-Back && INCLUDE_SYNTHETIC_DATA=true npm run catalog:held -- --apply
cd Move-Intelligence-Back && PYTHON_BIN=/usr/local/bin/python3 INCLUDE_SYNTHETIC_DATA=true npm run catalog:reprocess -- --finalize
```
Registre:
- `applied` e `blocked`;
- a fila de revisão antes e depois (`select kind, count(*) from catalog_review_items where status='pending' group by 1;`);
- que nenhum anúncio com decisão de ADMIN mudou de card. Para isso, confira os 6 `confirm` humanos de `catalog_decisions` contra `product_cluster_items`.

- [x] **Passo 6:** `ai_call_logs` final, `git status` resumido. **Sem commit.**

### Registro Tarefa 15

- **Trava entre processos:** `CardRollupsService.refresh` agora chama `$executeRaw` com `SELECT pg_advisory_xact_lock(hashtext('card_rollups_refresh'))` como primeira instrução da transação, antes de `deleteMany`. O teste novo `obtém a trava advisory antes de apagar rollups` verifica o SQL e a ordem; o mock recebeu `$executeRaw`. Nenhuma assertion existente foi alterada.
- **Validação da correção:** `npx jest src/shared/card-rollups` — PASS, 1 suite/8 testes; `npx tsc --noEmit -p tsconfig.json` — PASS. `prisma migrate diff --from-url ... --to-schema-datamodel prisma/schema.prisma --script` — `This is an empty migration.` O shell que carregou `.env` emitiu duas mensagens `command not found` por valores sem aspas, mas o comando Prisma terminou exit 0 e confirmou schema vazio; a URL não foi exibida.
- **Backend:** `docker compose up -d --build backend` — exit 0; Prisma Client gerado e build TypeScript Docker passou. Logs: `The database is already in sync with the Prisma schema` e Nest iniciado. `move-backend` e `move-frontend` ativos; Postgres e Redis saudáveis. As cinco flags `FICHA_ENABLED`, `TRACK_LISTINGS_CRON_ENABLED`, `RADAR_DISCOVERY_ENABLED`, `SEARCH_TRENDS_CRON_ENABLED`, `WEEKLY_COLLECTION_CRON_ENABLED` ficaram `false` no container.
- **Contexto da retomada:** a primeira rodada do Passo 3 foi interrompida após a colisão de unicidade, diagnosticada pelo usuário como dois processos no cron `*/30` às 14:00; a falha de cache não afetou as fichas. Na base original 380, essa rodada acrescentou 15 chamadas `catalog-ficha`; junto da chamada do Passo 1, `ai_call_logs` passou a 396. A retomada começou em 396 (21 no UTC do dia, 159 `pending`). Após a trava e rebuild, `run-fichas --max-calls 12 --hold` terminou exit 0 com `{hold:true,maxCalls:12,calls:8,done:148,copied:11,failed:0,stoppedBy:"empty"}`. Nenhuma chamada Bright Data.
- **Passo 1:** exit 0, resumo `{hold:false,maxCalls:2,calls:1,done:6,copied:0,failed:0,stoppedBy:"empty"}`. Resultado dos seis anúncios (todos `inScope=true`): (1) Alibaba `1600973142623`, “High Quality Home Gym Equipment Workout Adjustable …”: `unknown`, sugestão `home_gym_equipment`, sem card e sem revisão pendente; (2) Amazon `B0HJZ3JL9X`, “Adjustable Dumbbell & Weight Bench …”: `adjustable_dumbbell`, card “Halter ajustável de seletor” (`confirmed`); (3) Amazon `B0C6ZTDWCZ`, “LIANTRAL Yoga Mat Storage Rack …”: `weight_rack`, card “Suporte para pesos” (`provisional`), revisão `provisional_listing` pendente; (4) Amazon `B0GFVLX289`, “Stair Stepper for Home …”: `stair_climber`, card “Simulador de escada” (`confirmed`); (5) Amazon `B08RNCBDVC`, “LEMY Medicine Ball Exercise Weighted Fitness …”: `weighted_ball`, card “Bola de peso medicine ball” (`confirmed`); (6) Alibaba `1601290079532`, “Fitness Equipment Adjustable Aerobic Step …”: `aerobic_step`, card “Step aeróbico regulável” (`confirmed`). Nenhum foi classificado fora do escopo.
- **Passo 2:** exit 0; 502 fichas `codex-manual` voltaram para a fila.
- **Passo 4:** `/private/tmp/move-held-report.json`, exit 0; `total=502`: `fica=326`, `muda=176`, `fora_do_escopo=0`, `tipo_sugerido=0`, `revisao_admin=0`, `novo=0`. Travas: (a) 0 ≤ 6; (b) (176+0+0)/502 = **35,1%**, abaixo de 40%; (c) 502 não é menor que 251. Nenhuma acionada. Exemplos de `muda`: “Corda de Pular Ajustável PVC Fitness Casa Completo” (de “Corda de pular speed de aço”, `jump_rope`); “Tapete de Yoga 5mm Antiderrapante Fitness Casa Completo” (de “Tapete de TPE”, `yoga_mat`); “Vibration Plate Pro 180Kg Home Training Equipment” (de “Plataforma vibratória”, `vibration_plate`). Exemplos de `fica`: “Pilates Accessory Kit 5 Pecas Home Training Equipment” (`pilates_accessory_kit`); “Functional Training Battle Rope 9M Home Training Equipment” (`battle_rope`); “Barra de Exercícios Estação Torre Fitness Casa Completo” (`pull_up_tower`). As categorias zeradas não tiveram exemplos.
- **Passo 5:** `catalog:held --apply` — exit 0, `applied=502`, `blocked=0`; `catalog:reprocess --finalize` — exit 0, **568 scores recalculados**. Fila `catalog_review_items` pendente antes: `provisional_listing=85`, `suggested_type=1`; depois: `provisional_listing=62`, `suggested_type=1`.
- **Decisões humanas:** os 6 `confirm` de `catalog_decisions` continuam nos cards originais, todos com `matches=true` em `product_cluster_items`: `amazon_br/mock_plataforma_vibratoria_3d_oscilante_amazon_br_1` → `8e9fbf6b-0b2f-4d81-8dc5-572d19a7b8a8`; `mercado_livre/mock_tapete_de_yoga_8mm_nbr_mercado_livre_1` → `afdca3e8-91b8-4931-9926-5fddea8c2afa`; `shopee_br/mock_barra_de_exercicios_paralelas_barra_shopee_br_1` → `abe60697-3a86-4192-b27e-d1278e7f94d9`; `amazon/mock_tapete_de_yoga_8mm_nbr_amazon_1` → `afdca3e8-91b8-4931-9926-5fddea8c2afa`; `alibaba/mock_apoio_para_flexao_par_ergonomico_alibaba_1` → `abe60697-3a86-4192-b27e-d1278e7f94d9`; `mercado_livre/mock_plataforma_vibratoria_com_cordas_mercado_livre_1` → `50181442-9bad-4a4d-90b2-e17c716f25fe`.
- **Pendências e logs finais:** `listing_fichas`: `done=718`, `held=0`, `pending=0`; não há fichas pendentes. `FICHA_ENABLED` segue `false` no container. `ai_call_logs`: base 396 → **405** (+9); oito novos `catalog-ficha` nesta retomada. Também apareceu um `recommendations_executive` automático às **2026-09-23 16:09:37 UTC** (modelo autorizado, metadata `premises@1@2026-09-22T19:56:06.207Z`), não acionado pelos scripts de ficha e com origem de chamada não determinada. Assim, no período da retomada o delta não foi apenas `catalog-ficha`: `recommendations_executive` passou de 2 para 3; `ai_recommendation_card` permaneceu em 3. Ao longo da Tarefa 15, foram registradas 24 chamadas `catalog-ficha` (1 no Passo 1, 15 na primeira rodada do Passo 3 e 8 na retomada), dentro do máximo autorizado de 32. Total de hoje: 30. Nenhuma chamada Bright Data. Avisos não fatais de pré-cálculo (`Response from the Engine was empty`) apareceram ao fechar os contextos Nest após `--apply`/`--finalize`; ambos os comandos terminaram exit 0.
- **Git:** sem commit/push; `docker-compose.production.yml` já constava modificado antes e não foi tocado. `git diff --stat`: 42 arquivos rastreados, 842 inserções(+), 2.522 remoções(-), cumulativo e incluindo trabalho preexistente; os arquivos não rastreados `src/shared/card-rollups/` e o plano não aparecem nessa contagem. Uma consulta auxiliar de leitura usou por engano a coluna inexistente `action` em `ai_call_logs` e falhou; a consulta corrigida confirmou os resultados acima, sem escrita no banco.

---

## Critérios de aceite (spec §10)

- Suítes verdes: backend, Python e frontend (5 vezes seguidas na Tarefa 5b), com `tsc` e build.
- `perf:golden --compare` com `OK` depois das Tarefas 8, 9, 10, 11, 12 e 13.
- `perf:probe`: tela inicial, Ranking, resumo e recomendações ≤ 150 ms com o pré-cálculo pronto; página do produto ≤ 120 ms; nenhuma chamada mais lenta.
- Acompanhamento sem Bright Data: `not_configured`, 0 anúncios alterados e job `FAILED` com mensagem clara.
- Relatório do reprocessamento entregue antes do `--apply`; nenhum anúncio com decisão de ADMIN mudou de card.
- Compose local sem override, com os crons de coleta desligados e o `CHECKLIST_COLETA_REAL.md` escrito.
