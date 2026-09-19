# Subprojeto A — Catálogo e Card: Plano de Implementação

> **Para agentes executores:** no Claude Code, use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans`. **No Codex ou em qualquer agente sem esses skills:** execute você mesmo, **uma tarefa por vez, na ordem**:
> 1. Siga os passos de cada tarefa exatamente (teste que falha → implementação → teste passando).
> 2. Marque o checkbox (`- [x]`) neste arquivo ao concluir cada passo.
> 3. Ao terminar cada tarefa, mostre ao usuário o resultado dos testes e o `git diff --stat` e **espere o "ok" antes de ir para a próxima**.
> 4. Se um teste do plano não passar com o código do plano, **pare e explique**; não altere a expectativa do teste para "fazer passar".

**Objetivo:** substituir o agrupamento "mesmo modelo" por **cards por conceito de produto**: ficha por anúncio (LLM) → chave do card (tipo + diferenciais) → card, com fila de revisão só para ADMIN e telas atualizadas.

**Arquitetura:**
- O **Python** recorta a página do anúncio e grava o recorte em `products.source_specific.page_excerpt`.
- Um **módulo NestJS novo `catalog`**:
  - registra anúncios numa fila no banco (`listing_fichas`);
  - gera fichas em lotes pela LLM do OpenRouter, respeitando o limite diário;
  - monta o card por regras determinísticas, **reaproveitando `product_clusters` como card**.
- Os **4 caminhos que criavam clusters** passam a chamar uma porta única (`registerListing`), e o `ProductMatchingService` é removido.

**Tecnologias:** NestJS 11 (Fastify), Prisma 6 + PostgreSQL 16 (`pg_trgm`), `@nestjs/schedule`, jest; Python 3 (ETL, pytest); Angular (standalone components, signals); OpenRouter (API compatível com OpenAI).

**Spec:** [`SPEC_SUBPROJETO_A_CATALOGO_CARD.md`](SPEC_SUBPROJETO_A_CATALOGO_CARD.md). **Leia a spec inteira antes de começar.** Este plano implementa a spec; se algo aqui parecer contradizer a spec, a spec vence, e você deve parar e perguntar ao usuário.

## Restrições globais (valem para todas as tarefas)

- **Git:**
  - branch `feat/catalogo-card`;
  - **NÃO fazer commit, push nem criar branch.** O usuário pediu explicitamente. Os passos "Commit" das tarefas foram trocados por "Revisar o diff" (`git status` + `git diff --stat`);
  - **não reverter nem apagar alterações não commitadas que já existem na branch** (há muito trabalho do usuário em andamento).
- **Escopo:** implementar **somente** o que está na spec. Respeitar a seção 11 da spec ("Não fazer"). Nada dos subprojetos B, C, D e E. Nada de abstração multi-provedor de LLM, fila BullMQ nova, embeddings/pgvector ou divisão residencial × comercial.
- **Banco:**
  - mudanças **somente aditivas** (CREATE TABLE, ADD COLUMN com default ou NULL, CREATE INDEX);
  - **nunca** rodar `prisma db push` nem `prisma migrate dev` contra o banco local com dados sem antes ver a diferença com `prisma migrate diff`;
  - o banco local foi restaurado de dump e **não tem `_prisma_migrations`**. O `docker-compose.yml` local define `RUN_DB_PUSH_ON_BOOT=true`, então **não reinicie o container do backend pelo compose padrão** sem revisar isso.
- **LLM:**
  - nenhum teste automatizado chama LLM, Bright Data ou NVIDIA de verdade (usar mocks);
  - o único comando que chama a LLM é `npm run catalog:eval` (manual) e a rotina agendada com `FICHA_ENABLED=true`.
- **Plano gratuito do OpenRouter:** 50 chamadas por dia **para a conta inteira**, zerando às 00:00 UTC. `FICHA_DAILY_CALL_LIMIT` padrão = **35**.
- **Modelo atual:** `inclusionai/ling-3.0-flash-fin:free`. Ele **não aceita `response_format`**, **raciocina antes de responder** (400–7.600 tokens) e tem resposta máxima de **32.768** tokens. `FICHA_MAX_TOKENS` padrão = **20000**. Com 2048 a resposta sai vazia.
- **Idioma:** textos de interface em **português do Brasil**. Chaves de tipo e atributos em snake_case (tipos em inglês, atributos em português, como no Anexo A).
- **Estilo:** siga os padrões do código vizinho (serviços NestJS com `PrismaService`, specs jest com mocks de Prisma, componentes Angular standalone com `signal`/`computed`, API com snake_case convertida para camelCase por `toCamel` no frontend).
- **Comandos de teste** (o frontend usa vitest via `ng test`; os mocks são `vi.fn()`):
  - backend: `cd Move-Intelligence-Back && npx jest <caminho>`;
  - frontend: `cd Move-Intelligence-Front && npx ng test --watch=false --include=<caminho>`;
  - Python: `cd Move-Intelligence-Dados && python3 -m pytest <caminho> -q`.

---

## Mapa de arquivos

**Backend (`Move-Intelligence-Back/`)**

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `prisma/schema.prisma` | Modificar | 5 modelos novos + colunas novas (spec 4) |
| `prisma/migrations/20260918120000_catalog_cards/migration.sql` | Criar | SQL aditivo |
| `prisma/seed/catalog-taxonomy.json` | Criar | Taxonomia inicial (Anexo A) |
| `src/shared/synthetic-data/synthetic-data.filter.ts` (+ `.spec.ts`) | Modificar/Criar | Filtros passam a excluir `analytics_excluded` |
| `src/modules/ai-gateway/openrouter.service.ts` | Modificar | Opção `timeoutMs` |
| `src/modules/catalog/catalog.constants.ts` | Criar | Status, prioridades, leitura das variáveis `FICHA_*` |
| `src/modules/catalog/taxonomy.types.ts` | Criar | Tipos TS da taxonomia |
| `src/modules/catalog/taxonomy.service.ts` (+ spec) | Criar | Ler tipos ativos do banco; semear a partir do JSON |
| `src/modules/catalog/card-key.ts` (+ spec) | Criar | Chave e nome do card (funções puras) |
| `src/modules/catalog/ficha-input.ts` (+ spec) | Criar | Texto de entrada normalizado + hash |
| `src/modules/catalog/ficha-prompt.ts` (+ spec) | Criar | Prompt `ficha-v1` |
| `src/modules/catalog/ficha-parser.ts` (+ spec) | Criar | Ler JSON Lines + validar ficha |
| `src/modules/catalog/ficha-budget.ts` (+ spec) | Criar | Saldo diário de chamadas |
| `src/modules/catalog/card-comparison.ts` (+ spec) | Criar | "Comparação dentro do card" (função pura) |
| `src/modules/catalog/card-assigner.service.ts` (+ spec) | Criar | Regras R1–R7, adoção de legado, `merged`, sincronizar snapshots |
| `src/modules/catalog/ficha.service.ts` (+ spec) | Criar | `registerListing`, `runOnce` |
| `src/modules/catalog/ficha.scheduler.ts` | Criar | Cron da ficha |
| `src/modules/catalog/catalog-review.service.ts` (+ spec) | Criar | Ações de revisão + desfazer |
| `src/modules/catalog/catalog-review.controller.ts` | Criar | Rotas ADMIN |
| `src/modules/catalog/catalog-cards.controller.ts` | Criar | `GET /catalog/cards/:id/listings`, busca e renomear |
| `src/modules/catalog/dto/*.ts` | Criar | DTOs das rotas |
| `src/modules/catalog/catalog.module.ts` | Criar | Wiring |
| `src/modules/auth/admin.guard.ts` (+ spec) | Criar | Exige `role === 'ADMIN'` |
| `src/app.module.ts` | Modificar | Troca `ProductMatchingModule` por `CatalogModule` |
| `src/modules/ingestion/ingestion.service.ts`, `ingestion.module.ts`, `intelligence-collection.service.ts` (+ spec), `src/modules/imports/imports.processor.ts`, `imports.module.ts` | Modificar | Usar `registerListing` |
| `src/modules/product-matching/**`, `scripts/recluster-products.ts` | **Remover** | Agrupamento antigo |
| `src/modules/dashboard-api/dashboard-api.service.ts` (+ spec) | Modificar | Campos do card, `merged`, provisório sem score, comparação |
| `src/modules/products/products.service.ts` | Modificar | Lote do Monte Carlo pula `provisional`/`merged` |
| `scripts/catalog-seed.ts`, `scripts/catalog-reprocess.ts`, `scripts/catalog-eval.ts`, `scripts/user-make-admin.ts` | Criar | Comandos |
| `package.json` | Modificar | Scripts npm |
| `.env.example` | Modificar | Variáveis `FICHA_*` |

**ETL (`Move-Intelligence-Dados/`)**

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `app/etl/extract/marketplace/parsers/base.py` | Modificar | `build_page_excerpt` |
| `app/etl/extract/marketplace/common.py` | Modificar | `parse_detail` grava `page_excerpt` |
| `tests/test_page_excerpt.py` | Criar | Testes com as fixtures reais |

**Frontend (`Move-Intelligence-Front/src/app/`)**

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `core/models/contract.models.ts` | Modificar | Campos do card + tipos da revisão |
| `core/services/catalog.service.ts` | Criar | API do catálogo |
| `core/auth/admin.guard.ts` (+ spec) | Criar | Guard de rota ADMIN |
| `features/ranking/ranking.component.*` + `shared/components/intel/trend-card/*` | Modificar | Linha/card do card, selo Provisório |
| `features/tendencia/tendencia.component.*` | Modificar | Topo, comparação, aba "Anúncios", renomear, redirecionar `merged` |
| `shared/components/intel/card-listings-table/*` | Criar | Tabela de anúncios do card |
| `features/revisao/*` | Criar | Página de revisão |
| `app.routes.ts`, `shared/layout/app-sidebar/*` | Modificar | Rota e item de menu ADMIN |

**Raiz:** `.gitignore` recebe `.superpowers/`.

---

## Tarefa 1: Preparação, variáveis e timeout da LLM

**Arquivos:**
- Modificar: `.gitignore` (raiz)
- Modificar: `Move-Intelligence-Back/.env.example`
- Modificar: `Move-Intelligence-Back/src/modules/ai-gateway/openrouter.service.ts` (interface `OpenRouterChatOptions` e `fetch` em `chatCompletion`)
- Teste: `Move-Intelligence-Back/src/modules/ai-gateway/openrouter.service.spec.ts` (já existe; acrescentar caso)

**Interfaces:**
- Produz: `OpenRouterChatOptions.timeoutMs?: number` (padrão 35_000), usado pela Tarefa 12.

- [x] **Passo 1: Conferir o estado inicial**

Rode:
```bash
cd /Users/raul/Desktop/Move-All && git branch --show-current && git status --short | wc -l
cd Move-Intelligence-Back && npx jest 2>&1 | tail -5
```
Esperado: branch `feat/catalogo-card`. Anote quantos testes passam e falham **antes** de mudar qualquer coisa (é a sua linha de base; falhas já existentes não são sua responsabilidade, mas não podem aumentar).

- [x] **Passo 2: `.gitignore`**

Acrescente ao final de `/Users/raul/Desktop/Move-All/.gitignore`:
```
# Rascunhos visuais do brainstorming (superpowers)
.superpowers/
```

- [x] **Passo 3: `.env.example`**

Acrescente ao final de `Move-Intelligence-Back/.env.example`:
```
# Catálogo (subprojeto A) — ficha por anúncio gerada pela LLM do OpenRouter.
# O plano gratuito do OpenRouter tem 50 chamadas/dia PARA A CONTA INTEIRA (zera 00:00 UTC);
# FICHA_DAILY_CALL_LIMIT é o teto de chamadas do dia (todos os endpoints) até o qual as fichas rodam.
FICHA_ENABLED=false
FICHA_CRON=*/30 * * * *
FICHA_DAILY_CALL_LIMIT=35
FICHA_BATCH_SIZE=20
FICHA_MAX_TOKENS=20000
FICHA_TIMEOUT_MS=120000
# Vazio = usa OPENROUTER_MODEL
FICHA_MODEL=
```

- [x] **Passo 4: Escrever o teste que falha (timeout configurável)**

Acrescente em `src/modules/ai-gateway/openrouter.service.spec.ts` (reaproveite o padrão de mock de `fetch` já usado no arquivo; se o arquivo usar `global.fetch = jest.fn()`, siga igual):
```ts
it('usa timeoutMs das opções no AbortSignal', async () => {
  const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'ok' } }], usage: {} }),
  });
  await service.chatCompletion([{ role: 'user', content: 'oi' }], { timeoutMs: 120_000 });
  expect(timeoutSpy).toHaveBeenCalledWith(120_000);
});
```

- [x] **Passo 5: Rodar o teste e ver falhar**

Run: `cd Move-Intelligence-Back && npx jest src/modules/ai-gateway/openrouter.service.spec.ts -t timeoutMs`
Esperado: FAIL (`toHaveBeenCalledWith(120000)`, recebido `35000`).

- [x] **Passo 6: Implementar**

Em `OpenRouterChatOptions` acrescente:
```ts
  /** Timeout de cada tentativa em ms (padrão 35_000). */
  timeoutMs?: number;
```
Em `chatCompletion`, troque `signal: AbortSignal.timeout(35_000),` por:
```ts
          signal: AbortSignal.timeout(options.timeoutMs ?? 35_000),
```

- [x] **Passo 7: Rodar e ver passar**

Run: `npx jest src/modules/ai-gateway/openrouter.service.spec.ts`
Esperado: PASS (todos os testes do arquivo).

- [x] **Passo 8: Revisar o diff (sem commit)**

```bash
cd /Users/raul/Desktop/Move-All && git diff --stat -- .gitignore Move-Intelligence-Back/.env.example Move-Intelligence-Back/src/modules/ai-gateway/
```

---

## Tarefa 2: Banco — schema Prisma e migration aditiva

**Arquivos:**
- Modificar: `Move-Intelligence-Back/prisma/schema.prisma`
- Criar: `Move-Intelligence-Back/prisma/migrations/20260918120000_catalog_cards/migration.sql`

**Interfaces:**
- Produz (Prisma Client): `catalogFamily`, `catalogType`, `listingFicha`, `catalogReviewItem`, `catalogDecision`; campos novos `productCluster.{typeId, cardKey, cardKeyValues, cardStatus, nameLocked, mergedIntoId}`, `productClusterItem.status`, `productListingSnapshot.analyticsExcluded`.
- Valores de `cardStatus`: `'legacy' | 'provisional' | 'confirmed' | 'merged'`. Valores de `productClusterItem.status`: `'provisional' | 'confirmed'`.

**Desvio consciente da spec (4.2):** a spec pedia índice **UNIQUE parcial** em `card_key`. O Prisma 6 não representa índice parcial (um `db push` futuro o apagaria), então use **índice comum** em `card_key`. A unicidade entre cards ativos é garantida pelo `CardAssignerService` (Tarefa 11), que sempre procura o card ativo antes de criar, e a rotina é de execução única (cron).

- [x] **Passo 1: Acrescentar os modelos novos ao `schema.prisma`**

Cole ao final de `prisma/schema.prisma`:
```prisma
/// Catálogo (subprojeto A): famílias (as ~20 categorias antigas + novas).
model CatalogFamily {
  id        String        @id @default(uuid()) @db.Uuid
  key       String        @unique
  namePt    String        @map("name_pt")
  sortOrder Int           @default(0) @map("sort_order")
  createdAt DateTime      @default(now()) @map("created_at")
  types     CatalogType[]

  @@map("catalog_families")
}

/// Tipo de produto: define a chave do card (card_key_attrs) e o NCM esperado.
model CatalogType {
  id              String           @id @default(uuid()) @db.Uuid
  familyId        String           @map("family_id") @db.Uuid
  key             String           @unique
  namePt          String           @map("name_pt")
  descriptionEn   String           @map("description_en")
  ncm             String?
  cardKeyAttrs    Json             @default("[]") @map("card_key_attrs")
  comparisonAttrs Json             @default("[]") @map("comparison_attrs")
  variationAttrs  Json             @default("[]") @map("variation_attrs")
  source          String           @default("seed")
  active          Boolean          @default(true)
  createdAt       DateTime         @default(now()) @map("created_at")
  updatedAt       DateTime         @updatedAt @map("updated_at")
  family          CatalogFamily    @relation(fields: [familyId], references: [id])
  clusters        ProductCluster[]

  @@map("catalog_types")
}

/// Ficha do anúncio gerada pela LLM. Uma por (marketplace, external_product_id).
model ListingFicha {
  id                String   @id @default(uuid()) @db.Uuid
  marketplace       String
  externalProductId String   @map("external_product_id")
  title             String
  inputHash         String   @map("input_hash")
  status            String   @default("pending")
  priority          Int      @default(100)
  attempts          Int      @default(0)
  lastError         String?  @map("last_error")
  typeKey           String?  @map("type_key")
  suggestedType     String?  @map("suggested_type")
  inScope           Boolean? @map("in_scope")
  isAccessoryOrPart Boolean? @map("is_accessory_or_part")
  isKitOrBundle     Boolean? @map("is_kit_or_bundle")
  hasVariations     Boolean? @map("has_variations")
  cardKeyValues     Json     @default("{}") @map("card_key_values")
  newDifferential   String?  @map("new_differential")
  missingKeyAttrs   String[] @default([]) @map("missing_key_attrs")
  comparisonValues  Json     @default("{}") @map("comparison_values")
  variationValues   Json     @default("{}") @map("variation_values")
  specs             Json     @default("{}")
  brand             String?
  model             String?
  confidence        Decimal? @db.Decimal(4, 3)
  llmModel          String?  @map("llm_model")
  promptVersion     String?  @map("prompt_version")
  copiedFromFichaId String?  @map("copied_from_ficha_id") @db.Uuid
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  @@unique([marketplace, externalProductId])
  @@index([status, priority(sort: Desc), createdAt])
  @@index([inputHash])
  @@map("listing_fichas")
}

/// Fila de revisão do catálogo (ADMIN).
model CatalogReviewItem {
  id                   String          @id @default(uuid()) @db.Uuid
  kind                 String
  marketplace          String?
  externalProductId    String?         @map("external_product_id")
  suggestedClusterId   String?         @map("suggested_cluster_id") @db.Uuid
  suggestedTypeKey     String?         @map("suggested_type_key")
  suggestedTypeAliases String[]        @default([]) @map("suggested_type_aliases")
  listingCount         Int             @default(0) @map("listing_count")
  reason               String
  status               String          @default("pending")
  resolution           String?
  resolvedBy           String?         @map("resolved_by") @db.Uuid
  resolvedAt           DateTime?       @map("resolved_at")
  createdAt            DateTime        @default(now()) @map("created_at")
  suggestedCluster     ProductCluster? @relation(fields: [suggestedClusterId], references: [id], onDelete: SetNull)
  resolver             User?           @relation("CatalogReviewResolver", fields: [resolvedBy], references: [id])

  @@index([kind, status, createdAt])
  @@index([marketplace, externalProductId])
  @@map("catalog_review_items")
}

/// Histórico de decisões da revisão (para desfazer).
model CatalogDecision {
  id                 String   @id @default(uuid()) @db.Uuid
  actorUserId        String   @map("actor_user_id") @db.Uuid
  action             String
  reviewItemId       String?  @map("review_item_id") @db.Uuid
  before             Json
  after              Json
  undoneByDecisionId String?  @map("undone_by_decision_id") @db.Uuid
  createdAt          DateTime @default(now()) @map("created_at")
  actor              User     @relation("CatalogDecisionActor", fields: [actorUserId], references: [id])

  @@index([createdAt])
  @@map("catalog_decisions")
}
```

- [x] **Passo 2: Acrescentar os campos novos aos modelos existentes**

No `model ProductCluster`, logo antes de `items ProductClusterItem[]`, acrescente:
```prisma
  // Catálogo (subprojeto A): o cluster É o card.
  typeId          String?             @map("type_id") @db.Uuid
  cardKey         String?             @map("card_key")
  cardKeyValues   Json?               @map("card_key_values")
  /// legacy | provisional | confirmed | merged
  cardStatus      String              @default("legacy") @map("card_status")
  nameLocked      Boolean             @default(false) @map("name_locked")
  mergedIntoId    String?             @map("merged_into_id") @db.Uuid
  type            CatalogType?        @relation(fields: [typeId], references: [id])
  mergedInto      ProductCluster?     @relation("ClusterMerge", fields: [mergedIntoId], references: [id])
  mergedFrom      ProductCluster[]    @relation("ClusterMerge")
  reviewItems     CatalogReviewItem[]
```
E, nos índices do mesmo modelo (antes de `@@map("product_clusters")`):
```prisma
  @@index([cardKey], map: "idx_clusters_card_key")
  @@index([typeId, cardStatus], map: "idx_clusters_type_status")
```
No `model ProductClusterItem`, depois de `matchedAt`:
```prisma
  /// provisional | confirmed (itens antigos ficam confirmed)
  status            String         @default("confirmed")
```
No `model ProductListingSnapshot`, depois de `isSynthetic`:
```prisma
  /// true = fora de score/séries/Monte Carlo/ranking (anúncio provisório de card confirmado).
  analyticsExcluded Boolean              @default(false) @map("analytics_excluded")
```
No `model User`, depois de `refreshTokens RefreshToken[]`:
```prisma
  catalogReviewsResolved CatalogReviewItem[] @relation("CatalogReviewResolver")
  catalogDecisions       CatalogDecision[]   @relation("CatalogDecisionActor")
