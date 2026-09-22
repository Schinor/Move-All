# Especificação — Subprojeto D: Descoberta pelos termos em alta + acompanhamento por níveis

**Status:** escopo aprovado pelo usuário em 2026-09-22 (partes 1, 2 e 3). Aguardando revisão do texto.
**Depende de:** Subprojetos A, A2, B e C (branch `feat/catalogo-card`).
**Executor previsto:** Codex, a partir de `PLANO_SUBPROJETO_D_DESCOBERTA.md` (raiz).

## 1. Objetivo

Entregar o básico, sem implementações adicionais:

1. **Termos em alta → busca de anúncios novos.** As buscas em alta que o radar (C) já grava viram uma lista filtrada. O ADMIN aprova ou ignora cada termo, e os aprovados são buscados nos marketplaces na coleta semanal. Os anúncios novos seguem o caminho que já existe: ficha → card (atribuição automática do A2) → revisão nos casos incertos.
2. **Acompanhamento por níveis.** A frequência de revisita de cada anúncio passa a ser recalculada pela regra "top 50 / descoberta / radar / demais", com vagas por nível que cabem no orçamento atual de raspagens.
3. **Pré-requisito e correção:** validar a LLM de fichas antes de qualquer busca real e corrigir os acentos quebrados de algumas coletas do radar.

## 2. Decisões do usuário

| # | Decisão |
|---|---|
| D-D1 | **O ADMIN aprova cada termo.** Nada é buscado sozinho. A lista já vem sem o ruído óbvio. "Ignorar" esconde o termo de vez, mas ele pode ser restaurado na aba Ignorados. |
| D-D2 | **A lista fica numa aba nova da página Revisão**, chamada "Termos em alta", ao lado de "Anúncios provisórios" e "Tipos novos sugeridos". Não há página nem item de menu novo, e **Mercados continua desativado**. |
| D-D3 | **Busca na coleta semanal** (segunda, 03:00), com até 5 termos aprovados por semana. Termo BR → `amazon_br`, `mercado_livre` e `shopee_br`. Termo US → `amazon`, `alibaba`, `aliexpress` e `1688`. Até 10 anúncios por marketplace. Sem botão "buscar agora". |
| D-D4 | **Níveis pelo card: top 50 / radar / demais.** Nível 1 (a cada 3,5 dias) para os anúncios dos 50 cards de maior score. Nível 2 (semanal) para os anúncios da descoberta recente e dos cards cujo tipo está em alta no radar. Nível 3 para o resto. |
| D-D5 | **Vagas por nível dentro do orçamento atual:** nível 1 com até 80 anúncios, nível 2 com até 100 e o resto no nível 3, com revisita **mensal**. O orçamento continua sendo 50 raspagens por dia, cerca de 360 por semana. |
| D-D6 | **Antes de qualquer busca real, a LLM de fichas é validada** (`catalog:eval`) com o ok do usuário. Se não passar, a busca continua desligada e a decisão sobre um modelo pago volta para o usuário. |
| D-D7 | **A aba Anúncios do card ganha a coluna "Acompanhamento"**, com o nível, a frequência, o motivo e a última coleta. Só informa. O histórico já aparece na aba Adoção e não muda. |

## 3. Como é hoje (fatos do código e dos dados)

