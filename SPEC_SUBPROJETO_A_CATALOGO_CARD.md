# Especificação — Subprojeto A: Catálogo e Card

Data: 18/09/2026 · Branch: `feat/catalogo-card` (criada a partir de `feat/ranking-view-modes`, sem commits) · Status: **desenho aprovado em conversa; aguardando revisão desta especificação**.

Este documento é a fonte da verdade do subprojeto A. O plano de implementação (passo a passo para o agente) será escrito depois, em `PLANO_SUBPROJETO_A_CATALOGO_CARD.md`, também na raiz.

---

## 0. Resumo

Hoje o catálogo agrupa anúncios em clusters no formato **"mesmo modelo"**: vetos de marca, peso e preço acima de 3×, mais similaridade de texto. Resultado: a mesma bike aparece 3× no ranking, só mudando loja ou marca.

O subprojeto A troca isso por **cards por conceito de produto**:

- cada anúncio ganha uma **ficha** gerada por LLM a partir de um **recorte da página**;
- a ficha define **tipo + diferenciais** = **chave do card**;
- anúncios com a mesma chave ficam no **mesmo card**. Marca, loja, peso e cor são variação ou fornecedor dentro do card;
- casos incertos entram como **provisórios** numa **fila de revisão só para ADMIN**.

O **cluster atual (`product_clusters`) passa a ser o card** (sem tabela nova de card), para não migrar as ~20 ligações existentes.

### 0.1 Roteiro geral (5 subprojetos, um plano por vez)

| # | Subprojeto | Depende de | Status |
|---|---|---|---|
| **A** | **Catálogo e card** (este documento) | — | especificação |
| B | Ofertas por fornecedor como entidade + Monte Carlo por oferta + score do card em dois níveis + tabela de ofertas na página do produto | A | não iniciado |
| C | Radar de demanda: corrigir âncora do Trends (`q=a,b`), busca em dois níveis (categoria Fitness → consultas "em alta"), fila de classificação de termos, descoberta direcionada | A | não iniciado |
| D | Filas de acompanhamento: top 50 / radar / demais, vagas, expiração, orçamento | A, C | não iniciado |
| E | Embeddings: segunda verificação, busca semântica, agrupar "sem tipo" (pgvector) | A | não iniciado |

**Nada de B, C, D ou E entra neste subprojeto.** Ver a seção 11 ("Não fazer").

---

## 1. Decisões tomadas (com o usuário)

| # | Decisão |
|---|---|
| D1 | Dividir em 5 subprojetos, com especificação e plano separados; começar pelo A |
| D2 | Os dados atuais (~58 mil produtos, 117 clusters) são **de demonstração**, mas **ficam na plataforma** para validar o visual. São **reprocessados** no novo modelo de card |
| D3 | Escopo = **fitness**, com **NCM como atributo de cada tipo** (9506.91.00 é o principal; tipos com outro NCM entram com o NCM deles). **O NCM não é usado como termo de busca no scraper** |
| D4 | Taxonomia **Família → Tipo**: as ~20 categorias atuais viram famílias; os tipos (mais finos) definem o card |
| D5 | O **Python recorta a página**; o **NestJS gera a ficha** (usa o `openrouter.service` e o log de IA existentes) |
| D6 | LLM no **plano gratuito do OpenRouter** por enquanto (50 chamadas/dia para a conta inteira). O provedor precisa ser trocável **só por configuração** |
| D7 | **Sem divisão residencial × comercial** nesta fase (se está em varejo, pode ser uso residencial). Card = **tipo + diferenciais**. Diferenças de desempenho vão para a **comparação dentro do card** |
| D8 | Falta de especificação que define o card → **card provisório + revisão**; o provisório **não entra no score** |
| D9 | Ranking: card só com anúncios provisórios **aparece com selo "Provisório" e sem score** |
| D10 | Página do produto: **"Comparação dentro do card" no topo** + a aba **"Concorrência" renomeada para "Anúncios"** |
| D11 | Fila de revisão: **tela nova, só usuários ADMIN** |
| D12 | Taxonomia vive no **banco**, **semeada por arquivo versionado** |
| D13 | Nome do card **montado por regra** (tipo + diferenciais) e **editável** pelo ADMIN |
| D14 | **Reaproveitar `product_clusters` como card** (sem tabela Card nova) |
| D15 | Fila da ficha = **status no banco + rotina agendada** (`@nestjs/schedule`), sem fila BullMQ nova |
| D16 | Ranking **mantém** a troca de visualização **tabela / cards** (já existe na branch base); as duas mostram os dados do card |

---

## 2. Estado atual (fatos verificados no código)

- **Agrupamento atual:** `Move-Intelligence-Back/src/modules/product-matching/product-matching.service.ts`
  - `findOrCreateClusterForProduct`: candidatos por trigram (`pg_trgm`) + vetos em `decide()` (GTIN, `kg|g|cm|mm|m|lb|un|model` divergente, marca divergente, preço > 3×). Aprova com similaridade ≥ 0,55 e manda para revisão entre 0,40 e 0,55;
  - `findOrCreateTrivialCluster`: caminho legado;
  - `reclusterAll`: reprocessa tudo.
- **Quem cria clusters hoje (4 caminhos):**
  1. `src/modules/ingestion/intelligence-collection.service.ts` → `syncObservationsToSnapshots` (≈ linha 513) e `syncAnalyticalModels` (≈ linha 732);
  2. `src/modules/imports/imports.processor.ts` (≈ linha 280), importação de CSV;
  3. `src/modules/ingestion/ingestion.service.ts` (≈ linha 72), pipeline legado;
  4. `ProductMatchingService.reclusterAll`.
- **Modelos Prisma relevantes** (`Move-Intelligence-Back/prisma/schema.prisma`):
  - `ProductCluster` (`product_clusters`): `canonicalName`, `category`, `confidenceScore`, `riskLevel`, `financialScore`, `simulatedAt`;
  - `ProductClusterItem` (`product_cluster_items`): único por `(marketplace, externalProductId)`;
  - `ProductListingSnapshot`: tem `productClusterId` e `rawProductId`;
  - `IntelligenceProduct` (`products`): `sourceSpecific` JSON e `cluster` (família atual);
  - `TrackedListing.productId` → cluster;
  - `ProductScore` por `productClusterId`;
  - `ProductMatchReview` (existe, **sem uso** em API ou tela);
  - `AiCallLog` (`endpoint`, `status`, `createdAt`);
  - `User.role` (padrão `"USER"`).