```

- [x] **Passo 3: Validar e gerar o client**

Run: `cd Move-Intelligence-Back && npx prisma validate && npx prisma generate`
Esperado: "The schema at prisma/schema.prisma is valid" e client gerado sem erro.

- [x] **Passo 4: Escrever o SQL da migration**

Crie `prisma/migrations/20260918120000_catalog_cards/migration.sql`:
```sql
-- Subprojeto A (catálogo e card): SOMENTE ADITIVO.
CREATE TABLE "catalog_families" (
  "id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name_pt" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "catalog_families_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "catalog_families_key_key" ON "catalog_families"("key");

CREATE TABLE "catalog_types" (
  "id" UUID NOT NULL,
  "family_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name_pt" TEXT NOT NULL,
  "description_en" TEXT NOT NULL,
  "ncm" TEXT,
  "card_key_attrs" JSONB NOT NULL DEFAULT '[]',
  "comparison_attrs" JSONB NOT NULL DEFAULT '[]',
  "variation_attrs" JSONB NOT NULL DEFAULT '[]',
  "source" TEXT NOT NULL DEFAULT 'seed',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "catalog_types_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "catalog_types_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "catalog_families"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "catalog_types_key_key" ON "catalog_types"("key");

CREATE TABLE "listing_fichas" (
  "id" UUID NOT NULL,
  "marketplace" TEXT NOT NULL,
  "external_product_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "input_hash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "priority" INTEGER NOT NULL DEFAULT 100,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "type_key" TEXT,
  "suggested_type" TEXT,
  "in_scope" BOOLEAN,
  "is_accessory_or_part" BOOLEAN,
  "is_kit_or_bundle" BOOLEAN,
  "has_variations" BOOLEAN,
  "card_key_values" JSONB NOT NULL DEFAULT '{}',
  "new_differential" TEXT,
  "missing_key_attrs" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "comparison_values" JSONB NOT NULL DEFAULT '{}',
  "variation_values" JSONB NOT NULL DEFAULT '{}',
  "specs" JSONB NOT NULL DEFAULT '{}',
  "brand" TEXT,
  "model" TEXT,
  "confidence" DECIMAL(4,3),
  "llm_model" TEXT,
  "prompt_version" TEXT,
  "copied_from_ficha_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "listing_fichas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "listing_fichas_marketplace_external_product_id_key" ON "listing_fichas"("marketplace", "external_product_id");
CREATE INDEX "listing_fichas_status_priority_created_at_idx" ON "listing_fichas"("status", "priority" DESC, "created_at");
CREATE INDEX "listing_fichas_input_hash_idx" ON "listing_fichas"("input_hash");

CREATE TABLE "catalog_review_items" (
  "id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "marketplace" TEXT,
  "external_product_id" TEXT,
  "suggested_cluster_id" UUID,
  "suggested_type_key" TEXT,
  "suggested_type_aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "listing_count" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "resolution" TEXT,
  "resolved_by" UUID,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "catalog_review_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "catalog_review_items_suggested_cluster_id_fkey" FOREIGN KEY ("suggested_cluster_id") REFERENCES "product_clusters"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "catalog_review_items_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "catalog_review_items_kind_status_created_at_idx" ON "catalog_review_items"("kind", "status", "created_at");
CREATE INDEX "catalog_review_items_marketplace_external_product_id_idx" ON "catalog_review_items"("marketplace", "external_product_id");

CREATE TABLE "catalog_decisions" (
  "id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "review_item_id" UUID,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "undone_by_decision_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "catalog_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "catalog_decisions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "catalog_decisions_created_at_idx" ON "catalog_decisions"("created_at");

ALTER TABLE "product_clusters"
  ADD COLUMN "type_id" UUID,
  ADD COLUMN "card_key" TEXT,
  ADD COLUMN "card_key_values" JSONB,
  ADD COLUMN "card_status" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "name_locked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "merged_into_id" UUID;
ALTER TABLE "product_clusters"
  ADD CONSTRAINT "product_clusters_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "catalog_types"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "product_clusters_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "product_clusters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "idx_clusters_card_key" ON "product_clusters"("card_key");
CREATE INDEX "idx_clusters_type_status" ON "product_clusters"("type_id", "card_status");

ALTER TABLE "product_cluster_items" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'confirmed';
ALTER TABLE "product_listing_snapshots" ADD COLUMN "analytics_excluded" BOOLEAN NOT NULL DEFAULT false;
```

- [x] **Passo 5: Conferir a diferença contra o banco local (sem aplicar nada)**

O banco local roda em Docker (`move-postgres`). Com o `DATABASE_URL` do `.env` do backend:
```bash
cd Move-Intelligence-Back
npx prisma migrate diff --from-url "$(grep '^DATABASE_URL=' .env | cut -d= -f2-)" --to-schema-datamodel prisma/schema.prisma --script > /tmp/catalog-diff.sql
cat /tmp/catalog-diff.sql
```
Esperado: o SQL listado contém **apenas** criações e adições equivalentes às do Passo 4. **Se aparecer qualquer `DROP` ou `ALTER ... DROP`, PARE e mostre ao usuário.** Não aplique nada.

- [x] **Passo 6: Aplicar a migration no banco LOCAL (somente local)**

```bash
docker exec -i move-postgres psql -U move -d move_intelligence -v ON_ERROR_STOP=1 < prisma/migrations/20260918120000_catalog_cards/migration.sql
```
Esperado: vários `CREATE TABLE`/`ALTER TABLE`/`CREATE INDEX` sem erro. Depois repita o Passo 5; esperado: diferença vazia (ou só comentários).

- [x] **Passo 7: Revisar o diff (sem commit)**

```bash
git status --short Move-Intelligence-Back/prisma
```

---

## Tarefa 3: Filtros compartilhados excluem `analytics_excluded`

**Arquivos:**
- Modificar: `Move-Intelligence-Back/src/shared/synthetic-data/synthetic-data.filter.ts`
- Criar: `Move-Intelligence-Back/src/shared/synthetic-data/synthetic-data.filter.spec.ts`

**Interfaces:**
- Produz: `syntheticSnapshotWhere()` passa a retornar **sempre** `analyticsExcluded: false` (mais `isSynthetic: false` quando `INCLUDE_SYNTHETIC_DATA !== 'true'`); `syntheticSnapshotFilterSql(alias?)` passa a **sempre** incluir `AND <alias.>analytics_excluded = false`.
- Os nomes das funções **não mudam**. Todos os leitores de snapshots (products, dashboard-api, alerts, copilot) herdam o filtro sem outras mudanças.

- [x] **Passo 1: Escrever o teste que falha**

`src/shared/synthetic-data/synthetic-data.filter.spec.ts`:
```ts
import { Prisma } from '@prisma/client';
import { syntheticSnapshotFilterSql, syntheticSnapshotWhere } from './synthetic-data.filter';

describe('synthetic-data.filter — analytics_excluded', () => {
  const original = process.env.INCLUDE_SYNTHETIC_DATA;
  afterEach(() => {
    process.env.INCLUDE_SYNTHETIC_DATA = original;
  });

  it('Prisma: exclui sintético e analytics_excluded por padrão', () => {
    delete process.env.INCLUDE_SYNTHETIC_DATA;
    expect(syntheticSnapshotWhere()).toEqual({ isSynthetic: false, analyticsExcluded: false });
  });

  it('Prisma: com INCLUDE_SYNTHETIC_DATA=true ainda exclui analytics_excluded', () => {
    process.env.INCLUDE_SYNTHETIC_DATA = 'true';
    expect(syntheticSnapshotWhere()).toEqual({ analyticsExcluded: false });
  });

  it('SQL: inclui analytics_excluded com alias', () => {
    delete process.env.INCLUDE_SYNTHETIC_DATA;
    const sql = syntheticSnapshotFilterSql('s') as Prisma.Sql;
    expect(sql.sql).toContain('s.is_synthetic = false');
    expect(sql.sql).toContain('s.analytics_excluded = false');
  });

  it('SQL: com INCLUDE_SYNTHETIC_DATA=true mantém só analytics_excluded', () => {
    process.env.INCLUDE_SYNTHETIC_DATA = 'true';
    const sql = syntheticSnapshotFilterSql() as Prisma.Sql;
    expect(sql.sql).not.toContain('is_synthetic');
    expect(sql.sql).toContain('analytics_excluded = false');
  });
});
```

- [x] **Passo 2: Rodar e ver falhar**

Run: `npx jest src/shared/synthetic-data/synthetic-data.filter.spec.ts`
Esperado: FAIL nos 4 casos.

- [x] **Passo 3: Implementar**

Substitua as duas funções em `synthetic-data.filter.ts`:
```ts
export function syntheticSnapshotFilterSql(alias?: string): Prisma.Sql {
  const prefix = alias ? `${alias}.` : '';
  // Catálogo (subprojeto A): anúncio provisório de card confirmado nunca entra nas análises.
  const excluded = Prisma.sql`AND ${Prisma.raw(`${prefix}analytics_excluded`)} = false`;
  if (includeSyntheticData()) return excluded;
  return Prisma.sql`AND ${Prisma.raw(`${prefix}is_synthetic`)} = false ${excluded}`;
}

/** Filtro Prisma (typed query) para `product_listing_snapshots`. */
export function syntheticSnapshotWhere(): Prisma.ProductListingSnapshotWhereInput {
  return includeSyntheticData()
    ? { analyticsExcluded: false }
    : { isSynthetic: false, analyticsExcluded: false };
}
```
Acrescente ao comentário de topo do arquivo: `Também exclui snapshots com analytics_excluded = true (catálogo, subprojeto A).`

- [x] **Passo 4: Rodar este teste e a suíte inteira**

Run: `npx jest src/shared/synthetic-data && npx jest 2>&1 | tail -5`
Esperado: o novo spec passa; a suíte inteira não tem **mais** falhas que a linha de base da Tarefa 1. Se algum spec existente comparava `syntheticSnapshotWhere()` com `{ isSynthetic: false }` literal, atualize **só essa expectativa** para incluir `analyticsExcluded: false`.

- [x] **Passo 5: Revisar o diff (sem commit)**

---

## Tarefa 4: Taxonomia — arquivo inicial, tipos TS, serviço e `catalog:seed`

**Arquivos:**
- Criar: `Move-Intelligence-Back/prisma/seed/catalog-taxonomy.json`
- Criar: `Move-Intelligence-Back/src/modules/catalog/taxonomy.types.ts`
- Criar: `Move-Intelligence-Back/src/modules/catalog/taxonomy.service.ts`
- Criar: `Move-Intelligence-Back/src/modules/catalog/taxonomy.service.spec.ts`
- Criar: `Move-Intelligence-Back/scripts/catalog-seed.ts`
- Modificar: `Move-Intelligence-Back/package.json` (script `catalog:seed`)

**Interfaces:**
- Produz (`taxonomy.types.ts`):
  ```ts
  export interface CardKeyAttrValue { value: string; label_pt: string }
  export interface CardKeyAttr { attr: string; label_pt: string; values: CardKeyAttrValue[] }
  export type ComparisonKind = 'number' | 'boolean' | 'enum';
  export interface ComparisonAttr { attr: string; label_pt: string; kind: ComparisonKind; unit?: string }
  export interface CatalogTypeDef {
    id: string; key: string; familyKey: string; familyNamePt: string; namePt: string;
    descriptionEn: string; ncm: string | null;
    cardKeyAttrs: CardKeyAttr[]; comparisonAttrs: ComparisonAttr[]; variationAttrs: string[];
  }
  export interface TaxonomySeedFile {
    families: Array<{ key: string; name_pt: string; sort: number }>;
    types: Array<{
      key: string; family: string; name_pt: string; ncm: string | null; description_en: string;
      card_key_attrs: Array<{ attr: string; label_pt: string; values: Array<[string, string]> }>;
      comparison_attrs: Array<[string, string, ComparisonKind] | [string, string, ComparisonKind, string]>;
      variation_attrs: string[];
    }>;
  }
  ```
- Produz (`TaxonomyService`): `listActiveTypes(): Promise<CatalogTypeDef[]>`, `getTypeMap(): Promise<Map<string, CatalogTypeDef>>`, `seedFromFile(file: TaxonomySeedFile): Promise<{ families: number; types: number }>`, e a função exportada `seedTypeToDb(t)` (conversão do formato compacto).
- Regra do nome do card (usada na Tarefa 5): o nome é `name_pt` do tipo + os `label_pt` dos valores-chave, **ignorando o valor `nenhum`**. Por isso os `label_pt` dos valores são escritos para "encaixar" depois do nome (ex.: `Esteira` + `com chuveiro`).

- [x] **Passo 1: Criar `prisma/seed/catalog-taxonomy.json`** (conteúdo exato; espelha o Anexo A da spec)

```json
{
  "families": [
    { "key": "treadmills", "name_pt": "Esteiras", "sort": 1 },
    { "key": "compact_cardio", "name_pt": "Cardio compacto", "sort": 2 },
    { "key": "spinning_bike", "name_pt": "Bikes spinning", "sort": 3 },
    { "key": "exercise_bikes", "name_pt": "Bicicletas ergométricas", "sort": 4 },
    { "key": "elliptical_trainer", "name_pt": "Elípticos", "sort": 5 },
    { "key": "rowing_machine", "name_pt": "Remo", "sort": 6 },
    { "key": "vibration_plate", "name_pt": "Plataformas vibratórias", "sort": 7 },
    { "key": "dumbbells", "name_pt": "Halteres", "sort": 8 },
    { "key": "kettlebells", "name_pt": "Kettlebells", "sort": 9 },
    { "key": "barbells_plates", "name_pt": "Barras e anilhas", "sort": 10 },
    { "key": "weight_bench", "name_pt": "Bancos", "sort": 11 },
    { "key": "commercial_gym_equipment", "name_pt": "Equipamentos de força", "sort": 12 },
    { "key": "ankle_weights", "name_pt": "Caneleiras", "sort": 13 },
    { "key": "pull_up_equipment", "name_pt": "Barras fixas", "sort": 14 },
    { "key": "push_up_equipment", "name_pt": "Apoio de flexão", "sort": 15 },
    { "key": "resistance_bands", "name_pt": "Elásticos", "sort": 16 },
    { "key": "ab_wheel", "name_pt": "Roda abdominal", "sort": 17 },
    { "key": "jump_rope", "name_pt": "Cordas", "sort": 18 },
    { "key": "functional_training", "name_pt": "Treino funcional", "sort": 19 },
    { "key": "yoga_mat", "name_pt": "Tapetes", "sort": 20 },
    { "key": "yoga_pilates", "name_pt": "Pilates", "sort": 21 },
    { "key": "recovery_massage", "name_pt": "Recuperação", "sort": 22 },
    { "key": "protective_gear", "name_pt": "Proteção", "sort": 23 },
    { "key": "smart_fitness", "name_pt": "Smart fitness", "sort": 24 }
  ],
  "types": [
    { "key": "treadmill", "family": "treadmills", "name_pt": "Esteira", "ncm": "9506.91.00",
      "description_en": "full-size electric treadmill with console tower and side handrails, running speeds",
      "card_key_attrs": [{ "attr": "diferencial", "label_pt": "diferencial", "values": [["nenhum", "sem diferencial"], ["chuveiro", "com chuveiro"], ["plataforma_vibratoria", "com plataforma vibratória"]] }],
      "comparison_attrs": [["motor_hp", "motor", "number", "HP"], ["velocidade_max_kmh", "velocidade máx.", "number", "km/h"], ["inclinacao_max_pct", "inclinação máx.", "number", "%"], ["carga_max_kg", "carga máx.", "number", "kg"], ["largura_lona_cm", "largura da lona", "number", "cm"], ["dobravel", "dobrável", "boolean"]],
      "variation_attrs": ["voltagem", "cor"] },
    { "key": "manual_treadmill", "family": "treadmills", "name_pt": "Esteira manual", "ncm": "9506.91.00",
      "description_en": "non-motorized self-powered treadmill (flat or curved deck)",
      "card_key_attrs": [{ "attr": "formato", "label_pt": "formato", "values": [["plana", "plana"], ["curva", "curva"]] }],
      "comparison_attrs": [["carga_max_kg", "carga máx.", "number", "kg"], ["dobravel", "dobrável", "boolean"]],
      "variation_attrs": ["cor"] },
    { "key": "walking_pad", "family": "compact_cardio", "name_pt": "Walking pad", "ncm": "9506.91.00",
      "description_en": "compact low-profile electric walking treadmill, flat deck, walking speeds, fits under a desk, no console tower (may have a short fold-down bar)",
      "card_key_attrs": [{ "attr": "diferencial", "label_pt": "diferencial", "values": [["nenhum", "sem diferencial"]] }],
      "comparison_attrs": [["inclinacao_max_pct", "inclinação máx.", "number", "%"], ["velocidade_max_kmh", "velocidade máx.", "number", "km/h"], ["carga_max_kg", "carga máx.", "number", "kg"], ["com_barra_apoio", "com barra de apoio", "boolean"], ["com_controle", "com controle remoto", "boolean"]],
      "variation_attrs": ["voltagem", "cor"] },
    { "key": "mini_stepper", "family": "compact_cardio", "name_pt": "Mini stepper", "ncm": "9506.91.00",
      "description_en": "mini stepper / step machine",
      "card_key_attrs": [{ "attr": "formato", "label_pt": "formato", "values": [["simples", "simples"], ["com_bracos_ou_elasticos", "com braços ou elásticos"]] }],
      "comparison_attrs": [["carga_max_kg", "carga máx.", "number", "kg"]],
      "variation_attrs": ["cor"] },
    { "key": "pedal_exerciser", "family": "compact_cardio", "name_pt": "Exercitador sentado", "ncm": "9506.91.00",
      "description_en": "seated under-desk pedal exerciser or seated mini elliptical",
      "card_key_attrs": [{ "attr": "movimento", "label_pt": "movimento", "values": [["pedal", "de pedal"], ["eliptico_sentado", "elíptico"]] }],
      "comparison_attrs": [["motorizado", "motorizado", "boolean"], ["niveis_resistencia", "níveis de resistência", "number"]],
      "variation_attrs": ["cor"] },
    { "key": "stair_climber", "family": "compact_cardio", "name_pt": "Simulador de escada", "ncm": "9506.91.00",
      "description_en": "compact stair climber machine",
      "card_key_attrs": [],
      "comparison_attrs": [["carga_max_kg", "carga máx.", "number", "kg"], ["niveis_resistencia", "níveis de resistência", "number"]],
      "variation_attrs": ["cor"] },
    { "key": "spin_bike", "family": "spinning_bike", "name_pt": "Bike spinning", "ncm": "9506.91.00",
      "description_en": "upright indoor cycling / spinning bike with flywheel",
      "card_key_attrs": [{ "attr": "resistencia", "label_pt": "resistência", "values": [["magnetica", "magnética"], ["friccao", "por fricção"]] }],
      "comparison_attrs": [["roda_inercia_kg", "roda de inércia", "number", "kg"], ["carga_max_kg", "carga máx.", "number", "kg"], ["com_app", "com app", "boolean"]],
      "variation_attrs": ["cor"] },
    { "key": "upright_bike", "family": "exercise_bikes", "name_pt": "Bicicleta ergométrica", "ncm": "9506.91.00",
      "description_en": "upright stationary exercise bike or folding X-bike that is not a spinning bike",
      "card_key_attrs": [{ "attr": "formato", "label_pt": "formato", "values": [["vertical", "vertical"], ["x_bike_dobravel", "X-bike dobrável"]] }],
      "comparison_attrs": [["carga_max_kg", "carga máx.", "number", "kg"], ["niveis_resistencia", "níveis de resistência", "number"], ["com_encosto", "com encosto", "boolean"], ["com_app", "com app", "boolean"]],
      "variation_attrs": ["cor"] },
    { "key": "recumbent_bike", "family": "exercise_bikes", "name_pt": "Bicicleta reclinada", "ncm": "9506.91.00",
      "description_en": "recumbent exercise bike with backrest seat",
      "card_key_attrs": [{ "attr": "resistencia", "label_pt": "resistência", "values": [["magnetica", "magnética"], ["friccao", "por fricção"]] }],
      "comparison_attrs": [["carga_max_kg", "carga máx.", "number", "kg"], ["niveis_resistencia", "níveis de resistência", "number"]],
      "variation_attrs": ["cor"] },
    { "key": "air_bike", "family": "exercise_bikes", "name_pt": "Air bike", "ncm": "9506.91.00",
      "description_en": "fan / air resistance bike with moving arms",
      "card_key_attrs": [],
      "comparison_attrs": [["carga_max_kg", "carga máx.", "number", "kg"]],
      "variation_attrs": ["cor"] },
    { "key": "elliptical", "family": "elliptical_trainer", "name_pt": "Elíptico", "ncm": "9506.91.00",
      "description_en": "elliptical cross trainer (transport)",
      "card_key_attrs": [{ "attr": "formato", "label_pt": "formato", "values": [["eliptico", "tradicional"], ["eliptico_bike_2em1", "2 em 1 com bike"]] }],
      "comparison_attrs": [["passada_cm", "passada", "number", "cm"], ["niveis_resistencia", "níveis de resistência", "number"], ["carga_max_kg", "carga máx.", "number", "kg"], ["roda_inercia_kg", "roda de inércia", "number", "kg"]],
      "variation_attrs": ["cor"] },
    { "key": "rowing_machine", "family": "rowing_machine", "name_pt": "Remo seco", "ncm": "9506.91.00",
      "description_en": "indoor rowing machine",
      "card_key_attrs": [{ "attr": "resistencia", "label_pt": "resistência", "values": [["magnetica", "magnético"], ["ar", "a ar"], ["agua", "a água"], ["hidraulica", "hidráulico"]] }],
      "comparison_attrs": [["niveis_resistencia", "níveis de resistência", "number"], ["carga_max_kg", "carga máx.", "number", "kg"], ["dobravel", "dobrável", "boolean"]],
      "variation_attrs": ["cor"] },
    { "key": "vibration_plate", "family": "vibration_plate", "name_pt": "Plataforma", "ncm": "9506.91.00",
      "description_en": "whole body vibration platform",
      "card_key_attrs": [{ "attr": "movimento", "label_pt": "movimento", "values": [["vibratoria", "vibratória"], ["oscilatoria", "oscilatória"], ["dupla", "vibratória e oscilatória"]] }],
      "comparison_attrs": [["niveis_velocidade", "níveis de velocidade", "number"], ["carga_max_kg", "carga máx.", "number", "kg"], ["potencia_w", "potência", "number", "W"]],
      "variation_attrs": ["voltagem", "cor"] },
    { "key": "fixed_dumbbell", "family": "dumbbells", "name_pt": "Halter fixo", "ncm": "9506.91.00",
      "description_en": "fixed-weight dumbbell (hex, round, neoprene/vinyl, chrome); weight cannot be changed",
      "card_key_attrs": [{ "attr": "formato", "label_pt": "formato", "values": [["sextavado", "sextavado"], ["bola", "bola"], ["neoprene_vinil", "de neoprene/vinil"], ["cromado", "cromado"]] }],
      "comparison_attrs": [["revestimento", "revestimento", "enum"]],
      "variation_attrs": ["peso_kg", "par_ou_unidade", "cor"] },
    { "key": "adjustable_dumbbell", "family": "dumbbells", "name_pt": "Halter ajustável", "ncm": "9506.91.00",
      "description_en": "dumbbell whose weight can be changed (selector dial, removable plates with thread/collars, convertible multi-function sets)",
      "card_key_attrs": [{ "attr": "mecanismo", "label_pt": "mecanismo", "values": [["seletor", "de seletor"], ["rosca_anilhas", "de anilhas com rosca"], ["conversivel_multifuncao", "conversível multifunção"]] }],
      "comparison_attrs": [["peso_max_kg", "peso máx.", "number", "kg"], ["incremento_kg", "incremento", "number", "kg"], ["com_maleta_ou_base", "com maleta ou base", "boolean"]],
      "variation_attrs": ["par_ou_unidade", "cor"] },
    { "key": "dumbbell_handle", "family": "dumbbells", "name_pt": "Pegador de halter", "ncm": "9506.91.00",
      "description_en": "loose dumbbell handle bar sold without plates (spare part)",
      "card_key_attrs": [],
      "comparison_attrs": [["comprimento_cm", "comprimento", "number", "cm"], ["diametro_mm", "diâmetro", "number", "mm"]],
      "variation_attrs": ["par_ou_unidade"] },
    { "key": "kettlebell", "family": "kettlebells", "name_pt": "Kettlebell", "ncm": "9506.91.00",
      "description_en": "kettlebell, fixed or adjustable",
      "card_key_attrs": [{ "attr": "formato", "label_pt": "formato", "values": [["ferro_fundido", "de ferro fundido"], ["emborrachado_vinil", "emborrachado/vinil"], ["competicao", "de competição"], ["ajustavel", "ajustável"]] }],
      "comparison_attrs": [],
      "variation_attrs": ["peso_kg", "cor"] },
    { "key": "barbell", "family": "barbells_plates", "name_pt": "Barra", "ncm": "9506.91.00",
      "description_en": "barbell bar (olympic, straight, EZ/W, H) or fixed-weight barbell",
      "card_key_attrs": [{ "attr": "formato", "label_pt": "formato", "values": [["olimpica", "olímpica"], ["reta_comum", "reta comum"], ["w_ez", "W (EZ)"], ["h", "H"], ["montada_fixa", "montada fixa"]] }],
      "comparison_attrs": [["comprimento_m", "comprimento", "number", "m"], ["peso_kg", "peso", "number", "kg"], ["carga_max_kg", "carga máx.", "number", "kg"]],
      "variation_attrs": ["cor"] },
    { "key": "weight_plate", "family": "barbells_plates", "name_pt": "Anilha", "ncm": "9506.91.00",
      "description_en": "loose weight plates / discs",
      "card_key_attrs": [
        { "attr": "formato", "label_pt": "formato", "values": [["bumper", "bumper"], ["ferro_fundido", "de ferro fundido"], ["emborrachada", "emborrachada"]] },
        { "attr": "furo", "label_pt": "furo", "values": [["olimpico_50mm", "furo olímpico 50 mm"], ["comum_28_30mm", "furo 28–30 mm"]] }],
      "comparison_attrs": [],
      "variation_attrs": ["peso_kg", "cor"] },
    { "key": "weight_bench", "family": "weight_bench", "name_pt": "Banco de musculação", "ncm": "9506.91.00",
      "description_en": "workout bench (flat, adjustable, multi-function with rack)",
      "card_key_attrs": [{ "attr": "formato", "label_pt": "formato", "values": [["reto", "reto"], ["regulavel", "regulável"], ["multifuncional_com_suporte", "multifuncional com suporte"]] }],
      "comparison_attrs": [["carga_max_kg", "carga máx.", "number", "kg"], ["posicoes", "posições", "number"], ["dobravel", "dobrável", "boolean"]],
      "variation_attrs": ["cor"] },
    { "key": "power_rack", "family": "commercial_gym_equipment", "name_pt": "Rack", "ncm": "9506.91.00",
      "description_en": "power rack, squat cage, half rack or squat stand (NOT a barbell)",
      "card_key_attrs": [{ "attr": "formato", "label_pt": "formato", "values": [["gaiola_completa", "gaiola completa"], ["suporte_agachamento", "suporte de agachamento"], ["meia_gaiola", "meia gaiola"]] }],
      "comparison_attrs": [["carga_max_kg", "carga máx.", "number", "kg"], ["com_barra_fixa", "com barra fixa", "boolean"]],
      "variation_attrs": ["cor"] },
    { "key": "home_gym_station", "family": "commercial_gym_equipment", "name_pt": "Estação", "ncm": "9506.91.00",
      "description_en": "multi-station home gym, cable crossover / pulley machine or smith machine",
      "card_key_attrs": [{ "attr": "formato", "label_pt": "formato", "values": [["estacao_multifuncao", "de musculação multifunção"], ["crossover_polia", "crossover/polia"], ["smith", "smith"]] }],
      "comparison_attrs": [["carga_max_kg", "carga máx.", "number", "kg"], ["numero_exercicios", "número de exercícios", "number"]],
      "variation_attrs": ["cor"] },
    { "key": "leg_press", "family": "commercial_gym_equipment", "name_pt": "Leg press", "ncm": "9506.91.00",
      "description_en": "leg press machine",
      "card_key_attrs": [],
      "comparison_attrs": [["carga_max_kg", "carga máx.", "number", "kg"], ["angulo", "ângulo", "number", "°"]],
      "variation_attrs": ["cor"] },
    { "key": "ankle_weight", "family": "ankle_weights", "name_pt": "Caneleira", "ncm": "9506.91.00",
      "description_en": "ankle / wrist weights",
      "card_key_attrs": [{ "attr": "formato", "label_pt": "formato", "values": [["fixa", "fixa"], ["ajustavel", "ajustável"]] }],
      "comparison_attrs": [],
      "variation_attrs": ["peso_kg", "par_ou_unidade", "cor"] },
    { "key": "pull_up_bar", "family": "pull_up_equipment", "name_pt": "Barra fixa", "ncm": "9506.91.00",
      "description_en": "doorway, wall or ceiling mounted pull-up / chin-up bar (NOT a barbell)",
      "card_key_attrs": [{ "attr": "fixacao", "label_pt": "fixação", "values": [["porta", "de porta"], ["parede", "de parede"], ["teto", "de teto"]] }],
      "comparison_attrs": [["carga_max_kg", "carga máx.", "number", "kg"]],
      "variation_attrs": ["comprimento_cm", "cor"] },
    { "key": "pull_up_tower", "family": "pull_up_equipment", "name_pt": "Estação de barra", "ncm": "9506.91.00",
      "description_en": "free-standing pull-up tower / dip station",
      "card_key_attrs": [{ "attr": "formato", "label_pt": "formato", "values": [["torre", "torre"], ["paralelas", "com paralelas"]] }],
      "comparison_attrs": [["carga_max_kg", "carga máx.", "number", "kg"], ["altura_regulavel", "altura regulável", "boolean"]],
      "variation_attrs": ["cor"] },
    { "key": "push_up_bars", "family": "push_up_equipment", "name_pt": "Apoio para flexão", "ncm": "9506.91.00",
      "description_en": "push-up handles, rotating push-up bars or multi-position push-up board",
      "card_key_attrs": [{ "attr": "formato", "label_pt": "formato", "values": [["alca_fixa", "de alça fixa"], ["rotativo", "rotativo"], ["prancha_multiposicao", "prancha multiposição"]] }],
      "comparison_attrs": [],
      "variation_attrs": ["cor"] },
    { "key": "resistance_band", "family": "resistance_bands", "name_pt": "Elástico", "ncm": "9506.91.00",
      "description_en": "elastic resistance bands: mini loop bands, long super bands, tubes with handles, fabric bands",
      "card_key_attrs": [{ "attr": "formato", "label_pt": "formato", "values": [["mini_band", "mini band"], ["super_band_longa", "super band longa"], ["tubo_com_alcas", "tubo com alças"], ["faixa_tecido", "de tecido"]] }],
      "comparison_attrs": [["quantidade", "quantidade no kit", "number"], ["niveis", "níveis de resistência", "number"]],
      "variation_attrs": ["cor"] },
    { "key": "ab_wheel", "family": "ab_wheel", "name_pt": "Roda abdominal", "ncm": "9506.91.00",
      "description_en": "ab roller wheel",
      "card_key_attrs": [{ "attr": "formato", "label_pt": "formato", "values": [["simples", "simples"], ["dupla", "dupla"], ["retorno_automatico", "com retorno automático"]] }],
      "comparison_attrs": [],
      "variation_attrs": ["cor"] },
    { "key": "jump_rope", "family": "jump_rope", "name_pt": "Corda de pular", "ncm": "9506.91.00",
      "description_en": "jump rope / skipping rope (speed, weighted, digital counter)",
      "card_key_attrs": [{ "attr": "formato", "label_pt": "formato", "values": [["speed_aco", "speed de aço"], ["com_peso", "com peso"], ["contador_digital", "com contador digital"]] }],
      "comparison_attrs": [],
      "variation_attrs": ["comprimento", "cor"] },
    { "key": "battle_rope", "family": "functional_training", "name_pt": "Battle rope", "ncm": "9506.91.00",
      "description_en": "battle rope",
      "card_key_attrs": [],
      "comparison_attrs": [["comprimento_m", "comprimento", "number", "m"], ["diametro_mm", "diâmetro", "number", "mm"]],
      "variation_attrs": [] },
    { "key": "plyo_box", "family": "functional_training", "name_pt": "Caixa pliométrica", "ncm": "9506.91.00",
      "description_en": "plyometric jump box",
      "card_key_attrs": [{ "attr": "material", "label_pt": "material", "values": [["madeira", "de madeira"], ["espuma", "de espuma"], ["metal", "de metal"]] }],
      "comparison_attrs": [["alturas_cm", "alturas", "enum"]],
      "variation_attrs": [] },
    { "key": "suspension_trainer", "family": "functional_training", "name_pt": "Fita de suspensão", "ncm": "9506.91.00",
      "description_en": "suspension trainer straps (TRX style)",
      "card_key_attrs": [],
      "comparison_attrs": [],
      "variation_attrs": ["cor"] },
    { "key": "weighted_ball", "family": "functional_training", "name_pt": "Bola de peso", "ncm": "9506.91.00",
      "description_en": "slam ball, medicine ball or wall ball",
      "card_key_attrs": [{ "attr": "formato", "label_pt": "formato", "values": [["slam_ball", "slam ball"], ["medicine_ball", "medicine ball"], ["wall_ball", "wall ball"]] }],
      "comparison_attrs": [],
      "variation_attrs": ["peso_kg"] },
    { "key": "sandbag", "family": "functional_training", "name_pt": "Sandbag", "ncm": "9506.91.00",
      "description_en": "training sandbag",
      "card_key_attrs": [],
      "comparison_attrs": [],
      "variation_attrs": ["peso_kg"] },
    { "key": "gymnastic_rings", "family": "functional_training", "name_pt": "Argolas", "ncm": "9506.91.00",
      "description_en": "gymnastic rings",
      "card_key_attrs": [{ "attr": "material", "label_pt": "material", "values": [["madeira", "de madeira"], ["plastico", "de plástico"]] }],
      "comparison_attrs": [],
      "variation_attrs": [] },
    { "key": "hand_grip", "family": "functional_training", "name_pt": "Hand grip", "ncm": "9506.91.00",
      "description_en": "hand grip strengthener",
      "card_key_attrs": [{ "attr": "formato", "label_pt": "formato", "values": [["fixo", "fixo"], ["ajustavel", "ajustável"]] }],
      "comparison_attrs": [["carga_max_kg", "carga máx.", "number", "kg"]],
      "variation_attrs": ["cor"] },
    { "key": "yoga_mat", "family": "yoga_mat", "name_pt": "Tapete", "ncm": "9506.91.00",
      "description_en": "yoga / exercise / pilates mat",
      "card_key_attrs": [{ "attr": "material", "label_pt": "material", "values": [["eva", "de EVA"], ["tpe", "de TPE"], ["pvc", "de PVC"], ["borracha_natural", "de borracha natural"], ["cortica", "de cortiça"]] }],
      "comparison_attrs": [["espessura_mm", "espessura", "number", "mm"], ["comprimento_cm", "comprimento", "number", "cm"]],
      "variation_attrs": ["cor"] },
    { "key": "pilates_ball", "family": "yoga_pilates", "name_pt": "Bola de pilates", "ncm": "9506.91.00",
      "description_en": "pilates / swiss ball",
      "card_key_attrs": [],
      "comparison_attrs": [],
      "variation_attrs": ["diametro_cm", "cor"] },
    { "key": "pilates_ring", "family": "yoga_pilates", "name_pt": "Anel de pilates", "ncm": "9506.91.00",
      "description_en": "pilates magic circle ring",
      "card_key_attrs": [],
      "comparison_attrs": [],
      "variation_attrs": ["cor"] },
    { "key": "foam_roller", "family": "yoga_pilates", "name_pt": "Rolo de liberação", "ncm": "9506.91.00",
      "description_en": "non-electric foam roller or massage roller stick",
      "card_key_attrs": [{ "attr": "formato", "label_pt": "formato", "values": [["liso", "liso"], ["texturizado", "texturizado"]] }],
      "comparison_attrs": [],
      "variation_attrs": ["comprimento_cm", "cor"] },
    { "key": "massage_gun", "family": "recovery_massage", "name_pt": "Pistola massageadora", "ncm": "9019.10.00",
      "description_en": "percussion massage gun (handheld, with heads)",
      "card_key_attrs": [{ "attr": "formato", "label_pt": "formato", "values": [["mini", "mini"], ["padrao", "padrão"]] }],
      "comparison_attrs": [["amplitude_mm", "amplitude", "number", "mm"], ["velocidades", "velocidades", "number"], ["cabecas", "cabeças", "number"]],
      "variation_attrs": ["cor"] },
    { "key": "vibrating_roller", "family": "recovery_massage", "name_pt": "Rolo vibratório", "ncm": "9019.10.00",
      "description_en": "electric vibrating foam roller",
      "card_key_attrs": [],
      "comparison_attrs": [["velocidades", "velocidades", "number"]],
      "variation_attrs": ["cor"] },
    { "key": "neck_massager", "family": "recovery_massage", "name_pt": "Massageador de pescoço", "ncm": "9019.10.00",
      "description_en": "electric neck / shiatsu massager",
      "card_key_attrs": [],
      "comparison_attrs": [],
      "variation_attrs": ["cor"] },
    { "key": "gym_gloves", "family": "protective_gear", "name_pt": "Luva de treino", "ncm": null,
      "description_en": "weightlifting / gym gloves",
      "card_key_attrs": [],
      "comparison_attrs": [],
      "variation_attrs": ["tamanho", "cor"] },
    { "key": "lifting_belt", "family": "protective_gear", "name_pt": "Cinturão", "ncm": null,
      "description_en": "weightlifting belt",
      "card_key_attrs": [{ "attr": "material", "label_pt": "material", "values": [["couro", "de couro"], ["neoprene_nylon", "de neoprene/nylon"]] }],
      "comparison_attrs": [["espessura_mm", "espessura", "number", "mm"]],
      "variation_attrs": ["tamanho", "cor"] },
    { "key": "knee_sleeve", "family": "protective_gear", "name_pt": "Joelheira", "ncm": null,
      "description_en": "knee sleeve / knee support for training",
      "card_key_attrs": [],
      "comparison_attrs": [["espessura_mm", "espessura", "number", "mm"]],
      "variation_attrs": ["tamanho", "cor"] },
    { "key": "wrist_wrap", "family": "protective_gear", "name_pt": "Munhequeira", "ncm": null,
      "description_en": "wrist wraps / wrist support",
      "card_key_attrs": [],
      "comparison_attrs": [],
      "variation_attrs": ["cor"] },
    { "key": "hand_grips_cross", "family": "protective_gear", "name_pt": "Grip de cross training", "ncm": null,
      "description_en": "cross training hand grips / palm protectors",
      "card_key_attrs": [],
      "comparison_attrs": [],
      "variation_attrs": ["tamanho"] },
    { "key": "smart_scale", "family": "smart_fitness", "name_pt": "Balança de composição", "ncm": "8423.10.00",
      "description_en": "smart body composition scale",
      "card_key_attrs": [],
      "comparison_attrs": [["metricas", "métricas", "number"]],
      "variation_attrs": ["cor"] },
    { "key": "rep_sensor", "family": "smart_fitness", "name_pt": "Sensor de repetições", "ncm": null,
      "description_en": "wearable / clip-on repetition counting sensor",
      "card_key_attrs": [],
      "comparison_attrs": [],
      "variation_attrs": [] },
    { "key": "smart_mirror", "family": "smart_fitness", "name_pt": "Espelho de treino", "ncm": null,
      "description_en": "smart training mirror with screen",
      "card_key_attrs": [],
      "comparison_attrs": [["tamanho_pol", "tamanho", "number", "pol"]],
      "variation_attrs": [] },
    { "key": "led_reaction_platform", "family": "smart_fitness", "name_pt": "Plataforma de reação LED", "ncm": null,
      "description_en": "LED reaction / agility training platform or lights",
      "card_key_attrs": [],
      "comparison_attrs": [],
      "variation_attrs": [] }
  ]
}
```

- [x] **Passo 2: Criar `taxonomy.types.ts`** com exatamente as interfaces do bloco "Interfaces" acima.

- [x] **Passo 3: Escrever o teste que falha**

`src/modules/catalog/taxonomy.service.spec.ts`:
```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../../shared/database/prisma.service';
import { TaxonomyService, seedTypeToDb } from './taxonomy.service';
import { TaxonomySeedFile } from './taxonomy.types';

const SEED: TaxonomySeedFile = JSON.parse(
  readFileSync(join(__dirname, '../../../prisma/seed/catalog-taxonomy.json'), 'utf-8'),
);

describe('catalog-taxonomy.json', () => {
  it('tem chaves de família e de tipo únicas', () => {
    const fam = SEED.families.map((f) => f.key);
    const types = SEED.types.map((t) => t.key);
    expect(new Set(fam).size).toBe(fam.length);
    expect(new Set(types).size).toBe(types.length);
  });

  it('todo tipo aponta para família existente e tem descrição', () => {
    const fam = new Set(SEED.families.map((f) => f.key));
    for (const t of SEED.types) {
      expect(fam.has(t.family)).toBe(true);
      expect(t.description_en.length).toBeGreaterThan(5);
    }
  });

  it('cobre as 20 famílias que já existem em product_clusters.category', () => {
    const fam = new Set(SEED.families.map((f) => f.key));
    for (const key of [
      'jump_rope', 'yoga_mat', 'commercial_gym_equipment', 'compact_cardio', 'weight_bench',
      'recovery_massage', 'push_up_equipment', 'resistance_bands', 'spinning_bike', 'ab_wheel',
      'functional_training', 'kettlebells', 'dumbbells', 'yoga_pilates', 'rowing_machine',
      'vibration_plate', 'pull_up_equipment', 'smart_fitness', 'protective_gear', 'ankle_weights',
    ]) {
      expect(fam.has(key)).toBe(true);
    }
  });

  it('atributos-chave têm valores não vazios e sem repetição', () => {
    for (const t of SEED.types) {
      for (const a of t.card_key_attrs) {
        const values = a.values.map(([v]) => v);
        expect(values.length).toBeGreaterThan(0);
        expect(new Set(values).size).toBe(values.length);
      }
    }
  });
});

describe('seedTypeToDb', () => {
  it('converte o formato compacto para o JSON do banco', () => {
    const t = SEED.types.find((x) => x.key === 'spin_bike')!;
    const db = seedTypeToDb(t);
    expect(db.cardKeyAttrs).toEqual([
      { attr: 'resistencia', label_pt: 'resistência', values: [
        { value: 'magnetica', label_pt: 'magnética' },
        { value: 'friccao', label_pt: 'por fricção' },
      ] },
    ]);
    expect(db.comparisonAttrs[0]).toEqual({ attr: 'roda_inercia_kg', label_pt: 'roda de inércia', kind: 'number', unit: 'kg' });
    expect(db.comparisonAttrs[2]).toEqual({ attr: 'com_app', label_pt: 'com app', kind: 'boolean' });
  });
});

describe('TaxonomyService', () => {
  it('seedFromFile faz upsert de famílias e tipos e não mexe em tipos aprovados', async () => {
    const prisma = {
      catalogFamily: { upsert: jest.fn().mockImplementation(({ create }) => ({ id: `f-${create.key}`, ...create })) },
      catalogType: {
        findUnique: jest.fn().mockImplementation(({ where }) =>
          where.key === 'spin_bike' ? { id: 't1', source: 'approved' } : null),
        upsert: jest.fn(),
      },
    };
    const service = new TaxonomyService(prisma as unknown as PrismaService);
    const result = await service.seedFromFile(SEED);
    expect(result.families).toBe(SEED.families.length);
    expect(prisma.catalogType.upsert).toHaveBeenCalledTimes(SEED.types.length - 1);
    expect(prisma.catalogType.upsert.mock.calls.some(([arg]) => arg.where.key === 'spin_bike')).toBe(false);
  });

  it('listActiveTypes converte linhas do banco em CatalogTypeDef', async () => {
    const prisma = {
      catalogType: {
        findMany: jest.fn().mockResolvedValue([{
          id: 't1', key: 'kettlebell', namePt: 'Kettlebell', descriptionEn: 'kettlebell', ncm: '9506.91.00',
          cardKeyAttrs: [], comparisonAttrs: [], variationAttrs: ['peso_kg'],
          family: { key: 'kettlebells', namePt: 'Kettlebells' },
        }]),
      },
    };
    const service = new TaxonomyService(prisma as unknown as PrismaService);
    const [def] = await service.listActiveTypes();
    expect(def).toEqual({
      id: 't1', key: 'kettlebell', familyKey: 'kettlebells', familyNamePt: 'Kettlebells', namePt: 'Kettlebell',
      descriptionEn: 'kettlebell', ncm: '9506.91.00', cardKeyAttrs: [], comparisonAttrs: [], variationAttrs: ['peso_kg'],
    });
    expect(prisma.catalogType.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { active: true } }));
  });
});
```

- [x] **Passo 4: Rodar e ver falhar**

Run: `npx jest src/modules/catalog/taxonomy.service.spec.ts`
Esperado: FAIL ("Cannot find module './taxonomy.service'").

- [x] **Passo 5: Implementar `taxonomy.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import {
  CardKeyAttr,
  CatalogTypeDef,
  ComparisonAttr,
  TaxonomySeedFile,
} from './taxonomy.types';

type SeedType = TaxonomySeedFile['types'][number];

/** Converte o formato compacto do arquivo semente para o JSON gravado no banco. */
export function seedTypeToDb(t: SeedType): {
  cardKeyAttrs: CardKeyAttr[];
  comparisonAttrs: ComparisonAttr[];
  variationAttrs: string[];
} {
  return {
    cardKeyAttrs: t.card_key_attrs.map((a) => ({
      attr: a.attr,
      label_pt: a.label_pt,
      values: a.values.map(([value, label_pt]) => ({ value, label_pt })),
    })),
    comparisonAttrs: t.comparison_attrs.map(([attr, label_pt, kind, unit]) =>
      unit ? { attr, label_pt, kind, unit } : { attr, label_pt, kind },
    ),
    variationAttrs: [...t.variation_attrs],
  };
}

@Injectable()
export class TaxonomyService {
  constructor(private readonly prisma: PrismaService) {}

  async listActiveTypes(): Promise<CatalogTypeDef[]> {
    const rows = await this.prisma.catalogType.findMany({
      where: { active: true },
      include: { family: true },
      orderBy: { key: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      familyKey: row.family.key,
      familyNamePt: row.family.namePt,
      namePt: row.namePt,
      descriptionEn: row.descriptionEn,
      ncm: row.ncm ?? null,
      cardKeyAttrs: (row.cardKeyAttrs as unknown as CardKeyAttr[]) ?? [],
      comparisonAttrs: (row.comparisonAttrs as unknown as ComparisonAttr[]) ?? [],
      variationAttrs: (row.variationAttrs as unknown as string[]) ?? [],
    }));
  }

  async getTypeMap(): Promise<Map<string, CatalogTypeDef>> {
    return new Map((await this.listActiveTypes()).map((t) => [t.key, t]));
  }

  /** Idempotente: upsert por `key`. Tipos com source='approved' (criados na revisão) não são tocados. */
  async seedFromFile(file: TaxonomySeedFile): Promise<{ families: number; types: number }> {
    const familyIds = new Map<string, string>();
    for (const f of file.families) {
      const row = await this.prisma.catalogFamily.upsert({
        where: { key: f.key },
        update: { namePt: f.name_pt, sortOrder: f.sort },
        create: { key: f.key, namePt: f.name_pt, sortOrder: f.sort },
      });
      familyIds.set(f.key, row.id);
    }
    let types = 0;
    for (const t of file.types) {
      const existing = await this.prisma.catalogType.findUnique({ where: { key: t.key } });
      if (existing?.source === 'approved') continue;
      const familyId = familyIds.get(t.family);
      if (!familyId) throw new Error(`Família inexistente no arquivo: ${t.family} (tipo ${t.key})`);
      const json = seedTypeToDb(t);
      const data = {
        familyId,
        namePt: t.name_pt,
        descriptionEn: t.description_en,
        ncm: t.ncm,
        cardKeyAttrs: json.cardKeyAttrs as unknown as Prisma.InputJsonValue,
        comparisonAttrs: json.comparisonAttrs as unknown as Prisma.InputJsonValue,
        variationAttrs: json.variationAttrs as unknown as Prisma.InputJsonValue,
        source: 'seed',
      };
      await this.prisma.catalogType.upsert({
        where: { key: t.key },
        update: data,
        create: { key: t.key, ...data },
      });
      types += 1;
    }
    return { families: file.families.length, types };
  }
}
```

- [x] **Passo 6: Rodar e ver passar**

Run: `npx jest src/modules/catalog/taxonomy.service.spec.ts`
Esperado: PASS.

- [x] **Passo 7: Script `scripts/catalog-seed.ts` + npm script**

`scripts/catalog-seed.ts`:
```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { TaxonomyService } from '../src/modules/catalog/taxonomy.service';
import { TaxonomySeedFile } from '../src/modules/catalog/taxonomy.types';

async function main() {
  const prisma = new PrismaClient();
  try {
    const file = JSON.parse(
      readFileSync(join(__dirname, '../prisma/seed/catalog-taxonomy.json'), 'utf-8'),
    ) as TaxonomySeedFile;
    // PrismaClient é compatível com o que o TaxonomyService usa do PrismaService.
    const service = new TaxonomyService(prisma as never);
    const result = await service.seedFromFile(file);
    console.log(`catalog:seed OK — famílias: ${result.families}, tipos gravados: ${result.types}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```
Em `package.json`, dentro de `"scripts"`, acrescente:
```json
    "catalog:seed": "node --env-file-if-exists=.env -r ts-node/register -r tsconfig-paths/register scripts/catalog-seed.ts",
```

- [x] **Passo 8: Rodar a semente no banco LOCAL e conferir**

```bash
npm run catalog:seed
docker exec move-postgres psql -U move -d move_intelligence -At -c "select count(*) from catalog_families; select count(*) from catalog_types;"
```
Esperado: `famílias: 24, tipos gravados: 53` e as contagens 24 e 53. Rodar de novo não duplica (idempotente).

- [x] **Passo 9: Revisar o diff (sem commit)**

---

## Tarefa 5: Constantes do catálogo + chave e nome do card (funções puras)

**Arquivos:**
- Criar: `Move-Intelligence-Back/src/modules/catalog/catalog.constants.ts`
- Criar: `Move-Intelligence-Back/src/modules/catalog/card-key.ts`
- Criar: `Move-Intelligence-Back/src/modules/catalog/card-key.spec.ts`

**Interfaces:**
- Consome: `CatalogTypeDef` (Tarefa 4).
- Produz (`catalog.constants.ts`): `FICHA_PROMPT_VERSION = 'ficha-v1'`, `PRIORITY = { REPROCESS: 10, DISCOVERY: 100, REVIEW_MERGE: 200 }`, `MAX_FICHA_ATTEMPTS = 3`, `UNKNOWN_TYPE = 'unknown'`, `MISSING_VALUE = '?'`, `NONE_VALUE = 'nenhum'`, `BR_MARKETPLACES`, `ACTIVE_CARD_STATUSES = ['provisional','confirmed']`, `interface FichaConfig`, `fichaConfig(env?)`.
- Produz (`card-key.ts`):
  - `interface KeyEvaluation { cardKey: string; values: Record<string, string>; missing: string[]; newDifferential: string | null; complete: boolean }`;
  - `normalizeDifferential(raw: unknown): string | null`;
  - `evaluateCardKey(type: CatalogTypeDef, rawValues: Record<string, unknown>, newDifferential: unknown): KeyEvaluation`;
  - `cardChipLabels(type: CatalogTypeDef, values: Record<string, string>): string[]`;
  - `buildCardName(type: CatalogTypeDef, values: Record<string, string>): string`.

- [x] **Passo 1: Criar `catalog.constants.ts`**

```ts
export const FICHA_PROMPT_VERSION = 'ficha-v1';
export const FICHA_ENDPOINT_NAME = 'catalog-ficha';
export const PRIORITY = { REPROCESS: 10, DISCOVERY: 100, REVIEW_MERGE: 200 } as const;
export const MAX_FICHA_ATTEMPTS = 3;
export const UNKNOWN_TYPE = 'unknown';
export const MISSING_VALUE = '?';
export const NONE_VALUE = 'nenhum';
export const DIFFERENTIAL_ATTR = 'diferencial';
/** Lojas brasileiras: preço de venda BR (mediana/faixa do card). */
export const BR_MARKETPLACES = ['amazon_br', 'mercado_livre', 'mercadolivre', 'shopee_br'] as const;
export const ACTIVE_CARD_STATUSES = ['provisional', 'confirmed'] as const;

export interface FichaConfig {
  enabled: boolean;
  cron: string;
  dailyCallLimit: number;
  batchSize: number;
  maxTokens: number;
  timeoutMs: number;
  model: string | undefined;
}

function intEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function fichaConfig(env: NodeJS.ProcessEnv = process.env): FichaConfig {
  return {
    enabled: env.FICHA_ENABLED === 'true',
    cron: env.FICHA_CRON || '*/30 * * * *',
    dailyCallLimit: intEnv(env.FICHA_DAILY_CALL_LIMIT, 35, 0, 100_000),
    batchSize: intEnv(env.FICHA_BATCH_SIZE, 20, 1, 60),
    maxTokens: intEnv(env.FICHA_MAX_TOKENS, 20_000, 1_000, 32_768),
    timeoutMs: intEnv(env.FICHA_TIMEOUT_MS, 120_000, 10_000, 600_000),
    model: env.FICHA_MODEL?.trim() || undefined,
  };
}
```

- [x] **Passo 2: Escrever o teste que falha**

`src/modules/catalog/card-key.spec.ts`:
```ts
import { buildCardName, cardChipLabels, evaluateCardKey, normalizeDifferential } from './card-key';
import { fichaConfig } from './catalog.constants';
import { CatalogTypeDef } from './taxonomy.types';

function type(partial: Partial<CatalogTypeDef>): CatalogTypeDef {
  return {
    id: 't', key: 'x', familyKey: 'f', familyNamePt: 'F', namePt: 'X', descriptionEn: 'x', ncm: null,
    cardKeyAttrs: [], comparisonAttrs: [], variationAttrs: [], ...partial,
  };
}

const SPIN = type({
  key: 'spin_bike', namePt: 'Bike spinning',
  cardKeyAttrs: [{ attr: 'resistencia', label_pt: 'resistência', values: [
    { value: 'magnetica', label_pt: 'magnética' }, { value: 'friccao', label_pt: 'por fricção' }] }],
});
const TREADMILL = type({
  key: 'treadmill', namePt: 'Esteira',
  cardKeyAttrs: [{ attr: 'diferencial', label_pt: 'diferencial', values: [
    { value: 'nenhum', label_pt: 'sem diferencial' }, { value: 'chuveiro', label_pt: 'com chuveiro' }] }],
});
const PLATE = type({
  key: 'weight_plate', namePt: 'Anilha',
  cardKeyAttrs: [
    { attr: 'formato', label_pt: 'formato', values: [{ value: 'bumper', label_pt: 'bumper' }] },
    { attr: 'furo', label_pt: 'furo', values: [{ value: 'olimpico_50mm', label_pt: 'furo olímpico 50 mm' }] },
  ],
});
const KETTLE_NO_ATTRS = type({ key: 'battle_rope', namePt: 'Battle rope' });

describe('evaluateCardKey', () => {
  it('chave completa', () => {
    const r = evaluateCardKey(SPIN, { resistencia: 'magnetica' }, null);
    expect(r).toEqual({ cardKey: 'spin_bike|resistencia=magnetica', values: { resistencia: 'magnetica' }, missing: [], newDifferential: null, complete: true });
  });

  it('valor fora da lista vira faltando com "?"', () => {
    const r = evaluateCardKey(SPIN, { resistencia: 'eletromagnetica' }, null);
    expect(r.cardKey).toBe('spin_bike|resistencia=?');
    expect(r.missing).toEqual(['resistencia']);
    expect(r.complete).toBe(false);
  });

  it('respeita a ordem dos atributos do tipo', () => {
    const r = evaluateCardKey(PLATE, { furo: 'olimpico_50mm', formato: 'bumper' }, null);
    expect(r.cardKey).toBe('weight_plate|formato=bumper|furo=olimpico_50mm');
  });

  it('tipo sem atributos-chave: chave = tipo', () => {
    expect(evaluateCardKey(KETTLE_NO_ATTRS, {}, null).cardKey).toBe('battle_rope');
  });

  it('diferencial novo ocupa o atributo diferencial e deixa a chave incompleta', () => {
    const r = evaluateCardKey(TREADMILL, {}, 'Shower Head');
    expect(r.cardKey).toBe('treadmill|diferencial=shower_head');
    expect(r.newDifferential).toBe('shower_head');
    expect(r.missing).toEqual([]);
    expect(r.complete).toBe(false);
  });

  it('diferencial já permitido mandado em new_differential vale como valor conhecido', () => {
    const r = evaluateCardKey(TREADMILL, {}, 'chuveiro');
    expect(r).toEqual({ cardKey: 'treadmill|diferencial=chuveiro', values: { diferencial: 'chuveiro' }, missing: [], newDifferential: null, complete: true });
  });

  it('diferencial novo em tipo sem atributo diferencial vai para o fim da chave', () => {
    expect(evaluateCardKey(SPIN, { resistencia: 'magnetica' }, 'water').cardKey)
      .toBe('spin_bike|resistencia=magnetica|diferencial=water');
  });
});

describe('buildCardName / cardChipLabels', () => {
  it('monta nome com rótulos e ignora "nenhum"', () => {
    expect(buildCardName(SPIN, { resistencia: 'magnetica' })).toBe('Bike spinning magnética');
    expect(buildCardName(TREADMILL, { diferencial: 'nenhum' })).toBe('Esteira');
    expect(buildCardName(TREADMILL, { diferencial: 'chuveiro' })).toBe('Esteira com chuveiro');
  });

  it('ignora "?" e usa o próprio valor para diferencial sem rótulo', () => {
    expect(buildCardName(SPIN, { resistencia: '?' })).toBe('Bike spinning');
    expect(buildCardName(TREADMILL, { diferencial: 'shower_head' })).toBe('Esteira com shower head');
  });

  it('chips são os rótulos sem o nome do tipo', () => {
    expect(cardChipLabels(PLATE, { formato: 'bumper', furo: 'olimpico_50mm' })).toEqual(['bumper', 'furo olímpico 50 mm']);
  });
});

describe('normalizeDifferential / fichaConfig', () => {
  it('normaliza diferencial', () => {
    expect(normalizeDifferential('  Chuveiro Integrado ')).toBe('chuveiro_integrado');
    expect(normalizeDifferential('')).toBeNull();
    expect(normalizeDifferential(null)).toBeNull();
  });

  it('lê padrões e limites', () => {
    expect(fichaConfig({})).toEqual({ enabled: false, cron: '*/30 * * * *', dailyCallLimit: 35, batchSize: 20, maxTokens: 20000, timeoutMs: 120000, model: undefined });
    expect(fichaConfig({ FICHA_ENABLED: 'true', FICHA_BATCH_SIZE: '500', FICHA_MODEL: ' m ' }).batchSize).toBe(60);
    expect(fichaConfig({ FICHA_MODEL: ' m ' }).model).toBe('m');
  });
});
```

- [x] **Passo 3: Rodar e ver falhar**

Run: `npx jest src/modules/catalog/card-key.spec.ts`
Esperado: FAIL ("Cannot find module './card-key'").

- [x] **Passo 4: Implementar `card-key.ts`**

```ts
import { DIFFERENTIAL_ATTR, MISSING_VALUE, NONE_VALUE } from './catalog.constants';
import { CatalogTypeDef } from './taxonomy.types';

export interface KeyEvaluation {
  cardKey: string;
  values: Record<string, string>;
  missing: string[];
  newDifferential: string | null;
  complete: boolean;
}

export function normalizeDifferential(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return value.length > 0 ? value : null;
}

export function evaluateCardKey(
  type: CatalogTypeDef,
  rawValues: Record<string, unknown>,
  newDifferential: unknown,
): KeyEvaluation {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  const order: string[] = [];
  const nd = normalizeDifferential(newDifferential);

  for (const attr of type.cardKeyAttrs) {
    order.push(attr.attr);
    const allowed = new Set(attr.values.map((v) => v.value));
    // Se a LLM mandou um diferencial JÁ permitido em new_differential, ele vale como valor conhecido.
    const raw = rawValues?.[attr.attr] ?? (attr.attr === DIFFERENTIAL_ATTR ? nd : undefined);
    if (attr.attr === DIFFERENTIAL_ATTR && nd && !allowed.has(nd)) {
      values[attr.attr] = nd;
      continue;
    }
    if (typeof raw === 'string' && allowed.has(raw)) {
      values[attr.attr] = raw;
    } else {
      values[attr.attr] = MISSING_VALUE;
      missing.push(attr.attr);
    }
  }
  const hasDifferentialAttr = type.cardKeyAttrs.some((a) => a.attr === DIFFERENTIAL_ATTR);
  const differentialIsNew =
    nd !== null &&
    !(hasDifferentialAttr &&
      type.cardKeyAttrs.find((a) => a.attr === DIFFERENTIAL_ATTR)!.values.some((v) => v.value === nd));
  if (nd && !hasDifferentialAttr) {
    order.push(DIFFERENTIAL_ATTR);
    values[DIFFERENTIAL_ATTR] = nd;
  }
  const cardKey = [type.key, ...order.map((attr) => `${attr}=${values[attr]}`)].join('|');
  const newDiff = differentialIsNew ? nd : null;
  return {
    cardKey,
    values,
    missing,
    newDifferential: newDiff,
    complete: missing.length === 0 && newDiff === null,
  };
}

function labelFor(type: CatalogTypeDef, attr: string, value: string): string | null {
  if (!value || value === MISSING_VALUE || value === NONE_VALUE) return null;
  const def = type.cardKeyAttrs.find((a) => a.attr === attr);
  const known = def?.values.find((v) => v.value === value)?.label_pt;
  if (known) return known;
  const human = value.replace(/_/g, ' ');
  return attr === DIFFERENTIAL_ATTR ? `com ${human}` : human;
}

export function cardChipLabels(type: CatalogTypeDef, values: Record<string, string>): string[] {
  const attrs = [
    ...type.cardKeyAttrs.map((a) => a.attr),
    ...Object.keys(values).filter((k) => !type.cardKeyAttrs.some((a) => a.attr === k)),
  ];
  return attrs
    .map((attr) => labelFor(type, attr, values[attr]))
    .filter((label): label is string => label !== null);
}

export function buildCardName(type: CatalogTypeDef, values: Record<string, string>): string {
  return [type.namePt, ...cardChipLabels(type, values)].join(' ');
}
```
Note: se `diferencial` recebe um valor novo que **já está na lista permitida** (ex.: a LLM mandou `chuveiro` em `new_differential`), ele entra como valor conhecido, sem `newDifferential`.

- [x] **Passo 5: Rodar e ver passar**

Run: `npx jest src/modules/catalog/card-key.spec.ts`
Esperado: PASS.

- [x] **Passo 6: Revisar o diff (sem commit)**

---

## Tarefa 6: Texto de entrada da ficha + hash

**Arquivos:**
- Criar: `Move-Intelligence-Back/src/modules/catalog/ficha-input.ts`
- Criar: `Move-Intelligence-Back/src/modules/catalog/ficha-input.spec.ts`

**Interfaces:**
- Produz: `normalizeListingTitle(title: string): string`, `buildFichaInput(title: string, excerpt?: string | null): string`, `inputHash(text: string): string` (sha256 hex do texto em minúsculas), `MAX_INPUT_CHARS = 4000`.

- [x] **Passo 1: Escrever o teste que falha**

```ts
import { buildFichaInput, inputHash, normalizeListingTitle } from './ficha-input';

describe('ficha-input', () => {
  it('remove o sufixo "(FONTE)" dos dados de demonstração', () => {
    expect(normalizeListingTitle('Walking Pad Esteira Dobrável Ultracompacta (1688)')).toBe('Walking Pad Esteira Dobrável Ultracompacta');
    expect(normalizeListingTitle('Walking Pad Esteira Dobrável Ultracompacta (MERCADOLIVRE)')).toBe('Walking Pad Esteira Dobrável Ultracompacta');
    expect(normalizeListingTitle('Kit (3 peças)  Elástico')).toBe('Kit (3 peças) Elástico');
  });

  it('mesmo título-base de lojas diferentes gera o mesmo hash', () => {
    const a = inputHash(buildFichaInput('Halter Sextavado 5kg (AMAZON)'));
    const b = inputHash(buildFichaInput('Halter Sextavado 5kg (SHOPEE_BR)'));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('junta título e recorte sem repetir o título e corta em 4000', () => {
    const text = buildFichaInput('Bike X', 'Bike X\n- roda 13 kg\n' + 'y'.repeat(5000));
    expect(text.startsWith('Bike X\n- roda 13 kg')).toBe(true);
    expect(text.length).toBe(4000);
  });

  it('sem recorte usa só o título', () => {
    expect(buildFichaInput('Bike X', '   ')).toBe('Bike X');
    expect(buildFichaInput('Bike X', null)).toBe('Bike X');
  });
});
```

- [x] **Passo 2: Rodar e ver falhar** — `npx jest src/modules/catalog/ficha-input.spec.ts` → FAIL (módulo inexistente).

- [x] **Passo 3: Implementar**

```ts
import { createHash } from 'crypto';

export const MAX_INPUT_CHARS = 4000;
const SOURCE_SUFFIX = /\s*\([A-Z0-9_]+\)\s*$/;

export function normalizeListingTitle(title: string): string {
  return String(title ?? '').replace(SOURCE_SUFFIX, '').replace(/\s+/g, ' ').trim();
}

export function buildFichaInput(title: string, excerpt?: string | null): string {
  const base = normalizeListingTitle(title);
  const raw = String(excerpt ?? '').trim();
  if (!raw) return base.slice(0, MAX_INPUT_CHARS);
  const rest = raw.startsWith(base) ? raw.slice(base.length).trim() : raw;
  return (rest ? `${base}\n${rest}` : base).slice(0, MAX_INPUT_CHARS);
}

export function inputHash(text: string): string {
  return createHash('sha256').update(text.toLowerCase()).digest('hex');
}
```

- [x] **Passo 4: Rodar e ver passar** — mesmo comando → PASS.

- [x] **Passo 5: Revisar o diff (sem commit)**

---

## Tarefa 7: Prompt `ficha-v1`

**Arquivos:**
- Criar: `Move-Intelligence-Back/src/modules/catalog/ficha-prompt.ts`
- Criar: `Move-Intelligence-Back/src/modules/catalog/ficha-prompt.spec.ts`

**Interfaces:**
- Consome: `CatalogTypeDef`, `FICHA_PROMPT_VERSION`.
- Produz: `interface FichaPromptItem { ref: string; text: string }`, `buildFichaSystemPrompt(types: CatalogTypeDef[]): string`, `buildFichaUserMessage(items: FichaPromptItem[]): string`.
- `ref` é um identificador curto por lote (`L1`, `L2`, …). O `FichaService` (Tarefa 12) mapeia `ref` → ficha.

- [x] **Passo 1: Escrever o teste que falha**

```ts
import { buildFichaSystemPrompt, buildFichaUserMessage } from './ficha-prompt';
import { CatalogTypeDef } from './taxonomy.types';

const TYPES: CatalogTypeDef[] = [{
  id: 't1', key: 'spin_bike', familyKey: 'spinning_bike', familyNamePt: 'Bikes spinning', namePt: 'Bike spinning',
  descriptionEn: 'upright indoor cycling bike', ncm: '9506.91.00',
  cardKeyAttrs: [{ attr: 'resistencia', label_pt: 'resistência', values: [{ value: 'magnetica', label_pt: 'magnética' }, { value: 'friccao', label_pt: 'por fricção' }] }],
  comparisonAttrs: [{ attr: 'roda_inercia_kg', label_pt: 'roda de inércia', kind: 'number', unit: 'kg' }],
  variationAttrs: ['cor'],
}];

describe('ficha-prompt', () => {
  const system = buildFichaSystemPrompt(TYPES);

  it('lista os tipos com valores permitidos, comparação e variação', () => {
    expect(system).toContain('spin_bike: upright indoor cycling bike');
    expect(system).toContain('resistencia ∈ {magnetica, friccao}');
    expect(system).toContain('roda_inercia_kg (number, kg)');
    expect(system).toContain('variation: cor');
  });

  it('exige JSON Lines e as chaves da ficha', () => {
    expect(system).toContain('JSON Lines');
    for (const key of ['ref', 'type_key', 'suggested_type', 'in_scope', 'is_accessory_or_part', 'is_kit_or_bundle',
      'has_variations', 'card_key_values', 'new_differential', 'comparison_values', 'variation_values', 'specs',
      'brand', 'model', 'confidence']) {
      expect(system).toContain(`"${key}"`);
    }
  });

  it('traz os exemplos do teste cego', () => {
    expect(system).toContain('Esteira Elétrica Plana Residencial Bluetooth');
    expect(system).toContain('dumbbell_handle');
    expect(system).toContain('呼吸啞鈴');
  });

  it('mensagem do usuário é um array JSON com ref e text', () => {
    const msg = buildFichaUserMessage([{ ref: 'L1', text: 'Bike X' }]);
    expect(JSON.parse(msg)).toEqual([{ ref: 'L1', text: 'Bike X' }]);
  });
});
```

- [x] **Passo 2: Rodar e ver falhar** — `npx jest src/modules/catalog/ficha-prompt.spec.ts` → FAIL.

- [x] **Passo 3: Implementar**

```ts
import { FICHA_PROMPT_VERSION } from './catalog.constants';
import { CatalogTypeDef } from './taxonomy.types';

export interface FichaPromptItem {
  ref: string;
  text: string;
}

function typeLine(t: CatalogTypeDef): string {
  const key = t.cardKeyAttrs.length
    ? t.cardKeyAttrs.map((a) => `${a.attr} ∈ {${a.values.map((v) => v.value).join(', ')}}`).join('; ')
    : '(none)';
  const cmp = t.comparisonAttrs.length
    ? t.comparisonAttrs.map((c) => `${c.attr} (${c.kind}${c.unit ? `, ${c.unit}` : ''})`).join(', ')
    : '(none)';
  const variation = t.variationAttrs.length ? t.variationAttrs.join(', ') : '(none)';
  return `- ${t.key}: ${t.descriptionEn} | card key: ${key} | comparison: ${cmp} | variation: ${variation}`;
}

export function buildFichaSystemPrompt(types: CatalogTypeDef[]): string {
  return [
    `You are a strict product classifier for a fitness-equipment sourcing catalog (prompt ${FICHA_PROMPT_VERSION}).`,
    'Each input is a marketplace listing (title, sometimes followed by structured data, specs and bullets) in Portuguese,',
    'English, Simplified or Traditional Chinese. Listings may be noisy, SEO-stuffed, off-topic, accessories, kits or have variations.',
    '',
    'CLOSED TYPE LIST (type_key must be exactly one of these keys, or "unknown"):',
    ...types.map(typeLine),
    '',
    'RULES:',
    '1. Classify by the MAIN physical object being sold, not by words that merely appear in the title (titles add related keywords, e.g. 哑铃/啞鈴 "dumbbell" inside kettlebell or plate listings).',
    '2. A part/accessory FOR a machine: is_accessory_or_part=true and use the type of the part itself when it exists (e.g. dumbbell_handle); if no type describes the part, type_key="unknown".',
    '3. Not fitness equipment (bags, waist packs, phone armbands, clothes, shoes, headphones, speakers, supplements, toys): in_scope=false.',
    '4. Fitness item but no type fits: type_key="unknown" and suggested_type in snake_case English.',
    '5. Kits with different products: is_kit_or_bundle=true; classify by the main item. A pair or a set of the same item is NOT a kit.',
    '6. card_key_values: only the allowed values listed for the type. If the listing has a distinguishing feature not in the list (e.g. a treadmill with a shower), put it in new_differential. If a value is not stated, omit the attribute.',
    '7. comparison_values, variation_values and specs: only facts present in the text, values in English, original units. Never invent.',
    '8. Never invent a new type_key.',
    '',
    'EXAMPLES:',
    '- "Esteira Elétrica Plana Residencial Bluetooth" -> type_key "walking_pad"',
    '- "Barra Halter 35cm Cromada com Rosca" -> type_key "dumbbell_handle", is_accessory_or_part true',
    '- "Keep跑步腰包运动手机袋" (running waist bag) -> in_scope false',
    '- "呼吸啞鈴腹式呼吸訓練器" (breathing trainer) -> in_scope false',
    '- "实心竞技壶铃…提壶哑铃" -> type_key "kettlebell"',
    '- "大孔健身啞鈴片 槓鈴片 15kg" -> type_key "weight_plate"',
    '- "Power Rack Barra Fixa Supino Agachamento" -> type_key "power_rack"',
    '- "Treadmill with shower head for home" -> type_key "treadmill", new_differential "shower"',
    '',
    'OUTPUT: JSON Lines only — one JSON object per line, one line per input, no code fences, no text before or after.',
    'Keys of each object:',
    '{"ref": str, "type_key": str, "suggested_type": str|null, "in_scope": bool, "is_accessory_or_part": bool,',
    ' "is_kit_or_bundle": bool, "has_variations": bool, "card_key_values": {attr: value}, "new_differential": str|null,',
    ' "comparison_values": {attr: value}, "variation_values": {attr: value}, "specs": {name: value}, "brand": str|null,',
    ' "model": str|null, "confidence": number 0-1}',
  ].join('\n');
}

export function buildFichaUserMessage(items: FichaPromptItem[]): string {
  return JSON.stringify(items.map((item) => ({ ref: item.ref, text: item.text })));
}
```

- [x] **Passo 4: Rodar e ver passar** — mesmo comando → PASS.

- [x] **Passo 5: Revisar o diff (sem commit)**

---

## Tarefa 8: Ler e validar a resposta (JSON Lines)

**Arquivos:**
- Criar: `Move-Intelligence-Back/src/modules/catalog/ficha-parser.ts`
- Criar: `Move-Intelligence-Back/src/modules/catalog/ficha-parser.spec.ts`

**Interfaces:**
- Consome: `evaluateCardKey` (Tarefa 5), `CatalogTypeDef`, `UNKNOWN_TYPE`, `MISSING_VALUE`.
- Produz:
  ```ts
  export interface RawFichaLine { ref: string; [key: string]: unknown }
  export interface ValidatedFicha {
    typeKey: string; suggestedType: string | null; inScope: boolean;
    isAccessoryOrPart: boolean; isKitOrBundle: boolean; hasVariations: boolean;
    cardKeyValues: Record<string, string>; newDifferential: string | null; missingKeyAttrs: string[];
    comparisonValues: Record<string, number | boolean | string>; variationValues: Record<string, unknown>;
    specs: Record<string, unknown>; brand: string | null; model: string | null; confidence: number | null;
  }
  export function parseFichaJsonLines(content: string | null | undefined): RawFichaLine[];
  export function validateFicha(line: RawFichaLine, types: Map<string, CatalogTypeDef>): ValidatedFicha;
  ```
- `cardKeyValues` guarda **só valores permitidos** (sem `?`); faltantes vão em `missingKeyAttrs`.

- [x] **Passo 1: Escrever o teste que falha**

```ts
import { parseFichaJsonLines, validateFicha } from './ficha-parser';
import { CatalogTypeDef } from './taxonomy.types';

const SPIN: CatalogTypeDef = {
  id: 't1', key: 'spin_bike', familyKey: 'spinning_bike', familyNamePt: 'Bikes spinning', namePt: 'Bike spinning',
  descriptionEn: 'x', ncm: null,
  cardKeyAttrs: [{ attr: 'resistencia', label_pt: 'resistência', values: [{ value: 'magnetica', label_pt: 'magnética' }] }],
  comparisonAttrs: [
    { attr: 'roda_inercia_kg', label_pt: 'roda', kind: 'number', unit: 'kg' },
    { attr: 'com_app', label_pt: 'app', kind: 'boolean' },
  ],
  variationAttrs: ['cor'],
};
const TYPES = new Map([[SPIN.key, SPIN]]);

describe('parseFichaJsonLines', () => {
  it('lê uma linha por objeto, ignora cerca e linha cortada', () => {
    const content = '```json\n{"ref":"L1","type_key":"spin_bike"}\n{"ref":"L2","type_key":"unknown"}\n{"ref":"L3","type_k';
    expect(parseFichaJsonLines(content).map((l) => l.ref)).toEqual(['L1', 'L2']);
  });

  it('aceita também um array JSON', () => {
    expect(parseFichaJsonLines('[{"ref":"L1"},{"ref":"L2"}]').map((l) => l.ref)).toEqual(['L1', 'L2']);
  });

  it('ignora objetos sem ref e conteúdo vazio', () => {
    expect(parseFichaJsonLines('{"type_key":"x"}')).toEqual([]);
    expect(parseFichaJsonLines(null)).toEqual([]);
  });
});

describe('validateFicha', () => {
  it('tipo conhecido com chave completa', () => {
    const v = validateFicha({ ref: 'L1', type_key: 'spin_bike', in_scope: true, card_key_values: { resistencia: 'magnetica' },
      comparison_values: { roda_inercia_kg: '13', com_app: true, inventado: 1 }, variation_values: { cor: 'preto', peso: 2 },
      brand: 'Merach', confidence: 1.7 }, TYPES);
    expect(v.typeKey).toBe('spin_bike');
    expect(v.cardKeyValues).toEqual({ resistencia: 'magnetica' });
    expect(v.missingKeyAttrs).toEqual([]);
    expect(v.comparisonValues).toEqual({ roda_inercia_kg: 13, com_app: true });
    expect(v.variationValues).toEqual({ cor: 'preto' });
    expect(v.brand).toBe('Merach');
    expect(v.confidence).toBe(1);
  });

  it('valor não permitido vira atributo faltando', () => {
    const v = validateFicha({ ref: 'L1', type_key: 'spin_bike', card_key_values: { resistencia: 'ar' } }, TYPES);
    expect(v.cardKeyValues).toEqual({});
    expect(v.missingKeyAttrs).toEqual(['resistencia']);
  });

  it('tipo inventado vira unknown com sugestão', () => {
    const v = validateFicha({ ref: 'L1', type_key: 'squat_cage' }, TYPES);
    expect(v.typeKey).toBe('unknown');
    expect(v.suggestedType).toBe('squat_cage');
  });

  it('fora do escopo', () => {
    const v = validateFicha({ ref: 'L1', type_key: 'unknown', in_scope: false }, TYPES);
    expect(v.inScope).toBe(false);
    expect(v.typeKey).toBe('unknown');
  });

  it('diferencial novo é normalizado', () => {
    const v = validateFicha({ ref: 'L1', type_key: 'spin_bike', card_key_values: { resistencia: 'magnetica' }, new_differential: 'Water Tank' }, TYPES);
    expect(v.newDifferential).toBe('water_tank');
  });
});
```

- [x] **Passo 2: Rodar e ver falhar** — `npx jest src/modules/catalog/ficha-parser.spec.ts` → FAIL.

- [x] **Passo 3: Implementar**

```ts
import { evaluateCardKey, normalizeDifferential } from './card-key';
import { MISSING_VALUE, UNKNOWN_TYPE } from './catalog.constants';
import { CatalogTypeDef } from './taxonomy.types';

export interface RawFichaLine {
  ref: string;
  [key: string]: unknown;
}

export interface ValidatedFicha {
  typeKey: string;
  suggestedType: string | null;
  inScope: boolean;
  isAccessoryOrPart: boolean;
  isKitOrBundle: boolean;
  hasVariations: boolean;
  cardKeyValues: Record<string, string>;
  newDifferential: string | null;
  missingKeyAttrs: string[];
  comparisonValues: Record<string, number | boolean | string>;
  variationValues: Record<string, unknown>;
  specs: Record<string, unknown>;
  brand: string | null;
  model: string | null;
  confidence: number | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function withRef(value: unknown): value is RawFichaLine {
  return !!value && typeof value === 'object' && typeof (value as { ref?: unknown }).ref === 'string';
}

export function parseFichaJsonLines(content: string | null | undefined): RawFichaLine[] {
  const text = String(content ?? '').replace(/```(?:json|jsonl)?/gi, '').trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) return parsed.filter(withRef);
    } catch {
      // cai para leitura linha a linha
    }
  }
  const lines: RawFichaLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/,$/, '');
    if (!line.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (withRef(parsed)) lines.push(parsed);
    } catch {
      // linha cortada ou inválida: ignorada (o anúncio volta para a fila)
    }
  }
  return lines;
}

function snake(value: string): string {
  return normalizeDifferential(value) ?? value;
}

export function validateFicha(line: RawFichaLine, types: Map<string, CatalogTypeDef>): ValidatedFicha {
  const rawType = asText(line.type_key);
  const type = rawType ? types.get(rawType) : undefined;
  const suggestedRaw = asText(line.suggested_type) ?? (rawType && rawType !== UNKNOWN_TYPE ? rawType : null);
  const confidence = typeof line.confidence === 'number' && Number.isFinite(line.confidence)
    ? Math.min(1, Math.max(0, line.confidence))
    : null;
  const base = {
    inScope: line.in_scope !== false,
    isAccessoryOrPart: line.is_accessory_or_part === true,
    isKitOrBundle: line.is_kit_or_bundle === true,
    hasVariations: line.has_variations === true,
    specs: asRecord(line.specs),
    brand: asText(line.brand),
    model: asText(line.model),
    confidence,
  };

  if (!type) {
    return {
      ...base,
      typeKey: UNKNOWN_TYPE,
      suggestedType: suggestedRaw ? snake(suggestedRaw) : null,
      cardKeyValues: {},
      newDifferential: null,
      missingKeyAttrs: [],
      comparisonValues: {},
      variationValues: {},
    };
  }

  const evaluation = evaluateCardKey(type, asRecord(line.card_key_values), line.new_differential);
  const cardKeyValues: Record<string, string> = {};
  for (const [attr, value] of Object.entries(evaluation.values)) {
    if (value !== MISSING_VALUE && value !== evaluation.newDifferential) cardKeyValues[attr] = value;
  }

  const rawComparison = asRecord(line.comparison_values);
  const comparisonValues: Record<string, number | boolean | string> = {};
  for (const def of type.comparisonAttrs) {
    const value = rawComparison[def.attr];
    if (def.kind === 'number') {
      const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'));
      if (value !== undefined && value !== null && value !== '' && Number.isFinite(n)) comparisonValues[def.attr] = n;
    } else if (def.kind === 'boolean') {
      if (typeof value === 'boolean') comparisonValues[def.attr] = value;
    } else if (typeof value === 'string' && value.trim()) {
      comparisonValues[def.attr] = value.trim();
    }
  }

  const rawVariation = asRecord(line.variation_values);
  const variationValues: Record<string, unknown> = {};
  for (const attr of type.variationAttrs) {
    if (rawVariation[attr] !== undefined && rawVariation[attr] !== null) variationValues[attr] = rawVariation[attr];
  }

  return {
    ...base,
    typeKey: type.key,
    suggestedType: null,
    cardKeyValues,
    newDifferential: evaluation.newDifferential,
    missingKeyAttrs: evaluation.missing,
    comparisonValues,
    variationValues,
  };
}
```

- [x] **Passo 4: Rodar e ver passar** — mesmo comando → PASS.

- [x] **Passo 5: Revisar o diff (sem commit)**

---

## Tarefa 9: Saldo diário de chamadas

**Arquivos:**
- Criar: `Move-Intelligence-Back/src/modules/catalog/ficha-budget.ts`
- Criar: `Move-Intelligence-Back/src/modules/catalog/ficha-budget.spec.ts`

**Interfaces:**
- Produz: `startOfUtcDay(now: Date): Date`, `remainingFichaCalls(prisma: { aiCallLog: { count(args: unknown): Promise<number> } }, limit: number, now?: Date): Promise<number>`.
- Regra (spec 5.2): conta **todas** as linhas de `ai_call_logs` desde 00:00 UTC, **em todos os endpoints**, e devolve `max(0, limit - usadas)`.

- [x] **Passo 1: Escrever o teste que falha**

```ts
import { remainingFichaCalls, startOfUtcDay } from './ficha-budget';

describe('ficha-budget', () => {
  it('início do dia é 00:00 UTC', () => {
    expect(startOfUtcDay(new Date('2026-09-18T02:30:00-03:00')).toISOString()).toBe('2026-09-18T00:00:00.000Z');
  });

  it('conta todas as chamadas do dia (todos os endpoints) e desconta do limite', async () => {
    const prisma = { aiCallLog: { count: jest.fn().mockResolvedValue(30) } };
    const now = new Date('2026-09-18T15:00:00Z');
    await expect(remainingFichaCalls(prisma, 35, now)).resolves.toBe(5);
    expect(prisma.aiCallLog.count).toHaveBeenCalledWith({ where: { createdAt: { gte: new Date('2026-09-18T00:00:00.000Z') } } });
  });

  it('nunca negativo', async () => {
    const prisma = { aiCallLog: { count: jest.fn().mockResolvedValue(80) } };
    await expect(remainingFichaCalls(prisma, 35)).resolves.toBe(0);
  });
});
```

- [x] **Passo 2: Rodar e ver falhar** — `npx jest src/modules/catalog/ficha-budget.spec.ts` → FAIL.

- [x] **Passo 3: Implementar**

```ts
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function remainingFichaCalls(
  prisma: { aiCallLog: { count(args: unknown): Promise<number> } },
  limit: number,
  now: Date = new Date(),
): Promise<number> {
  const used = await prisma.aiCallLog.count({ where: { createdAt: { gte: startOfUtcDay(now) } } });
  return Math.max(0, limit - used);
}
```

- [x] **Passo 4: Rodar e ver passar** — PASS.

- [x] **Passo 5: Revisar o diff (sem commit)**

---

## Tarefa 10: Comparação dentro do card (função pura)

**Arquivos:**
- Criar: `Move-Intelligence-Back/src/modules/catalog/card-comparison.ts`
- Criar: `Move-Intelligence-Back/src/modules/catalog/card-comparison.spec.ts`

**Interfaces:**
- Consome: `CatalogTypeDef`, `BR_MARKETPLACES`.
- Produz:
  ```ts
  export interface ComparisonListing {
    marketplace: string; brand: string | null; price: number | null;
    status: 'confirmed' | 'provisional';
    comparisonValues: Record<string, unknown>;
  }
  export interface CardComparison {
    listing_count: number; store_count: number; brand_count: number;
    price_median_br: number | null; price_min_br: number | null; price_max_br: number | null;
    ranges: Array<{ attr: string; label_pt: string; unit: string | null; min: number; max: number }>;
    counts: Array<{ attr: string; label_pt: string; values: Array<{ value: string; count: number }>; total: number }>;
    tech_warning: string | null;
  }
  export function buildCardComparison(type: CatalogTypeDef, listings: ComparisonListing[]): CardComparison;
  export function median(values: number[]): number | null;
  ```
- As chaves estão em **snake_case de propósito**: o objeto vai direto na resposta da API, e o frontend converte para camelCase.
- Só anúncios `confirmed` entram. O preço usa só as lojas de `BR_MARKETPLACES`. O aviso só olha atributos `enum`/`boolean` com ≥ 2 grupos de ≥ 2 anúncios com preço, e dispara se a diferença de medianas for ≥ 30% (spec 6.3).

- [x] **Passo 1: Escrever o teste que falha**

```ts
import { buildCardComparison, median } from './card-comparison';
import { CatalogTypeDef } from './taxonomy.types';

const SPIN: CatalogTypeDef = {
  id: 't1', key: 'spin_bike', familyKey: 'f', familyNamePt: 'F', namePt: 'Bike spinning', descriptionEn: 'x', ncm: null,
  cardKeyAttrs: [],
  comparisonAttrs: [
    { attr: 'roda_inercia_kg', label_pt: 'roda de inércia', kind: 'number', unit: 'kg' },
    { attr: 'com_app', label_pt: 'com app', kind: 'boolean' },
  ],
  variationAttrs: [],
};

const L = (marketplace: string, price: number | null, values: Record<string, unknown>, extra: Partial<{ brand: string; status: 'confirmed' | 'provisional' }> = {}) => ({
  marketplace, price, brand: extra.brand ?? null, status: extra.status ?? 'confirmed', comparisonValues: values,
});

describe('median', () => {
  it('calcula mediana par e ímpar', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('buildCardComparison', () => {
  const listings = [
    L('mercado_livre', 1000, { roda_inercia_kg: 6, com_app: false }, { brand: 'A' }),
    L('shopee_br', 1100, { roda_inercia_kg: 8, com_app: false }, { brand: 'B' }),
    L('amazon_br', 2000, { roda_inercia_kg: 13, com_app: true }, { brand: 'A' }),
    L('mercado_livre', 2200, { roda_inercia_kg: 13, com_app: true }),
    L('1688', 90, { roda_inercia_kg: 20 }),
    L('mercado_livre', 50, { roda_inercia_kg: 99 }, { status: 'provisional' }),
  ];
  const c = buildCardComparison(SPIN, listings);

  it('conta só confirmados; lojas e marcas distintas', () => {
    expect(c.listing_count).toBe(5);
    expect(c.store_count).toBe(4);
    expect(c.brand_count).toBe(2);
  });

  it('preço de venda BR: mediana e faixa só de lojas brasileiras', () => {
    expect(c.price_median_br).toBe(1550);
    expect(c.price_min_br).toBe(1000);
    expect(c.price_max_br).toBe(2200);
  });

  it('faixas numéricas e contagens de booleanos', () => {
    expect(c.ranges).toEqual([{ attr: 'roda_inercia_kg', label_pt: 'roda de inércia', unit: 'kg', min: 6, max: 20 }]);
    expect(c.counts).toEqual([{ attr: 'com_app', label_pt: 'com app', total: 4, values: [{ value: 'false', count: 2 }, { value: 'true', count: 2 }] }]);
  });

  it('aviso de tecnologia quando o preço difere ≥ 30%', () => {
    expect(c.tech_warning).toBe('⚠ Tecnologias diferentes: com app = não custa ~50% menos que com app = sim — compare antes de negociar.');
  });

  it('sem aviso quando a diferença é pequena ou os grupos são pequenos', () => {
    const small = buildCardComparison(SPIN, [
      L('mercado_livre', 1000, { com_app: false }), L('mercado_livre', 1050, { com_app: false }),
      L('mercado_livre', 1100, { com_app: true }), L('mercado_livre', 1150, { com_app: true }),
    ]);
    expect(small.tech_warning).toBeNull();
    expect(buildCardComparison(SPIN, []).price_median_br).toBeNull();
  });
});
```

- [x] **Passo 2: Rodar e ver falhar** — `npx jest src/modules/catalog/card-comparison.spec.ts` → FAIL.

- [x] **Passo 3: Implementar**

```ts
import { BR_MARKETPLACES } from './catalog.constants';
import { CatalogTypeDef } from './taxonomy.types';

export interface ComparisonListing {
  marketplace: string;
  brand: string | null;
  price: number | null;
  status: 'confirmed' | 'provisional';
  comparisonValues: Record<string, unknown>;
}

export interface CardComparison {
  listing_count: number;
  store_count: number;
  brand_count: number;
  price_median_br: number | null;
  price_min_br: number | null;
  price_max_br: number | null;
  ranges: Array<{ attr: string; label_pt: string; unit: string | null; min: number; max: number }>;
  counts: Array<{ attr: string; label_pt: string; values: Array<{ value: string; count: number }>; total: number }>;
  tech_warning: string | null;
}

const BR = new Set<string>(BR_MARKETPLACES);
const TECH_GAP = 0.3;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function display(value: string): string {
  if (value === 'true') return 'sim';
  if (value === 'false') return 'não';
  return value.replace(/_/g, ' ');
}

export function buildCardComparison(type: CatalogTypeDef, listings: ComparisonListing[]): CardComparison {
  const confirmed = listings.filter((l) => l.status === 'confirmed');
  const brPrices = confirmed
    .filter((l) => BR.has(l.marketplace) && typeof l.price === 'number' && l.price > 0)
    .map((l) => l.price as number);

  const ranges: CardComparison['ranges'] = [];
  const counts: CardComparison['counts'] = [];
  let bestWarning: { gap: number; text: string } | null = null;

  for (const def of type.comparisonAttrs) {
    if (def.kind === 'number') {
      const nums = confirmed
        .map((l) => l.comparisonValues[def.attr])
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      if (nums.length) ranges.push({ attr: def.attr, label_pt: def.label_pt, unit: def.unit ?? null, min: Math.min(...nums), max: Math.max(...nums) });
      continue;
    }
    const tally = new Map<string, number>();
    const priceGroups = new Map<string, number[]>();
    for (const l of confirmed) {
      const raw = l.comparisonValues[def.attr];
      if (raw === undefined || raw === null || raw === '') continue;
      const key = String(raw);
      tally.set(key, (tally.get(key) ?? 0) + 1);
      if (BR.has(l.marketplace) && typeof l.price === 'number' && l.price > 0) {
        priceGroups.set(key, [...(priceGroups.get(key) ?? []), l.price]);
      }
    }
    if (tally.size) {
      const values = [...tally.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([value, count]) => ({ value, count }));
      counts.push({ attr: def.attr, label_pt: def.label_pt, values, total: values.reduce((s, v) => s + v.count, 0) });
    }
    const groups = [...priceGroups.entries()]
      .filter(([, prices]) => prices.length >= 2)
      .map(([value, prices]) => ({ value, med: median(prices) as number }));
    if (groups.length >= 2) {
      const cheap = groups.reduce((a, b) => (b.med < a.med ? b : a));
      const dear = groups.reduce((a, b) => (b.med > a.med ? b : a));
      const gap = (dear.med - cheap.med) / dear.med;
      if (gap >= TECH_GAP && (!bestWarning || gap > bestWarning.gap)) {
        bestWarning = {
          gap,
          text: `⚠ Tecnologias diferentes: ${def.label_pt} = ${display(cheap.value)} custa ~${Math.round(gap * 100)}% menos que ${def.label_pt} = ${display(dear.value)} — compare antes de negociar.`,
        };
      }
    }
  }

  return {
    listing_count: confirmed.length,
    store_count: new Set(confirmed.map((l) => l.marketplace)).size,
    brand_count: new Set(confirmed.map((l) => l.brand).filter((b): b is string => !!b)).size,
    price_median_br: median(brPrices),
    price_min_br: brPrices.length ? Math.min(...brPrices) : null,
    price_max_br: brPrices.length ? Math.max(...brPrices) : null,
    ranges,
    counts,
    tech_warning: bestWarning?.text ?? null,
  };
}
```

- [x] **Passo 4: Rodar e ver passar** — PASS.

- [x] **Passo 5: Revisar o diff (sem commit)**

---

## Tarefa 11: Montagem do card (`CardAssignerService`)

**Arquivos:**
- Criar: `Move-Intelligence-Back/src/modules/catalog/card-assigner.service.ts`
- Criar: `Move-Intelligence-Back/src/modules/catalog/card-assigner.service.spec.ts`

**Interfaces:**
- Consome: `TaxonomyService.getTypeMap()`, `evaluateCardKey`, `buildCardName`, `normalizeDifferential` (Tarefa 5), constantes (Tarefa 5), Prisma (Tarefa 2).
- Produz:
  ```ts
  export interface ListingRef { marketplace: string; externalProductId: string }
  export type ItemStatus = 'confirmed' | 'provisional';
  export type AssignOutcome = 'out_of_scope' | 'suggested_type' | 'confirmed' | 'provisional' | 'error_review';
  export interface AssignResult { outcome: AssignOutcome; clusterId: string | null; touched: string[] }
  class CardAssignerService {
    assign(ficha: ListingFicha, opts?: { deferRefresh?: boolean }): Promise<AssignResult>;
    moveListing(listing: ListingRef, targetClusterId: string | null, status: ItemStatus, opts?: { deferRefresh?: boolean }): Promise<{ fromClusterId: string | null; touched: string[] }>;
    refreshCard(clusterId: string, lastDestination?: string | null): Promise<void>;
    refreshMany(pairs: Array<{ clusterId: string; lastDestination: string | null }>): Promise<void>;
    createCardForType(typeKey: string, cardKeyValues: Record<string, string>, name?: string): Promise<string>;
    registerSuggestedType(raw: string | null): Promise<string>;
    ensureListingReview(listing: ListingRef, clusterId: string | null, reason: string): Promise<void>;
    resolveListingReviews(listing: ListingRef, resolution: string, actorId?: string | null): Promise<void>;
  }
  ```
- `touched` = ids de cards alterados. Com `deferRefresh: true`, a rotina chama `refreshMany` **uma vez por lote**, em vez de recalcular o card a cada anúncio. Isso é essencial no reprocessamento de ~58 mil anúncios.
- Regras (spec 6.2): R1 fora do escopo · R2 tipo desconhecido → tipo sugerido · R3/R4 chave completa → `confirmed` (card existente ou novo) · R5 diferencial novo → `provisional` + revisão · R6 atributo faltando → card mais provável `provisional` + revisão · R7 ficha em erro → revisão.
- **Adoção (spec 6.5):** ao criar card para um anúncio cujo cluster atual tem `cardStatus='legacy'` e `cardKey=null`, **esse cluster vira o card** (preserva scores, alertas e links).
- **`refreshCard`:**
  - card sem itens → se era `legacy` e há `lastDestination`, vira `merged` com `mergedIntoId = lastDestination`;
  - card com itens → recalcula `cardStatus` (≥ 1 `confirmed` → `confirmed`, senão `provisional`) e o nome (se `nameLocked=false`);
  - mantém `analytics_excluded` (spec 4.4) e zera `simulatedAt` (score desatualizado).

- [x] **Passo 1: Escrever o teste que falha**

`src/modules/catalog/card-assigner.service.spec.ts`:
```ts
import { ListingFicha } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { CardAssignerService } from './card-assigner.service';
import { TaxonomyService } from './taxonomy.service';
import { CatalogTypeDef } from './taxonomy.types';

const SPIN: CatalogTypeDef = {
  id: 'type-spin', key: 'spin_bike', familyKey: 'spinning_bike', familyNamePt: 'Bikes spinning', namePt: 'Bike spinning',
  descriptionEn: 'x', ncm: null,
  cardKeyAttrs: [{ attr: 'resistencia', label_pt: 'resistência', values: [
    { value: 'magnetica', label_pt: 'magnética' }, { value: 'friccao', label_pt: 'por fricção' }] }],
  comparisonAttrs: [], variationAttrs: [],
};

function ficha(partial: Partial<ListingFicha>): ListingFicha {
  return {
    id: 'f1', marketplace: 'mercado_livre', externalProductId: 'MLB1', title: 't', inputHash: 'h', status: 'done',
    priority: 100, attempts: 0, lastError: null, typeKey: 'spin_bike', suggestedType: null, inScope: true,
    isAccessoryOrPart: false, isKitOrBundle: false, hasVariations: false, cardKeyValues: { resistencia: 'magnetica' },
    newDifferential: null, missingKeyAttrs: [], comparisonValues: {}, variationValues: {}, specs: {}, brand: null,
    model: null, confidence: null, llmModel: null, promptVersion: null, copiedFromFichaId: null,
    createdAt: new Date(), updatedAt: new Date(), ...partial,
  } as ListingFicha;
}

function build() {
  const prisma = {
    productClusterItem: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(), update: jest.fn(), delete: jest.fn(),
    },
    productCluster: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'card-new' }),
      update: jest.fn(),
    },
    productListingSnapshot: { updateMany: jest.fn() },
    trackedListing: { updateMany: jest.fn() },
    catalogReviewItem: {
      findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'rev1', suggestedTypeAliases: ['squat_cage'] }),
      update: jest.fn().mockImplementation(({ data }) => ({ id: 'rev1', suggestedTypeAliases: data.suggestedTypeAliases ?? ['squat_cage'] })),
      updateMany: jest.fn(),
    },
    listingFicha: { count: jest.fn().mockResolvedValue(1) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const taxonomy = { getTypeMap: jest.fn().mockResolvedValue(new Map([[SPIN.key, SPIN]])) };
  const service = new CardAssignerService(prisma as unknown as PrismaService, taxonomy as unknown as TaxonomyService);
  return { service, prisma };
}

describe('CardAssignerService.assign — regras R1–R7', () => {
  it('R1: fora do escopo remove o anúncio de qualquer card', async () => {
    const { service, prisma } = build();
    prisma.productClusterItem.findUnique.mockResolvedValue({ id: 'i1', clusterId: 'old' });
    const r = await service.assign(ficha({ inScope: false }), { deferRefresh: true });
    expect(r.outcome).toBe('out_of_scope');
    expect(prisma.productClusterItem.delete).toHaveBeenCalledWith({ where: { id: 'i1' } });
    expect(prisma.productListingSnapshot.updateMany).toHaveBeenCalledWith({
      where: { marketplace: 'mercado_livre', externalProductId: 'MLB1' }, data: { productClusterId: null } });
  });

  it('R2: tipo desconhecido registra tipo sugerido e não cria card', async () => {
    const { service, prisma } = build();
    const r = await service.assign(ficha({ typeKey: 'unknown', suggestedType: 'squat_cage' }), { deferRefresh: true });
    expect(r.outcome).toBe('suggested_type');
    expect(prisma.catalogReviewItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'suggested_type', suggestedTypeKey: 'squat_cage' }) }));
    expect(prisma.productCluster.create).not.toHaveBeenCalled();
  });

  it('R3: chave completa entra no card ativo existente como confirmed', async () => {
    const { service, prisma } = build();
    prisma.productCluster.findFirst.mockResolvedValue({ id: 'card-1' });
    const r = await service.assign(ficha({}), { deferRefresh: true });
    expect(r).toEqual({ outcome: 'confirmed', clusterId: 'card-1', touched: ['card-1'] });
    expect(prisma.productCluster.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { cardKey: 'spin_bike|resistencia=magnetica', cardStatus: { in: ['provisional', 'confirmed'] } } }));
    expect(prisma.productClusterItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({ clusterId: 'card-1', status: 'confirmed' }) });
  });

  it('R4: chave completa sem card cria card confirmado com nome montado', async () => {
    const { service, prisma } = build();
    const r = await service.assign(ficha({}), { deferRefresh: true });
    expect(r.clusterId).toBe('card-new');
    expect(prisma.productCluster.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      canonicalName: 'Bike spinning magnética', category: 'spinning_bike', typeId: 'type-spin',
      cardKey: 'spin_bike|resistencia=magnetica', cardStatus: 'confirmed' }) });
  });

  it('R4 + adoção: cluster legacy do anúncio vira o card', async () => {
    const { service, prisma } = build();
    prisma.productClusterItem.findUnique.mockResolvedValue({ id: 'i1', clusterId: 'legacy-1' });
    prisma.productCluster.findUnique.mockResolvedValue({ id: 'legacy-1', cardStatus: 'legacy', cardKey: null, nameLocked: false });
    const r = await service.assign(ficha({}), { deferRefresh: true });
    expect(r.clusterId).toBe('legacy-1');
    expect(prisma.productCluster.create).not.toHaveBeenCalled();
    expect(prisma.productCluster.update).toHaveBeenCalledWith({ where: { id: 'legacy-1' }, data: expect.objectContaining({
      cardKey: 'spin_bike|resistencia=magnetica', cardStatus: 'confirmed', canonicalName: 'Bike spinning magnética' }) });
  });

  it('R5: diferencial novo cria card provisional e item de revisão', async () => {
    const { service, prisma } = build();
    const r = await service.assign(ficha({ newDifferential: 'water_tank' }), { deferRefresh: true });
    expect(r.outcome).toBe('provisional');
    expect(prisma.productCluster.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      cardKey: 'spin_bike|resistencia=magnetica|diferencial=water_tank', cardStatus: 'provisional' }) });
    expect(prisma.catalogReviewItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      kind: 'provisional_listing', reason: 'diferencial novo: water_tank' }) });
  });

  it('R6: atributo faltando entra no card mais provável como provisional', async () => {
    const { service, prisma } = build();
    prisma.productCluster.findMany.mockResolvedValue([
      { id: 'card-a', cardKeyValues: { resistencia: 'friccao' }, createdAt: new Date('2026-01-01'), items: [{ id: '1' }] },
      { id: 'card-b', cardKeyValues: { resistencia: 'magnetica' }, createdAt: new Date('2026-02-01'), items: [{ id: '1' }, { id: '2' }] },
    ]);
    const r = await service.assign(ficha({ cardKeyValues: {} }), { deferRefresh: true });
    expect(r).toMatchObject({ outcome: 'provisional', clusterId: 'card-b' });
    expect(prisma.catalogReviewItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      reason: 'falta a especificação: resistência' }) });
  });

  it('R6 sem card do tipo: cria card provisional com "?" na chave', async () => {
    const { service, prisma } = build();
    await service.assign(ficha({ cardKeyValues: {} }), { deferRefresh: true });
    expect(prisma.productCluster.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      cardKey: 'spin_bike|resistencia=?', cardStatus: 'provisional' }) });
  });

  it('R7: ficha em erro vai para revisão sem mover o anúncio', async () => {
    const { service, prisma } = build();
    const r = await service.assign(ficha({ status: 'error' }), { deferRefresh: true });
    expect(r.outcome).toBe('error_review');
    expect(prisma.productClusterItem.create).not.toHaveBeenCalled();
    expect(prisma.catalogReviewItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({ reason: 'ficha falhou' }) });
  });
});

describe('CardAssignerService.refreshCard', () => {
  it('card legacy vazio vira merged apontando para o destino', async () => {
    const { service, prisma } = build();
    prisma.productCluster.findUnique.mockResolvedValue({ id: 'legacy-1', cardStatus: 'legacy', cardKey: null, items: [] });
    await service.refreshCard('legacy-1', 'card-9');
    expect(prisma.productCluster.update).toHaveBeenCalledWith({ where: { id: 'legacy-1' }, data: { cardStatus: 'merged', mergedIntoId: 'card-9', simulatedAt: null } });
  });

  it('card com confirmado + provisório: exclui provisórios das análises e fica confirmed', async () => {
    const { service, prisma } = build();
    prisma.productCluster.findUnique.mockResolvedValue({
      id: 'c1', cardStatus: 'provisional', cardKey: 'spin_bike|resistencia=magnetica', typeId: 'type-spin', nameLocked: false,
      cardKeyValues: { resistencia: 'magnetica' },
      items: [
        { marketplace: 'ml', externalProductId: 'A', status: 'confirmed' },
        { marketplace: 'ml', externalProductId: 'B', status: 'provisional' },
      ],
    });
    await service.refreshCard('c1');
    expect(prisma.productListingSnapshot.updateMany).toHaveBeenNthCalledWith(1, { where: { productClusterId: 'c1' }, data: { analyticsExcluded: false } });
    expect(prisma.productListingSnapshot.updateMany).toHaveBeenNthCalledWith(2, {
      where: { productClusterId: 'c1', OR: [{ marketplace: 'ml', externalProductId: 'B' }] }, data: { analyticsExcluded: true } });
    expect(prisma.productCluster.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: {
      cardStatus: 'confirmed', simulatedAt: null, canonicalName: 'Bike spinning magnética' } });
  });

  it('card só com provisórios: nada excluído das análises e fica provisional', async () => {
    const { service, prisma } = build();
    prisma.productCluster.findUnique.mockResolvedValue({
      id: 'c1', cardStatus: 'confirmed', cardKey: 'k', typeId: 'type-spin', nameLocked: true, cardKeyValues: {},
      items: [{ marketplace: 'ml', externalProductId: 'B', status: 'provisional' }],
    });
    await service.refreshCard('c1');
    expect(prisma.productListingSnapshot.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.productCluster.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { cardStatus: 'provisional', simulatedAt: null } });
  });
});
```

- [x] **Passo 2: Rodar e ver falhar**

Run: `npx jest src/modules/catalog/card-assigner.service.spec.ts`
Esperado: FAIL (módulo inexistente).

- [x] **Passo 3: Implementar `card-assigner.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { ListingFicha, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { buildCardName, evaluateCardKey, KeyEvaluation, normalizeDifferential } from './card-key';
import { ACTIVE_CARD_STATUSES, MISSING_VALUE } from './catalog.constants';
import { TaxonomyService } from './taxonomy.service';
import { CatalogTypeDef } from './taxonomy.types';

export interface ListingRef {
  marketplace: string;
  externalProductId: string;
}
export type ItemStatus = 'confirmed' | 'provisional';
export type AssignOutcome = 'out_of_scope' | 'suggested_type' | 'confirmed' | 'provisional' | 'error_review';
export interface AssignResult {
  outcome: AssignOutcome;
  clusterId: string | null;
  touched: string[];
}

const ACTIVE = { in: [...ACTIVE_CARD_STATUSES] as string[] };
const TYPE_CACHE_MS = 60_000;

@Injectable()
export class CardAssignerService {
  private typeCache: { at: number; map: Map<string, CatalogTypeDef> } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly taxonomy: TaxonomyService,
  ) {}

  private async types(): Promise<Map<string, CatalogTypeDef>> {
    if (!this.typeCache || Date.now() - this.typeCache.at > TYPE_CACHE_MS) {
      this.typeCache = { at: Date.now(), map: await this.taxonomy.getTypeMap() };
    }
    return this.typeCache.map;
  }

  private async typeById(typeId: string | null): Promise<CatalogTypeDef | undefined> {
    if (!typeId) return undefined;
    return [...(await this.types()).values()].find((t) => t.id === typeId);
  }

  async assign(ficha: ListingFicha, opts: { deferRefresh?: boolean } = {}): Promise<AssignResult> {
    const listing: ListingRef = { marketplace: ficha.marketplace, externalProductId: ficha.externalProductId };
    const current = await this.prisma.productClusterItem.findUnique({
      where: { marketplace_externalProductId: listing },
    });

    if (ficha.status === 'error') {
      await this.ensureListingReview(listing, current?.clusterId ?? null, 'ficha falhou');
      return { outcome: 'error_review', clusterId: current?.clusterId ?? null, touched: [] };
    }
    if (ficha.inScope === false) {
      const moved = await this.moveListing(listing, null, 'confirmed', opts);
      await this.resolveListingReviews(listing, 'auto_out_of_scope');
      return { outcome: 'out_of_scope', clusterId: null, touched: moved.touched };
    }
    const type = ficha.typeKey ? (await this.types()).get(ficha.typeKey) : undefined;
    if (!type) {
      const moved = await this.moveListing(listing, null, 'confirmed', opts);
      await this.registerSuggestedType(ficha.suggestedType);
      return { outcome: 'suggested_type', clusterId: null, touched: moved.touched };
    }

    const evaluation = evaluateCardKey(
      type,
      (ficha.cardKeyValues ?? {}) as Record<string, unknown>,
      ficha.newDifferential,
    );
    const adopt = current && (await this.isAdoptableLegacy(current.clusterId)) ? current.clusterId : null;

    let clusterId: string;
    let status: ItemStatus;
    let reason: string | null = null;
    if (evaluation.newDifferential) {
      clusterId = (await this.findActiveByKey(evaluation.cardKey)) ?? (await this.createCard(type, evaluation, 'provisional', adopt));
      status = 'provisional';
      reason = `diferencial novo: ${evaluation.newDifferential}`;
    } else if (evaluation.complete) {
      clusterId = (await this.findActiveByKey(evaluation.cardKey)) ?? (await this.createCard(type, evaluation, 'confirmed', adopt));
      status = 'confirmed';
    } else {
      clusterId = (await this.mostProbableCard(type, evaluation)) ?? (await this.createCard(type, evaluation, 'provisional', adopt));
      status = 'provisional';
      const labels = evaluation.missing.map((attr) => type.cardKeyAttrs.find((a) => a.attr === attr)?.label_pt ?? attr);
      reason = `falta a especificação: ${labels.join(', ')}`;
    }

    const moved = await this.moveListing(listing, clusterId, status, opts);
    if (reason) await this.ensureListingReview(listing, clusterId, reason);
    else await this.resolveListingReviews(listing, 'auto_confirmed');
    return { outcome: status, clusterId, touched: moved.touched };
  }

  async moveListing(
    listing: ListingRef,
    targetClusterId: string | null,
    status: ItemStatus,
    opts: { deferRefresh?: boolean } = {},
  ): Promise<{ fromClusterId: string | null; touched: string[] }> {
    const current = await this.prisma.productClusterItem.findUnique({
      where: { marketplace_externalProductId: listing },
    });
    const from = current?.clusterId ?? null;
    if (targetClusterId === null) {
      if (current) await this.prisma.productClusterItem.delete({ where: { id: current.id } });
    } else if (current) {
      await this.prisma.productClusterItem.update({
        where: { id: current.id },
        data: { clusterId: targetClusterId, status, matchedBy: 'catalog', similarityScore: 1, matchedAt: new Date() },
      });
    } else {
      await this.prisma.productClusterItem.create({
        data: { clusterId: targetClusterId, ...listing, status, matchedBy: 'catalog', similarityScore: 1 },
      });
    }
    await this.prisma.productListingSnapshot.updateMany({
      where: { marketplace: listing.marketplace, externalProductId: listing.externalProductId },
      data: { productClusterId: targetClusterId },
    });
    await this.prisma.trackedListing.updateMany({
      where: { source: listing.marketplace, nativeId: listing.externalProductId },
      data: { productId: targetClusterId },
    });
    const touched = [...new Set([targetClusterId, from].filter((id): id is string => !!id))];
    if (!opts.deferRefresh) {
      if (targetClusterId) await this.refreshCard(targetClusterId);
      if (from && from !== targetClusterId) await this.refreshCard(from, targetClusterId);
    }
    return { fromClusterId: from, touched };
  }

  async refreshMany(pairs: Array<{ clusterId: string; lastDestination: string | null }>): Promise<void> {
    const seen = new Map<string, string | null>();
    for (const pair of pairs) seen.set(pair.clusterId, pair.lastDestination ?? seen.get(pair.clusterId) ?? null);
    for (const [clusterId, lastDestination] of seen) await this.refreshCard(clusterId, lastDestination);
  }

  async refreshCard(clusterId: string, lastDestination: string | null = null): Promise<void> {
    const card = await this.prisma.productCluster.findUnique({ where: { id: clusterId }, include: { items: true } });
    if (!card) return;
    if (card.items.length === 0) {
      if (card.cardStatus === 'legacy' && lastDestination) {
        await this.prisma.productCluster.update({
          where: { id: clusterId },
          data: { cardStatus: 'merged', mergedIntoId: lastDestination, simulatedAt: null },
        });
      } else {
        await this.prisma.productCluster.update({ where: { id: clusterId }, data: { simulatedAt: null } });
      }
      return;
    }
    if (card.cardKey === null) {
      await this.prisma.productCluster.update({ where: { id: clusterId }, data: { simulatedAt: null } });
      return;
    }
    const hasConfirmed = card.items.some((item) => item.status === 'confirmed');
    const provisional = card.items.filter((item) => item.status === 'provisional');
    await this.prisma.productListingSnapshot.updateMany({
      where: { productClusterId: clusterId },
      data: { analyticsExcluded: false },
    });
    if (hasConfirmed && provisional.length > 0) {
      await this.prisma.productListingSnapshot.updateMany({
        where: {
          productClusterId: clusterId,
          OR: provisional.map((item) => ({ marketplace: item.marketplace, externalProductId: item.externalProductId })),
        },
        data: { analyticsExcluded: true },
      });
    }
    const data: Prisma.ProductClusterUpdateInput = {
      cardStatus: hasConfirmed ? 'confirmed' : 'provisional',
      simulatedAt: null,
    };
    const type = await this.typeById(card.typeId);
    if (!card.nameLocked && type) {
      data.canonicalName = buildCardName(type, (card.cardKeyValues ?? {}) as Record<string, string>);
    }
    await this.prisma.productCluster.update({ where: { id: clusterId }, data });
  }

  /** Usado pela revisão ("criar card novo" / "aprovar tipo"). Reaproveita card ativo com a mesma chave. */
  async createCardForType(typeKey: string, cardKeyValues: Record<string, string>, name?: string): Promise<string> {
    const type = (await this.types()).get(typeKey);
    if (!type) throw new Error(`Tipo inexistente: ${typeKey}`);
    const evaluation = evaluateCardKey(type, cardKeyValues, cardKeyValues['diferencial'] ?? null);
    const existing = await this.findActiveByKey(evaluation.cardKey);
    if (existing) return existing;
    const id = await this.createCard(type, evaluation, 'confirmed', null);
    if (name) {
      await this.prisma.productCluster.update({ where: { id }, data: { canonicalName: name, nameLocked: true } });
    }
    return id;
  }

  private async isAdoptableLegacy(clusterId: string): Promise<boolean> {
    const cluster = await this.prisma.productCluster.findUnique({ where: { id: clusterId } });
    return !!cluster && cluster.cardStatus === 'legacy' && cluster.cardKey === null;
  }

  private async findActiveByKey(cardKey: string): Promise<string | null> {
    const row = await this.prisma.productCluster.findFirst({
      where: { cardKey, cardStatus: ACTIVE },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return row?.id ?? null;
  }

  private async mostProbableCard(type: CatalogTypeDef, evaluation: KeyEvaluation): Promise<string | null> {
    const known = Object.entries(evaluation.values).filter(([, value]) => value !== MISSING_VALUE);
    const cards = await this.prisma.productCluster.findMany({
      where: { typeId: type.id, cardStatus: ACTIVE },
      select: { id: true, cardKeyValues: true, createdAt: true, items: { where: { status: 'confirmed' }, select: { id: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const matching = cards.filter((card) =>
      known.every(([attr, value]) => ((card.cardKeyValues ?? {}) as Record<string, string>)[attr] === value),
    );
    matching.sort((a, b) => b.items.length - a.items.length || a.createdAt.getTime() - b.createdAt.getTime());
    return matching[0]?.id ?? null;
  }

  private async createCard(
    type: CatalogTypeDef,
    evaluation: KeyEvaluation,
    status: ItemStatus,
    adoptClusterId: string | null,
  ): Promise<string> {
    const data = {
      typeId: type.id,
      cardKey: evaluation.cardKey,
      cardKeyValues: evaluation.values as Prisma.InputJsonValue,
      category: type.familyKey,
      cardStatus: status,
    };
    const canonicalName = buildCardName(type, evaluation.values);
    if (adoptClusterId) {
      const cluster = await this.prisma.productCluster.findUnique({ where: { id: adoptClusterId } });
      await this.prisma.productCluster.update({
        where: { id: adoptClusterId },
        data: { ...data, ...(cluster?.nameLocked ? {} : { canonicalName }) },
      });
      return adoptClusterId;
    }
    const created = await this.prisma.productCluster.create({ data: { ...data, canonicalName } });
    return created.id;
  }

  async registerSuggestedType(raw: string | null): Promise<string> {
    const key = normalizeDifferential(raw) ?? 'sem_sugestao';
    const similar = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM catalog_review_items
      WHERE kind = 'suggested_type' AND status = 'pending'
        AND (suggested_type_key = ${key} OR ${key} = ANY(suggested_type_aliases) OR similarity(suggested_type_key, ${key}) >= 0.6)
      ORDER BY similarity(suggested_type_key, ${key}) DESC
      LIMIT 1`;
    let item: { id: string; suggestedTypeAliases: string[] };
    if (similar[0]) {
      const existing = await this.prisma.catalogReviewItem.findUnique({ where: { id: similar[0].id } });
      const aliases = existing?.suggestedTypeAliases ?? [];
      item = aliases.includes(key)
        ? { id: similar[0].id, suggestedTypeAliases: aliases }
        : await this.prisma.catalogReviewItem.update({
            where: { id: similar[0].id },
            data: { suggestedTypeAliases: [...aliases, key] },
          });
    } else {
      item = await this.prisma.catalogReviewItem.create({
        data: { kind: 'suggested_type', suggestedTypeKey: key, suggestedTypeAliases: [key], reason: `tipo novo sugerido: ${key}` },
      });
    }
    const listingCount = await this.prisma.listingFicha.count({
      where: { typeKey: 'unknown', inScope: { not: false }, suggestedType: { in: item.suggestedTypeAliases } },
    });
    await this.prisma.catalogReviewItem.update({ where: { id: item.id }, data: { listingCount } });
    return item.id;
  }

  async ensureListingReview(listing: ListingRef, clusterId: string | null, reason: string): Promise<void> {
    const existing = await this.prisma.catalogReviewItem.findFirst({
      where: { kind: 'provisional_listing', status: 'pending', ...listing },
    });
    if (existing) {
      await this.prisma.catalogReviewItem.update({ where: { id: existing.id }, data: { suggestedClusterId: clusterId, reason } });
    } else {
      await this.prisma.catalogReviewItem.create({
        data: { kind: 'provisional_listing', ...listing, suggestedClusterId: clusterId, reason, listingCount: 1 },
      });
    }
  }

  async resolveListingReviews(listing: ListingRef, resolution: string, actorId: string | null = null): Promise<void> {
    await this.prisma.catalogReviewItem.updateMany({
      where: { kind: 'provisional_listing', status: 'pending', ...listing },
      data: { status: 'resolved', resolution, resolvedAt: new Date(), resolvedBy: actorId },
    });
  }
}
```

- [x] **Passo 4: Rodar e ver passar**

Run: `npx jest src/modules/catalog/card-assigner.service.spec.ts`
Esperado: PASS. Se o caso "R6 sem card do tipo" falhar porque `findMany` do mock devolve `[]` e o `createCard` recebe `cardKey 'spin_bike|resistencia=?'`, confira que `evaluateCardKey` gera `?` para atributo ausente (Tarefa 5). **Não altere as expectativas do teste.**

- [x] **Passo 5: Revisar o diff (sem commit)**

---

## Tarefa 12: Rotina da ficha (`FichaService`, scheduler e módulo)

**Arquivos:**
- Criar: `Move-Intelligence-Back/src/modules/catalog/ficha.service.ts`
- Criar: `Move-Intelligence-Back/src/modules/catalog/ficha.service.spec.ts`
- Criar: `Move-Intelligence-Back/src/modules/catalog/ficha.scheduler.ts`
- Criar: `Move-Intelligence-Back/src/modules/catalog/catalog.module.ts`
- Modificar: `Move-Intelligence-Back/src/app.module.ts` (acrescentar `CatalogModule`; `ProductMatchingModule` sai na Tarefa 13)

**Interfaces:**
- Consome: `OpenRouterService.chatCompletion(messages, { endpointName, model, maxTokens, timeoutMs, temperature, metadata })` (Tarefa 1), `TaxonomyService`, `CardAssignerService` (Tarefa 11), `buildFichaInput`/`inputHash` (Tarefa 6), prompt (Tarefa 7), parser (Tarefa 8), `remainingFichaCalls` (Tarefa 9), `fichaConfig`/constantes (Tarefa 5).
- Produz:
  ```ts
  export interface RegisterListingInput { marketplace: string; externalProductId: string; title: string; excerpt?: string | null; priority?: number }
  export type RegisterResult = 'created' | 'updated' | 'unchanged' | 'assigned';
  export interface FichaRunSummary { calls: number; done: number; copied: number; failed: number;
    stoppedBy: 'disabled' | 'running' | 'empty' | 'budget' | 'daily_limit' | 'error' | 'max_rounds' }
  class FichaService {
    registerListing(input: RegisterListingInput): Promise<RegisterResult>;
    runOnce(now?: () => Date): Promise<FichaRunSummary>;
  }
  ```
- `CatalogModule` exporta `FichaService`, `CardAssignerService` e `TaxonomyService` (usados pelas Tarefas 13, 15 e 17).

- [x] **Passo 1: Escrever o teste que falha**

`src/modules/catalog/ficha.service.spec.ts`:
```ts
import { ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import { OpenRouterService } from '../ai-gateway/openrouter.service';
import { CardAssignerService } from './card-assigner.service';
import { FichaService } from './ficha.service';
import { buildFichaInput, inputHash } from './ficha-input';
import { TaxonomyService } from './taxonomy.service';
import { CatalogTypeDef } from './taxonomy.types';

const SPIN: CatalogTypeDef = {
  id: 'type-spin', key: 'spin_bike', familyKey: 'spinning_bike', familyNamePt: 'B', namePt: 'Bike spinning', descriptionEn: 'x', ncm: null,
  cardKeyAttrs: [{ attr: 'resistencia', label_pt: 'resistência', values: [{ value: 'magnetica', label_pt: 'magnética' }] }],
  comparisonAttrs: [], variationAttrs: [],
};

function build() {
  const prisma = {
    listingFicha: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'f-new', status: 'pending', priority: 100, attempts: 0, ...data })),
      update: jest.fn().mockImplementation(({ where, data }) => ({ id: where.id, marketplace: 'ml', externalProductId: 'X', ...data })),
    },
    productClusterItem: { findUnique: jest.fn().mockResolvedValue(null) },
    intelligenceProduct: { findFirst: jest.fn().mockResolvedValue(null) },
    aiCallLog: { count: jest.fn().mockResolvedValue(0) },
  };
  const taxonomy = { getTypeMap: jest.fn().mockResolvedValue(new Map([[SPIN.key, SPIN]])) };
  const assigner = {
    assign: jest.fn().mockResolvedValue({ outcome: 'confirmed', clusterId: 'c1', touched: ['c1'] }),
    refreshMany: jest.fn(),
  };
  const llm = { chatCompletion: jest.fn() };
  const service = new FichaService(
    prisma as unknown as PrismaService,
    taxonomy as unknown as TaxonomyService,
    assigner as unknown as CardAssignerService,
    llm as unknown as OpenRouterService,
  );
  return { service, prisma, assigner, llm };
}

describe('FichaService.registerListing', () => {
  it('cria ficha pendente com hash do título normalizado', async () => {
    const { service, prisma } = build();
    const result = await service.registerListing({ marketplace: 'ml', externalProductId: 'X', title: 'Bike 13kg (AMAZON)' });
    expect(result).toBe('created');
    expect(prisma.listingFicha.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      marketplace: 'ml', externalProductId: 'X', inputHash: inputHash(buildFichaInput('Bike 13kg')), priority: 100 }) });
  });

  it('mesmo hash e ficha pronta: não faz nada se o anúncio já tem card', async () => {
    const { service, prisma, assigner } = build();
    prisma.listingFicha.findUnique.mockResolvedValue({ id: 'f1', inputHash: inputHash('Bike'), status: 'done', typeKey: 'spin_bike', inScope: true });
    prisma.productClusterItem.findUnique.mockResolvedValue({ id: 'i1' });
    await expect(service.registerListing({ marketplace: 'ml', externalProductId: 'X', title: 'Bike' })).resolves.toBe('unchanged');
    expect(assigner.assign).not.toHaveBeenCalled();
  });

  it('copia de ficha gêmea (mesmo hash) e monta o card sem LLM', async () => {
    const { service, prisma, assigner } = build();
    prisma.listingFicha.findFirst.mockResolvedValue({ id: 'twin', status: 'done', typeKey: 'spin_bike', inScope: true,
      cardKeyValues: { resistencia: 'magnetica' }, missingKeyAttrs: [], copiedFromFichaId: null });
    await expect(service.registerListing({ marketplace: 'ml', externalProductId: 'X', title: 'Bike' })).resolves.toBe('assigned');
    expect(prisma.listingFicha.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'done', typeKey: 'spin_bike', copiedFromFichaId: 'twin' }) }));
    expect(assigner.assign).toHaveBeenCalled();
  });
});