- **Radar (C):** a tabela `search_trend_snapshots` guarda `related_rising` como `[{query, value, label, breakout}]` para cada tipo e país. Nas coletas mais recentes com status `ok` há **814 termos em alta nos US e 68 no BR**, com muito ruído. Exemplos: em `adjustable_dumbbell`/US aparecem "coffee grinder", "solar panels" e "hotel booking"; em `ab_crunch_machine`/US aparecem nomes de exercícios ("goblet squat", "hip thrust machine").
- **Acentos quebrados:** 12 das 341 coletas têm texto como "acupressÃ£o" em `related_rising`. A causa provável é `BrightDataClient._decode_mcp_response` (`app/etl/extract/marketplace/common.py`), que usa `response.iter_lines(decode_unicode=True)` e `response.text`. Numa resposta `text/event-stream` sem charset, o `requests` decodifica como ISO-8859-1.
- **Coleta de um termo avulso:** `IntelligenceCollectionService.start(dto)` cria um `collection_job` e roda `main.py --pipeline live-intelligence --term … --sources … --limit … --geos … [--skip-demand]`. Depois, `execute()` passa os anúncios por `FichaService.registerListing` (a porta única das fichas). O Python registra anúncios novos em `tracked_listings` como `CANDIDATE`/nível 3, com `discovered_by_term = termo` (`app/etl/load/tracked.py → register_new_listings`), e devolve `tracked_new` no resumo.
- **Atenção:** em `run_live_intelligence.py`, `_source_term()` **troca o termo pedido** pelo termo padrão do grupo no `keyword_map` quando o termo pertence a um grupo conhecido. Para a descoberta, o termo precisa ser buscado **literalmente**.
- **Coleta semanal:** `WeeklyCollectionScheduler` (cron `0 3 * * 1`, só em produção ou com `WEEKLY_COLLECTION_CRON_ENABLED=true`) → `startWeekly` → `executeWeekly` → `runPythonWeekly`.
- **Acompanhamento:** `TrackListingsScheduler` (cron diário `0 2 * * *`, mesma regra de ativação) → `executeTrackListings` → Python `run_track_listings.py` (orçamento `TRACK_LISTINGS_MAX_CALLS`, padrão 50, ordem por nível e depois por `next_due_at`; `TIER_CADENCE_DAYS = {1: 3.5, 2: 7.0, 3: 14.0}`). Depois vêm o Monte Carlo em lote e **`promoteTiers()`**, que hoje faz: top 50 por `ProductScore` mais a watchlist → nível 1; posições 51–300 → nível 2; o resto → nível 3. **Não há vagas**, e o recálculo acontece a cada execução do acompanhamento.
- **Dados locais:** 609 `tracked_listings` (todos `ACTIVE`, 300 no nível 1 e 309 no nível 2), todos com `product_id` (que é o id do card, `product_clusters.id`). 47.502 `listing_observations`, todas sintéticas. 74 cards com itens contados, com cerca de 8,5 anúncios por card. A watchlist está vazia.
- **Revisão:** `features/revisao` (Angular) e `CatalogReviewController` (`@UseGuards(AdminGuard)`, prefixo `catalog`). A aba Anúncios do card usa `GET /catalog/cards/:id/listings` → `CatalogReviewService.listCardListings`.
- **Fichas:** `FICHA_ENABLED` liga a rotina. O `catalog:eval` (`scripts/catalog-eval.ts`) usa `test/fixtures/catalog-eval/listings-gold.json` e imprime: tipo nos casos claros e ambíguos, por idioma, fora do escopo, acessório e "Sem resposta". No último eval, 4 de 7 lotes voltaram vazios, e 502 das 712 fichas vieram de regras (`llm_model = 'codex-manual'`).
- **Taxonomia:** `prisma/seed/catalog-taxonomy.json` tem, para cada tipo, `key`, `name_pt`, `family` e `trend_terms {pt, en}`. Os termos do radar ficam em `keyword_terms` (`category` = chave do tipo).
- Lições anteriores: scripts locais precisam de `INCLUDE_SYNTHETIC_DATA=true` e de `PYTHON_BIN=/usr/local/bin/python3`.

## 4. Parte 0 — Pré-requisito: validar a LLM de fichas