- **Papel do usuário:** já vai no JWT (`auth.service.ts`: `{ sub, email, role }`) e no `currentUser` do frontend. **Nenhuma rota verifica o papel hoje.**
- **Descoberta (Python):** `Move-Intelligence-Dados/app/etl/extract/marketplace/common.py` → `MarketplaceExtractor.parse_detail(candidate, markdown)` já recebe o markdown da página (`scrape_as_markdown`) e hoje guarda só `raw_content_preview` (4.000 caracteres).
  - Utilidades existentes: `parsers/base.py` (`extract_json_ld_products`, `fix_mojibake`, `extract_title`).
  - Fixtures reais em `Move-Intelligence-Dados/tests/fixtures/markdown/{alibaba,amazon,amazon_br,mercado_livre,shopee_br}`.
- **LLM:** `src/modules/ai-gateway/openrouter.service.ts`:
  - lê `OPENROUTER_API_URL`, `OPENROUTER_MODEL`, `OPENROUTER_API_KEY`, `OPENROUTER_HTTP_REFERER` e `OPENROUTER_X_TITLE`;
  - `maxTokens` padrão 2048;
  - aceita `responseFormat`, mas o modelo gratuito atual (`inclusionai/ling-3.0-flash-fin:free`) **não suporta** `response_format`/`structured_outputs`;
  - contexto de 262.144 tokens e **resposta máxima de 32.768**;
  - **o modelo raciocina antes de responder**: de 400 a 7.600 tokens de raciocínio por lote de 10. Com `maxTokens` 2048, a resposta sai **vazia**.
- **Frontend:**
  - ranking em `Move-Intelligence-Front/src/app/features/ranking/` (tabela + grade com `app-trend-card`);
  - página do produto em `features/tendencia/` (rota `tendencia/:id`, abas: Adoção, Unit Economics, Concorrência, Sazonalidade, Sourcing, Simulação, Decisão);
  - aba Concorrência = `shared/components/intel/competitor-matrix`;
  - topo = seção `.hero` em `tendencia.component.html`.
- **Banco:**
  - o banco local foi restaurado de dump e **não tem `_prisma_migrations`**. As 12 migrations em `prisma/migrations/` foram aplicadas à mão;
  - o compose local define `RUN_DB_PUSH_ON_BOOT=true` (o Dockerfile roda `prisma db push` no boot); a produção não define essa variável;
  - Postgres **sem pgvector** (`postgres:16-alpine`); `pg_trgm` instalado.
- **Dados atuais:** 58.110 `products` (47.502 com `is_synthetic=true`), **626 títulos distintos** (tirando o sufixo `(FONTE)`), 117 clusters, 125 scores, 0 watchlist, 20 famílias em `product_clusters.category`.

---

## 3. Fluxo

```
1. COLETA (Python, descoberta — já existe)
   baixa a página → NOVO: build_page_excerpt() → products.source_specific.page_excerpt

2. REGISTRO (NestJS) — porta única para os 4 caminhos
   catalog.registerListing({ marketplace, externalProductId, title, excerpt?, priority })
   → cria/atualiza listing_fichas (status=pending); NÃO cria cluster

3. FICHA (NestJS, rotina agendada)
   pendentes por prioridade → dedupe por hash → lotes → LLM → valida → listing_fichas (done|error)

4. CARD (NestJS, sem LLM)
   ficha → chave do card → regras da seção 6.2 → product_cluster_items (+status)
   → atualiza snapshots/tracked_listings com o card → marca score do card como desatualizado

5. REVISÃO (tela nova, ADMIN) → decisões registradas e reversíveis

6. TELAS: ranking (tabela e cards), página do produto (topo + aba Anúncios), página Revisão
```

---

## 4. Banco de dados (somente mudanças **aditivas**)

### 4.1 Tabelas novas

**`catalog_families`**

| Coluna | Tipo | Observação |
|---|---|---|
| id | uuid PK | |
| key | text UNIQUE | ex.: `dumbbells` (as 20 atuais + novas do Anexo A) |
| name_pt | text | ex.: "Halteres" |
| sort_order | int | |
| created_at | timestamptz | |

**`catalog_types`**

| Coluna | Tipo | Observação |
|---|---|---|
| id | uuid PK | |
| family_id | uuid FK → catalog_families | |
| key | text UNIQUE | snake_case em inglês, ex.: `walking_pad` |
| name_pt | text | ex.: "Walking pad" |
| description_en | text | vai para o prompt |
| ncm | text NULL | ex.: `9506.91.00`; NULL = a definir |
| card_key_attrs | jsonb | `[{ "attr": "resistencia", "label_pt": "resistência", "values": [{ "value": "magnetica", "label_pt": "magnética" }, …] }]`; ordem = ordem na chave |
| comparison_attrs | jsonb | `[{ "attr": "roda_inercia_kg", "label_pt": "roda de inércia", "kind": "number", "unit": "kg" }, { "attr": "com_app", "kind": "boolean" }, { "attr": "tipo_motor", "kind": "enum", "values": […] }]` |
| variation_attrs | jsonb | ex.: `["peso_kg","voltagem","cor"]` (vão para a coluna "Variação") |
| source | text | `seed` \| `approved` |
| active | boolean default true | |
| created_at / updated_at | timestamptz | |

**`listing_fichas`**

| Coluna | Tipo | Observação |
|---|---|---|
| id | uuid PK | |
| marketplace | text | |
| external_product_id | text | |
| UNIQUE | (marketplace, external_product_id) | mesma chave de `product_cluster_items` |
| title | text | |
| input_hash | text | sha256 do texto de entrada normalizado (título sem sufixo `(FONTE)` + recorte) |
| status | text | `pending` \| `done` \| `error` \| `skipped` |
| priority | int | 100 = descoberta nova; 10 = reprocessamento; 200 = "juntar tipo" da revisão |
| attempts | int default 0 | |
| last_error | text NULL | |
| type_key | text NULL | chave em `catalog_types` ou `unknown` |
| suggested_type | text NULL | quando `type_key = unknown` |
| in_scope | boolean NULL | |
| is_accessory_or_part | boolean NULL | |
| is_kit_or_bundle | boolean NULL | |
| has_variations | boolean NULL | |
| card_key_values | jsonb | `{ "resistencia": "magnetica" }` (só valores permitidos) |
| new_differential | text NULL | diferencial fora da lista (ex.: `chuveiro`) |
| missing_key_attrs | text[] | atributos-chave não encontrados |
| comparison_values | jsonb | `{ "roda_inercia_kg": 13, "com_app": true }` |
| variation_values | jsonb | `{ "peso_kg": 2 }` |
| specs | jsonb | especificações livres, em inglês, só com fatos do texto |
| brand | text NULL | |
| model | text NULL | |
| confidence | numeric(4,3) NULL | só informativo (o teste mostrou que não separa acerto de erro) |
| llm_model | text NULL | |
| prompt_version | text NULL | |
| copied_from_ficha_id | uuid NULL | quando reaproveitada por hash |
| created_at / updated_at | timestamptz | |
| índices | (status, priority desc, created_at), (input_hash) | |