describe('FichaService.runOnce', () => {
  const env = process.env;
  beforeEach(() => { process.env = { ...env, FICHA_ENABLED: 'true', FICHA_BATCH_SIZE: '2', FICHA_DAILY_CALL_LIMIT: '35' }; });
  afterEach(() => { process.env = env; });

  it('desligado não faz nada', async () => {
    process.env.FICHA_ENABLED = 'false';
    const { service, llm } = build();
    await expect(service.runOnce()).resolves.toMatchObject({ stoppedBy: 'disabled' });
    expect(llm.chatCompletion).not.toHaveBeenCalled();
  });

  it('sem saldo no dia não chama a LLM', async () => {
    const { service, prisma, llm } = build();
    prisma.aiCallLog.count.mockResolvedValue(40);
    prisma.listingFicha.findMany.mockResolvedValue([{ id: 'a', marketplace: 'ml', externalProductId: 'A', title: 'Bike A', inputHash: 'h1', attempts: 0 }]);
    await expect(service.runOnce()).resolves.toMatchObject({ stoppedBy: 'budget', calls: 0 });
    expect(llm.chatCompletion).not.toHaveBeenCalled();
  });

  it('gera fichas do lote, reenfileira quem não voltou e recalcula os cards uma vez', async () => {
    const { service, prisma, llm, assigner } = build();
    prisma.listingFicha.findMany
      .mockResolvedValueOnce([
        { id: 'a', marketplace: 'ml', externalProductId: 'A', title: 'Bike A', inputHash: 'h1', attempts: 0 },
        { id: 'b', marketplace: 'ml', externalProductId: 'B', title: 'Bike B', inputHash: 'h2', attempts: 2 },
      ])
      .mockResolvedValueOnce([]);
    llm.chatCompletion.mockResolvedValue({
      content: '{"ref":"L1","type_key":"spin_bike","in_scope":true,"card_key_values":{"resistencia":"magnetica"}}',
      model: 'm',
    });
    const summary = await service.runOnce();
    expect(summary).toMatchObject({ calls: 1, done: 1, failed: 1, stoppedBy: 'empty' });
    expect(llm.chatCompletion).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
      endpointName: 'catalog-ficha', maxTokens: 20000, timeoutMs: 120000 }));
    expect(prisma.listingFicha.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: expect.objectContaining({
      status: 'done', typeKey: 'spin_bike', cardKeyValues: { resistencia: 'magnetica' }, promptVersion: 'ficha-v1', llmModel: 'm' }) });
    // "b" já tinha 2 tentativas: a 3ª falha vira erro (e vai para a revisão pela montagem)
    expect(prisma.listingFicha.update).toHaveBeenCalledWith({ where: { id: 'b' }, data: expect.objectContaining({
      status: 'error', attempts: 3, lastError: 'sem resposta no lote' }) });
    expect(assigner.refreshMany).toHaveBeenCalledTimes(1);
  });

  it('para no limite diário do provedor', async () => {
    const { service, prisma, llm } = build();
    prisma.listingFicha.findMany.mockResolvedValue([{ id: 'a', marketplace: 'ml', externalProductId: 'A', title: 'Bike A', inputHash: 'h1', attempts: 0 }]);
    llm.chatCompletion.mockRejectedValue(new ServiceUnavailableException('Falha na API do OpenRouter: OpenRouter API HTTP 429: {"error":{"message":"Rate limit exceeded: free-models-per-day"}}'));
    await expect(service.runOnce()).resolves.toMatchObject({ stoppedBy: 'daily_limit' });
    expect(prisma.listingFicha.update).not.toHaveBeenCalled();
  });
});
```

- [x] **Passo 2: Rodar e ver falhar** — `npx jest src/modules/catalog/ficha.service.spec.ts` → FAIL (módulo inexistente).

- [x] **Passo 3: Implementar `ficha.service.ts`**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ListingFicha, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { OpenRouterService } from '../ai-gateway/openrouter.service';
import { AssignResult, CardAssignerService } from './card-assigner.service';
import {
  FICHA_ENDPOINT_NAME,
  FICHA_PROMPT_VERSION,
  MAX_FICHA_ATTEMPTS,
  PRIORITY,
  UNKNOWN_TYPE,
  fichaConfig,
} from './catalog.constants';
import { remainingFichaCalls } from './ficha-budget';
import { buildFichaInput, inputHash } from './ficha-input';
import { parseFichaJsonLines, validateFicha, ValidatedFicha } from './ficha-parser';
import { buildFichaSystemPrompt, buildFichaUserMessage } from './ficha-prompt';
import { TaxonomyService } from './taxonomy.service';

export interface RegisterListingInput {
  marketplace: string;
  externalProductId: string;
  title: string;
  excerpt?: string | null;
  priority?: number;
}
export type RegisterResult = 'created' | 'updated' | 'unchanged' | 'assigned';
export interface FichaRunSummary {
  calls: number;
  done: number;
  copied: number;
  failed: number;
  stoppedBy: 'disabled' | 'running' | 'empty' | 'budget' | 'daily_limit' | 'error' | 'max_rounds';
}

const MAX_ROUNDS = 500;
const COPY_FIELDS = [
  'typeKey', 'suggestedType', 'inScope', 'isAccessoryOrPart', 'isKitOrBundle', 'hasVariations', 'cardKeyValues',
  'newDifferential', 'missingKeyAttrs', 'comparisonValues', 'variationValues', 'specs', 'brand', 'model',
  'confidence', 'llmModel', 'promptVersion',
] as const;

@Injectable()
export class FichaService {
  private readonly logger = new Logger(FichaService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly taxonomy: TaxonomyService,
    private readonly assigner: CardAssignerService,
    private readonly llm: OpenRouterService,
  ) {}

  /** Porta única: os 4 caminhos de entrada chamam isto (spec 6.4). Nunca cria cluster diretamente. */
  async registerListing(input: RegisterListingInput): Promise<RegisterResult> {
    const listing = { marketplace: input.marketplace, externalProductId: input.externalProductId };
    const hash = inputHash(buildFichaInput(input.title, input.excerpt));
    const priority = input.priority ?? PRIORITY.DISCOVERY;
    const existing = await this.prisma.listingFicha.findUnique({ where: { marketplace_externalProductId: listing } });

    if (existing && existing.inputHash === hash) {
      if (existing.status === 'done' && existing.inScope !== false && existing.typeKey !== UNKNOWN_TYPE) {
        const item = await this.prisma.productClusterItem.findUnique({ where: { marketplace_externalProductId: listing } });
        if (!item) {
          await this.assigner.assign(existing);
          return 'assigned';
        }
      }
      return 'unchanged';
    }

    const row = existing
      ? await this.prisma.listingFicha.update({
          where: { id: existing.id },
          data: { title: input.title, inputHash: hash, status: 'pending', priority: Math.max(existing.priority, priority), attempts: 0, lastError: null },
        })
      : await this.prisma.listingFicha.create({ data: { ...listing, title: input.title, inputHash: hash, priority } });

    const copied = await this.copyFromTwin(row, false);
    if (copied) return 'assigned';
    return existing ? 'updated' : 'created';
  }

  async runOnce(now: () => Date = () => new Date()): Promise<FichaRunSummary> {
    const cfg = fichaConfig();
    const summary: FichaRunSummary = { calls: 0, done: 0, copied: 0, failed: 0, stoppedBy: 'empty' };
    if (!cfg.enabled) return { ...summary, stoppedBy: 'disabled' };
    if (this.running) return { ...summary, stoppedBy: 'running' };
    this.running = true;
    try {
      const types = await this.taxonomy.getTypeMap();
      const system = buildFichaSystemPrompt([...types.values()]);
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const pending = await this.prisma.listingFicha.findMany({
          where: { status: 'pending' },
          orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
          take: cfg.batchSize * 3,
        });
        if (pending.length === 0) return { ...summary, stoppedBy: 'empty' };

        const refresh: Array<{ clusterId: string; lastDestination: string | null }> = [];
        const batch: ListingFicha[] = [];
        const hashesInBatch = new Set<string>();
        for (const ficha of pending) {
          const copied = await this.copyFromTwin(ficha, true);
          if (copied) {
            summary.copied += 1;
            refresh.push(...this.refreshPairs(copied));
            continue;
          }
          if (hashesInBatch.has(ficha.inputHash)) continue; // a gêmea copia na próxima rodada
          hashesInBatch.add(ficha.inputHash);
          batch.push(ficha);
          if (batch.length >= cfg.batchSize) break;
        }
        if (batch.length === 0) {
          await this.assigner.refreshMany(refresh);
          continue;
        }
        if ((await remainingFichaCalls(this.prisma, cfg.dailyCallLimit, now())) <= 0) {
          await this.assigner.refreshMany(refresh);
          return { ...summary, stoppedBy: 'budget' };
        }

        const items = await Promise.all(
          batch.map(async (ficha, index) => ({ ref: `L${index + 1}`, text: await this.inputText(ficha) })),
        );
        let content: string | null;
        let model: string;
        try {
          const response = await this.llm.chatCompletion(
            [
              { role: 'system', content: system },
              { role: 'user', content: buildFichaUserMessage(items) },
            ],
            {
              endpointName: FICHA_ENDPOINT_NAME,
              model: cfg.model,
              maxTokens: cfg.maxTokens,
              timeoutMs: cfg.timeoutMs,
              temperature: 0.2,
              metadata: { listings: batch.length, promptVersion: FICHA_PROMPT_VERSION },
            },
          );
          content = response.content;
          model = response.model;
          summary.calls += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await this.assigner.refreshMany(refresh);
          if (/429/.test(message) && /per-day|per day|daily/i.test(message)) {
            return { ...summary, stoppedBy: 'daily_limit' };
          }
          summary.failed += await this.bumpAttempts(batch, message.slice(0, 500), refresh);
          await this.assigner.refreshMany(refresh);
          this.logger.warn(`Lote de fichas falhou: ${message.slice(0, 200)}`);
          return { ...summary, stoppedBy: 'error' };
        }

        const byRef = new Map(parseFichaJsonLines(content).map((line) => [line.ref, line]));
        for (const [index, ficha] of batch.entries()) {
          const line = byRef.get(`L${index + 1}`);
          if (!line) {
            summary.failed += await this.bumpAttempts([ficha], 'sem resposta no lote', refresh);
            continue;
          }
          const updated = await this.prisma.listingFicha.update({
            where: { id: ficha.id },
            data: { ...this.toDbFields(validateFicha(line, types)), status: 'done', lastError: null, llmModel: model, promptVersion: FICHA_PROMPT_VERSION },
          });
          const result = await this.assigner.assign(updated, { deferRefresh: true });
          refresh.push(...this.refreshPairs(result));
          summary.done += 1;
        }
        await this.assigner.refreshMany(refresh);
      }
      return { ...summary, stoppedBy: 'max_rounds' };
    } finally {
      this.running = false;
    }
  }

  private refreshPairs(result: AssignResult): Array<{ clusterId: string; lastDestination: string | null }> {
    return result.touched.map((clusterId) => ({
      clusterId,
      lastDestination: clusterId === result.clusterId ? null : result.clusterId,
    }));
  }

  private async bumpAttempts(
    fichas: ListingFicha[],
    error: string,
    refresh: Array<{ clusterId: string; lastDestination: string | null }>,
  ): Promise<number> {
    for (const ficha of fichas) {
      const attempts = ficha.attempts + 1;
      const failed = attempts >= MAX_FICHA_ATTEMPTS;
      const updated = await this.prisma.listingFicha.update({
        where: { id: ficha.id },
        data: { attempts, lastError: error, ...(failed ? { status: 'error' } : {}) },
      });
      if (failed) refresh.push(...this.refreshPairs(await this.assigner.assign(updated, { deferRefresh: true })));
    }
    return fichas.length;
  }

  private async copyFromTwin(ficha: ListingFicha, deferRefresh: boolean): Promise<AssignResult | null> {
    const twin = await this.prisma.listingFicha.findFirst({
      where: { inputHash: ficha.inputHash, status: 'done', id: { not: ficha.id } },
      orderBy: { updatedAt: 'desc' },
    });
    if (!twin) return null;
    const data: Record<string, unknown> = { status: 'done', lastError: null, copiedFromFichaId: twin.copiedFromFichaId ?? twin.id };
    for (const field of COPY_FIELDS) data[field] = (twin as unknown as Record<string, unknown>)[field];
    const updated = await this.prisma.listingFicha.update({
      where: { id: ficha.id },
      data: data as Prisma.ListingFichaUpdateInput,
    });
    return this.assigner.assign(updated, { deferRefresh });
  }

  private async inputText(ficha: ListingFicha): Promise<string> {
    const product = await this.prisma.intelligenceProduct.findFirst({
      where: { source: ficha.marketplace, recordId: ficha.externalProductId },
      orderBy: { capturedAt: 'desc' },
      select: { sourceSpecific: true },
    });
    const specific = (product?.sourceSpecific ?? {}) as Record<string, unknown>;
    const excerpt = typeof specific['page_excerpt'] === 'string' ? (specific['page_excerpt'] as string) : null;
    return buildFichaInput(ficha.title, excerpt);
  }

  private toDbFields(v: ValidatedFicha): Prisma.ListingFichaUpdateInput {
    return {
      typeKey: v.typeKey,
      suggestedType: v.suggestedType,
      inScope: v.inScope,
      isAccessoryOrPart: v.isAccessoryOrPart,
      isKitOrBundle: v.isKitOrBundle,
      hasVariations: v.hasVariations,
      cardKeyValues: v.cardKeyValues as Prisma.InputJsonValue,
      newDifferential: v.newDifferential,
      missingKeyAttrs: v.missingKeyAttrs,
      comparisonValues: v.comparisonValues as Prisma.InputJsonValue,
      variationValues: v.variationValues as Prisma.InputJsonValue,
      specs: v.specs as Prisma.InputJsonValue,
      brand: v.brand,
      model: v.model,
      confidence: v.confidence,
    };
  }
}
```