- **Parada de segurança:** o executor pede o ok do usuário antes de rodar o `npm run catalog:eval`, que faz cerca de 7 chamadas das 50 diárias do modelo gratuito.
- **Passa se:** "Sem resposta" ≤ 10% dos itens **e** acerto de tipo nos casos claros ≥ 85%.
- **Se não passar:** com um novo ok, repetir com `FICHA_BATCH_SIZE=5` (cerca de 28 chamadas). Se falhar de novo, registrar o resultado e **seguir com o resto do D**. A busca real (Parte 2) fica desligada até o usuário decidir.
- O resultado (números e modelo) vai para o relatório final do executor. **Não** refazer as fichas `codex-manual` neste subprojeto.

## 5. Parte 1 — Termos em alta

### 5.1 Tabela `discovery_terms` (migration nova)

| Coluna | Tipo | Observação |
|---|---|---|
| id | uuid | PK |
| type_key | text | tipo do radar de onde o termo veio |
| geo | text | `BR` ou `US` |
| term | text | texto como veio do Trends (depois da correção de acentos) |
| term_norm | text | minúsculas, sem acento, sem pontuação, espaços simples |
| rising_value | int | `value` do Trends |
| rising_label | text | ex.: "+350%" ou "Breakout" |
| breakout | boolean | |
| status | text | `new` \| `approved` \| `searched` \| `ignored` (padrão `new`) |
| first_seen_at / last_seen_at | timestamp | |
| decided_by | uuid null | usuário que aprovou, ignorou ou restaurou |
| decided_at | timestamp null | |
| searched_at | timestamp null | |
| search_job_id | uuid null | `collection_jobs.id` da busca |
| new_listings | int null | `tracked_new` da busca |
| search_error | text null | último erro. O termo continua `approved` e é tentado de novo na semana seguinte |

Índices: único em `(geo, term_norm)` e um em `status`.

### 5.2 Filtro de ruído e atualização da lista

Função pura `buildDiscoveryCandidates(snapshots, types)` no backend (`src/modules/radar-discovery/discovery-candidates.ts`). A comparação com o que já está no banco (item 7) fica no serviço. Para cada coleta mais recente com status `ok` de cada `(type_key, geo)`, e para cada item de `related_rising`:

1. **Normalizar** o texto (`term_norm`): minúsculas, sem acento, só `[a-z0-9 ]` e espaços simples.
2. **Descartar perguntas e conteúdo:** o termo sai se tiver **qualquer** uma destas palavras (lista `BLOCK_WORDS`): `what, is, are, how, why, when, who, which, does, do, can, vs, versus, benefits, benefit, beneficios, beneficio, meaning, significado, near, como, que, qual, quais, serve, funciona, funcionam, calories, calorias, exercises, exercise, exercicios, exercicio, workout, workouts, routine, rotina, plan, plano, class, classes, aula, aulas, lesson, lessons, tutorial, video, videos, youtube, reddit, wiki, definition, definicao, lunges, squats, squat, curls, curl, press, pushups, results, resultados, before, after, antes, depois, diet, dieta, loss, emagrecer, emagrece, best, melhor, melhores, review, reviews, top`.
3. **Vocabulário do tipo:** as palavras de `trend_terms.pt` e de `trend_terms.en`, normalizadas. Cada palavra vale também sem o "s" final.
4. **Palavras que não contam** para a comparação: palavras com menos de 3 letras e a lista `GENERIC_WORDS`: `de, da, do, das, dos, para, com, sem, em, the, for, with, and, of, me, buy, price, preco, cheap, barato, used, usado, amazon, machine, maquina, aparelho, equipment, equipamento, set, kit, fitness, gym, academia, home, casa`.
5. **O termo fica** se tiver pelo menos uma palavra que conta em comum com o vocabulário do tipo **e** não for igual ao `trend_terms` (pt ou en) de **nenhum** tipo, porque esse termo já é acompanhado pelo radar.
6. **No máximo 3 por coleta:** de cada `(type_key, geo)`, entram só os 3 termos que sobraram com maior `rising_value`.
7. **Deduplicação:** se `(geo, term_norm)` já existir, só se atualizam `last_seen_at`, `rising_value`, `rising_label` e `breakout`. O **status nunca muda aqui**, então ignorado continua ignorado. Se o mesmo termo aparecer em dois tipos na mesma rodada, fica o de maior `rising_value`.