**`catalog_review_items`**

| Coluna | Tipo | Observação |
|---|---|---|
| id | uuid PK | |
| kind | text | `provisional_listing` \| `suggested_type` |
| marketplace / external_product_id | text NULL | para `provisional_listing` |
| suggested_cluster_id | uuid NULL FK → product_clusters | |
| suggested_type_key | text NULL | para `suggested_type` (normalizado) |
| suggested_type_aliases | text[] | variações agrupadas (ex.: `power_rack`, `squat_cage`) |
| listing_count | int | anúncios que sugeriram o tipo |
| reason | text | legível em PT (ex.: "falta a especificação: resistência") |
| status | text | `pending` \| `resolved` |
| resolution | text NULL | ação tomada |
| resolved_by | uuid NULL FK → users | |
| resolved_at | timestamptz NULL | |
| created_at | timestamptz | |
| índices | (kind, status, created_at) | |

**`catalog_decisions`**

| Coluna | Tipo | Observação |
|---|---|---|
| id | uuid PK | |
| actor_user_id | uuid FK → users | |
| action | text | `confirm` \| `move` \| `create_card` \| `out_of_scope` \| `approve_type` \| `merge_type` \| `discard_type` \| `rename_card` \| `undo` |
| review_item_id | uuid NULL | |
| before | jsonb | estado anterior (card, status do item, tipo, nome) |
| after | jsonb | estado posterior |
| undone_by_decision_id | uuid NULL | |
| created_at | timestamptz | |

### 4.2 Colunas novas em tabelas existentes

| Tabela | Colunas novas | Observação |
|---|---|---|
| `product_clusters` | `type_id uuid NULL FK`, `card_key text NULL`, `card_key_values jsonb NULL`, `card_status text NOT NULL DEFAULT 'legacy'`, `name_locked boolean NOT NULL DEFAULT false`, `merged_into_id uuid NULL FK → product_clusters` | `card_status` ∈ `legacy` (ainda não reprocessado) \| `provisional` \| `confirmed` \| `merged`. Índice **UNIQUE parcial** em `card_key` WHERE `card_status IN ('provisional','confirmed')`. `canonical_name` passa a guardar o nome montado; `category` passa a guardar a **família** |
| `product_cluster_items` | `status text NOT NULL DEFAULT 'confirmed'` | `provisional` \| `confirmed`. Itens antigos ficam `confirmed`, para o score atual não mudar antes do reprocessamento |
| `product_listing_snapshots` | `analytics_excluded boolean NOT NULL DEFAULT false` | `true` = snapshot fora de score, séries, Monte Carlo, ranking, alertas e copiloto (ver 4.4) |
| `users` | — | passa a usar `role = 'ADMIN'` |

### 4.3 Recorte da página

Fica em `products.source_specific.page_excerpt` (JSON que o ETL já grava). **Não** entra em tabela nova; a ficha guarda só o `input_hash`.

### 4.4 Regra de leitura para score, gráficos e Monte Carlo

Toda leitura de snapshots já passa pelos helpers de `src/shared/synthetic-data/synthetic-data.filter.ts`: `syntheticSnapshotWhere()` (Prisma) e `syntheticSnapshotFilterSql()` (SQL do ranking). Esses dois helpers passam a **sempre** acrescentar `analytics_excluded = false`, independentemente de `INCLUDE_SYNTHETIC_DATA`.

A montagem do card mantém `analytics_excluded`:

- card com ≥ 1 item `confirmed` → snapshots dos itens `provisional` = `true`; dos `confirmed` = `false`;
- card só com itens `provisional` → todos `false`. Os dados aparecem no ranking e na página, mas **sem score**: o Monte Carlo em lote pula cards `provisional` e `merged`, e as respostas da API forçam `move_score = null` e a ação "Aguardando revisão" para cards `provisional`.

Clusters com `card_status = 'merged'` saem do ranking e do recálculo. "Marcar score como desatualizado" = `product_clusters.simulated_at = NULL` (critério que o lote `findClustersNeedingSimulation` já usa).

**Não mudam:** snapshots, `product_scores`, alertas, watchlist, `ai_recommendations`, `review_summaries` e a tabela `product_match_reviews` (fica sem uso, como hoje).

---

## 5. Ficha

### 5.1 Recorte da página (Python)

- **Função nova** `build_page_excerpt(markdown: str, title: str | None) -> str` em `Move-Intelligence-Dados/app/etl/extract/marketplace/parsers/base.py`, chamada em `MarketplaceExtractor.parse_detail`. Grava em `source_specific["page_excerpt"]`.
- **Ordem** (corta em **4.000 caracteres** no total):
  1. título;
  2. JSON-LD `Product` (name, brand, model, `additionalProperty` e os primeiros 800 caracteres de `description`);
  3. bloco de especificações, localizado por cabeçalhos (sem diferenciar maiúsculas):
     - PT: "Características", "Ficha técnica", "Especificações", "O que você precisa saber";
     - EN: "Specifications", "Technical Details", "Product details", "About this item";
     - ZH: "参数", "规格", "产品参数";

     pega até o próximo cabeçalho do mesmo nível;
  4. bullets (linhas iniciadas por `-`/`*`/`•`) logo após o título.
- **Tratamento do texto:** aplicar `fix_mojibake`, remover imagens, links e linhas vazias repetidas.
- **Sem markdown:** retorna só o título.

### 5.2 Rotina (NestJS, módulo novo `src/modules/catalog/`)

1. **Agendamento:** `@Cron(process.env.FICHA_CRON ?? '*/30 * * * *')`, e só roda se `FICHA_ENABLED === 'true'`, no padrão dos schedulers de ingestão existentes.
2. **Orçamento do dia:** conta as linhas de `ai_call_logs` com `createdAt` desde **00:00 UTC**, **em todos os endpoints**, porque o limite gratuito é da conta. Compara com `FICHA_DAILY_CALL_LIMIT`. Se não houver saldo, encerra.
3. **Busca de pendentes:** pega as fichas `pending`, ordenadas por `priority DESC, created_at ASC`.
4. **Deduplicação:** para cada pendente, se existe ficha `done` com o mesmo `input_hash`, copia o resultado (`copied_from_ficha_id`), sem chamar a LLM.
5. **Chamada à LLM:** agrupa em lotes de `FICHA_BATCH_SIZE` e chama `openrouter.service` com `maxTokens = FICHA_MAX_TOKENS`, `temperature 0.2`, `endpointName: 'catalog-ficha'` e `model = FICHA_MODEL || OPENROUTER_MODEL`.
6. **Gravação:** grava as fichas e chama a montagem do card (seção 6) para cada anúncio.