- [x] **Passo 4: Rodar e ver passar**

Run: `npx jest src/modules/catalog/ficha.service.spec.ts`
Esperado: PASS. No teste "gera fichas do lote", `findMany` devolve o lote na 1ª rodada e `[]` na 2ª, e `refreshMany` é chamado **uma vez por rodada com lote**. Se o seu código chamar `refreshMany` também na rodada vazia, a expectativa `toHaveBeenCalledTimes(1)` falha. Retorne `stoppedBy: 'empty'` **antes** de qualquer `refreshMany` quando `pending` vier vazio (como no código acima).

- [x] **Passo 5: Scheduler e módulo**

`src/modules/catalog/ficha.scheduler.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FichaService } from './ficha.service';

/** Rotina da ficha (spec 5.2). Só age com FICHA_ENABLED=true (checado dentro do runOnce). */
@Injectable()
export class FichaScheduler {
  private readonly logger = new Logger(FichaScheduler.name);

  constructor(private readonly fichas: FichaService) {}

  @Cron(process.env.FICHA_CRON || '*/30 * * * *', { name: 'catalog-ficha', timeZone: 'America/Sao_Paulo' })
  async tick() {
    try {
      const summary = await this.fichas.runOnce();
      if (summary.stoppedBy !== 'disabled') {
        this.logger.log(`Fichas: ${JSON.stringify(summary)}`);
      }
    } catch (error) {
      this.logger.warn(`Rotina de fichas falhou: ${error instanceof Error ? error.message : error}`);
    }
  }
}
```