Exemplos que viram teste: "coffee grinder" (adjustable_dumbbell) **sai**; "hip thrust machine" (ab_crunch_machine) **sai**; "what is pilates" **sai**; "best adjustable dumbbells" **sai**; "ab roller with elbow support" (ab_wheel) **fica**; "adjustable aerobic step" (aerobic_step) **fica**; "nike adjustable dumbbells" (adjustable_dumbbell) **fica**.

Medido com os dados de 2026-09-22 (antes da regra, 814 termos US e 68 BR): **201 US e 36 BR** entram na primeira vez. Ainda sobra algum ruído (ex.: "phase 10 twist board game" em `twister_disc`), e o ADMIN ignora esses termos. Nas semanas seguintes só aparecem os termos novos.

**Quando roda:** um cron diário no Nest (`DISCOVERY_TERMS_CRON`, padrão `0 6 * * *`, `America/Sao_Paulo`). Ele só lê e grava no banco e é idempotente, então fica sempre ligado. Também roda pelo script `npm run discovery:refresh` (`--dry-run` imprime o que entraria, sem gravar).

### 5.3 API (só ADMIN, módulo novo `radar-discovery`, `@UseGuards(AdminGuard)`)

O `src/modules/discovery/` que já existe atende outra rota (`dashboard/quote`) e **não** é usado nem alterado.

- `GET /discovery/terms?status=new|approved|searched|ignored&geo=BR|US&family=<key>` → lista com `id`, `term`, `geo`, `type_key`, `type_name`, `family_key`, `rising_label`, `breakout`, `first_seen_at`, `last_seen_at`, `status`, `searched_at`, `new_listings` e `search_error`. A aba `new` vem ordenada por `breakout` desc e depois por `rising_value` desc. As outras vêm por `decided_at` desc.
- `GET /discovery/terms/counts` → `{ new, approved, searched, ignored }`.
- `POST /discovery/terms/:id/approve` (só de `new`), `POST /discovery/terms/:id/ignore` (de `new` ou `approved`) e `POST /discovery/terms/:id/restore` (de `ignored` para `new`). Cada ação grava `decided_by` (o id do usuário no JWT) e `decided_at`. Uma transição inválida devolve 409.

### 5.4 Tela (aba na Revisão)

- `features/revisao` já tem as abas **"Anúncios provisórios"** e **"Tipos novos sugeridos"**. Ela ganha a terceira aba, **"Termos em alta"**, feita como um componente filho. As outras duas não mudam.
- A aba "Termos em alta" tem:
  - chips **Novos (n)**, **Aprovados (n)** e **Ignorados (n)**. "Aprovados" mostra os `approved` e os `searched`;
  - filtro **BR / US** e filtro de família;
  - tabela com tipo, país, termo, alta ("+350%" ou "Breakout") e "visto em" (há quanto tempo desde `first_seen_at`);
  - botões **Buscar produtos** (aprovar) e **Ignorar** em Novos, e **Restaurar** em Ignorados;
  - em Aprovados, a coluna "Situação" mostra: "Na fila: entra na próxima coleta" (`approved`), "Buscado em dd/mm: N anúncios novos" (`searched`) ou "Erro na última busca: …" (`approved` com `search_error`).
- O contador do menu (Revisão) **não muda**. Ele continua contando só os anúncios provisórios.

## 6. Parte 2 — Busca dos termos aprovados

- **Python:** a nova opção `--exact-term` no `live-intelligence` faz `_source_term()` devolver o **termo pedido** para todas as fontes. O grupo continua sendo resolvido como hoje, só para a classificação. Sem a opção, nada muda.
- **Nest:**
  - `RunIntelligenceCollectionDto` ganha `exactTerm?: boolean`, e `runPython` passa `--exact-term`.
  - O `IntelligenceCollectionService` ganha o método público `runTermAndWait(dto, category)`. Ele cria o `collection_job` com a categoria informada e **espera** o `execute()` terminar. Devolve o job, com `stats.tracked_new`.