| Variável | Padrão | Uso |
|---|---|---|
| `FICHA_ENABLED` | `false` | liga a rotina |
| `FICHA_CRON` | `*/30 * * * *` | frequência |
| `FICHA_DAILY_CALL_LIMIT` | `35` | teto de chamadas/dia **para fichas** (a conta tem 50 no plano gratuito) |
| `FICHA_BATCH_SIZE` | `20` | anúncios por chamada |
| `FICHA_MAX_TOKENS` | `20000` | resposta máxima (≤ 32.768 no modelo gratuito atual) |
| `FICHA_MODEL` | vazio | sobrescreve `OPENROUTER_MODEL` só para fichas |

Trocar de provedor = mudar `OPENROUTER_API_URL`, `OPENROUTER_API_KEY` e `FICHA_MODEL`/`OPENROUTER_MODEL`. Vale para qualquer API compatível com OpenAI chat completions. **Não criar abstração multi-provedor.**

### 5.3 Prompt (`prompt_version` = `ficha-v1`)

- **Montagem a partir do banco:** tipos ativos com `key`, `description_en`, `card_key_attrs` (valores permitidos), `comparison_attrs` e `variation_attrs`.
- **Regras** (herdadas do prompt v2 testado em 18/09):
  1. classificar pelo **objeto principal**, não por palavras soltas no título;
  2. peça ou acessório **para** um aparelho → `is_accessory_or_part = true` e o tipo da própria peça (existem tipos de peça, ex.: `dumbbell_handle`). Se não houver tipo para a peça, `type_key = unknown`;
  3. não é fitness → `in_scope = false`;
  4. nenhum tipo serve → `type_key = "unknown"` + `suggested_type` (snake_case em inglês);
  5. kit → `is_kit_or_bundle = true`, classificando pelo item principal;
  6. atributos-chave **só com valores permitidos**. Diferencial fora da lista vai em `new_differential`. Se não achar o valor, deixa de fora (vira `missing_key_attrs` na validação);
  7. especificações só com fatos do texto, valores em inglês, unidades originais;
  8. **nunca** inventar chave nova de tipo.
- **Exemplos resolvidos** (few-shot):

  | Entrada | Classificação |
  |---|---|
  | "Esteira Elétrica Plana Residencial Bluetooth" | `walking_pad` |
  | "Barra Halter 35cm Cromada com Rosca" | `dumbbell_handle`, peça |
  | "Keep跑步腰包运动手机袋" | `in_scope = false` (pochete de corrida) |
  | "呼吸啞鈴腹式呼吸訓練器" | `in_scope = false` (treinador de respiração) |
  | "实心竞技壶铃…提壶哑铃" | `kettlebell` (o título contém "哑铃") |
  | "大孔健身啞鈴片 槓鈴片 15kg" | `weight_plate` |
  | "Power Rack Barra Fixa Supino Agachamento" | `power_rack` |
  | "Treadmill with shower head for home" | `treadmill` + `new_differential: "shower"` |

- **Entrada:** array JSON `[{ "id": "<marketplace>:<externalId>", "text": "<recorte>" }]`.
- **Saída exigida:** **JSON Lines** (um objeto por linha, sem cerca de código), com as chaves:

  ```
  id, type_key, suggested_type, in_scope, is_accessory_or_part, is_kit_or_bundle,
  has_variations, card_key_values, new_differential, comparison_values,
  variation_values, specs, brand, model, confidence
  ```

### 5.4 Validação