`src/modules/catalog/catalog.module.ts` (os controllers entram na Tarefa 15):
```ts
import { Module } from '@nestjs/common';
import { AiGatewayModule } from '../ai-gateway/ai-gateway.module';
import { CardAssignerService } from './card-assigner.service';
import { FichaScheduler } from './ficha.scheduler';
import { FichaService } from './ficha.service';
import { TaxonomyService } from './taxonomy.service';

@Module({
  imports: [AiGatewayModule],
  providers: [TaxonomyService, CardAssignerService, FichaService, FichaScheduler],
  exports: [TaxonomyService, CardAssignerService, FichaService],
})
export class CatalogModule {}
```
Em `src/app.module.ts`: `import { CatalogModule } from './modules/catalog/catalog.module';` e acrescente `CatalogModule,` na lista `imports` (logo depois de `ProductMatchingModule,`).

- [x] **Passo 6: Compilar e rodar a suíte**

Run: `npx tsc -p tsconfig.build.json --noEmit && npx jest src/modules/catalog`
Esperado: sem erros de tipo; todos os specs de `catalog` passam.

- [x] **Passo 7: Revisar o diff (sem commit)**

---

## Tarefa 13: Porta única nos 4 caminhos + remoção do agrupamento antigo

**Arquivos:**
- Modificar: `Move-Intelligence-Back/src/modules/catalog/ficha.service.ts` (+ spec): método `currentCardId`
- Modificar: `Move-Intelligence-Back/src/modules/ingestion/ingestion.service.ts` e `ingestion.module.ts`
- Modificar: `Move-Intelligence-Back/src/modules/imports/imports.processor.ts` e `imports.module.ts`
- Modificar: `Move-Intelligence-Back/src/modules/ingestion/intelligence-collection.service.ts` e `intelligence-collection.service.spec.ts`
- Modificar: `Move-Intelligence-Back/src/app.module.ts`, `Move-Intelligence-Back/package.json`
- **Remover:** `Move-Intelligence-Back/src/modules/product-matching/` (pasta inteira: module, service, spec) e `Move-Intelligence-Back/scripts/recluster-products.ts`

**Interfaces:**
- Produz: `FichaService.currentCardId(listing: { marketplace: string; externalProductId: string }): Promise<string | null>` (o cluster atual do anúncio em `product_cluster_items`, ou `null`).
- Regra: os caminhos gravam o snapshot com o card **atual** do anúncio (se já tiver ficha pronta) ou `null`. A montagem do card preenche depois (Tarefa 11, `moveListing`). **Nenhum caminho cria cluster.**

- [x] **Passo 1: Teste de `currentCardId` (falha primeiro)**

Acrescente em `ficha.service.spec.ts`:
```ts
describe('FichaService.currentCardId', () => {
  it('devolve o cluster do item ou null', async () => {
    const { service, prisma } = build();
    prisma.productClusterItem.findUnique.mockResolvedValueOnce({ clusterId: 'c9' }).mockResolvedValueOnce(null);
    await expect(service.currentCardId({ marketplace: 'ml', externalProductId: 'X' })).resolves.toBe('c9');
    await expect(service.currentCardId({ marketplace: 'ml', externalProductId: 'Y' })).resolves.toBeNull();
  });
});
```
Run: `npx jest src/modules/catalog/ficha.service.spec.ts -t currentCardId` → FAIL.

- [x] **Passo 2: Implementar `currentCardId`** em `FichaService`:
```ts
  async currentCardId(listing: { marketplace: string; externalProductId: string }): Promise<string | null> {
    const item = await this.prisma.productClusterItem.findUnique({
      where: { marketplace_externalProductId: listing },
      select: { clusterId: true },
    });
    return item?.clusterId ?? null;
  }
```
Run de novo → PASS.

- [x] **Passo 3: `ingestion.service.ts` (pipeline legado)**

- Troque o import `ProductMatchingService` por `import { FichaService } from '../catalog/ficha.service';`.
- No construtor, troque `private readonly matching: ProductMatchingService,` por `private readonly fichas: FichaService,`.
- Substitua o trecho:
```ts
          const normalized = await this.normalization.normalize(rawProduct);
          const clusterId =
            await this.matching.findOrCreateTrivialCluster(normalized);

          await this.snapshots.persist(normalized, clusterId);
```
por:
```ts
          const normalized = await this.normalization.normalize(rawProduct);
          const listing = { marketplace: normalized.marketplace, externalProductId: normalized.externalProductId };
          await this.fichas.registerListing({
            ...listing,
            title: normalized.titleOriginal ?? normalized.titleNormalized,
          });
          const clusterId = await this.fichas.currentCardId(listing);

          await this.snapshots.persist(normalized, clusterId ?? undefined);
```
Em `ingestion.module.ts`: troque `import { ProductMatchingModule } ...` e o item `ProductMatchingModule,` por `import { CatalogModule } from '../catalog/catalog.module';` e `CatalogModule,`.

- [x] **Passo 4: `imports.processor.ts` (importação de CSV)**

- Troque o import de `ProductMatchingService` por `import { FichaService } from '../catalog/ficha.service';`; no construtor, `private readonly matching: ProductMatchingService,` → `private readonly fichas: FichaService,`.
- Em `persistMarketplace`, substitua o bloco `const productClusterId = await this.matching.findOrCreateTrivialCluster({ ... } as CanonicalProductListing);` por:
```ts
          const listingRef = { marketplace: listing.marketplace, externalProductId: listing.externalProductId };
          await this.fichas.registerListing({ ...listingRef, title: listing.title });
          const productClusterId = await this.fichas.currentCardId(listingRef);
```
- Remova o import de `CanonicalProductListing` se ficar sem uso.
- Em `imports.module.ts`: `imports: [ProductsModule, ProductMatchingModule]` → `imports: [ProductsModule, CatalogModule]` (ajuste o import).
- Se existir `imports.processor.spec.ts` que injeta `ProductMatchingService`, troque o mock por `{ registerListing: jest.fn().mockResolvedValue('created'), currentCardId: jest.fn().mockResolvedValue(null) }` e ajuste expectativas que exigiam `productClusterId: 'cluster-...'` para `productClusterId: null`.

- [x] **Passo 5: `intelligence-collection.service.ts` (descoberta + acompanhamento)**

- Import: troque `ProductMatchingService` por `FichaService` (`'../catalog/ficha.service'`); construtor: `private readonly matching: ProductMatchingService,` → `private readonly fichas: FichaService,`.
- Em `syncObservationsToSnapshots`, substitua o bloco que começa em `let productClusterId = listing.productId;` e termina no `matched += 1;` (inclui a busca de `discovered`, `findOrCreateClusterForProduct`/`findOrCreateTrivialCluster` e o `trackedListing.update`) por:
```ts
      let productClusterId = listing.productId;
      if (!productClusterId) {
        const discovered = await this.prisma.intelligenceProduct.findFirst({
          where: { source: listing.source, recordId: listing.nativeId },
          orderBy: { capturedAt: 'desc' },
        });
        const specific = this.asRecord(discovered?.sourceSpecific);
        await this.fichas.registerListing({
          marketplace: listing.source,
          externalProductId: listing.nativeId,
          title: discovered?.title ?? listing.canonicalUrl,
          excerpt: typeof specific['page_excerpt'] === 'string' ? (specific['page_excerpt'] as string) : null,
        });
        productClusterId = await this.fichas.currentCardId({ marketplace: listing.source, externalProductId: listing.nativeId });
        registered += 1;
      }
```
  Renomeie a variável `matched` → `registered`, e a chave de retorno `matched_listings` → `registered_listings` (no tipo de retorno e nos dois `return`).
- Em `syncAnalyticalModels`, substitua `const clusterId = await this.matching.findOrCreateClusterForProduct(product);` por:
```ts
        const listingRef = { marketplace: product.source, externalProductId: product.recordId };
        const specificForFicha = this.asRecord(product.sourceSpecific);
        await this.fichas.registerListing({
          ...listingRef,
          title: product.title,
          excerpt: typeof specificForFicha['page_excerpt'] === 'string' ? (specificForFicha['page_excerpt'] as string) : null,
        });
        const clusterId = await this.fichas.currentCardId(listingRef);
```
- Em `intelligence-collection.service.spec.ts`:
  - troque o objeto `matching` por `const fichas = { registerListing: jest.fn().mockResolvedValue('created'), currentCardId: jest.fn().mockResolvedValue(null) };`, passe `fichas as unknown as FichaService` no lugar de `matching` e retorne `fichas` no `build`;
  - no teste `syncObservationsToSnapshots grava snapshot real e vincula via matching`, renomeie para `... e registra o anúncio na ficha`. Espere `fichas.registerListing` chamado com `{ marketplace, externalProductId, title, excerpt }` e o snapshot criado com `productClusterId: null`. Troque qualquer `matched_listings` por `registered_listings`.

- [x] **Passo 6: Remover o agrupamento antigo**

```bash
cd Move-Intelligence-Back
rm -r src/modules/product-matching scripts/recluster-products.ts
```
- Em `src/app.module.ts`, remova o import e o item `ProductMatchingModule`.
- Em `package.json`, remova a linha do script `"products:recluster"`.
- Confira que não sobrou referência:
```bash
grep -rn "ProductMatching\|product-matching\|findOrCreateTrivialCluster\|findOrCreateClusterForProduct\|reclusterAll" src scripts package.json
```
Esperado: nenhuma linha.

- [x] **Passo 7: Compilar e rodar a suíte inteira**

Run: `npx tsc -p tsconfig.build.json --noEmit && npx jest 2>&1 | tail -8`
Esperado: sem erro de tipo. A suíte não tem **mais** falhas que a linha de base (os specs do `ProductMatchingService` saíram junto com ele; qualquer outra falha nova é sua e deve ser corrigida).

- [x] **Passo 8: Revisar o diff (sem commit)**

---

## Tarefa 14: `AdminGuard` + `user:make-admin`

**Arquivos:**
- Criar: `Move-Intelligence-Back/src/modules/auth/admin.guard.ts`
- Criar: `Move-Intelligence-Back/src/modules/auth/admin.guard.spec.ts`
- Criar: `Move-Intelligence-Back/scripts/user-make-admin.ts`
- Modificar: `Move-Intelligence-Back/package.json`

**Interfaces:**
- Produz: `AdminGuard implements CanActivate`. Exige `request.user?.role === 'ADMIN'` (o `JwtAuthGuard` global já preenche `request.user` com `{ sub, email, role }`). Lança `ForbiddenException('Acesso restrito a administradores.')`.
- Uso: `@UseGuards(AdminGuard)` nos controllers da Tarefa 15.

- [x] **Passo 1: Teste que falha**

```ts
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

function ctx(user?: { role: string }): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ user }) }) } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  const guard = new AdminGuard();
  it('libera ADMIN', () => expect(guard.canActivate(ctx({ role: 'ADMIN' }))).toBe(true));
  it('bloqueia USER', () => expect(() => guard.canActivate(ctx({ role: 'USER' }))).toThrow(ForbiddenException));
  it('bloqueia sem usuário', () => expect(() => guard.canActivate(ctx())).toThrow(ForbiddenException));
});
```
Run: `npx jest src/modules/auth/admin.guard.spec.ts` → FAIL.

- [x] **Passo 2: Implementar**

```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/** Rotas do catálogo que só ADMIN pode usar (fila de revisão, tipos, renomear card). */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: { role?: string } }>();
    if (request.user?.role !== 'ADMIN') {
      throw new ForbiddenException('Acesso restrito a administradores.');
    }
    return true;
  }
}
```
Run → PASS.

- [x] **Passo 3: Script `scripts/user-make-admin.ts`**

```ts
import { PrismaClient } from '@prisma/client';

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error('Uso: npm run user:make-admin -- <email>');
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
    console.log(`Usuário ${user.email} agora é ADMIN.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
```
Em `package.json`:
```json
    "user:make-admin": "node --env-file-if-exists=.env -r ts-node/register scripts/user-make-admin.ts",