- **`DiscoverySearchService.runApproved({ dryRun })`:**
  - só roda se `RADAR_DISCOVERY_ENABLED === 'true'` **e** `FICHA_ENABLED === 'true'`. Se não, devolve `{ skipped: 'disabled' }`;
  - pega até `RADAR_DISCOVERY_MAX_TERMS` (padrão 5) termos `approved`, do `decided_at` mais antigo para o mais novo;
  - para cada termo, **um por vez**, roda `runTermAndWait` com: `term`, as fontes do país (§2 D-D3), `limit = RADAR_DISCOVERY_LIMIT_PER_SOURCE` (padrão 10), `geos = [geo]`, `includeDemand = false`, `exactTerm = true` e a categoria `radar_discovery`;
  - se der certo: `status = searched`, com `searched_at`, `search_job_id`, `new_listings = stats.tracked_new ?? 0` e `search_error = null`;
  - se falhar (job `FAILED` ou exceção): grava `search_error` (até 500 caracteres) e mantém `approved`. **Continua** com o próximo termo;
  - em `dryRun`, só lista os termos e as fontes, sem chamar nada.
- **Onde roda:** no início de `executeWeekly`, antes de `runPythonWeekly`. Um erro aqui **não** derruba a coleta semanal, só vai para o log e para `stats.radar_discovery` do job semanal.
- **Script:** `npm run discovery:search -- --dry-run | --apply [--max-terms N]`. É usado na verificação local e na primeira busca real, que é uma parada de segurança (§10).

## 7. Parte 3 — Acompanhamento por níveis

### 7.1 Regra (função pura `assignTiers(input)` em `src/modules/ingestion/tracking-tiers.ts`)

**Entrada:**
- anúncios `ACTIVE` e `CANDIDATE` com `product_id` (o card), `reviews` (o `reviews_count` da observação mais recente) e `first_seen_at`, e se vieram da descoberta;
- o score mais recente de cada card (a mesma lógica de hoje em `promoteTiers`);
- os cards da watchlist;
- os cards em alta no radar, com a maior `growth_12w` entre BR e US.

**Configuração:** `TRACK_TOP_CARDS` (50), `TRACK_TIER1_SLOTS` (80), `TRACK_TIER2_SLOTS` (100), `TRACK_RADAR_MIN_GROWTH` (0.20) e `TRACK_DISCOVERY_WINDOW_DAYS` (30).

**Definições:**
- **Top cards:** a watchlist primeiro, depois os `TRACK_TOP_CARDS` cards de maior score (nulo por último; empate pelo id).
- **Card em alta:** o tipo do card (`product_clusters.type_id` → `catalog_types.key`) tem uma coleta `ok` mais recente com `growth_12w ≥ TRACK_RADAR_MIN_GROWTH` no BR ou nos US.
- **Anúncio da descoberta:** `discovered_by_term` corresponde a um `discovery_terms` com status `searched` (comparado por `term_norm`) e `first_seen_at ≥ agora − TRACK_DISCOVERY_WINDOW_DAYS`.
- **Rodízio:** os cards são percorridos em ordem, pegando 1 anúncio de cada por volta. Dentro de cada card, a ordem é `reviews` desc (nulo por último) e depois `native_id`.

**Preenchimento (cada anúncio entra em um só nível):**
1. **Nível 1** (até `TRACK_TIER1_SLOTS`): rodízio sobre os top cards. Motivo: `watchlist` se o card está na watchlist; senão, `top50`.
2. **Nível 2** (até `TRACK_TIER2_SLOTS`), nesta ordem:
   - (a) anúncios da descoberta, do `first_seen_at` mais novo para o mais antigo. Motivo `descoberta`;
   - (b) rodízio sobre os cards em alta, com os de maior `growth_12w` primeiro. Motivo `radar`;
   - (c) rodízio sobre o que sobrou dos top cards. Motivo `top50`.