- **Leitura da resposta:** tolerante a cerca ```` ``` ```` e a linha final cortada; aproveita as linhas completas.
- **`type_key`:** fora dos tipos ativos e diferente de `unknown` → tratar como `unknown` com `suggested_type = type_key`.
- **Valor de atributo-chave fora dos permitidos:** descartar o valor e adicionar o atributo em `missing_key_attrs`.
- **Anúncio do lote sem resposta:** `attempts += 1` e continua `pending`. Com `attempts >= 3`: `status = error`, `last_error` preenchido e item de revisão `provisional_listing` com motivo "ficha falhou".
- **Erros da API:**
  - HTTP 429 com "per-day"/"daily" → interrompe a rodada;
  - outros 429 e 5xx → espera crescente, até 3 tentativas por lote;
  - resposta sem nenhuma linha válida → reenvia o lote pela metade uma vez.
- **Prompt novo:** mudar `prompt_version` **não** reprocessa nada sozinho; só o comando `catalog:reprocess --prompt-version`.

### 5.5 Avaliação de qualidade

- **Comando:** `npm run catalog:eval` (backend) usa `test/fixtures/catalog-eval/listings-gold.json`: 140 anúncios reais, gabarito com `gold_ambiguous`.
- **Mapeamento:** o gabarito usa a taxonomia do teste (`taxonomy-used-in-test.json`); o mapeamento para os tipos finais (Anexo A) é:
  - `gold_type = unknown` (bolsas, pochetes, calçados, fones, caixa de som, treinador de respiração) → espera `in_scope = false`;
  - `gold_type = adjustable_dumbbell` **e** `gold_is_accessory_or_part = true` (pegadores/barras de halter) → espera `dumbbell_handle` + `is_accessory_or_part = true`;
  - demais `gold_is_accessory_or_part = true` (tapete de esteira, cabo de força, motor de esteira) → **fora da conta de tipo**; avaliar só a marcação `is_accessory_or_part`;
  - todos os outros `gold_type` têm o mesmo nome no Anexo A (`treadmill`, `walking_pad`, `spin_bike`, `upright_bike`, `recumbent_bike`, `fixed_dumbbell`, `adjustable_dumbbell`, `kettlebell`, `weight_plate`).
- **Relatório:** acerto de tipo (claros × ambíguos), `in_scope`, acessório e kit, por idioma.
- **Custo:** ~7 chamadas; **não roda nos testes automáticos**.
- **Referência do teste de 18/09** (prompt v2, títulos só): tipo 91/100 nos casos claros (98/100 aceitando pochetes como acessório); acessório 4/7; kit com 16 falsos positivos.

---

## 6. Card

### 6.1 Chave e nome

- **Chave:** `card_key = type_key + "|" + join(attr=value)` na ordem de `card_key_attrs`. Um valor `new_differential` entra como `diferencial=<valor>`. Tipo sem atributos-chave → `card_key = type_key`.
- **Nome** (se `name_locked = false`): `name_pt` do tipo + `label_pt` dos valores (ignorando valores `nenhum`/`none`), em minúsculas depois da primeira palavra.
  - Ex.: "Bike spinning magnética", "Esteira com chuveiro", "Halter fixo sextavado".
  - Diferencial novo sem rótulo usa o próprio valor ("Esteira com shower" até o ADMIN renomear).

### 6.2 Regras de entrada (determinísticas, sem LLM)

| # | Situação da ficha | Ação | Status do item |
|---|---|---|---|
| R1 | `in_scope = false` | remove o item de qualquer card | — |
| R2 | `type_key = unknown` | cria/atualiza `catalog_review_items` `suggested_type` (agrupando sugestões iguais ou parecidas por `pg_trgm` ≥ 0,6), sem card | — |
| R3 | chave completa e card ativo com essa chave existe | entra no card | `confirmed` |
| R4 | chave completa, sem card ativo, **todos os valores permitidos** | cria o card (ou adota o cluster antigo, 6.5) | `confirmed` |
| R5 | `new_differential` presente | cria o card com a chave nova + revisão ("diferencial novo: X") | `provisional` |
| R6 | `missing_key_attrs` não vazio | entra no **card mais provável** do mesmo tipo: o que bate em todos os valores conhecidos e tem mais itens `confirmed`; desempate pelo mais antigo. Se não há card do tipo, cria um card com os atributos faltando como `?` na chave + revisão ("falta a especificação: X") | `provisional` |
| R7 | ficha em `error` | revisão "ficha falhou", sem card | — |

- **Status do card:** `confirmed` se tem ≥ 1 item `confirmed`; senão `provisional`. Card sem itens → `merged` (se veio de reprocessamento) ou continua vazio (não aparece no ranking).
- **Depois de cada entrada:**
  - atualizar `product_listing_snapshots.product_cluster_id` e `tracked_listings.product_id` desse anúncio;
  - marcar o score do card como desatualizado (o recálculo existente `simulateBatchForRanking` refaz na próxima execução).

### 6.3 Comparação dentro do card (calculada na leitura, sem LLM)

Usa só as fichas de itens `confirmed`:

- **Números:** faixa mín–máx por atributo de comparação `number` (ignora nulos).
- **Booleanos e enums:** contagem ("com app: 4 de 9").
- **Totais:** anúncios, lojas distintas e marcas distintas (`brand` não nulo).
- **Preço de venda:** mediana e faixa (usar o preço mais recente de cada anúncio, em BRL quando for loja brasileira).
- **Aviso de tecnologia:** para cada atributo `enum`/`boolean` com pelo menos 2 grupos de ≥ 2 anúncios, se a mediana de preço entre grupos difere em ≥ 30%. Texto: "⚠ Tecnologias diferentes: {grupo mais barato} custa ~{x}% menos que {grupo mais caro} — compare antes de negociar."
- **Variação:** `variation_values` formatados, exibidos na coluna "Variação" da aba Anúncios.

### 6.4 Porta única (substitui o agrupamento antigo)

- **Serviço:** `CatalogService.registerListing(input)`:
  - cria ou atualiza a ficha `pending`;
  - se o `input_hash` mudou, volta para `pending`;
  - se já existe ficha `done` com o mesmo hash, aplica a montagem do card na hora.
- **Os 4 caminhos da seção 2** passam a chamar `registerListing` e a gravar o snapshot com `productClusterId = null`. O card é preenchido depois, pela montagem.
- **Remoção do agrupamento antigo:** removidos `ProductMatchingService` (`findOrCreateClusterForProduct`, `findOrCreateTrivialCluster`, `reclusterAll`, `decide`, `candidates`, `attach`, `createStandaloneCluster`) e seus testes. Remover também o import e o provider no módulo. **Nenhum outro caminho pode criar cluster.**

### 6.5 Reprocessamento dos dados atuais

- **Comando:** `npm run catalog:reprocess` enfileira todos os `(marketplace, external_product_id)` conhecidos, a partir de `products` e `product_cluster_items`, com `priority = 10`. O texto de entrada é o título (os dados de demonstração não têm recorte).
- **Adoção do cluster antigo:** ao aplicar R4/R5/R6 para um anúncio cujo cluster atual tem `card_status = 'legacy'` e **ainda não foi adotado**, esse cluster **vira o card**: recebe `type_id`, `card_key`, nome e status. Assim se preservam scores, alertas e links.
- **Cluster legado que fica sem itens:** `card_status = 'merged'` e `merged_into_id` = card de destino do **último item que saiu dele** (nos dados de demonstração, todos os itens de um cluster vão para o mesmo card).
- **Redirecionamento:** `GET /tendencia/:id` (frontend) e a API de produto redirecionam cluster `merged` para `merged_into_id`.
- **Fim da fila de reprocessamento:** rodar `simulateBatchForRanking`.
- **Ritmo:** ~626 textos distintos. Com 35 chamadas/dia × 20 = 700 fichas/dia, **~1 dia**. Enquanto isso, clusters `legacy` continuam visíveis como hoje.

---

## 7. Revisão (ADMIN)

### 7.1 Acesso

- **Backend:** `AdminGuard` em `src/modules/auth/`, que exige `request.user.role === 'ADMIN'`. Aplicado a **todas** as rotas `/catalog/review/*`, `/catalog/types/*` e à renomeação de card.
- **Script:** `npm run user:make-admin -- <email>` atualiza `users.role`.
- **Frontend:** item de menu **"Revisão (n)"** e rota `/revisao`, com guard de rota, visíveis só quando `currentUser.role === 'ADMIN'`.

### 7.2 API

| Método | Rota | Efeito |
|---|---|---|
| GET | `/catalog/review?kind=&status=pending&page=` | lista (anúncio: título, loja, preço, link, resumo da ficha, card sugerido, motivo; tipo sugerido: chave, aliases, contagem, "parecido com") |
| GET | `/catalog/review/counts` | contadores do menu |
| POST | `/catalog/review/:id/confirm` | item → `confirmed` no card sugerido |
| POST | `/catalog/review/:id/move` `{ targetClusterId }` | move o item (fica `confirmed`) |
| POST | `/catalog/review/:id/create-card` `{ typeKey, cardKeyValues, name? }` | cria o card e move o item (fica `confirmed`); `name` preenchido → `name_locked = true` |
| POST | `/catalog/review/:id/out-of-scope` | remove de qualquer card; ficha `in_scope = false` |
| POST | `/catalog/types/suggestions/:id/approve` `{ familyKey, key, namePt, ncm? }` | cria `catalog_types` (`source = approved`, sem atributos-chave); aplica R3/R4 aos anúncios que sugeriram, **sem LLM** |
| POST | `/catalog/types/suggestions/:id/merge` `{ typeKey }` | fichas desses anúncios → `pending`, `priority = 200` (reextrai para o tipo escolhido) |
| POST | `/catalog/types/suggestions/:id/discard` | anúncios → `in_scope = false` |
| GET | `/catalog/cards?q=` | busca de cards por nome (trigram) para o "mover" |
| PATCH | `/catalog/cards/:id` `{ name }` | renomear; `name_locked = true` |
| POST | `/catalog/decisions/:id/undo` | desfaz (7.3) |
| GET | `/catalog/families` | ADMIN: lista de famílias (`key`, `name_pt`) para o formulário "aprovar tipo" |
| GET | `/catalog/cards/:id/listings` | **qualquer usuário logado** (não é ADMIN): anúncios do card com loja, título, link, variação formatada, último preço, nota e status (usado pela aba "Anúncios") |

A **comparação dentro do card** (6.3) e os campos do card (família, tipo, chips, contagens, `card_status`) vão na resposta existente de `GET /trends/products/:id`; os campos de lista vão em `GET /trends/products`. Sem endpoint extra para isso.

### 7.3 Histórico e desfazer

- **Registro:** toda ação grava `catalog_decisions` (`before`/`after`).
- **Desfazer:** disponível para `confirm`, `move`, `create_card`, `out_of_scope` e `rename_card`, e só se o estado atual é igual ao `after`. Senão, 409 com a mensagem "o anúncio foi alterado depois desta decisão". As ações de **tipo** (`approve_type`, `merge_type`, `discard_type`) ficam registradas, mas **não têm desfazer** nesta fase (409 "esta ação não pode ser desfeita"): o ajuste é feito movendo os anúncios na fila.
- **Efeitos de cada decisão:** recalcular status e nome dos cards envolvidos (6.1/6.2), atualizar os snapshots e `tracked_listings` do anúncio, e marcar os scores como desatualizados.

---

## 8. Telas

Rascunhos aprovados (HTML) em `.superpowers/brainstorm/71169-1789743526/content/`: `ranking-hoje-vs-depois.html`, `pagina-produto-hoje-vs-depois.html`, `fila-revisao.html`.

| Onde | Mudança |
|---|---|
| Ranking: **tabela e grade** (`features/ranking`, `app-trend-card`) | Uma linha/card por **card**; nome do card + "Família › Tipo"; preço = **mediana de venda BR + faixa**; coluna "Fornecedor" → **"N anúncios em N lojas"**; selo **Provisório** + score "—" + ação "Aguardando revisão" quando `card_status = provisional`; cards `merged` não aparecem. A troca tabela/grade continua |
| Página do produto: topo (`tendencia` `.hero`) | Nome do card, "Família › Tipo", chips com os valores-chave, métricas "Anúncios: X em Y lojas" e "Marcas: N", bloco **"Comparação dentro do card"** (6.3) com o aviso de tecnologia; lápis para renomear só para ADMIN |
| Página do produto: aba Concorrência → **"Anúncios"** | Renomear a aba; **acima** da `competitor-matrix` (que agrega por vendedor e continua igual), um componente novo `card-listings-table` lista **cada anúncio** do card: anúncio, loja, **Variação**, preço, nota, **Status** (confirmado/provisório). Dados de `GET /catalog/cards/:id/listings` |
| `/tendencia/:id` de cluster `merged` | redireciona para `merged_into_id` |
| **Nova** página `/revisao` (ADMIN) | Abas "Anúncios provisórios (n)" e "Tipos novos sugeridos (n)", com as ações da 7.2 e um diálogo de busca de card para "mover" |

Contratos: acrescentar só campos novos nos tipos compartilhados (backend `src/shared/contract/*` e frontend `core/models/contract.models.ts`). **Nenhum campo existente muda de significado.**

---

## 9. Testes (nenhum chama LLM ou Bright Data de verdade)

- **Python** (`Move-Intelligence-Dados/tests`):
  - `build_page_excerpt` com as fixtures reais (Amazon, Amazon BR, Mercado Livre, Shopee, Alibaba): contém o título; contém o bloco de especificações quando existe; ≤ 4.000 caracteres; sem imagens;
  - `parse_detail` grava `page_excerpt`.
- **Backend** (jest):
  - chave do card e nome;
  - **uma asserção por linha R1–R7**;
  - parser JSON Lines (cerca, linha cortada, valor não permitido, id faltando, tipo inválido);
  - orçamento diário (conta todos os endpoints desde 00:00 UTC);
  - deduplicação por hash;
  - `registerListing` nos 4 caminhos (snapshot sem cluster + ficha pendente);
  - cada ação da 7.2 e a recusa do desfazer (409);
  - `AdminGuard`;
  - score e Monte Carlo ignoram itens `provisional` e clusters `merged`;
  - adoção de cluster `legacy` e `merged_into_id`;
  - comparação 6.3 (faixas, contagens, aviso ≥ 30%).
- **Frontend:**
  - linha provisória nas duas visualizações do ranking;
  - menu e rota `/revisao` só para ADMIN;
  - ações da página de revisão chamam a API certa;
  - redirecionamento de `merged`.
- **Manual:** `npm run catalog:eval` (5.5).

---

## 10. Implantação segura

1. **Backup:** `pg_dump` do banco de produção.
2. **Migration nova:** `Move-Intelligence-Back/prisma/migrations/<timestamp>_catalog_cards/migration.sql`, **somente aditiva** (CREATE TABLE, ADD COLUMN com default/NULL, CREATE INDEX).
   - Local: conferir a diferença com `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script` antes de aplicar.
   - **Não usar `prisma db push`** contra banco com dados sem revisar a diferença.
   - Produção: aplicar o SQL como as migrations anteriores.
3. **Semear a taxonomia:** `npm run catalog:seed` (idempotente, upsert por `key`) a partir de `Move-Intelligence-Back/prisma/seed/catalog-taxonomy.json` (Anexo A).
4. **Tornar o usuário ADMIN:** `npm run user:make-admin -- <email>`.
5. **Implantar** backend, ETL Python e frontend; `FICHA_ENABLED=true`.
6. **Reprocessar:** `npm run catalog:reprocess` (~1 dia no plano gratuito; a plataforma continua mostrando os clusters `legacy` enquanto isso).
7. **Conferir** o ranking (tabela e grade), a página de um card e `/revisao`.

**Para voltar atrás:** reimplantar a versão anterior. As mudanças de banco são aditivas e ignoradas por ela.

**Git:** adicionar `.superpowers/` ao `.gitignore`.

---

## 11. Não fazer (fora do escopo; o agente não deve criar)

- **Subprojeto B:** entidade de oferta, Monte Carlo por oferta, score em dois níveis, tabela de ofertas.
- **Subprojeto C:** radar do Trends, correção da âncora do Trends, fila de termos.
- **Subprojetos D e E:** filas de acompanhamento, embeddings, pgvector, busca semântica.
- Abstração multi-provedor de LLM, fila BullMQ nova, divisão residencial × comercial.
- Ação "juntar dois cards inteiros" (mover anúncios resolve).
- Tabela de card separada de `product_clusters`.
- Qualquer uso de `product_match_reviews`.
- Mudar o comportamento de `is_synthetic`.
- Reprocessar fichas automaticamente quando o prompt mudar.
- Buscar ou classificar por NCM no scraper.

---

## 12. Critérios de aceite

1. **Unificação:** depois do reprocessamento, o ranking não mostra dois cards com o mesmo `card_key`, e produtos de demonstração com o mesmo título-base caem no mesmo card.
2. **Anúncio novo:** registrado por qualquer um dos 4 caminhos, entra num card em até 1 rodada da rotina depois da ficha, ou aparece na revisão.
3. **Provisórios:** anúncio provisório não altera o score do card; card só com provisórios aparece com o selo e sem score.
4. **Revisão:** um ADMIN confirma, move, cria card, marca fora do escopo, aprova/junta/descarta tipo e desfaz; um USER não vê nem acessa `/revisao` (403 na API).
5. **Limite diário:** a rotina nunca passa de `FICHA_DAILY_CALL_LIMIT` chamadas/dia contando todos os endpoints, e retoma sozinha no dia seguinte.
6. **Troca de provedor:** trocar `OPENROUTER_API_URL` e o modelo não exige mudança de código.
7. **Qualidade:** `catalog:eval` roda e imprime o relatório.
8. **Testes:** todos os testes das seções 9 passam; nenhum teste existente quebra (exceto os do `ProductMatchingService`, removidos junto com ele).

---

## Anexo A — Taxonomia inicial (primeira versão, **para revisão do usuário**)

**NCM:** 9506.91.00 é o padrão; todo NCM deve ser **confirmado com o despachante** antes de uso fiscal. "a definir" = NULL no banco.

**Variação (não muda o card) para todos os tipos:** cor, marca, voltagem, e o que estiver em "variação" abaixo.

### Cardio

| Família | Tipo (`key` — nome) | Muda o card (valores) | Comparação | Variação | NCM |
|---|---|---|---|---|---|
| `treadmills` (nova) — Esteiras | `treadmill` — Esteira | diferencial: nenhum / chuveiro / plataforma_vibratoria | motor_hp, velocidade_max_kmh, inclinacao_max_pct, carga_max_kg, largura_lona_cm, dobravel | — | 9506.91.00 |
| `treadmills` | `manual_treadmill` — Esteira manual | formato: plana / curva | carga_max_kg, dobravel | — | 9506.91.00 |
| `compact_cardio` — Cardio compacto | `walking_pad` — Walking pad | diferencial: nenhum / (novos pela revisão) | inclinacao_max_pct, velocidade_max_kmh, carga_max_kg, com_barra_apoio, com_controle | — | 9506.91.00 |
| `compact_cardio` | `mini_stepper` — Mini stepper | formato: simples / com_bracos_ou_elasticos | carga_max_kg | — | 9506.91.00 |
| `compact_cardio` | `pedal_exerciser` — Exercitador de pedal | movimento: pedal / eliptico_sentado | motorizado, niveis_resistencia | — | 9506.91.00 |
| `compact_cardio` | `stair_climber` — Simulador de escada | — | carga_max_kg, niveis_resistencia | — | 9506.91.00 |
| `spinning_bike` — Bikes spinning | `spin_bike` — Bike spinning | resistencia: magnetica / friccao | roda_inercia_kg, carga_max_kg, com_app | — | 9506.91.00 |
| `exercise_bikes` (nova) — Bicicletas ergométricas | `upright_bike` — Bicicleta ergométrica | formato: vertical / x_bike_dobravel | carga_max_kg, niveis_resistencia, com_encosto, com_app | — | 9506.91.00 |
| `exercise_bikes` | `recumbent_bike` — Bicicleta reclinada | resistencia: magnetica / friccao | carga_max_kg, niveis_resistencia | — | 9506.91.00 |
| `exercise_bikes` | `air_bike` — Air bike | — | carga_max_kg | — | 9506.91.00 |
| `elliptical_trainer` (nova) — Elípticos | `elliptical` — Elíptico | formato: eliptico / eliptico_bike_2em1 | passada_cm, niveis_resistencia, carga_max_kg, roda_inercia_kg | — | 9506.91.00 |
| `rowing_machine` — Remo | `rowing_machine` — Remo seco | resistencia: magnetica / ar / agua / hidraulica | niveis_resistencia, carga_max_kg, dobravel | — | 9506.91.00 |
| `vibration_plate` — Plataformas vibratórias | `vibration_plate` — Plataforma vibratória | movimento: vibratoria / oscilatoria / dupla | niveis_velocidade, carga_max_kg, potencia_w | — | 9506.91.00 |

### Força e pesos livres

| Família | Tipo | Muda o card | Comparação | Variação | NCM |
|---|---|---|---|---|---|
| `dumbbells` — Halteres | `fixed_dumbbell` — Halter fixo | formato: sextavado / bola / neoprene_vinil / cromado | revestimento | peso_kg, par_ou_unidade | 9506.91.00 |
| `dumbbells` | `adjustable_dumbbell` — Halter ajustável | mecanismo: seletor / rosca_anilhas / conversivel_multifuncao | peso_max_kg, incremento_kg, com_maleta_ou_base | par_ou_unidade | 9506.91.00 |
| `dumbbells` | `dumbbell_handle` — Pegador de halter (peça) | — | comprimento_cm, diametro_mm | par_ou_unidade | 9506.91.00 |
| `kettlebells` — Kettlebells | `kettlebell` — Kettlebell | formato: ferro_fundido / emborrachado_vinil / competicao / ajustavel | — | peso_kg | 9506.91.00 |
| `barbells_plates` (nova) — Barras e anilhas | `barbell` — Barra | formato: olimpica / reta_comum / w_ez / h / montada_fixa | comprimento_m, peso_kg, carga_max_kg | — | 9506.91.00 |
| `barbells_plates` | `weight_plate` — Anilha | formato: bumper / ferro_fundido / emborrachada; furo: olimpico_50mm / comum_28_30mm | — | peso_kg | 9506.91.00 |
| `weight_bench` — Bancos | `weight_bench` — Banco de musculação | formato: reto / regulavel / multifuncional_com_suporte | carga_max_kg, posicoes, dobravel | — | 9506.91.00 |
| `commercial_gym_equipment` — Equipamentos de força | `power_rack` — Rack / gaiola | formato: gaiola_completa / suporte_agachamento / meia_gaiola | carga_max_kg, com_barra_fixa | — | 9506.91.00 |
| `commercial_gym_equipment` | `home_gym_station` — Estação de musculação | formato: estacao_multifuncao / crossover_polia / smith | carga_max_kg, numero_exercicios | — | 9506.91.00 |
| `commercial_gym_equipment` | `leg_press` — Leg press | — | carga_max_kg, angulo | — | 9506.91.00 |
| `ankle_weights` — Caneleiras | `ankle_weight` — Caneleira | formato: fixa / ajustavel | — | peso_kg | 9506.91.00 |

### Calistenia e funcional

| Família | Tipo | Muda o card | Comparação | Variação | NCM |
|---|---|---|---|---|---|
| `pull_up_equipment` — Barras fixas | `pull_up_bar` — Barra fixa | fixacao: porta / parede / teto | carga_max_kg | comprimento_cm | 9506.91.00 |
| `pull_up_equipment` | `pull_up_tower` — Estação de barra | formato: torre / paralelas | carga_max_kg, altura_regulavel | — | 9506.91.00 |
| `push_up_equipment` — Apoio de flexão | `push_up_bars` — Apoio para flexão | formato: alca_fixa / rotativo / prancha_multiposicao | — | — | 9506.91.00 |
| `resistance_bands` — Elásticos | `resistance_band` — Elástico / faixa | formato: mini_band / super_band_longa / tubo_com_alcas / faixa_tecido | quantidade, niveis | — | 9506.91.00 |
| `ab_wheel` — Roda abdominal | `ab_wheel` — Roda abdominal | formato: simples / dupla / retorno_automatico | — | — | 9506.91.00 |
| `jump_rope` — Cordas | `jump_rope` — Corda de pular | formato: speed_aco / com_peso / contador_digital | — | comprimento | 9506.91.00 |
| `functional_training` — Treino funcional | `battle_rope` — Battle rope | — | comprimento_m, diametro_mm | — | 9506.91.00 |
| `functional_training` | `plyo_box` — Caixa pliométrica | material: madeira / espuma / metal | alturas_cm | — | 9506.91.00 |
| `functional_training` | `suspension_trainer` — Fita de suspensão | — | — | — | 9506.91.00 |
| `functional_training` | `weighted_ball` — Bola de peso | formato: slam_ball / medicine_ball / wall_ball | — | peso_kg | 9506.91.00 |
| `functional_training` | `sandbag` — Sandbag | — | — | peso_kg | 9506.91.00 |
| `functional_training` | `gymnastic_rings` — Argolas | material: madeira / plastico | — | — | 9506.91.00 |
| `functional_training` | `hand_grip` — Hand grip | formato: fixo / ajustavel | carga_max_kg | — | 9506.91.00 |

### Yoga, pilates e recuperação

| Família | Tipo | Muda o card | Comparação | Variação | NCM |
|---|---|---|---|---|---|
| `yoga_mat` — Tapetes | `yoga_mat` — Tapete / colchonete | material: eva / tpe / pvc / borracha_natural / cortica | espessura_mm, comprimento_cm | — | 9506.91.00 (confirmar) |
| `yoga_pilates` — Pilates | `pilates_ball` — Bola de pilates | — | — | diametro_cm | 9506.91.00 |
| `yoga_pilates` | `pilates_ring` — Anel de pilates | — | — | — | 9506.91.00 |
| `yoga_pilates` | `foam_roller` — Rolo de liberação | formato: liso / texturizado | — | comprimento_cm | 9506.91.00 (confirmar) |
| `recovery_massage` — Recuperação | `massage_gun` — Pistola massageadora | formato: mini / padrao | amplitude_mm, velocidades, cabecas | — | 9019.10.00 (confirmar) |
| `recovery_massage` | `vibrating_roller` — Rolo vibratório | — | velocidades | — | 9019.10.00 (confirmar) |
| `recovery_massage` | `neck_massager` — Massageador de pescoço | — | — | — | 9019.10.00 (confirmar) |

### Acessórios e smart

| Família | Tipo | Muda o card | Comparação | Variação | NCM |
|---|---|---|---|---|---|
| `protective_gear` — Proteção | `gym_gloves` — Luva de treino | — | — | tamanho | a definir |
| `protective_gear` | `lifting_belt` — Cinturão | material: couro / neoprene_nylon | espessura_mm | tamanho | a definir |
| `protective_gear` | `knee_sleeve` — Joelheira | — | espessura_mm | tamanho | a definir |
| `protective_gear` | `wrist_wrap` — Munhequeira | — | — | — | a definir |
| `protective_gear` | `hand_grips_cross` — Grip de cross training | — | — | tamanho | a definir |
| `smart_fitness` — Smart fitness | `smart_scale` — Balança de composição | — | metricas | — | 8423.10.00 (confirmar) |
| `smart_fitness` | `rep_sensor` — Sensor de repetições | — | — | — | a definir |
| `smart_fitness` | `smart_mirror` — Espelho de treino | — | tamanho_pol | — | a definir |
| `smart_fitness` | `led_reaction_platform` — Plataforma de reação LED | — | — | — | a definir |

**Fora do escopo** (`in_scope = false`): bolsas, pochetes, braçadeiras de celular, roupas, calçados, fones, caixas de som, suplementos, itens infantis que não são treino.

**Pontos para o usuário revisar neste anexo:**
1. famílias novas (`treadmills`, `exercise_bikes`, `elliptical_trainer`, `barbells_plates`);
2. se algum "muda o card" deveria ser só comparação (ou o contrário);
3. se `protective_gear` e `smart_fitness` ficam no escopo.