```

- [x] **Passo 4: Revisar o diff (sem commit)**

---

## Tarefa 15: Revisão — serviço, rotas ADMIN e anúncios do card

**Arquivos:**
- Modificar: `Move-Intelligence-Back/src/modules/catalog/card-assigner.service.ts` (método `invalidateTypeCache()`)
- Criar: `Move-Intelligence-Back/src/modules/catalog/catalog-review.service.ts`
- Criar: `Move-Intelligence-Back/src/modules/catalog/catalog-review.service.spec.ts`
- Criar: `Move-Intelligence-Back/src/modules/catalog/dto/catalog-review.dto.ts`
- Criar: `Move-Intelligence-Back/src/modules/catalog/catalog-review.controller.ts`
- Criar: `Move-Intelligence-Back/src/modules/catalog/catalog-cards.controller.ts`
- Modificar: `Move-Intelligence-Back/src/modules/catalog/catalog.module.ts`

**Interfaces:**
- Consome: `CardAssignerService.{moveListing, createCardForType, assign, resolveListingReviews}` (Tarefa 11), `AdminGuard` (Tarefa 14).
- Produz (`CatalogReviewService`):
  ```ts
  list(kind: 'provisional_listing' | 'suggested_type', page?: number, pageSize?: number): Promise<{ total: number; items: unknown[] }>;
  counts(): Promise<{ provisional_listing: number; suggested_type: number }>;
  confirm(reviewId: string, actorId: string): Promise<{ decisionId: string }>;
  move(reviewId: string, targetClusterId: string, actorId: string): Promise<{ decisionId: string }>;
  createCard(reviewId: string, dto: { typeKey: string; cardKeyValues: Record<string, string>; name?: string }, actorId: string): Promise<{ decisionId: string; clusterId: string }>;
  outOfScope(reviewId: string, actorId: string): Promise<{ decisionId: string }>;
  approveType(reviewId: string, dto: { familyKey: string; key: string; namePt: string; ncm?: string | null }, actorId: string): Promise<{ decisionId: string; typeId: string }>;
  mergeType(reviewId: string, typeKey: string, actorId: string): Promise<{ decisionId: string; requeued: number }>;
  discardType(reviewId: string, actorId: string): Promise<{ decisionId: string }>;
  renameCard(clusterId: string, name: string, actorId: string): Promise<{ decisionId: string }>;
  undo(decisionId: string, actorId: string): Promise<{ decisionId: string }>;
  listCardListings(clusterId: string): Promise<CardListingView[]>;
  searchCards(q: string): Promise<Array<{ id: string; name: string; category: string | null; card_status: string }>>;
  ```
- `CardListingView` (snake_case, vai direto para a API): `{ marketplace, external_product_id, title, url, price, currency, rating, status, variation, brand }`.
- Desfazer (spec 7.3): só para `confirm`, `move`, `create_card`, `out_of_scope` e `rename_card`; ações de tipo → 409.

- [x] **Passo 1: `invalidateTypeCache` no assigner**

Em `CardAssignerService` acrescente:
```ts
  /** Chamado quando a revisão cria um tipo novo (a próxima montagem precisa enxergá-lo). */
  invalidateTypeCache(): void {
    this.typeCache = null;
  }