3. **Nível 3:** todo o resto. Motivo `demais`.

**Saída por anúncio:** `{ id, tier, reason }`.

### 7.2 Serviço e gravação

- `TrackingTiersService.recalculate({ dryRun, now })` carrega os dados, aplica as mudanças de status (§7.3), chama `assignTiers` e grava `tier`, `tier_reason` e `tier_updated_at` **só quando mudou**. Devolve `{ tier1, tier2, tier3, by_reason, status_changes, estimated_weekly_calls }`, em que `estimated_weekly_calls = Σ 7 ÷ cadência(nível)`.
- **Próxima visita:** se o anúncio **subiu** de nível, `next_due_at = min(next_due_at, (last_success_at ?? agora) + cadência(novo nível))`. Se desceu ou ficou igual, `next_due_at` não muda.
- **Cadência** em TS (`TRACK_CADENCE_DAYS = {1: 3.5, 2: 7, 3: 30}`) e no Python (`TIER_CADENCE_DAYS` em `run_track_listings.py`, com o nível 3 passando de 14 para **30**). Um comentário em cada lado aponta para o outro.
- **Substitui `promoteTiers()`**, no mesmo lugar: depois de cada execução do acompanhamento. O resultado vai para `stats.tiers` do job. Os testes antigos de `promoteTiers` são trocados pelos novos.
- **Script:** `npm run tracking:recalc -- --dry-run | --apply`, que imprime o resumo.
- Migration: `tracked_listings` ganha `tier_reason text null` e `tier_updated_at timestamp null`.

### 7.3 Mudanças de status (no mesmo recálculo, antes dos níveis)

- Anúncio cuja ficha tem `in_scope = false` → `IGNORED`.
- Anúncio sem `product_cluster_items` e com ficha `done` → `IGNORED`. Se a ficha estiver pendente ou não existir, nada muda.
- `CANDIDATE` com item `confirmed` ou `auto` → `ACTIVE`. Um provisório continua `CANDIDATE` e é acompanhado.
- `IGNORED` e `DEAD` ficam fora dos níveis. O histórico (`listing_observations`) **nunca** é apagado.
- A relação com as fichas e os itens é feita por `tracked_listings.source = marketplace` e `native_id = external_product_id`.

### 7.4 Coluna "Acompanhamento" na aba Anúncios

- `listCardListings` passa a devolver `tracking: { status, tier, reason, cadence_days, last_success_at } | null`, buscando em `tracked_listings` por `(source, native_id)`.
- `card-listings-table` ganha a coluna **Acompanhamento**:
  - "Nível 1 · a cada 3,5 dias", "Nível 2 · semanal" ou "Nível 3 · mensal";
  - o motivo como dica (tooltip): watchlist, top 50, descoberta, radar ou demais;
  - "última: dd/mm";
  - `IGNORED` → "Fora do acompanhamento", `DEAD` → "Anúncio encerrado" e `null` → "—".

## 8. Parte 4 — Correção dos acentos do radar

- Em `_decode_mcp_response`, definir `response.encoding = "utf-8"` antes de `iter_lines` e de `response.text`.
- Teste: uma resposta SSE sem charset com "acupressão" volta com o acento certo.
- Script único `Move-Intelligence-Dados/scripts/repair_trends_encoding.py --dry-run | --apply`. Nas colunas `term`, `related_rising` e `related_top` de `search_trend_snapshots`, onde houver `Ã` ou `Â`, aplica `texto.encode('latin-1').decode('utf-8')`. Se a conversão falhar, mantém o original. Imprime quantas linhas mudou. Não chama a Bright Data.

## 9. Variáveis de ambiente novas