```

- [x] **Passo 2: DTOs** — `dto/catalog-review.dto.ts`:
```ts
import { IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class ReviewListQueryDto {
  @IsIn(['provisional_listing', 'suggested_type'])
  kind!: 'provisional_listing' | 'suggested_type';

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  page_size?: number;
}

export class MoveListingDto {
  @IsUUID()
  targetClusterId!: string;
}

export class CreateCardDto {
  @IsString() @MinLength(2)
  typeKey!: string;

  @IsObject()
  cardKeyValues!: Record<string, string>;

  @IsOptional() @IsString() @MinLength(3) @MaxLength(120)
  name?: string;
}

export class ApproveTypeDto {
  @IsString()
  familyKey!: string;

  @IsString() @Matches(/^[a-z][a-z0-9_]*$/)
  key!: string;

  @IsString() @MinLength(2) @MaxLength(80)
  namePt!: string;

  @IsOptional() @IsString() @MaxLength(20)
  ncm?: string;
}

export class MergeTypeDto {
  @IsString()
  typeKey!: string;
}

export class RenameCardDto {
  @IsString() @MinLength(3) @MaxLength(120)
  name!: string;
}
```

- [x] **Passo 3: Escrever o teste que falha** — `catalog-review.service.spec.ts`:
```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import { CardAssignerService } from './card-assigner.service';
import { CatalogReviewService } from './catalog-review.service';

function build() {
  const prisma = {
    catalogReviewItem: {
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    catalogDecision: {
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'd1', ...data })),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    productClusterItem: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    productCluster: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    listingFicha: {
      findUnique: jest.fn().mockResolvedValue({ inScope: true }),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    catalogFamily: { findUnique: jest.fn() },
    catalogType: { create: jest.fn().mockResolvedValue({ id: 'type-new' }), findUnique: jest.fn() },
    productListingSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const assigner = {
    moveListing: jest.fn().mockResolvedValue({ fromClusterId: 'c1', touched: [] }),
    createCardForType: jest.fn().mockResolvedValue('c-new'),
    assign: jest.fn(),
    resolveListingReviews: jest.fn(),
    invalidateTypeCache: jest.fn(),
  };
  const service = new CatalogReviewService(prisma as unknown as PrismaService, assigner as unknown as CardAssignerService);
  return { service, prisma, assigner };
}

const LISTING_REVIEW = { id: 'r1', kind: 'provisional_listing', status: 'pending', marketplace: 'ml', externalProductId: 'X', suggestedClusterId: 'c1' };

describe('CatalogReviewService', () => {
  it('confirm confirma no card sugerido, resolve o item e grava a decisão', async () => {
    const { service, prisma, assigner } = build();
    prisma.catalogReviewItem.findUnique.mockResolvedValue(LISTING_REVIEW);
    prisma.productClusterItem.findUnique.mockResolvedValue({ clusterId: 'c1', status: 'provisional' });
    const r = await service.confirm('r1', 'admin-1');
    expect(assigner.moveListing).toHaveBeenCalledWith({ marketplace: 'ml', externalProductId: 'X' }, 'c1', 'confirmed');
    expect(assigner.resolveListingReviews).toHaveBeenCalledWith({ marketplace: 'ml', externalProductId: 'X' }, 'confirm', 'admin-1');
    expect(prisma.catalogDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'confirm', actorUserId: 'admin-1', reviewItemId: 'r1',
      before: { listing: { marketplace: 'ml', externalProductId: 'X' }, clusterId: 'c1', status: 'provisional', inScope: true },
      after: { listing: { marketplace: 'ml', externalProductId: 'X' }, clusterId: 'c1', status: 'confirmed', inScope: true } }) });
    expect(r.decisionId).toBe('d1');
  });

  it('move exige card de destino ativo', async () => {
    const { service, prisma } = build();
    prisma.catalogReviewItem.findUnique.mockResolvedValue(LISTING_REVIEW);
    prisma.productCluster.findUnique.mockResolvedValue({ id: 'c2', cardStatus: 'merged' });
    await expect(service.move('r1', 'c2', 'admin-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('outOfScope tira de qualquer card e marca a ficha', async () => {
    const { service, prisma, assigner } = build();
    prisma.catalogReviewItem.findUnique.mockResolvedValue(LISTING_REVIEW);
    await service.outOfScope('r1', 'admin-1');
    expect(assigner.moveListing).toHaveBeenCalledWith({ marketplace: 'ml', externalProductId: 'X' }, null, 'confirmed');
    expect(prisma.listingFicha.update).toHaveBeenCalledWith({
      where: { marketplace_externalProductId: { marketplace: 'ml', externalProductId: 'X' } }, data: { inScope: false } });
  });

  it('item já resolvido não pode ser decidido de novo', async () => {
    const { service, prisma } = build();
    prisma.catalogReviewItem.findUnique.mockResolvedValue({ ...LISTING_REVIEW, status: 'resolved' });
    await expect(service.confirm('r1', 'admin-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('undo recusa quando o estado mudou depois da decisão', async () => {
    const { service, prisma } = build();
    prisma.catalogDecision.findUnique.mockResolvedValue({ id: 'd1', action: 'move', undoneByDecisionId: null, reviewItemId: 'r1',
      before: { listing: { marketplace: 'ml', externalProductId: 'X' }, clusterId: 'c1', status: 'provisional', inScope: true },
      after: { listing: { marketplace: 'ml', externalProductId: 'X' }, clusterId: 'c2', status: 'confirmed', inScope: true } });
    prisma.productClusterItem.findUnique.mockResolvedValue({ clusterId: 'c3', status: 'confirmed' });
    await expect(service.undo('d1', 'admin-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('undo aplica o estado anterior e reabre o item', async () => {
    const { service, prisma, assigner } = build();
    prisma.catalogDecision.findUnique.mockResolvedValue({ id: 'd1', action: 'move', undoneByDecisionId: null, reviewItemId: 'r1',
      before: { listing: { marketplace: 'ml', externalProductId: 'X' }, clusterId: 'c1', status: 'provisional', inScope: true },
      after: { listing: { marketplace: 'ml', externalProductId: 'X' }, clusterId: 'c2', status: 'confirmed', inScope: true } });
    prisma.productClusterItem.findUnique.mockResolvedValue({ clusterId: 'c2', status: 'confirmed' });
    await service.undo('d1', 'admin-1');
    expect(assigner.moveListing).toHaveBeenCalledWith({ marketplace: 'ml', externalProductId: 'X' }, 'c1', 'provisional');
    expect(prisma.catalogReviewItem.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { status: 'pending', resolution: null, resolvedBy: null, resolvedAt: null } });
    expect(prisma.catalogDecision.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { undoneByDecisionId: 'd1' } });
  });

  it('undo de ação de tipo é recusado', async () => {
    const { service, prisma } = build();
    prisma.catalogDecision.findUnique.mockResolvedValue({ id: 'd9', action: 'approve_type', undoneByDecisionId: null });
    await expect(service.undo('d9', 'admin-1')).rejects.toThrow('esta ação não pode ser desfeita');
  });

  it('approveType cria o tipo e monta os anúncios que o sugeriram, sem LLM', async () => {
    const { service, prisma, assigner } = build();
    prisma.catalogReviewItem.findUnique.mockResolvedValue({ id: 'r2', kind: 'suggested_type', status: 'pending', suggestedTypeAliases: ['power_rack', 'squat_cage'] });
    prisma.catalogFamily.findUnique.mockResolvedValue({ id: 'fam-1', key: 'commercial_gym_equipment' });
    prisma.listingFicha.findMany.mockResolvedValue([{ id: 'f1' }, { id: 'f2' }]);
    const r = await service.approveType('r2', { familyKey: 'commercial_gym_equipment', key: 'squat_rack', namePt: 'Suporte' }, 'admin-1');
    expect(prisma.catalogType.create).toHaveBeenCalledWith({ data: expect.objectContaining({ key: 'squat_rack', familyId: 'fam-1', source: 'approved' }) });
    expect(assigner.invalidateTypeCache).toHaveBeenCalled();
    expect(prisma.listingFicha.updateMany).toHaveBeenCalledWith({
      where: { typeKey: 'unknown', suggestedType: { in: ['power_rack', 'squat_cage'] }, inScope: { not: false } },
      data: { typeKey: 'squat_rack', suggestedType: null } });
    expect(assigner.assign).toHaveBeenCalledTimes(2);
    expect(r.typeId).toBe('type-new');
  });

  it('mergeType devolve as fichas para a fila com prioridade 200', async () => {
    const { service, prisma } = build();
    prisma.catalogReviewItem.findUnique.mockResolvedValue({ id: 'r2', kind: 'suggested_type', status: 'pending', suggestedTypeAliases: ['squat_cage'] });
    prisma.catalogType.findUnique.mockResolvedValue({ id: 't', key: 'power_rack' });
    const r = await service.mergeType('r2', 'power_rack', 'admin-1');
    expect(prisma.listingFicha.updateMany).toHaveBeenCalledWith({
      where: { typeKey: 'unknown', suggestedType: { in: ['squat_cage'] }, inScope: { not: false } },
      data: { status: 'pending', priority: 200, attempts: 0, lastError: null } });
    expect(r.requeued).toBe(2);
  });

  it('renameCard trava o nome e registra a decisão', async () => {
    const { service, prisma } = build();
    prisma.productCluster.findUnique.mockResolvedValue({ id: 'c1', canonicalName: 'Bike spinning magnética', nameLocked: false });
    await service.renameCard('c1', 'Bike spinning magnética 13 kg', 'admin-1');
    expect(prisma.productCluster.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { canonicalName: 'Bike spinning magnética 13 kg', nameLocked: true } });
  });
});
```
Run: `npx jest src/modules/catalog/catalog-review.service.spec.ts` → FAIL.

- [x] **Passo 4: Implementar `catalog-review.service.ts`**

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { CardAssignerService, ItemStatus, ListingRef } from './card-assigner.service';
import { ACTIVE_CARD_STATUSES, PRIORITY, UNKNOWN_TYPE } from './catalog.constants';

type Kind = 'provisional_listing' | 'suggested_type';
interface ListingState {
  listing: ListingRef;
  clusterId: string | null;
  status: ItemStatus | null;
  inScope: boolean | null;
}
const UNDOABLE = new Set(['confirm', 'move', 'create_card', 'out_of_scope', 'rename_card']);

export interface CardListingView {
  marketplace: string;
  external_product_id: string;
  title: string;
  url: string | null;
  price: number | null;
  currency: string | null;
  rating: number | null;
  status: string;
  variation: string | null;
  brand: string | null;
}

@Injectable()
export class CatalogReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assigner: CardAssignerService,
  ) {}

  // ---------- leitura ----------
  async counts(): Promise<{ provisional_listing: number; suggested_type: number }> {
    const [provisional, suggested] = await Promise.all([
      this.prisma.catalogReviewItem.count({ where: { kind: 'provisional_listing', status: 'pending' } }),
      this.prisma.catalogReviewItem.count({ where: { kind: 'suggested_type', status: 'pending' } }),
    ]);
    return { provisional_listing: provisional, suggested_type: suggested };
  }

  async list(kind: Kind, page = 1, pageSize = 20): Promise<{ total: number; items: unknown[] }> {
    const where = { kind, status: 'pending' };
    const orderBy: Prisma.CatalogReviewItemOrderByWithRelationInput[] =
      kind === 'suggested_type' ? [{ listingCount: 'desc' }, { createdAt: 'asc' }] : [{ createdAt: 'asc' }];
    const [total, rows] = await Promise.all([
      this.prisma.catalogReviewItem.count({ where }),
      this.prisma.catalogReviewItem.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { suggestedCluster: { select: { id: true, canonicalName: true, category: true } } },
      }),
    ]);
    const items = [];
    for (const row of rows) {
      if (kind === 'provisional_listing' && row.marketplace && row.externalProductId) {
        const listing = { marketplace: row.marketplace, externalProductId: row.externalProductId };
        const [snapshot, ficha] = await Promise.all([
          this.prisma.productListingSnapshot.findFirst({ where: listing, orderBy: { collectedAt: 'desc' } }),
          this.prisma.listingFicha.findUnique({ where: { marketplace_externalProductId: listing } }),
        ]);
        items.push({
          id: row.id,
          kind,
          reason: row.reason,
          marketplace: row.marketplace,
          external_product_id: row.externalProductId,
          title: snapshot?.title ?? ficha?.title ?? row.externalProductId,
          url: snapshot?.productUrl ?? null,
          price: snapshot?.priceMin !== null && snapshot?.priceMin !== undefined ? Number(snapshot.priceMin) : null,
          currency: snapshot?.currency ?? null,
          suggested_card: row.suggestedCluster
            ? { id: row.suggestedCluster.id, name: row.suggestedCluster.canonicalName, category: row.suggestedCluster.category }
            : null,
          ficha: ficha
            ? { type_key: ficha.typeKey, card_key_values: ficha.cardKeyValues, missing_key_attrs: ficha.missingKeyAttrs,
                comparison_values: ficha.comparisonValues, brand: ficha.brand }
            : null,
          created_at: row.createdAt,
        });
      } else {
        const aliases = row.suggestedTypeAliases;
        const [samples, similar] = await Promise.all([
          this.prisma.listingFicha.findMany({
            where: { typeKey: UNKNOWN_TYPE, suggestedType: { in: aliases }, inScope: { not: false } },
            select: { title: true, marketplace: true },
            take: 3,
          }),
          this.prisma.$queryRaw<Array<{ key: string; name_pt: string }>>`
            SELECT key, name_pt FROM catalog_types
            WHERE active = true AND similarity(key, ${row.suggestedTypeKey ?? ''}) >= 0.3
            ORDER BY similarity(key, ${row.suggestedTypeKey ?? ''}) DESC LIMIT 3`,
        ]);
        items.push({
          id: row.id,
          kind,
          reason: row.reason,
          suggested_type_key: row.suggestedTypeKey,
          aliases,
          listing_count: row.listingCount,
          samples,
          similar_types: similar,
          created_at: row.createdAt,
        });
      }
    }
    return { total, items };
  }

  async listCardListings(clusterId: string): Promise<CardListingView[]> {
    const items = await this.prisma.productClusterItem.findMany({ where: { clusterId }, orderBy: { matchedAt: 'asc' } });
    if (items.length === 0) return [];
    const refs = items.map((i) => ({ marketplace: i.marketplace, externalProductId: i.externalProductId }));
    const [fichas, snapshots] = await Promise.all([
      this.prisma.listingFicha.findMany({ where: { OR: refs } }),
      this.prisma.productListingSnapshot.findMany({
        where: { productClusterId: clusterId },
        orderBy: { collectedAt: 'desc' },
        distinct: ['marketplace', 'externalProductId'],
      }),
    ]);
    const key = (m: string, e: string) => `${m}::${e}`;
    const fichaBy = new Map(fichas.map((f) => [key(f.marketplace, f.externalProductId), f]));
    const snapBy = new Map(snapshots.map((s) => [key(s.marketplace, s.externalProductId), s]));
    return items.map((item) => {
      const f = fichaBy.get(key(item.marketplace, item.externalProductId));
      const s = snapBy.get(key(item.marketplace, item.externalProductId));
      const variation = Object.entries((f?.variationValues ?? {}) as Record<string, unknown>)
        .map(([attr, value]) => `${attr.replace(/_/g, ' ')}: ${String(value)}`)
        .join(' · ');
      return {
        marketplace: item.marketplace,
        external_product_id: item.externalProductId,
        title: s?.title ?? f?.title ?? item.externalProductId,
        url: s?.productUrl ?? null,
        price: s?.priceMin !== null && s?.priceMin !== undefined ? Number(s.priceMin) : null,
        currency: s?.currency ?? null,
        rating: s?.rating !== null && s?.rating !== undefined ? Number(s.rating) : null,
        status: item.status,
        variation: variation || null,
        brand: f?.brand ?? null,
      };
    });
  }

  async searchCards(q: string) {
    const rows = await this.prisma.productCluster.findMany({
      where: { cardStatus: { in: [...ACTIVE_CARD_STATUSES] }, canonicalName: { contains: q.trim(), mode: 'insensitive' } },
      select: { id: true, canonicalName: true, category: true, cardStatus: true },
      orderBy: { canonicalName: 'asc' },
      take: 20,
    });
    return rows.map((r) => ({ id: r.id, name: r.canonicalName, category: r.category, card_status: r.cardStatus }));
  }

  // ---------- ações sobre anúncio ----------
  async confirm(reviewId: string, actorId: string) {
    const review = await this.pendingListingReview(reviewId);
    const before = await this.state(this.listingOf(review));
    const target = review.suggestedClusterId ?? before.clusterId;
    if (!target) throw new BadRequestException('Este anúncio não tem card sugerido; use "mover" ou "criar card".');
    return this.applyListing(review, 'confirm', before, target, 'confirmed', actorId);
  }

  async move(reviewId: string, targetClusterId: string, actorId: string) {
    const review = await this.pendingListingReview(reviewId);
    const target = await this.prisma.productCluster.findUnique({ where: { id: targetClusterId } });
    if (!target || !ACTIVE_CARD_STATUSES.includes(target.cardStatus as never)) {
      throw new NotFoundException('Card de destino inexistente ou inativo.');
    }
    const before = await this.state(this.listingOf(review));
    return this.applyListing(review, 'move', before, targetClusterId, 'confirmed', actorId);
  }

  async createCard(reviewId: string, dto: { typeKey: string; cardKeyValues: Record<string, string>; name?: string }, actorId: string) {
    const review = await this.pendingListingReview(reviewId);
    const before = await this.state(this.listingOf(review));
    const clusterId = await this.assigner.createCardForType(dto.typeKey, dto.cardKeyValues, dto.name);
    const result = await this.applyListing(review, 'create_card', before, clusterId, 'confirmed', actorId);
    return { ...result, clusterId };
  }

  async outOfScope(reviewId: string, actorId: string) {
    const review = await this.pendingListingReview(reviewId);
    const listing = this.listingOf(review);
    const before = await this.state(listing);
    await this.assigner.moveListing(listing, null, 'confirmed');
    await this.prisma.listingFicha.update({ where: { marketplace_externalProductId: listing }, data: { inScope: false } });
    await this.assigner.resolveListingReviews(listing, 'out_of_scope', actorId);
    const after: ListingState = { listing, clusterId: null, status: null, inScope: false };
    return this.decision('out_of_scope', actorId, review.id, before, after);
  }

  // ---------- ações sobre tipo sugerido ----------
  async approveType(reviewId: string, dto: { familyKey: string; key: string; namePt: string; ncm?: string | null }, actorId: string) {
    const review = await this.pendingTypeReview(reviewId);
    const family = await this.prisma.catalogFamily.findUnique({ where: { key: dto.familyKey } });
    if (!family) throw new NotFoundException(`Família inexistente: ${dto.familyKey}`);
    const type = await this.prisma.catalogType.create({
      data: {
        familyId: family.id,
        key: dto.key,
        namePt: dto.namePt,
        descriptionEn: dto.namePt,
        ncm: dto.ncm ?? null,
        cardKeyAttrs: [],
        comparisonAttrs: [],
        variationAttrs: [],
        source: 'approved',
      },
    });
    this.assigner.invalidateTypeCache();
    const where = { typeKey: UNKNOWN_TYPE, suggestedType: { in: review.suggestedTypeAliases }, inScope: { not: false } };
    const fichas = await this.prisma.listingFicha.findMany({ where, select: { id: true } });
    await this.prisma.listingFicha.updateMany({ where, data: { typeKey: dto.key, suggestedType: null } });
    for (const { id } of fichas) {
      const ficha = await this.prisma.listingFicha.findUnique({ where: { id } });
      if (ficha) await this.assigner.assign(ficha);
    }
    await this.resolveReview(review.id, 'approve_type', actorId);
    const result = await this.decision('approve_type', actorId, review.id, { aliases: review.suggestedTypeAliases }, { typeKey: dto.key, typeId: type.id });
    return { ...result, typeId: type.id };
  }

  async mergeType(reviewId: string, typeKey: string, actorId: string) {
    const review = await this.pendingTypeReview(reviewId);
    const type = await this.prisma.catalogType.findUnique({ where: { key: typeKey } });
    if (!type) throw new NotFoundException(`Tipo inexistente: ${typeKey}`);
    const { count } = await this.prisma.listingFicha.updateMany({
      where: { typeKey: UNKNOWN_TYPE, suggestedType: { in: review.suggestedTypeAliases }, inScope: { not: false } },
      data: { status: 'pending', priority: PRIORITY.REVIEW_MERGE, attempts: 0, lastError: null },
    });
    await this.resolveReview(review.id, 'merge_type', actorId);
    const result = await this.decision('merge_type', actorId, review.id, { aliases: review.suggestedTypeAliases }, { typeKey, requeued: count });
    return { ...result, requeued: count };
  }

  async discardType(reviewId: string, actorId: string) {
    const review = await this.pendingTypeReview(reviewId);
    const where = { typeKey: UNKNOWN_TYPE, suggestedType: { in: review.suggestedTypeAliases }, inScope: { not: false } };
    const fichas = await this.prisma.listingFicha.findMany({ where, select: { id: true } });
    await this.prisma.listingFicha.updateMany({ where, data: { inScope: false } });
    for (const { id } of fichas) {
      const ficha = await this.prisma.listingFicha.findUnique({ where: { id } });
      if (ficha) await this.assigner.assign(ficha);
    }
    await this.resolveReview(review.id, 'discard_type', actorId);
    return this.decision('discard_type', actorId, review.id, { aliases: review.suggestedTypeAliases }, { discarded: fichas.length });
  }

  // ---------- card ----------
  async renameCard(clusterId: string, name: string, actorId: string) {
    const card = await this.prisma.productCluster.findUnique({ where: { id: clusterId } });
    if (!card) throw new NotFoundException('Card inexistente.');
    await this.prisma.productCluster.update({ where: { id: clusterId }, data: { canonicalName: name, nameLocked: true } });
    return this.decision('rename_card', actorId, null,
      { clusterId, name: card.canonicalName, nameLocked: card.nameLocked },
      { clusterId, name, nameLocked: true });
  }

  // ---------- desfazer ----------
  async undo(decisionId: string, actorId: string) {
    const decision = await this.prisma.catalogDecision.findUnique({ where: { id: decisionId } });
    if (!decision) throw new NotFoundException('Decisão inexistente.');
    if (decision.undoneByDecisionId) throw new ConflictException('Esta decisão já foi desfeita.');
    if (!UNDOABLE.has(decision.action)) throw new ConflictException('esta ação não pode ser desfeita');

    if (decision.action === 'rename_card') {
      const before = decision.before as { clusterId: string; name: string; nameLocked: boolean };
      const after = decision.after as { name: string };
      const card = await this.prisma.productCluster.findUnique({ where: { id: before.clusterId } });
      if (!card || card.canonicalName !== after.name) throw new ConflictException('o card foi alterado depois desta decisão');
      await this.prisma.productCluster.update({ where: { id: before.clusterId }, data: { canonicalName: before.name, nameLocked: before.nameLocked } });
    } else {
      const before = decision.before as unknown as ListingState;
      const after = decision.after as unknown as ListingState;
      const now = await this.state(before.listing);
      if (now.clusterId !== after.clusterId || now.status !== after.status) {
        throw new ConflictException('o anúncio foi alterado depois desta decisão');
      }
      await this.assigner.moveListing(before.listing, before.clusterId, before.status ?? 'confirmed');
      if (before.inScope !== after.inScope) {
        await this.prisma.listingFicha.update({
          where: { marketplace_externalProductId: before.listing },
          data: { inScope: before.inScope },
        });
      }
      if (decision.reviewItemId) {
        await this.prisma.catalogReviewItem.update({
          where: { id: decision.reviewItemId },
          data: { status: 'pending', resolution: null, resolvedBy: null, resolvedAt: null },
        });
      }
    }
    const undo = await this.decision('undo', actorId, decision.reviewItemId, decision.after as object, decision.before as object);
    await this.prisma.catalogDecision.update({ where: { id: decision.id }, data: { undoneByDecisionId: undo.decisionId } });
    return undo;
  }

  // ---------- auxiliares ----------
  private listingOf(review: { marketplace: string | null; externalProductId: string | null }): ListingRef {
    return { marketplace: review.marketplace as string, externalProductId: review.externalProductId as string };
  }

  private async pendingListingReview(id: string) {
    const review = await this.prisma.catalogReviewItem.findUnique({ where: { id } });
    if (!review || review.kind !== 'provisional_listing') throw new NotFoundException('Item de revisão inexistente.');
    if (review.status !== 'pending') throw new ConflictException('Este item já foi decidido.');
    return review;
  }

  private async pendingTypeReview(id: string) {
    const review = await this.prisma.catalogReviewItem.findUnique({ where: { id } });
    if (!review || review.kind !== 'suggested_type') throw new NotFoundException('Item de revisão inexistente.');
    if (review.status !== 'pending') throw new ConflictException('Este item já foi decidido.');
    return review;
  }

  private async state(listing: ListingRef): Promise<ListingState> {
    const [item, ficha] = await Promise.all([
      this.prisma.productClusterItem.findUnique({ where: { marketplace_externalProductId: listing } }),
      this.prisma.listingFicha.findUnique({ where: { marketplace_externalProductId: listing } }),
    ]);
    return {
      listing,
      clusterId: item?.clusterId ?? null,
      status: (item?.status as ItemStatus | undefined) ?? null,
      inScope: ficha?.inScope ?? null,
    };
  }

  private async applyListing(
    review: { id: string; marketplace: string | null; externalProductId: string | null },
    action: string,
    before: ListingState,
    target: string,
    status: ItemStatus,
    actorId: string,
  ) {
    const listing = this.listingOf(review);
    await this.assigner.moveListing(listing, target, status);
    await this.assigner.resolveListingReviews(listing, action, actorId);
    const after: ListingState = { listing, clusterId: target, status, inScope: before.inScope };
    return this.decision(action, actorId, review.id, before, after);
  }

  private async resolveReview(id: string, resolution: string, actorId: string) {
    await this.prisma.catalogReviewItem.update({
      where: { id },
      data: { status: 'resolved', resolution, resolvedBy: actorId, resolvedAt: new Date() },
    });
  }

  private async decision(action: string, actorId: string, reviewItemId: string | null, before: object, after: object) {
    const row = await this.prisma.catalogDecision.create({
      data: {
        action,
        actorUserId: actorId,
        reviewItemId,
        before: before as Prisma.InputJsonValue,
        after: after as Prisma.InputJsonValue,
      },
    });
    return { decisionId: row.id };
  }
}
```
Observação: o mock de `productClusterItem.findUnique` no teste de `confirm` devolve o mesmo valor para `state()`; é isso que monta o `before` esperado.

- [x] **Passo 5: Rodar e ver passar** — `npx jest src/modules/catalog/catalog-review.service.spec.ts` → PASS. Se `undo aplica o estado anterior` falhar por causa do id da decisão de desfazer: o mock de `catalogDecision.create` devolve `id: 'd1'`, então a expectativa `undoneByDecisionId: 'd1'` está correta.

- [x] **Passo 6: Controllers**

`catalog-review.controller.ts`:
```ts
import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { CatalogReviewService } from './catalog-review.service';
import { ApproveTypeDto, CreateCardDto, MergeTypeDto, MoveListingDto, RenameCardDto, ReviewListQueryDto } from './dto/catalog-review.dto';

type AuthedRequest = { user: { sub: string } };

@Controller('catalog')
@UseGuards(AdminGuard)
export class CatalogReviewController {
  constructor(private readonly review: CatalogReviewService) {}

  @Get('review')
  list(@Query() query: ReviewListQueryDto) {
    return this.review.list(query.kind, query.page ?? 1, query.page_size ?? 20);
  }

  @Get('review/counts')
  counts() {
    return this.review.counts();
  }

  @Post('review/:id/confirm')
  confirm(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.review.confirm(id, req.user.sub);
  }

  @Post('review/:id/move')
  move(@Param('id') id: string, @Body() dto: MoveListingDto, @Req() req: AuthedRequest) {
    return this.review.move(id, dto.targetClusterId, req.user.sub);
  }

  @Post('review/:id/create-card')
  createCard(@Param('id') id: string, @Body() dto: CreateCardDto, @Req() req: AuthedRequest) {
    return this.review.createCard(id, dto, req.user.sub);
  }

  @Post('review/:id/out-of-scope')
  outOfScope(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.review.outOfScope(id, req.user.sub);
  }

  @Post('types/suggestions/:id/approve')
  approve(@Param('id') id: string, @Body() dto: ApproveTypeDto, @Req() req: AuthedRequest) {
    return this.review.approveType(id, dto, req.user.sub);
  }

  @Post('types/suggestions/:id/merge')
  merge(@Param('id') id: string, @Body() dto: MergeTypeDto, @Req() req: AuthedRequest) {
    return this.review.mergeType(id, dto.typeKey, req.user.sub);
  }

  @Post('types/suggestions/:id/discard')
  discard(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.review.discardType(id, req.user.sub);
  }

  @Patch('cards/:id')
  rename(@Param('id') id: string, @Body() dto: RenameCardDto, @Req() req: AuthedRequest) {
    return this.review.renameCard(id, dto.name, req.user.sub);
  }

  @Post('decisions/:id/undo')
  undo(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.review.undo(id, req.user.sub);
  }
}
```

`catalog-cards.controller.ts` (qualquer usuário logado):
```ts
import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatalogReviewService } from './catalog-review.service';

@Controller('catalog/cards')
export class CatalogCardsController {
  constructor(private readonly review: CatalogReviewService) {}

  @Get()
  search(@Query('q') q = '') {
    return this.review.searchCards(q);
  }

  @Get(':id/listings')
  listings(@Param('id') id: string) {
    return this.review.listCardListings(id);
  }
}
```

Em `catalog.module.ts`, acrescente `controllers: [CatalogReviewController, CatalogCardsController]` e `CatalogReviewService` em `providers`.

- [x] **Passo 7: Compilar e rodar**

Run: `npx tsc -p tsconfig.build.json --noEmit && npx jest src/modules/catalog src/modules/auth`
Esperado: sem erros; todos passam. Confira no `main.ts` que o `ValidationPipe` global com `transform: true` já existe (os DTOs dependem dele). Se não existir, **não crie**: valide os DTOs manualmente no controller e avise o usuário.

- [x] **Passo 8: Revisar o diff (sem commit)**

---

## Tarefa 16: Ranking, página do produto e Monte Carlo passam a entender o card

**Arquivos:**
- Criar: `Move-Intelligence-Back/src/modules/dashboard-api/card-fields.ts`
- Criar: `Move-Intelligence-Back/src/modules/dashboard-api/card-fields.spec.ts`
- Modificar: `Move-Intelligence-Back/src/modules/dashboard-api/dashboard-api.service.ts`
- Modificar: `Move-Intelligence-Back/src/modules/dashboard-api/dashboard-api.module.ts`
- Modificar: `Move-Intelligence-Back/src/modules/products/products.service.ts` (+ spec)

**Interfaces:**
- Consome: `cardChipLabels` (Tarefa 5), `buildCardComparison` (Tarefa 10), `TaxonomyService` (Tarefa 4).
- Produz (`card-fields.ts`, funções puras):
  ```ts
  export interface CardRowInput {
    cardStatus: string | null; familyName: string | null; typeName: string | null;
    cardKeyAttrs: CardKeyAttr[] | null; cardKeyValues: Record<string, string> | null;
    listingCount: number | null; storeCount: number | null; brandCount: number | null;
    priceMedianBr: number | null; priceMinBr: number | null; priceMaxBr: number | null;
  }
  export function cardListFields(row: CardRowInput): Record<string, unknown>;
  export function provisionalScoreOverride(cardStatus: string | null): Record<string, unknown>;
  ```
- Campos novos na resposta de `GET /trends/products` (cada item) e `GET /trends/products/:id`: `card_status`, `family_name`, `type_name`, `card_chips` (string[]), `listing_count`, `store_count`, `brand_count`, `price_median_br`, `price_min_br`, `price_max_br`.
- Só no detalhe: `comparison` (objeto `CardComparison` da Tarefa 10).
- Card `merged` no detalhe: a resposta é **só** `{ merged_into_id: string }`.

- [x] **Passo 1: Teste que falha** — `card-fields.spec.ts`:
```ts
import { cardListFields, provisionalScoreOverride } from './card-fields';

describe('card-fields', () => {
  it('monta campos do card com chips', () => {
    expect(cardListFields({
      cardStatus: 'confirmed', familyName: 'Bikes spinning', typeName: 'Bike spinning',
      cardKeyAttrs: [{ attr: 'resistencia', label_pt: 'resistência', values: [{ value: 'magnetica', label_pt: 'magnética' }] }],
      cardKeyValues: { resistencia: 'magnetica' }, listingCount: 9, storeCount: 4, brandCount: 5,
      priceMedianBr: 1460, priceMinBr: 1390, priceMaxBr: 1520,
    })).toEqual({
      card_status: 'confirmed', family_name: 'Bikes spinning', type_name: 'Bike spinning', card_chips: ['magnética'],
      listing_count: 9, store_count: 4, brand_count: 5, price_median_br: 1460, price_min_br: 1390, price_max_br: 1520,
    });
  });

  it('cluster legado sem tipo: campos nulos e sem chips', () => {
    expect(cardListFields({ cardStatus: 'legacy', familyName: null, typeName: null, cardKeyAttrs: null, cardKeyValues: null,
      listingCount: null, storeCount: null, brandCount: null, priceMedianBr: null, priceMinBr: null, priceMaxBr: null }))
      .toMatchObject({ card_status: 'legacy', card_chips: [], listing_count: null });
  });

  it('provisório zera o score e troca a ação', () => {
    expect(provisionalScoreOverride('provisional')).toEqual({
      move_score: null, score_band: null, action: 'AGUARDANDO_REVISAO', action_label: 'Aguardando revisão' });
    expect(provisionalScoreOverride('confirmed')).toEqual({});
  });
});
```
Run: `npx jest src/modules/dashboard-api/card-fields.spec.ts` → FAIL.

- [x] **Passo 2: Implementar `card-fields.ts`**
```ts
import { cardChipLabels } from '../catalog/card-key';
import { CardKeyAttr, CatalogTypeDef } from '../catalog/taxonomy.types';

export interface CardRowInput {
  cardStatus: string | null;
  familyName: string | null;
  typeName: string | null;
  cardKeyAttrs: CardKeyAttr[] | null;
  cardKeyValues: Record<string, string> | null;
  listingCount: number | null;
  storeCount: number | null;
  brandCount: number | null;
  priceMedianBr: number | null;
  priceMinBr: number | null;
  priceMaxBr: number | null;
}

export function cardListFields(row: CardRowInput): Record<string, unknown> {
  const chips = row.cardKeyAttrs && row.cardKeyValues
    ? cardChipLabels({ cardKeyAttrs: row.cardKeyAttrs } as CatalogTypeDef, row.cardKeyValues)
    : [];
  return {
    card_status: row.cardStatus,
    family_name: row.familyName,
    type_name: row.typeName,
    card_chips: chips,
    listing_count: row.listingCount,
    store_count: row.storeCount,
    brand_count: row.brandCount,
    price_median_br: row.priceMedianBr,
    price_min_br: row.priceMinBr,
    price_max_br: row.priceMaxBr,
  };
}

/** Card provisório aparece sem score e com a ação "Aguardando revisão" (spec D9 e 4.4). */
export function provisionalScoreOverride(cardStatus: string | null): Record<string, unknown> {
  return cardStatus === 'provisional'
    ? { move_score: null, score_band: null, action: 'AGUARDANDO_REVISAO', action_label: 'Aguardando revisão' }
    : {};
}
```
Run → PASS.

- [x] **Passo 3: SQL do ranking (`loadClusterRollups`)**

No SQL de `loadClusterRollups`, **entre o `)` que fecha a CTE `tiktok_growth` e o `SELECT` final**, acrescente (com a vírgula depois do `)` da `tiktok_growth`):
```sql
      card_stats AS (
        SELECT
          i.cluster_id AS product_cluster_id,
          COUNT(*)::int AS listing_count,
          COUNT(DISTINCT i.marketplace)::int AS store_count,
          (COUNT(DISTINCT lf.brand) FILTER (WHERE lf.brand IS NOT NULL))::int AS brand_count
        FROM product_cluster_items i
        LEFT JOIN listing_fichas lf
          ON lf.marketplace = i.marketplace AND lf.external_product_id = i.external_product_id
        WHERE i.status = 'confirmed'
        GROUP BY i.cluster_id
      ),
      br_price AS (
        SELECT
          latest.product_cluster_id,
          (percentile_cont(0.5) WITHIN GROUP (ORDER BY latest.price_min))::float8 AS price_median_br,
          MIN(latest.price_min)::float8 AS price_min_br,
          MAX(latest.price_min)::float8 AS price_max_br
        FROM (
          SELECT DISTINCT ON (s.product_cluster_id, s.marketplace, s.external_product_id)
            s.product_cluster_id, s.price_min
          FROM product_listing_snapshots s
          WHERE s.product_cluster_id IS NOT NULL
            AND s.price_min > 0
            AND s.marketplace IN ('amazon_br', 'mercado_livre', 'mercadolivre', 'shopee_br')
            ${syntheticFilterS}
          ORDER BY s.product_cluster_id, s.marketplace, s.external_product_id, s.collected_at DESC
        ) latest
        GROUP BY latest.product_cluster_id
      )
```
No `SELECT` final, depois de `w.sellers`, acrescente:
```sql
        , c.card_status,
        c.card_key_values,
        t.name_pt AS type_name,
        t.card_key_attrs,
        f.name_pt AS family_name,
        cs.listing_count,
        cs.store_count,
        cs.brand_count,
        bp.price_median_br,
        bp.price_min_br,
        bp.price_max_br
```
Depois de `LEFT JOIN tiktok_growth tg ON tg.product_cluster_id = c.id`, acrescente:
```sql
      LEFT JOIN catalog_types t ON t.id = c.type_id
      LEFT JOIN catalog_families f ON f.id = t.family_id
      LEFT JOIN card_stats cs ON cs.product_cluster_id = c.id
      LEFT JOIN br_price bp ON bp.product_cluster_id = c.id
```
E no `WHERE 1 = 1` final, depois de `${categoryFilter}`: `AND c.card_status <> 'merged'`.

- [x] **Passo 4: Tipos e mapeamento**

- Em `type ClusterRollupRow`, acrescente: `card_status: string | null; card_key_values: unknown; type_name: string | null; card_key_attrs: unknown; family_name: string | null; listing_count: unknown; store_count: unknown; brand_count: unknown; price_median_br: unknown; price_min_br: unknown; price_max_br: unknown;`.
- Em `type ClusterRollup`, acrescente `card: CardRowInput;` (importe `CardRowInput`, `cardListFields` e `provisionalScoreOverride` de `./card-fields`).
- Em `mapClusterRollup`, acrescente:
```ts
      card: {
        cardStatus: row.card_status ?? null,
        familyName: row.family_name ?? null,
        typeName: row.type_name ?? null,
        cardKeyAttrs: (row.card_key_attrs as CardKeyAttr[] | null) ?? null,
        cardKeyValues: (row.card_key_values as Record<string, string> | null) ?? null,
        listingCount: this.toNumber(row.listing_count),
        storeCount: this.toNumber(row.store_count),
        brandCount: this.toNumber(row.brand_count),
        priceMedianBr: this.toNumber(row.price_median_br),
        priceMinBr: this.toNumber(row.price_min_br),
        priceMaxBr: this.toNumber(row.price_max_br),
      },
```
  (importe `CardKeyAttr` de `'../catalog/taxonomy.types'`).
- Em `clusterRollupToTrendProduct`, logo **depois** de `...this.toMoveScoreFields(moveScore),`, acrescente:
```ts
      ...provisionalScoreOverride(row.card.cardStatus),
      ...cardListFields(row.card),
```
- Se algum outro lugar do arquivo monta `ClusterRollup` sem passar por `mapClusterRollup` (o compilador vai acusar `card` faltando), preencha com `card: { cardStatus: null, familyName: null, typeName: null, cardKeyAttrs: null, cardKeyValues: null, listingCount: null, storeCount: null, brandCount: null, priceMedianBr: null, priceMinBr: null, priceMaxBr: null }`.

- [x] **Passo 5: Detalhe (`getTrendProduct`) — `merged`, campos do card e comparação**

- No construtor de `DashboardApiService`, acrescente como **último** parâmetro: `@Optional() private readonly taxonomy?: TaxonomyService,`. É opcional para não quebrar os `new DashboardApiService(...)` dos specs.
- Em `dashboard-api.module.ts`, acrescente `CatalogModule` em `imports`.
- No começo de `getTrendProduct(id)`, antes do `findUnique` atual:
```ts
    const card = await this.prisma.productCluster.findUnique({
      where: { id },
      select: { cardStatus: true, mergedIntoId: true, typeId: true, cardKeyValues: true },
    });
    if (card?.cardStatus === 'merged' && card.mergedIntoId) {
      return { merged_into_id: card.mergedIntoId };
    }
```
- No `return` final de `getTrendProduct`, acrescente depois de `...this.toMoveScoreFields(moveScore),`:
```ts
      ...provisionalScoreOverride(card?.cardStatus ?? null),
      ...(await this.cardDetailFields(id, card?.typeId ?? null, card?.cardStatus ?? null,
        (card?.cardKeyValues ?? null) as Record<string, string> | null)),
```
- Acrescente o método privado:
```ts
  private async cardDetailFields(
    clusterId: string,
    typeId: string | null,
    cardStatus: string | null,
    cardKeyValues: Record<string, string> | null,
  ): Promise<Record<string, unknown>> {
    const type = typeId && this.taxonomy
      ? [...(await this.taxonomy.getTypeMap()).values()].find((t) => t.id === typeId) ?? null
      : null;
    if (!type) {
      return cardListFields({ cardStatus, familyName: null, typeName: null, cardKeyAttrs: null, cardKeyValues: null,
        listingCount: null, storeCount: null, brandCount: null, priceMedianBr: null, priceMinBr: null, priceMaxBr: null });
    }
    const items = await this.prisma.productClusterItem.findMany({ where: { clusterId } });
    const refs = items.map((i) => ({ marketplace: i.marketplace, externalProductId: i.externalProductId }));
    const [fichas, snapshots] = refs.length
      ? await Promise.all([
          this.prisma.listingFicha.findMany({ where: { OR: refs } }),
          this.prisma.productListingSnapshot.findMany({
            where: { productClusterId: clusterId, priceMin: { gt: 0 } },
            orderBy: { collectedAt: 'desc' },
            distinct: ['marketplace', 'externalProductId'],
            select: { marketplace: true, externalProductId: true, priceMin: true },
          }),
        ])
      : [[], []];
    const k = (m: string, e: string) => `${m}::${e}`;
    const fichaBy = new Map(fichas.map((f) => [k(f.marketplace, f.externalProductId), f]));
    const priceBy = new Map(snapshots.map((s) => [k(s.marketplace, s.externalProductId), Number(s.priceMin)]));
    const comparison = buildCardComparison(type, items.map((i) => {
      const f = fichaBy.get(k(i.marketplace, i.externalProductId));
      return {
        marketplace: i.marketplace,
        brand: f?.brand ?? null,
        price: priceBy.get(k(i.marketplace, i.externalProductId)) ?? null,
        status: i.status === 'provisional' ? 'provisional' : 'confirmed',
        comparisonValues: (f?.comparisonValues ?? {}) as Record<string, unknown>,
      };
    }));
    return {
      ...cardListFields({
        cardStatus,
        familyName: type.familyNamePt,
        typeName: type.namePt,
        cardKeyAttrs: type.cardKeyAttrs,
        cardKeyValues,
        listingCount: comparison.listing_count,
        storeCount: comparison.store_count,
        brandCount: comparison.brand_count,
        priceMedianBr: comparison.price_median_br,
        priceMinBr: comparison.price_min_br,
        priceMaxBr: comparison.price_max_br,
      }),
      comparison,
    };
  }
```
  (importe `buildCardComparison` de `'../catalog/card-comparison'`, `TaxonomyService` de `'../catalog/taxonomy.service'` e `Optional` de `@nestjs/common` se ainda não estiver).
- Na busca (`search`, onde há `productCluster.findMany` com `canonicalName contains`), acrescente ao `where`: `cardStatus: { not: 'merged' }`.

- [x] **Passo 6: Monte Carlo em lote pula `provisional` e `merged`**

Em `products.service.ts`, `findClustersNeedingSimulation`, troque o `where` do `productCluster.findMany`:
```ts
      where: {
        cardStatus: { notIn: ['provisional', 'merged'] },
        snapshots: { some: syntheticSnapshotWhere() },
      },
```
Acrescente em `products.service.spec.ts` (siga o padrão de `build`/mocks do arquivo):
```ts
it('simulateBatchForRanking não considera cards provisórios nem merged', async () => {
  // prisma.productCluster.findMany deve ser um jest.fn() que devolve [] neste teste
  await service.simulateBatchForRanking(10);
  expect(prisma.productCluster.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ cardStatus: { notIn: ['provisional', 'merged'] } }),
  }));
});
```

- [x] **Passo 7: Compilar e rodar**

Run: `npx tsc -p tsconfig.build.json --noEmit && npx jest src/modules/dashboard-api src/modules/products`
Esperado: sem erro; os specs existentes continuam passando (ajuste **somente** as expectativas de specs que comparavam o objeto de resposta inteiro com `toEqual` e agora recebem os campos novos: troque por `toMatchObject` ou acrescente os campos com os valores nulos).

- [x] **Passo 8: Conferência manual no banco local**

Com o backend local rodando (`npm run start:dev`, **não** pelo compose; veja as restrições globais) e um token de login:
```bash
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/trends/products?limit=3" | head -c 1500
```
Esperado: itens com `card_status: "legacy"` e `card_chips: []` enquanto o reprocessamento não roda. Ajuste a porta ou o prefixo `/api` conforme o `main.ts`.

Executado em 18/09/2026: login local retornou `role=ADMIN`; o curl autenticado retornou 3 itens com `card_status: "legacy"` e `card_chips: []` (backend temporário na porta 3001, pois o compose ocupava a 3000).

- [x] **Passo 9: Revisar o diff (sem commit)**

---

## Tarefa 17: Comandos `catalog:reprocess` e `catalog:eval`

**Arquivos:**
- Criar: `Move-Intelligence-Back/scripts/catalog-reprocess.ts`
- Criar: `Move-Intelligence-Back/scripts/catalog-eval.ts`
- Modificar: `Move-Intelligence-Back/package.json`

**Interfaces:**
- Consome: `FichaService.registerListing` (Tarefas 12–13), `PRIORITY.REPROCESS`, `ProductsService.simulateBatchForRanking` (existente), prompt/parser (Tarefas 7–8), `TaxonomyService`, `OpenRouterService`.
- `catalog:reprocess` só **enfileira** (prioridade 10); quem gera as fichas é a rotina agendada (`FICHA_ENABLED=true`). Com `--finalize`, roda o recálculo do Monte Carlo em lote quando a fila de reprocessamento acabou.
- `catalog:eval` chama a LLM (~7 chamadas) sobre `test/fixtures/catalog-eval/listings-gold.json` e imprime o relatório. **Não grava nada no banco.**

- [x] **Passo 1: `scripts/catalog-reprocess.ts`**
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/shared/database/prisma.service';
import { PRIORITY } from '../src/modules/catalog/catalog.constants';
import { FichaService } from '../src/modules/catalog/ficha.service';
import { ProductsService } from '../src/modules/products/products.service';

/**
 * Enfileira TODOS os anúncios conhecidos para ficha (prioridade baixa) — spec 6.5.
 * Uso: npm run catalog:reprocess            (enfileira)
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
    const fichas = app.get(FichaService);
    const seen = new Set<string>();
    let queued = 0;
    const register = async (marketplace: string, externalProductId: string, title: string, excerpt: string | null) => {
      const key = `${marketplace}::${externalProductId}`;
      if (seen.has(key)) return;
      seen.add(key);
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
    console.log(`catalog:reprocess — ${queued} anúncios enfileirados. Ligue FICHA_ENABLED=true e acompanhe; depois rode --finalize.`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [x] **Passo 2: `scripts/catalog-eval.ts`**
```ts
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
```

- [x] **Passo 3: Scripts npm** — em `package.json`:
```json
    "catalog:reprocess": "node --env-file-if-exists=.env -r ts-node/register -r tsconfig-paths/register scripts/catalog-reprocess.ts",
    "catalog:eval": "node --env-file-if-exists=.env -r ts-node/register -r tsconfig-paths/register scripts/catalog-eval.ts",
```

- [x] **Passo 4: Compilar**

Run: `npx tsc --noEmit -p tsconfig.json` (ou, se o `tsconfig.json` não incluir `scripts/`, `npx ts-node --transpile-only -e "require('./scripts/catalog-eval.ts')"` **não** deve ser rodado: ele chama a LLM). Esperado: sem erros de tipo nos scripts. **Não rode `catalog:eval` agora**: ele gasta o limite diário; o usuário roda quando quiser.

- [x] **Passo 5: Revisar o diff (sem commit)**

---

## Tarefa 18: Recorte da página no ETL Python

**Arquivos:**
- Modificar: `Move-Intelligence-Dados/app/etl/extract/marketplace/parsers/base.py`
- Modificar: `Move-Intelligence-Dados/app/etl/extract/marketplace/common.py` (`MarketplaceExtractor.parse_detail`)
- Criar: `Move-Intelligence-Dados/tests/test_page_excerpt.py`

**Interfaces:**
- Produz: `build_page_excerpt(markdown: str, title: str | None = None, limit: int = 4000) -> str` em `parsers/base.py`; `parse_detail` grava `source_specific["page_excerpt"]`.
- Ordem (spec 5.1): título → JSON-LD `Product` (name, brand, model, additionalProperty, descrição até 800 caracteres) → bloco de especificações por cabeçalho → bullets → corte em 4.000.

- [x] **Passo 1: Teste que falha** — `tests/test_page_excerpt.py`:
```python
"""Recorte da página para a ficha (subprojeto A, spec 5.1)."""
from pathlib import Path

import pytest

from app.etl.extract.marketplace.parsers.base import build_page_excerpt

FIXTURES = Path(__file__).parent / "fixtures" / "markdown"
SOURCES = ["amazon", "amazon_br", "mercado_livre", "shopee_br", "alibaba"]


@pytest.mark.parametrize("source", SOURCES)
def test_excerpt_das_paginas_reais(source):
    markdown = (FIXTURES / source / "product-01.md").read_text(encoding="utf-8")
    excerpt = build_page_excerpt(markdown, title="Título do anúncio")
    assert excerpt.startswith("Título do anúncio")
    assert len(excerpt) <= 4000
    assert "![" not in excerpt
    assert "](http" not in excerpt


def test_usa_json_ld_e_bloco_de_especificacoes():
    markdown = (
        "# Bike Spinning X\n"
        '```json\n{"@type": "Product", "name": "Bike Spinning X", "brand": {"name": "Marca"}, '
        '"description": "Roda de inércia de 13 kg e resistência magnética."}\n```\n'
        "## Características\n- Roda de inércia: 13 kg\n- Carga máxima: 120 kg\n"
        "## Avaliações\nMuito boa\n"
    )
    excerpt = build_page_excerpt(markdown, title="Bike Spinning X")
    assert "Marca" in excerpt
    assert "Roda de inércia: 13 kg" in excerpt
    assert "Muito boa" not in excerpt


def test_sem_markdown_retorna_so_o_titulo():
    assert build_page_excerpt("", title="Só título") == "Só título"
```
Run: `cd Move-Intelligence-Dados && python3 -m pytest tests/test_page_excerpt.py -q` → FAIL (ImportError).

- [x] **Passo 2: Implementar** — acrescente em `parsers/base.py` (e inclua `"build_page_excerpt"` no `__all__`):
```python
_SPEC_HEADINGS = re.compile(
    r"^(#{1,4})\s*(caracter[ií]sticas|ficha t[eé]cnica|especifica[cç][oõ]es|o que voc[eê] precisa saber|"
    r"specifications|technical details|product details|about this item|参数|规格|产品参数)\b.*$",
    re.IGNORECASE | re.MULTILINE,
)
_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_LINK = re.compile(r"\[([^\]]*)\]\((?:https?:)?//[^)]*\)")


def _clean_markdown(text: str) -> str:
    text = _IMAGE.sub("", text)
    text = _LINK.sub(r"\1", text)
    lines = [line.rstrip() for line in text.splitlines()]
    out: list[str] = []
    for line in lines:
        if not line.strip() and out and not out[-1].strip():
            continue
        out.append(line)
    return "\n".join(out).strip()


def _json_ld_summary(markdown: str) -> str:
    parts: list[str] = []
    for product in extract_json_ld_products(markdown)[:1]:
        brand = product.get("brand")
        brand_name = brand.get("name") if isinstance(brand, Mapping) else brand
        for label, value in (("Nome", product.get("name")), ("Marca", brand_name), ("Modelo", product.get("model"))):
            if value:
                parts.append(f"{label}: {value}")
        props = product.get("additionalProperty")
        if isinstance(props, list):
            for prop in props[:20]:
                if isinstance(prop, Mapping) and prop.get("name") and prop.get("value") is not None:
                    parts.append(f"{prop['name']}: {prop['value']}")
        description = str(product.get("description") or "").strip()
        if description:
            parts.append(description[:800])
    return "\n".join(parts)


def _spec_block(markdown: str) -> str:
    match = _SPEC_HEADINGS.search(markdown)
    if not match:
        return ""
    level = len(match.group(1))
    rest = markdown[match.end():]
    stop = re.search(rf"^#{{1,{level}}}\s", rest, re.MULTILINE)
    return rest[: stop.start()] if stop else rest


def _bullets(markdown: str, limit: int = 15) -> str:
    found = [line.strip() for line in markdown.splitlines() if re.match(r"^\s*[-*•]\s+\S", line)]
    return "\n".join(found[:limit])


def build_page_excerpt(markdown: str, title: Optional[str] = None, limit: int = 4000) -> str:
    """Recorte da página para a ficha (spec 5.1): título → JSON-LD → especificações → bullets."""
    content = fix_mojibake(str(markdown or ""))
    head = (title or extract_title(content) or "").strip()
    if not content.strip():
        return head[:limit]
    sections = [head, _json_ld_summary(content), _clean_markdown(_spec_block(content)), _clean_markdown(_bullets(content))]
    seen: set[str] = set()
    lines: list[str] = []
    for section in sections:
        for line in section.splitlines():
            key = line.strip()
            if key and key not in seen:
                seen.add(key)
                lines.append(line)
    return "\n".join(lines)[:limit]
```
Em `common.py`, dentro de `parse_detail`, logo depois de montar o dicionário `source_specific` (antes do `try:` do parser da fonte):
```python
        from app.etl.extract.marketplace.parsers.base import build_page_excerpt

        source_specific["page_excerpt"] = build_page_excerpt(content, title=str(candidate.get("title") or "") or None)
```

- [x] **Passo 3: Rodar os testes Python**

Run: `python3 -m pytest tests/test_page_excerpt.py -q && python3 tests/run_tests.py`
Esperado: os 7 casos novos passam; o `run_tests.py` continua passando como antes.

- [x] **Passo 4: Revisar o diff (sem commit)**

---

## Tarefa 19: Frontend — contratos, serviço do catálogo, guard ADMIN e formatação do card

**Arquivos:**
- Modificar: `Move-Intelligence-Front/src/app/core/models/contract.models.ts`
- Criar: `Move-Intelligence-Front/src/app/core/services/catalog.service.ts` (+ `catalog.service.spec.ts`)
- Criar: `Move-Intelligence-Front/src/app/core/auth/admin.guard.ts` (+ `admin.guard.spec.ts`)
- Criar: `Move-Intelligence-Front/src/app/shared/util/card-format.ts` (+ `card-format.spec.ts`)
- Modificar: `Move-Intelligence-Front/src/app/shared/util/format.ts` (rótulo da ação `AGUARDANDO_REVISAO`)

**Interfaces:**
- Consome: API das Tarefas 15 e 16 (snake_case → camelCase pelo `ApiClient`).
- Produz (modelos): `CardStatus`, `CardComparison`, `CardListing`, `ReviewCounts`, `ReviewListingItem`, `ReviewTypeItem`, `CatalogFamily` e os campos novos opcionais de `TrendProduct`/`TrendProductDetail`.
- Produz (`CatalogService`): `cardListings(id)`, `searchCards(q)`, `families()`, `reviewCounts()`, `reviewList(kind, page?)`, `confirm(id)`, `move(id, targetClusterId)`, `createCard(id, body)`, `outOfScope(id)`, `approveType(id, body)`, `mergeType(id, typeKey)`, `discardType(id)`, `renameCard(id, name)`, `undo(decisionId)`. Todos retornam `Observable`.
- Produz (`card-format.ts`): `familyTypeText(p: TrendProduct): string | null`, `listingsText(p): string | null`, `priceMedianText(p): string | null`, `priceRangeText(p): string | null`, `comparisonCountText(c): string`.
- Produz: `adminGuard: CanActivateFn`.

- [x] **Passo 1: Modelos** — em `contract.models.ts`, acrescente:
```ts
export type CardStatus = 'legacy' | 'provisional' | 'confirmed' | 'merged';

export interface CardComparison {
  listingCount: number;
  storeCount: number;
  brandCount: number;
  priceMedianBr: number | null;
  priceMinBr: number | null;
  priceMaxBr: number | null;
  ranges: Array<{ attr: string; labelPt: string; unit: string | null; min: number; max: number }>;
  counts: Array<{ attr: string; labelPt: string; total: number; values: Array<{ value: string; count: number }> }>;
  techWarning: string | null;
}

export interface CardListing {
  marketplace: string;
  externalProductId: string;
  title: string;
  url: string | null;
  price: number | null;
  currency: string | null;
  rating: number | null;
  status: 'confirmed' | 'provisional';
  variation: string | null;
  brand: string | null;
}

export interface ReviewCounts { provisionalListing: number; suggestedType: number }

export interface ReviewListingItem {
  id: string;
  kind: 'provisional_listing';
  reason: string;
  marketplace: string;
  externalProductId: string;
  title: string;
  url: string | null;
  price: number | null;
  currency: string | null;
  suggestedCard: { id: string; name: string; category: string | null } | null;
  ficha: { typeKey: string | null; cardKeyValues: Record<string, string>; missingKeyAttrs: string[]; comparisonValues: Record<string, unknown>; brand: string | null } | null;
}

export interface ReviewTypeItem {
  id: string;
  kind: 'suggested_type';
  reason: string;
  suggestedTypeKey: string;
  aliases: string[];
  listingCount: number;
  samples: Array<{ title: string; marketplace: string }>;
  similarTypes: Array<{ key: string; namePt: string }>;
}

export interface CatalogFamily { key: string; namePt: string }
```
Em `interface TrendProduct`, acrescente (opcionais, no fim):
```ts
  /** Catálogo (subprojeto A): o cluster é o card. */
  cardStatus?: CardStatus | null;
  familyName?: string | null;
  typeName?: string | null;
  cardChips?: string[];
  listingCount?: number | null;
  storeCount?: number | null;
  brandCount?: number | null;
  priceMedianBr?: number | null;
  priceMinBr?: number | null;
  priceMaxBr?: number | null;
```
Em `interface TrendProductDetail`, acrescente: `comparison?: CardComparison | null;` e `mergedIntoId?: string;`.

- [x] **Passo 2: Rótulo da ação** — em `shared/util/format.ts`, no mapa usado por `actionLabel` (onde estão `DECIDIR_AGORA`, `NEGOCIAR_CUSTO`…), acrescente `AGUARDANDO_REVISAO: 'Aguardando revisão',`. No mapa de textos longos da ação (onde `DECIDIR_AGORA` tem a frase "Tendência em alta…"), acrescente `AGUARDANDO_REVISAO: 'Card provisório: falta confirmar a classificação na fila de revisão.',`.

- [x] **Passo 3: Teste que falha** — `shared/util/card-format.spec.ts`:
```ts
import { comparisonCountText, familyTypeText, listingsText, priceMedianText, priceRangeText } from './card-format';
import { TrendProduct } from '../../core/models/contract.models';

const p = (extra: Partial<TrendProduct>) => ({ canonicalName: 'X', ...extra }) as TrendProduct;

describe('card-format', () => {
  it('família › tipo', () => {
    expect(familyTypeText(p({ familyName: 'Bikes spinning', typeName: 'Bike spinning' }))).toBe('Bikes spinning › Bike spinning');
    expect(familyTypeText(p({}))).toBeNull();
  });

  it('anúncios e lojas', () => {
    expect(listingsText(p({ listingCount: 9, storeCount: 4 }))).toBe('9 anúncios em 4 lojas');
    expect(listingsText(p({ listingCount: 1, storeCount: 1 }))).toBe('1 anúncio em 1 loja');
    expect(listingsText(p({}))).toBeNull();
  });

  it('preço de venda BR', () => {
    expect(priceMedianText(p({ priceMedianBr: 1460 }))).toBe('~R$ 1.460');
    expect(priceRangeText(p({ priceMinBr: 1390, priceMaxBr: 1520 }))).toBe('R$ 1.390–1.520');
    expect(priceRangeText(p({ priceMinBr: 1390, priceMaxBr: 1390 }))).toBeNull();
  });

  it('contagem da comparação', () => {
    expect(comparisonCountText({ attr: 'com_app', labelPt: 'com app', total: 9, values: [{ value: 'false', count: 5 }, { value: 'true', count: 4 }] }))
      .toBe('com app: 4 de 9');
    expect(comparisonCountText({ attr: 'revestimento', labelPt: 'revestimento', total: 3, values: [{ value: 'pvc', count: 2 }, { value: 'borracha', count: 1 }] }))
      .toBe('revestimento: pvc (2), borracha (1)');
  });
});
```
Run: `cd Move-Intelligence-Front && npx ng test --watch=false --include=src/app/shared/util/card-format.spec.ts` → FAIL.

- [x] **Passo 4: Implementar `card-format.ts`**
```ts
import { CardComparison, TrendProduct } from '../../core/models/contract.models';

const brl = (value: number) => Math.round(value).toLocaleString('pt-BR');

export function familyTypeText(p: TrendProduct): string | null {
  return p.familyName && p.typeName ? `${p.familyName} › ${p.typeName}` : null;
}

export function listingsText(p: TrendProduct): string | null {
  if (p.listingCount === null || p.listingCount === undefined) return null;
  const n = p.listingCount;
  const s = p.storeCount ?? 0;
  return `${n} ${n === 1 ? 'anúncio' : 'anúncios'} em ${s} ${s === 1 ? 'loja' : 'lojas'}`;
}

export function priceMedianText(p: TrendProduct): string | null {
  return p.priceMedianBr === null || p.priceMedianBr === undefined ? null : `~R$ ${brl(p.priceMedianBr)}`;
}

export function priceRangeText(p: TrendProduct): string | null {
  if (p.priceMinBr == null || p.priceMaxBr == null || p.priceMinBr === p.priceMaxBr) return null;
  return `R$ ${brl(p.priceMinBr)}–${brl(p.priceMaxBr)}`;
}

export function comparisonCountText(c: CardComparison['counts'][number]): string {
  const yes = c.values.find((v) => v.value === 'true');
  const isBoolean = c.values.every((v) => v.value === 'true' || v.value === 'false');
  if (isBoolean) return `${c.labelPt}: ${yes?.count ?? 0} de ${c.total}`;
  const parts = [...c.values].sort((a, b) => b.count - a.count).map((v) => `${v.value.replace(/_/g, ' ')} (${v.count})`);
  return `${c.labelPt}: ${parts.join(', ')}`;
}
```
Run → PASS.

- [x] **Passo 5: `CatalogService`**
```ts
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { CardListing, CatalogFamily, ReviewCounts, ReviewListingItem, ReviewTypeItem } from '../models/contract.models';

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly api = inject(ApiClient);

  cardListings(id: string): Observable<CardListing[]> {
    return this.api.get<CardListing[]>(`/catalog/cards/${id}/listings`);
  }
  searchCards(q: string): Observable<Array<{ id: string; name: string; category: string | null; cardStatus: string }>> {
    return this.api.get('/catalog/cards', { q });
  }
  families(): Observable<CatalogFamily[]> {
    return this.api.get<CatalogFamily[]>('/catalog/families');
  }
  reviewCounts(): Observable<ReviewCounts> {
    return this.api.get<ReviewCounts>('/catalog/review/counts');
  }
  reviewList(kind: 'provisional_listing', page?: number): Observable<{ total: number; items: ReviewListingItem[] }>;
  reviewList(kind: 'suggested_type', page?: number): Observable<{ total: number; items: ReviewTypeItem[] }>;
  reviewList(kind: string, page = 1): Observable<{ total: number; items: unknown[] }> {
    return this.api.get('/catalog/review', { kind, page, page_size: 20 });
  }
  confirm(id: string) { return this.api.post<{ decisionId: string }>(`/catalog/review/${id}/confirm`, {}); }
  move(id: string, targetClusterId: string) { return this.api.post<{ decisionId: string }>(`/catalog/review/${id}/move`, { targetClusterId }); }
  createCard(id: string, body: { typeKey: string; cardKeyValues: Record<string, string>; name?: string }) {
    return this.api.post<{ decisionId: string; clusterId: string }>(`/catalog/review/${id}/create-card`, body);
  }
  outOfScope(id: string) { return this.api.post<{ decisionId: string }>(`/catalog/review/${id}/out-of-scope`, {}); }
  approveType(id: string, body: { familyKey: string; key: string; namePt: string; ncm?: string }) {
    return this.api.post<{ decisionId: string; typeId: string }>(`/catalog/types/suggestions/${id}/approve`, body);
  }
  mergeType(id: string, typeKey: string) { return this.api.post<{ decisionId: string; requeued: number }>(`/catalog/types/suggestions/${id}/merge`, { typeKey }); }
  discardType(id: string) { return this.api.post<{ decisionId: string }>(`/catalog/types/suggestions/${id}/discard`, {}); }
  renameCard(id: string, name: string) { return this.api.patch<{ decisionId: string }>(`/catalog/cards/${id}`, { name }); }
  undo(decisionId: string) { return this.api.post<{ decisionId: string }>(`/catalog/decisions/${decisionId}/undo`, {}); }
}
```
Teste `catalog.service.spec.ts` (siga o padrão com `HttpTestingController` já usado em `auth.interceptor.spec.ts`): verifique que `confirm('r1')` faz `POST {apiBaseUrl}/catalog/review/r1/confirm`, que `reviewList('suggested_type')` faz `GET` com `kind=suggested_type&page=1&page_size=20`, e que `renameCard('c1','N')` faz `PATCH` com corpo `{ name: 'N' }`.

- [x] **Passo 6: Guard de rota ADMIN** — `core/auth/admin.guard.ts`:
```ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from './auth.service';

/** Só ADMIN acessa (fila de revisão). Sem sessão/usuário carregado, tenta loadMe antes de decidir. */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const home = router.createUrlTree(['/']);
  const user = auth.currentUser();
  if (user) return user.role === 'ADMIN' ? true : home;
  if (!auth.hasStoredSession()) return router.createUrlTree(['/login']);
  return auth.loadMe().pipe(
    map((loaded) => (loaded?.role === 'ADMIN' ? true : home)),
    catchError(() => of(home)),
  );
};
```
`admin.guard.spec.ts` (mesmo padrão de `auth.guard.spec.ts`): com `auth.currentUser.set({ ..., role: 'ADMIN' })` o guard retorna `true`; com `role: 'USER'` retorna `UrlTree` para `/`. Confira em `auth.service.ts` que `loadMe()` emite o usuário (ele faz `tap(user => this.currentUser.set(user))`); se emitir outro formato, ajuste o `map`.

- [x] **Passo 7: Rodar os testes do frontend tocados**

Run: `npx ng test --watch=false --include=src/app/shared/util/card-format.spec.ts --include=src/app/core/services/catalog.service.spec.ts --include=src/app/core/auth/admin.guard.spec.ts`
Esperado: PASS.

- [x] **Passo 8: Revisar o diff (sem commit)**

---

## Tarefa 20: Ranking — tabela e grade mostram o card

**Arquivos:**
- Modificar: `Move-Intelligence-Front/src/app/features/ranking/ranking.component.html`, `.ts`, `.css`
- Modificar: `Move-Intelligence-Front/src/app/shared/components/intel/trend-card/trend-card.component.html`, `.ts`, `.css`

**Interfaces:**
- Consome: campos novos de `TrendProduct` e `card-format.ts` (Tarefa 19).
- Visual aprovado: `.superpowers/brainstorm/71169-1789743526/content/ranking-hoje-vs-depois.html` (lado "DEPOIS"). A troca tabela/grade existente continua.

- [x] **Passo 1: Tabela** — em `ranking.component.html`:
  - célula do produto:
```html
                <td class="product">
                  <strong>{{ product.canonicalName }}</strong>
                  @if (product.cardStatus === 'provisional') {
                    <span class="provisional-badge">Provisório</span>
                  }
                  <span>{{ familyType(product) ?? ((product.category | humanize) || 'Categoria não informada') }}</span>
                </td>
```
  - célula de preço (troque `{{ priceText(product) }}`):
```html
                <td class="num nowrap">
                  {{ priceText(product) }}
                  @if (priceRange(product); as range) { <span class="sub">{{ range }}</span> }
                </td>