| Variável | Padrão | Onde |
|---|---|---|
| `RADAR_DISCOVERY_ENABLED` | `false` | Nest |
| `RADAR_DISCOVERY_MAX_TERMS` | `5` | Nest |
| `RADAR_DISCOVERY_LIMIT_PER_SOURCE` | `10` | Nest |
| `DISCOVERY_TERMS_CRON` | `0 6 * * *` | Nest |
| `TRACK_TOP_CARDS` | `50` | Nest |
| `TRACK_TIER1_SLOTS` | `80` | Nest |
| `TRACK_TIER2_SLOTS` | `100` | Nest |
| `TRACK_RADAR_MIN_GROWTH` | `0.20` | Nest |
| `TRACK_DISCOVERY_WINDOW_DAYS` | `30` | Nest |

Documentar no `.env.example` do backend. **Não** mexer nos `docker-compose*.yml`, que têm alterações do usuário fora deste trabalho.

## 10. Paradas de segurança (o executor para e pede o ok)

1. Antes do `catalog:eval` e de qualquer repetição dele (chamadas à LLM).
2. Antes da primeira busca real (`discovery:search -- --apply --max-terms 1`, cerca de 35 raspagens da Bright Data).
3. Qualquer outra chamada à LLM ou à Bright Data que não esteja nesta lista.

Não são paradas: `discovery:refresh`, `tracking:recalc -- --apply`, `repair_trends_encoding.py --apply` e as migrations, porque só mexem no banco local.

## 11. Não fazer

- Aprovação automática de termos, botão "buscar agora" e busca fora da coleta semanal.
- Selo no Ranking, página Mercados e mudança no score.
- Embeddings (Subprojeto E).
- Refazer as fichas `codex-manual` pela LLM.
- Trocar termos do radar sem volume.
- Ligar crons em produção ou editar `docker-compose*.yml`.
- Mudar o contador do menu da Revisão.
- Apagar histórico ou anúncios.

## 12. Testes e critérios de aceite

- **Backend (jest):**
  - `buildDiscoveryCandidates`: os 7 exemplos do §5.2, o limite de 3 por coleta, deduplicação que preserva o status, termo igual ao `trend_terms` de outro tipo sai, e fica o de maior valor quando o termo se repete;
  - controller: não ADMIN → 403, transições válidas e 409 nas inválidas, `decided_by` gravado;
  - `DiscoverySearchService`: desligado → `skipped`, fontes por país, `exactTerm` e `includeDemand=false` enviados, sucesso → `searched` com `new_listings`, falha → `search_error` e continua com o próximo termo, limite de termos respeitado;
  - `assignTiers`: vagas, rodízio, watchlist primeiro, ordem (a)(b)(c) do nível 2, sobra do top 50, cada anúncio em um só nível e motivos;
  - `recalculate`: próxima visita adiantada só quando sobe, mudanças de status do §7.3, grava só o que mudou e `estimated_weekly_calls`;
  - `listCardListings` com `tracking`.
- **Python (pytest):** `--exact-term` (termo literal em todas as fontes; sem a opção, comportamento igual ao de hoje), `TIER_CADENCE_DAYS[3] == 30`, decodificação UTF-8 do SSE e o script de reparo (dry-run não grava, texto quebrado vira correto).
- **Frontend (vitest):** abas da Revisão, chips e contagens, aprovar/ignorar/restaurar chamam a API certa, situação em Aprovados e coluna Acompanhamento com os textos do §7.4.
- **Verificação local (sem chamadas externas):**
  - `discovery:refresh --dry-run` e depois sem dry-run: mostra quantos termos entraram por país (esperado: cerca de 200 US e 36 BR) e prova que "coffee grinder" não está na lista;
  - `tracking:recalc --dry-run`: níveis 80 / 100 / resto e `estimated_weekly_calls` ≤ 400;
  - `discovery:search --dry-run` com um termo aprovado de teste;
  - tela da Revisão e coluna no navegador;
  - suítes completas verdes (backend, Python e frontend), `tsc` e build.