```
  - cabeçalho `Fornecedor` → `Anúncios`; célula `{{ supplierText(product) }}` → `{{ listings(product) ?? supplierText(product) }}`.
- Em `ranking.component.ts`:
  - importe `familyTypeText`, `listingsText`, `priceMedianText` e `priceRangeText` de `../../shared/util/card-format`;
  - acrescente os métodos:
```ts
  familyType(product: TrendProduct): string | null { return familyTypeText(product); }
  listings(product: TrendProduct): string | null { return listingsText(product); }
  priceRange(product: TrendProduct): string | null { return priceRangeText(product); }
```
  - troque o corpo de `priceText` por: `return priceMedianText(product) ?? (product.price === null || product.price === undefined ? '—' : formatBRL(product.price));`
  - no início de `confidenceLabel(product)`, acrescente: `if (product.cardStatus === 'provisional') return 'Aguardando revisão';`.
- Em `ranking.component.css`, acrescente:
```css
.provisional-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--warning-bg, #f5c26b);
  color: var(--warning-fg, #1a1a1a);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
}
td .sub { display: block; font-size: 11px; opacity: 0.7; }
```

- [x] **Passo 2: Grade (`trend-card`)**
- `trend-card.component.html`:
  - troque `<span class="cat">{{ (trend().category | humanize) || 'Categoria não informada' }}</span>` por `<span class="cat">{{ familyType() ?? ((trend().category | humanize) || 'Categoria não informada') }}</span>`;
  - logo após o `<h3 class="name" …>`, acrescente `@if (trend().cardStatus === 'provisional') { <span class="provisional-badge">Provisório</span> }`;
  - dentro de `.foot`, antes de `<app-risk-badge…>`, acrescente `@if (listings(); as l) { <span class="listings">{{ l }}</span> }`.
- `trend-card.component.ts`: acrescente
```ts
  readonly familyType = computed(() => familyTypeText(this.trend()));
  readonly listings = computed(() => listingsText(this.trend()));
```
  (importe de `../../../util/card-format`; confira o caminho relativo a partir de `shared/components/intel/trend-card/`: `../../../util/card-format`).
- `trend-card.component.css`: copie o bloco `.provisional-badge` do Passo 1 e acrescente `.listings { font-size: 12px; opacity: 0.8; }`.
- Se `scoreConfidence()` exibir texto quando `moveScore` é nulo, faça-o devolver `'Aguardando revisão'` quando `trend().cardStatus === 'provisional'`.

- [x] **Passo 3: Build e conferência visual**

Run: `npx ng build` (ou o comando de build do `package.json`) → sem erros.
Suba o frontend local e abra `/ranking` nas duas visualizações. Enquanto os dados ainda são `legacy`, o ranking deve parecer igual ao de hoje (sem chips nem selo, com categoria antiga e fornecedor antigo). Depois do reprocessamento (Tarefa 23), deve ficar como o lado "DEPOIS" do rascunho.

- [x] **Passo 4: Revisar o diff (sem commit)**

---

## Tarefa 21: Página do produto — topo, comparação, aba "Anúncios", renomear e redirecionar

**Arquivos:**
- Criar: `Move-Intelligence-Front/src/app/shared/components/intel/card-listings-table/card-listings-table.component.ts` (+ `.html`, `.css`, `.spec.ts`)
- Modificar: `Move-Intelligence-Front/src/app/features/tendencia/tendencia.component.ts`, `.html`, `.css`

**Interfaces:**
- Consome: `CatalogService.cardListings` e `renameCard`, `AuthService.currentUser`, `comparisonCountText` e `listingsText` (Tarefa 19), `detail.comparison`, `detail.mergedIntoId` (Tarefa 16).
- Visual aprovado: `.superpowers/brainstorm/71169-1789743526/content/pagina-produto-hoje-vs-depois.html` (lado "DEPOIS").

- [x] **Passo 1: `card-listings-table` (teste primeiro)**

`card-listings-table.component.spec.ts`:
```ts
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CatalogService } from '../../../../core/services/catalog.service';
import { CardListingsTableComponent } from './card-listings-table.component';

describe('CardListingsTableComponent', () => {
  it('lista anúncios com variação e status', () => {
    TestBed.configureTestingModule({
      imports: [CardListingsTableComponent],
      providers: [{ provide: CatalogService, useValue: { cardListings: () => of([
        { marketplace: 'mercado_livre', externalProductId: 'A', title: 'Bike 13kg', url: 'https://x', price: 1520, currency: 'BRL',
          rating: 4.6, status: 'confirmed', variation: 'cor: preto', brand: null },
        { marketplace: 'alibaba', externalProductId: 'B', title: 'Spin bike', url: null, price: 90, currency: 'USD',
          rating: null, status: 'provisional', variation: null, brand: null },
      ]) } }],
    });
    const fixture = TestBed.createComponent(CardListingsTableComponent);
    fixture.componentRef.setInput('productClusterId', 'c1');
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Bike 13kg');
    expect(text).toContain('cor: preto');
    expect(text).toContain('provisório');
    expect(text).toContain('confirmado');
  });
});
```
`card-listings-table.component.ts`:
```ts
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { toAsyncState } from '../../../../core/api/async-state';
import { CatalogService } from '../../../../core/services/catalog.service';
import { CardListing } from '../../../../core/models/contract.models';
import { StatePanelComponent } from '../../../ui/state-panel/state-panel.component';
import { sourceLabel } from '../../../util/format';

@Component({
  selector: 'app-card-listings-table',
  standalone: true,
  imports: [StatePanelComponent],
  templateUrl: './card-listings-table.component.html',
  styleUrl: './card-listings-table.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardListingsTableComponent {
  private readonly catalog = inject(CatalogService);
  readonly productClusterId = input.required<string>();
  readonly listings = toAsyncState(
    toObservable(this.productClusterId).pipe(switchMap((id) => this.catalog.cardListings(id))),
  );

  store(l: CardListing): string { return sourceLabel(l.marketplace) || l.marketplace; }
  price(l: CardListing): string {
    return l.price === null ? '—' : `${l.currency === 'BRL' ? 'R$' : (l.currency ?? '')} ${l.price.toLocaleString('pt-BR')}`.trim();
  }
}
```
Confira a assinatura de `toAsyncState` em `core/api/async-state.ts` (a `tendencia` usa `toAsyncState(observable)`) e o formato do estado (`$any(state()).data`). Siga exatamente o mesmo uso.

`card-listings-table.component.html`:
```html
<section class="card-listings">
  <h3>Anúncios deste card</h3>
  @if ($any(listings()).data; as rows) {
    <table>
      <thead><tr><th>Anúncio</th><th>Loja</th><th>Variação</th><th>Preço</th><th>Nota</th><th>Status</th></tr></thead>
      <tbody>
        @for (l of $any(rows); track l.marketplace + l.externalProductId) {
          <tr>
            <td>@if (l.url) { <a [href]="l.url" target="_blank" rel="noopener">{{ l.title }}</a> } @else { {{ l.title }} }</td>
            <td>{{ store(l) }}</td>
            <td>{{ l.variation ?? '—' }}</td>
            <td class="num">{{ price(l) }}</td>
            <td class="num">{{ l.rating ?? '—' }}</td>
            <td><span class="status" [attr.data-status]="l.status">{{ l.status === 'provisional' ? 'provisório' : 'confirmado' }}</span></td>
          </tr>
        }
      </tbody>
    </table>
  } @else {
    <app-state-panel [state]="listings()" emptyMessage="Nenhum anúncio neste card ainda." />
  }
</section>
```
`card-listings-table.component.css`:
```css
.card-listings { margin-bottom: 16px; overflow-x: auto; }
.card-listings table { width: 100%; border-collapse: collapse; font-size: 13px; }
.card-listings th, .card-listings td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border, #e5e7eb); }
.status[data-status='provisional'] { background: var(--warning-bg, #f5c26b); color: var(--warning-fg, #1a1a1a); border-radius: 4px; padding: 0 5px; }
```
Run: `npx ng test --watch=false --include=src/app/shared/components/intel/card-listings-table/card-listings-table.component.spec.ts` → PASS.

- [x] **Passo 2: `tendencia.component.ts`**
- Importe `effect` de `@angular/core`, `AuthService` (`../../core/auth/auth.service`), `CatalogService`, `CardListingsTableComponent` (inclua no array `imports` do componente) e `comparisonCountText`/`listingsText` (`../../shared/util/card-format`).
- Na lista `tabs`, troque `{ id: 'competitors', label: 'Concorrência' }` por `{ id: 'competitors', label: 'Anúncios' }` (**mantenha o id**, para não quebrar links).
- Acrescente à classe:
```ts
  private readonly auth = inject(AuthService);
  private readonly catalog = inject(CatalogService);
  readonly isAdmin = computed(() => this.auth.currentUser()?.role === 'ADMIN');
  readonly countText = comparisonCountText;
  readonly listingsText = listingsText;

  private readonly redirectMerged = effect(() => {
    const target = ($any(this.product()) as { data?: { mergedIntoId?: string } })?.data?.mergedIntoId;
    if (target) window.location.replace(`/tendencia/${target}`);
  });

  rename(currentName: string): void {
    const name = window.prompt('Novo nome do card', currentName)?.trim();
    if (!name || name === currentName || name.length < 3) return;
    this.catalog.renameCard(this.id, name).subscribe({ next: () => window.location.reload() });
  }
```
  `$any` não existe em TypeScript de classe: use `(this.product() as unknown as { data?: { mergedIntoId?: string } })`.

- [x] **Passo 3: `tendencia.component.html`**
- Dentro de `<div class="hero-main">`, **antes** de `<div class="action-line" …>`, acrescente:
```html
        @if ($any(product()).data.familyName) {
          <div class="card-type">{{ $any(product()).data.familyName }} › {{ $any(product()).data.typeName }}</div>
        }
        @if ($any(product()).data.cardStatus === 'provisional') {
          <span class="provisional-badge">Provisório</span>
        }
        @if ($any(product()).data.cardChips?.length) {
          <div class="card-chips">
            @for (chip of $any(product()).data.cardChips; track chip) { <span class="chip">{{ chip }}</span> }
          </div>
        }
```
- Em `<div class="metric-strip">`, troque o bloco "Fontes principais" por:
```html
          <div>
            <span>Anúncios</span>
            <strong class="num">{{ listingsText($any(product()).data) ?? ($any(product()).data.mainSources?.length ?? '—') }}</strong>
          </div>
          <div>
            <span>Marcas</span>
            <strong class="num">{{ $any(product()).data.brandCount ?? '—' }}</strong>
          </div>
```
- Logo depois do bloco `@if ($any(product()).data.spark?.length) { … }` (ainda dentro de `.hero-main`), acrescente:
```html
        @if ($any(product()).data.comparison; as cmp) {
          <div class="card-comparison">
            <strong>Comparação dentro do card</strong>
            <div class="cmp-lines">
              @for (r of cmp.ranges; track r.attr) {
                <span>{{ r.labelPt }}: {{ r.min }}–{{ r.max }} {{ r.unit ?? '' }}</span>
              }
              @for (c of cmp.counts; track c.attr) {
                <span>{{ countText(c) }}</span>
              }
            </div>
            @if (cmp.techWarning) {
              <p class="tech-warning">{{ cmp.techWarning }}</p>
            }
          </div>
        }
```
- Nas ações do `app-page-header` (onde estão "Dossiê PDF" e "Exportar CSV"), acrescente:
```html
        @if (isAdmin()) {
          <button type="button" class="ghost" (click)="rename($any(product()).data.canonicalName)">
            <app-icon name="edit" [size]="16" /> Renomear card
          </button>
        }
```
  Use o mesmo elemento ou classe de botão dos outros dois. Se o ícone `edit` não existir no `IconComponent`, use um que exista.
- Na seção da aba `competitors` (onde está `<app-competitor-matrix [productClusterId]="id" />`), acrescente **antes** da matriz: `<app-card-listings-table [productClusterId]="id" />`.
- `tendencia.component.css`: acrescente estilos para `.card-type` (fonte pequena, opaca), `.card-chips .chip` (borda arredondada, padding 1px 7px), `.card-comparison` (fundo `var(--surface-2, #f3f4f6)`, raio 6px, padding 6px 8px, margem superior 8px), `.cmp-lines span:not(:last-child)::after { content: ' · '; }`, `.tech-warning` (cor de alerta, `var(--warning-fg, #b7791f)`) e copie `.provisional-badge` da Tarefa 20.

- [x] **Passo 4: Build e conferência visual**

Run: `npx ng build` → sem erros. Abra `/tendencia/<id>` de um card reprocessado e compare com o rascunho aprovado. Abra também o id de um cluster `merged` e confirme o redirecionamento para o card novo.

- [x] **Passo 5: Revisar o diff (sem commit)**

---

## Tarefa 22: Página "Revisão" (ADMIN), rota e item de menu

**Arquivos:**
- Modificar: `Move-Intelligence-Back/src/modules/catalog/catalog-review.controller.ts` e `catalog-review.service.ts` (rota `GET /catalog/families`)
- Criar: `Move-Intelligence-Front/src/app/features/revisao/revisao.component.ts` (+ `.html`, `.css`, `.spec.ts`)
- Modificar: `Move-Intelligence-Front/src/app/app.routes.ts`
- Modificar: `Move-Intelligence-Front/src/app/shared/layout/app-sidebar/app-sidebar.component.ts` e `.html`

**Interfaces:**
- Consome: `CatalogService` e `adminGuard` (Tarefa 19).
- Visual aprovado: `.superpowers/brainstorm/71169-1789743526/content/fila-revisao.html`.
- Backend novo: `CatalogReviewService.families(): Promise<Array<{ key: string; name_pt: string }>>` e `@Get('families')` no `CatalogReviewController` (já protegido por `AdminGuard`).

- [x] **Passo 1: Backend — famílias**

Em `catalog-review.service.ts`:
```ts
  async families() {
    const rows = await this.prisma.catalogFamily.findMany({ orderBy: { sortOrder: 'asc' }, select: { key: true, namePt: true } });
    return rows.map((r) => ({ key: r.key, name_pt: r.namePt }));
  }
```
Em `catalog-review.controller.ts`:
```ts
  @Get('families')
  families() {
    return this.review.families();
  }
```
Run: `cd Move-Intelligence-Back && npx tsc -p tsconfig.build.json --noEmit` → sem erros.

- [x] **Passo 2: Teste da página (falha primeiro)** — `features/revisao/revisao.component.spec.ts`:
```ts
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { CatalogService } from '../../core/services/catalog.service';
import { RevisaoComponent } from './revisao.component';

describe('RevisaoComponent', () => {
  const catalog = {
    reviewCounts: vi.fn().mockReturnValue(of({ provisionalListing: 1, suggestedType: 0 })),
    reviewList: vi.fn().mockReturnValue(of({ total: 1, items: [{
      id: 'r1', kind: 'provisional_listing', reason: 'falta a especificação: resistência', marketplace: 'alibaba',
      externalProductId: 'X', title: 'Bicicleta Spinning Compacta', url: null, price: 1390, currency: 'BRL',
      suggestedCard: { id: 'c1', name: 'Bike spinning magnética', category: 'spinning_bike' },
      ficha: { typeKey: 'spin_bike', cardKeyValues: {}, missingKeyAttrs: ['resistencia'], comparisonValues: {}, brand: null },
    }] })),
    families: vi.fn().mockReturnValue(of([])),
    confirm: vi.fn().mockReturnValue(of({ decisionId: 'd1' })),
  };

  it('mostra o item e confirma pelo botão', () => {
    TestBed.configureTestingModule({ imports: [RevisaoComponent], providers: [{ provide: CatalogService, useValue: catalog }] });
    const fixture = TestBed.createComponent(RevisaoComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Bicicleta Spinning Compacta');
    expect(el.textContent).toContain('falta a especificação: resistência');
    (el.querySelector('[data-action="confirm"]') as HTMLButtonElement).click();
    expect(catalog.confirm).toHaveBeenCalledWith('r1');
  });
});
```
O frontend usa **vitest** (`import { vi } from 'vitest'`, como em `auth.guard.spec.ts`).
Run: `npx ng test --watch=false --include=src/app/features/revisao/revisao.component.spec.ts` → FAIL.

- [x] **Passo 3: `revisao.component.ts`**
```ts
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CatalogService } from '../../core/services/catalog.service';
import { CatalogFamily, ReviewCounts, ReviewListingItem, ReviewTypeItem } from '../../core/models/contract.models';
import { PageHeaderComponent } from '../../shared/ui/page-header/page-header.component';
import { sourceLabel } from '../../shared/util/format';

type Tab = 'provisional_listing' | 'suggested_type';

@Component({
  selector: 'app-revisao',
  standalone: true,
  imports: [FormsModule, PageHeaderComponent],
  templateUrl: './revisao.component.html',
  styleUrl: './revisao.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RevisaoComponent {
  private readonly catalog = inject(CatalogService);

  readonly tab = signal<Tab>('provisional_listing');
  readonly counts = signal<ReviewCounts>({ provisionalListing: 0, suggestedType: 0 });
  readonly listingItems = signal<ReviewListingItem[]>([]);
  readonly typeItems = signal<ReviewTypeItem[]>([]);
  readonly families = signal<CatalogFamily[]>([]);
  readonly message = signal<string | null>(null);
  readonly lastDecisionId = signal<string | null>(null);
  readonly moveFor = signal<string | null>(null);
  readonly moveResults = signal<Array<{ id: string; name: string }>>([]);
  readonly approveFor = signal<string | null>(null);
  approveForm = { familyKey: '', key: '', namePt: '', ncm: '' };
  moveQuery = '';
  readonly sourceLabel = sourceLabel;

  constructor() {
    this.reload();
    this.catalog.families().subscribe((f) => this.families.set(f));
  }

  setTab(tab: Tab): void {
    this.tab.set(tab);
    this.reload();
  }

  reload(): void {
    this.catalog.reviewCounts().subscribe((c) => this.counts.set(c));
    if (this.tab() === 'provisional_listing') {
      this.catalog.reviewList('provisional_listing').subscribe((r) => this.listingItems.set(r.items));
    } else {
      this.catalog.reviewList('suggested_type').subscribe((r) => this.typeItems.set(r.items));
    }
  }

  private done(text: string) {
    return {
      next: (r: { decisionId: string }) => {
        this.message.set(text);
        this.lastDecisionId.set(r.decisionId);
        this.moveFor.set(null);
        this.approveFor.set(null);
        this.reload();
      },
      error: (e: { error?: { message?: string } }) => this.message.set(e?.error?.message ?? 'Não foi possível concluir a ação.'),
    };
  }

  confirm(item: ReviewListingItem): void { this.catalog.confirm(item.id).subscribe(this.done('Anúncio confirmado no card.')); }
  outOfScope(item: ReviewListingItem): void { this.catalog.outOfScope(item.id).subscribe(this.done('Anúncio marcado como fora do escopo.')); }
  createCard(item: ReviewListingItem): void {
    if (!item.ficha?.typeKey) return;
    const name = window.prompt('Nome do card novo (deixe vazio para montar automaticamente)')?.trim() || undefined;
    this.catalog.createCard(item.id, { typeKey: item.ficha.typeKey, cardKeyValues: item.ficha.cardKeyValues, name })
      .subscribe(this.done('Card novo criado.'));
  }
  openMove(item: ReviewListingItem): void { this.moveFor.set(item.id); this.moveQuery = ''; this.moveResults.set([]); }
  searchMove(): void {
    if (this.moveQuery.trim().length < 2) return;
    this.catalog.searchCards(this.moveQuery).subscribe((r) => this.moveResults.set(r.map((c) => ({ id: c.id, name: c.name }))));
  }
  move(item: ReviewListingItem, targetId: string): void { this.catalog.move(item.id, targetId).subscribe(this.done('Anúncio movido.')); }

  openApprove(item: ReviewTypeItem): void {
    this.approveFor.set(item.id);
    this.approveForm = { familyKey: this.families()[0]?.key ?? '', key: item.suggestedTypeKey, namePt: '', ncm: '' };
  }
  approve(item: ReviewTypeItem): void {
    const { familyKey, key, namePt, ncm } = this.approveForm;
    if (!familyKey || !key || namePt.trim().length < 2) { this.message.set('Preencha família, chave e nome.'); return; }
    this.catalog.approveType(item.id, { familyKey, key, namePt: namePt.trim(), ...(ncm.trim() ? { ncm: ncm.trim() } : {}) })
      .subscribe(this.done('Tipo aprovado.'));
  }
  merge(item: ReviewTypeItem): void {
    const typeKey = window.prompt('Juntar com qual tipo existente? (chave, ex.: power_rack)', item.similarTypes[0]?.key ?? '')?.trim();
    if (!typeKey) return;
    this.catalog.mergeType(item.id, typeKey).subscribe(this.done('Anúncios devolvidos para a fila da ficha.'));
  }
  discard(item: ReviewTypeItem): void { this.catalog.discardType(item.id).subscribe(this.done('Tipo descartado.')); }
  undo(): void {
    const id = this.lastDecisionId();
    if (id) this.catalog.undo(id).subscribe(this.done('Decisão desfeita.'));
  }
}
```

- [x] **Passo 4: `revisao.component.html`** (segue o rascunho `fila-revisao.html`)
```html
<app-page-header title="Revisão do catálogo" />
<div class="review-tabs">
  <button type="button" [class.active]="tab() === 'provisional_listing'" (click)="setTab('provisional_listing')">
    Anúncios provisórios ({{ counts().provisionalListing }})
  </button>
  <button type="button" [class.active]="tab() === 'suggested_type'" (click)="setTab('suggested_type')">
    Tipos novos sugeridos ({{ counts().suggestedType }})
  </button>
</div>

@if (message()) {
  <div class="review-message">
    {{ message() }}
    @if (lastDecisionId()) { <button type="button" class="link" (click)="undo()">Desfazer</button> }
  </div>
}

@if (tab() === 'provisional_listing') {
  @for (item of listingItems(); track item.id) {
    <article class="review-item">
      <strong>{{ item.title }}</strong>
      <span class="meta">{{ sourceLabel(item.marketplace) || item.marketplace }}@if (item.price !== null) { · {{ item.currency === 'BRL' ? 'R$' : item.currency }} {{ item.price }} }
        @if (item.url) { · <a [href]="item.url" target="_blank" rel="noopener">abrir anúncio</a> }</span>
      @if (item.suggestedCard) { <div>Card sugerido: <b>{{ item.suggestedCard.name }}</b></div> }
      <div class="reason">Motivo: {{ item.reason }}</div>
      <div class="actions">
        @if (item.suggestedCard) { <button type="button" data-action="confirm" (click)="confirm(item)">✓ Confirmar neste card</button> }
        <button type="button" data-action="move" (click)="openMove(item)">Mover para outro card…</button>
        @if (item.ficha?.typeKey && item.ficha?.typeKey !== 'unknown') { <button type="button" data-action="create" (click)="createCard(item)">Criar card novo</button> }
        <button type="button" data-action="out" (click)="outOfScope(item)">Fora do escopo</button>
      </div>
      @if (moveFor() === item.id) {
        <div class="move-box">
          <input [(ngModel)]="moveQuery" placeholder="Buscar card pelo nome" (keyup.enter)="searchMove()" />
          <button type="button" (click)="searchMove()">Buscar</button>
          @for (card of moveResults(); track card.id) {
            <button type="button" class="result" (click)="move(item, card.id)">{{ card.name }}</button>
          }
        </div>
      }
    </article>
  } @empty {
    <p class="empty">Nenhum anúncio aguardando revisão.</p>
  }
} @else {
  @for (item of typeItems(); track item.id) {
    <article class="review-item">
      <strong>{{ item.suggestedTypeKey }}</strong> <span class="meta">sugerido {{ item.listingCount }}×</span>
      @if (item.aliases.length > 1) { <div class="meta">também chamado de: {{ item.aliases.join(', ') }}</div> }
      @if (item.similarTypes.length) { <div class="meta">parecido com: {{ item.similarTypes[0].key }} ({{ item.similarTypes[0].namePt }})</div> }
      @for (s of item.samples; track s.title) { <div class="sample">• {{ s.title }}</div> }
      <div class="actions">
        <button type="button" (click)="openApprove(item)">Aprovar tipo</button>
        <button type="button" (click)="merge(item)">Juntar com tipo existente…</button>
        <button type="button" (click)="discard(item)">Descartar</button>
      </div>
      @if (approveFor() === item.id) {
        <div class="approve-box">
          <label>Família
            <select [(ngModel)]="approveForm.familyKey">
              @for (f of families(); track f.key) { <option [value]="f.key">{{ f.namePt }}</option> }
            </select>
          </label>
          <label>Chave <input [(ngModel)]="approveForm.key" /></label>
          <label>Nome em português <input [(ngModel)]="approveForm.namePt" /></label>
          <label>NCM (opcional) <input [(ngModel)]="approveForm.ncm" placeholder="9506.91.00" /></label>
          <button type="button" (click)="approve(item)">Salvar tipo</button>
        </div>
      }
    </article>
  } @empty {
    <p class="empty">Nenhum tipo novo sugerido.</p>
  }
}
```
`revisao.component.css`: estilos simples. `.review-tabs button.active` com borda inferior; `.review-item` com borda de 1px, raio 8px, padding 10px e margem inferior 8px; `.reason` com cor de alerta; `.actions` como flex com gap 6px e quebra de linha; `.move-box` e `.approve-box` como flex com gap 6px e quebra de linha.

- [x] **Passo 5: Rota e menu**

Em `app.routes.ts`, antes da rota `'**'`:
```ts
  {
    path: 'revisao',
    loadComponent: () => import('./features/revisao/revisao.component').then((m) => m.RevisaoComponent),
    canActivate: [authGuard, adminGuard],
  },
```
(importe `adminGuard` de `./core/auth/admin.guard`).

Em `app-sidebar.component.ts`:
- injete `AuthService` e `CatalogService`;
- crie `readonly reviewCount = signal<number | null>(null);`;
- no construtor, se `currentUser()?.role === 'ADMIN'`, chame `reviewCounts()` e guarde a soma dos dois contadores;
- crie:
```ts
  readonly visibleGroups = computed<NavGroup[]>(() => {
    if (this.auth.currentUser()?.role !== 'ADMIN') return this.groups;
    const count = this.reviewCount();
    return [...this.groups, {
      label: 'Administrar',
      items: [{ path: '/revisao', label: count ? `Revisão (${count})` : 'Revisão', icon: 'bell', synonyms: 'catálogo revisão admin' }],
    }];
  });
```
Ajuste o objeto do item aos campos obrigatórios de `NavItem`: se `image` for obrigatório, reutilize o ícone de outro item. No `.html`, troque o laço `@for (group of groups; …)` por `@for (group of visibleGroups(); …)`.

- [x] **Passo 6: Testes e build**

Run: `npx ng test --watch=false --include=src/app/features/revisao/revisao.component.spec.ts && npx ng build`
Esperado: PASS e build sem erros. Com um usuário USER, o menu "Administrar" não aparece e `/revisao` redireciona para `/`.

- [x] **Passo 7: Revisar o diff (sem commit)**

---

## Tarefa 23: Implantação local ponta a ponta e verificação final

Esta tarefa não escreve código. Ela executa o roteiro da spec (seção 10) **no ambiente local** e confere os critérios de aceite (seção 12). **Produção fica para o usuário**: não rode nada contra a EC2.

- [x] **Passo 1: Suítes completas**

```bash
cd /Users/raul/Desktop/Move-All/Move-Intelligence-Back && npx tsc -p tsconfig.build.json --noEmit && npx jest 2>&1 | tail -8
cd ../Move-Intelligence-Front && npx ng test --watch=false 2>&1 | tail -8 && npx ng build
cd ../Move-Intelligence-Dados && python3 -m pytest tests/test_page_excerpt.py -q && python3 tests/run_tests.py
```
Esperado: nenhuma falha **nova** em relação à linha de base da Tarefa 1.

- [x] **Passo 2: Banco local**

Já feito nas Tarefas 2 e 4 (migration + `catalog:seed`). Confira de novo:
```bash
docker exec move-postgres psql -U move -d move_intelligence -At -c "select count(*) from catalog_types; select card_status, count(*) from product_clusters group by 1;"
```
Esperado: 53 tipos; todos os clusters `legacy`.

- [x] **Passo 3: Usuário ADMIN**

Usuário autorizado pelo solicitante: `teste@email.com`; `npm run user:make-admin -- teste@email.com` executado com sucesso.

- [x] **Passo 4: Reprocessamento/importação e finalização**

**Pergunte ao usuário antes de ligar a rotina:** ela gasta as chamadas gratuitas do dia no OpenRouter (até `FICHA_DAILY_CALL_LIMIT=35`). Com o "sim":
```bash
cd Move-Intelligence-Back
npm run catalog:reprocess
# no .env local: FICHA_ENABLED=true ; reinicie o backend local com `npm run start:dev` (NÃO pelo docker compose)
```
Acompanhe:
```bash
docker exec move-postgres psql -U move -d move_intelligence -At -c "select status, count(*) from listing_fichas group by 1; select card_status, count(*) from product_clusters group by 1; select kind, status, count(*) from catalog_review_items group by 1,2;"
```
Esperado: `pending` caindo a cada rodada (~20 fichas por chamada; títulos repetidos são copiados sem chamada) e clusters passando de `legacy` para `confirmed`/`provisional`/`merged`. Quando `pending` de prioridade 10 zerar: `npm run catalog:reprocess -- --finalize`.

- Executado inicialmente em 19/09/2026 após o reset da cota: `catalog:reprocess` enfileirou 711 anúncios e a rodada LLM consumiu exatamente 35 chamadas, parando por `stoppedBy: budget` (`FICHA_ENABLED=true` apenas nessa rodada autorizada).
- A abordagem foi então pausada conforme solicitado, mantendo `FICHA_ENABLED=false`: `parseFichaJsonLines` passou a aceitar objetos JSON multiline por varredura de chaves balanceadas; foi criado `catalog:import-fichas` com `parseFichaJsonLines` + `validateFicha` + `CardAssignerService`; e foi criado o gerador local determinístico de fichas, sem OpenRouter, usando `buildFichaInput` e a taxonomia ativa.
- Foram gerados/importados 501 anúncios em 11 arquivos ignorados pelo Git, em lotes de no máximo 50. O snapshot final contém 712 fichas `done` (711 prioritárias + 1 anúncio sintético de aceite), com `llm_model=codex-manual` e `prompt_version=ficha-v1` nas importações manuais. Não houve chamadas LLM após a pausa; `catalog-ficha` permanece em 35 chamadas no dia.
- O `catalog:reprocess --finalize` foi executado após a importação: primeira passagem recalculou 15 scores e a passagem final, após o anúncio sintético, recalculou 1 score. Estado final dos cards: 66 `confirmed`, 13 `provisional`, 41 `merged` e 2 `legacy`.

- [x] **Passo 5: Critérios de aceite (spec 12), conferidos um a um**

1. Nenhum `card_key` repetido entre cards ativos:
```bash
docker exec move-postgres psql -U move -d move_intelligence -At -c "select card_key, count(*) from product_clusters where card_status in ('provisional','confirmed') group by 1 having count(*) > 1;"
```
Esperado: nenhuma linha.
2. **Anúncio novo:** registre um anúncio de teste via `registerListing` (ex.: rode uma coleta pequena) e veja a ficha `pending` → `done` → card na rodada seguinte.
3. **Provisórios:** um card provisório aparece no `/ranking` com selo e score "—".
4. **Acesso:** com ADMIN, `/revisao` funciona (confirme, mova, desfaça um item). Com USER, `GET /api/catalog/review/counts` responde 403.
5. **Limite diário:** `select count(*) from ai_call_logs where created_at >= date_trunc('day', now() at time zone 'utc')` nunca passa de 35 por causa das fichas.
6. **Troca de provedor:** só por `.env` (sem código). Confira que não há URL de provedor fixa fora de `openrouter.service.ts`.
7. **`catalog:eval`:** **pergunte ao usuário** antes de rodar (gasta ~7 chamadas).
8. **Testes:** todos os do Passo 1 passam.

Auditoria final em 19/09/2026:

1. **Duplicidade ativa:** passou; consulta por `card_key` em `confirmed`/`provisional` retornou 0 duplicidades.
2. **Anúncio novo:** passou; `manual_acceptance::codex-acceptance-20260919` percorreu `pending` → `done`, foi gravado com `codex-manual`/`ficha-v1` e recebeu item confirmado no card.
3. **Provisórios:** passou; `GET /api/trends/products?limit=100` respondeu 200 com 79 itens e um provisório com `move_score=null`, `score_band=null` e `AGUARDANDO_REVISAO`; o detalhe também respondeu 200.
4. **Acesso:** passou; login ADMIN e `/api/catalog/review/counts` responderam 200, enquanto o mesmo endpoint com token USER respondeu 403. A rota/interface de revisão e seus testes permanecem cobertos.
5. **Limite diário:** passou; `ai_call_logs` registra exatamente 35 chamadas do endpoint `catalog-ficha`, sem aumento durante a importação manual/finalização.
6. **Troca de provedor:** passou; a configuração continua por `.env`, e a auditoria de URLs de provedor não encontrou URL fixa fora de `openrouter.service.ts`.
7. **`catalog:eval`:** passou; foi autorizado previamente e executado com 7 chamadas, com resultado completo registrado no relatório da execução.
8. **Testes:** passou; backend completo com 49 suítes/388 testes, typecheck, parser/importer e validações frontend/Python/build aprovados.

- [x] **Passo 6: Relatório final ao usuário**

Mostre `git status --short` e `git diff --stat`, liste os critérios de aceite com o resultado de cada um e aponte o que ficou para o usuário: aplicar em produção (backup `pg_dump` → migration → `catalog:seed` → `user:make-admin` → deploy → `FICHA_ENABLED=true` → `catalog:reprocess`). **Não faça commit.**

---

## Autorrevisão do plano (feita por quem escreveu)

- **Cobertura da spec:**

  | Seção da spec | Tarefas |
  |---|---|
  | 4 (banco) | 2, 3 |
  | 5.1 (recorte) | 18 |
  | 5.2–5.4 (ficha) | 5–9, 12 |
  | 5.5 (avaliação) | 17 |
  | 6.1–6.2 (chave e regras) | 5, 11 |
  | 6.3 (comparação) | 10, 16 |
  | 6.4 (porta única) | 13 |
  | 6.5 (reprocessamento) | 11, 17, 23 |
  | 7 (revisão) | 14, 15, 22 |
  | 8 (telas) | 19–22 |
  | 9 (testes) | em cada tarefa |
  | 10 (implantação) | 23 |
  | 11 ("não fazer") | restrições globais |
  | 12 (critérios de aceite) | 23 |

- **Desvios conscientes da spec, já refletidos nela:**
  - índice comum, e não UNIQUE parcial, em `card_key` (Tarefa 2);
  - `analytics_excluded` no snapshot em vez de join (4.4);
  - tabela de anúncios nova acima da matriz de vendedores (8);
  - `merged_into_id` = destino do último item (6.5);
  - desfazer não cobre ações de tipo (7.3);
  - rota `GET /catalog/families` (7.2).
- **Nomes que atravessam tarefas:**
  - `registerListing` e `currentCardId` (Tarefas 12/13);
  - `assign`, `moveListing`, `refreshCard`, `refreshMany` e `createCardForType` (11);
  - `invalidateTypeCache` (15);
  - `cardListFields` e `provisionalScoreOverride` (16);
  - `buildCardComparison` (10/16);
  - `evaluateCardKey`, `buildCardName` e `cardChipLabels` (5).
