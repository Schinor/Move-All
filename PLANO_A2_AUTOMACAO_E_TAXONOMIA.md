# Plano A2 — Atribuição automática de anúncios provisórios + taxonomia ampliada

> **Para o agente executor (Codex):** execute UMA tarefa por vez, na ordem. Ao terminar cada tarefa: marque os checkboxes, mostre a saída dos testes e o `git diff --stat`, e **espere o "ok"** do usuário antes da próxima. Se um teste deste plano falhar de um jeito que o plano não previu, pare e explique.

**Contexto:** complemento do Subprojeto A (`SPEC_SUBPROJETO_A_CATALOGO_CARD.md` e `PLANO_SUBPROJETO_A_CATALOGO_CARD.md`, já executados). Hoje 188 anúncios estão na fila de revisão como provisórios e isso não escala: uma pessoa não pode aprovar card por card.

**Decisão do usuário (2026-09-19):** "Automático em camadas". Anúncios atribuídos automaticamente **entram no score**, recebem o selo "automático" e podem ser desfeitos. A revisão humana fica só para empates reais e tipos novos. Além disso, a taxonomia deve ser ampliada ao máximo agora, para evitar trabalho manual durante o desenvolvimento.

## Regras globais (valem para todas as tarefas)

- **Proibido chamar LLM/OpenRouter.** Mantenha `FICHA_ENABLED=false`. Não rode `catalog:eval` nem nenhum endpoint de IA. Ao final de cada tarefa que mexe no banco, mostre a contagem de `ai_call_logs` antes e depois; ela não pode mudar.
- Sem commit, sem push, sem branch nova (branch atual: `feat/catalogo-card`). Não reverta alterações existentes não commitadas.
- Banco: só mudanças aditivas. Nada de `prisma db push`. Migration nova em `prisma/migrations/`.
- Não crie nada fora do que está aqui (sem telas novas, sem filas BullMQ, sem configurações extras).
- Testes: backend com jest (`npm test` em `Move-Intelligence-Back`) e frontend com vitest (`npx ng test --watch=false` em `Move-Intelligence-Front`). Siga o padrão dos arquivos `*.spec.ts` vizinhos.

## Dados de hoje (para conferir o efeito)

| Motivo do provisório | Anúncios |
|---|---|
| falta a especificação (mecanismo, resistência, material, formato, movimento, fixação) | 164 |
| diferencial novo (smart, com_cordas, dobravel_viagem, bluetooth) | 19 |
| ficha falhou | 5 |

Anúncios com "falta a especificação" por quantidade de cards confirmados do mesmo tipo: 1 card → 62; 2 cards → 36; 3 → 32; 4 → 16; 5 → 5; nenhum → 13.

---

### Tarefa 1 — Correções da tela de revisão

**Arquivos:** `Move-Intelligence-Front/src/app/features/revisao/revisao.component.ts` (+ `.html` e `.spec.ts` do mesmo componente)

- [x] `openApprove(item)`: preencha `namePt` com uma sugestão derivada da chave (`pilates_reformer` → `Pilates reformer`: troque `_` por espaço e deixe só a primeira letra maiúscula). O usuário pode editar.
- [x] A mensagem de validação ("Preencha família, chave e nome.") deve aparecer **ao lado do botão "Salvar tipo"** do formulário aberto, e não só no topo da página.
- [x] Quando `reviewCounts()` ou `reviewList()` falharem (403, 500, rede), mostre "Não foi possível carregar a fila (erro N)." no lugar de "0" / "Nenhum anúncio aguardando revisão".
- [x] Testes: (a) sugestão de nome ao abrir o formulário; (b) erro exibido junto do formulário; (c) resposta 403 mostra a mensagem de erro, e não "Nenhum anúncio".

Execução em 19/09/2026: o teste isolado de `revisao.component.spec.ts` passou (5/5), cobrindo os três cenários acima. A suíte frontend completa passou (11 arquivos/43 testes) usando `NODE_OPTIONS=--localstorage-file=/private/tmp/move-front-vitest-localstorage`, necessário no Node `v25.9.0` para disponibilizar `localStorage` no Vitest.

---

### Tarefa 2 — Base para decisões automáticas

**Arquivos:** nova migration `prisma/migrations/20260919120000_catalog_auto_assign/migration.sql`, `prisma/schema.prisma`, e cada lugar que trata o status do item.

- [x] Migration: `ALTER TABLE catalog_decisions ALTER COLUMN actor_user_id DROP NOT NULL;`. Ajuste o `schema.prisma` (`actorUserId String?`). `actor_user_id = NULL` significa **decisão automática do sistema**.
- [x] `product_cluster_items.status` ganha o valor **`auto`** (a coluna é texto, então não precisa de migration). Significado: atribuído automaticamente, **conta como confirmado** para score, métricas e status do card.
- [x] Rode `grep -rn "'confirmed'" Move-Intelligence-Back/src` e trate `auto` igual a `confirmed` em todo lugar que decide o que entra no score ou se o card é confirmado. Isso inclui, no mínimo: `card-assigner.service.ts` (`refreshCard`/`hasConfirmed`), as CTEs de card em `dashboard-api` (`card_stats`, `br_price`) e `catalog-review.service.ts` (`listCardListings`). Crie a constante `COUNTED_ITEM_STATUSES = ['confirmed', 'auto'] as const` em `catalog.constants.ts` e use nesses lugares.
- [x] Frontend: na aba "Anúncios", o status `auto` aparece como selo **"automático"** (mesmo estilo do selo "provisório", com cor neutra). Ajuste o tipo do status no `contract.models.ts`.
- [x] O desfazer (`POST /catalog/decisions/:id/undo`) tem que funcionar para decisões com `actor_user_id` nulo: o anúncio volta para `provisional` e o item de revisão volta para `pending`.
- [x] Testes: card só com itens `auto` fica `confirmed`; item `auto` entra na contagem de score; desfazer uma decisão automática.

Execução em 19/09/2026: criada a migration `20260919120000_catalog_auto_assign`, schema Prisma validado e cliente regenerado. Inicialmente a migration não estava aplicada; durante o rebuild local do Compose, o backend foi reiniciado pela dependência do frontend e seu `RUN_DB_PUSH_ON_BOOT=true` sincronizou o schema local, deixando `actor_user_id` nullable. `COUNTED_ITEM_STATUSES` foi usado no refrescamento do card, seleção de itens contados, comparação, CTEs `card_stats`/`br_price`, `listCardListings` e contratos/mapeamentos de anúncios. O teste direcionado backend passou 31/31, o frontend do selo passou 1/1, e a suíte backend completa passou 51 suítes/413 testes. Nenhuma chamada foi emitida pelos comandos do plano; o backend ambientemente gerou 4 erros adicionais de `ai_recommendation_card` antes de ser parado.

---

### Tarefa 3 — Decisão automática (função pura)

**Arquivos:** criar `Move-Intelligence-Back/src/modules/catalog/auto-assign.ts` e `auto-assign.spec.ts`. Adicionar a `catalog.constants.ts` a função `autoAssignConfig(env)`, no mesmo padrão de `fichaConfig`.

```ts
export interface AutoAssignConfig {
  enabled: boolean;            // CATALOG_AUTO_ASSIGN_ENABLED, padrão true
  minSimilarity: number;       // CATALOG_AUTO_MIN_SIMILARITY, padrão 0.35
  minMargin: number;           // CATALOG_AUTO_MIN_MARGIN, padrão 0.10
  diffMinListings: number;     // CATALOG_AUTO_DIFF_MIN_LISTINGS, padrão 3
  diffMinMarketplaces: number; // CATALOG_AUTO_DIFF_MIN_MARKETPLACES, padrão 2
  maxRequeues: number;         // CATALOG_AUTO_MAX_REQUEUES, padrão 2
}

export interface Candidate { clusterId: string; similarity: number; countedItems: number }

export type AutoDecision =
  | { kind: 'assign'; clusterId: string; rule: 'single_candidate' | 'best_similarity' }
  | { kind: 'review'; reason: string };

/** Camadas 1 e 2. Os candidatos já vêm filtrados: mesmo tipo, card ativo e especificações conhecidas iguais. */
export function decideMissingSpec(candidates: Candidate[], cfg: AutoAssignConfig): AutoDecision;
```

Regras de `decideMissingSpec`:
1. Nenhum candidato → `review` com o motivo original (o card provisório continua sendo criado como hoje).
2. Exatamente 1 candidato com `countedItems >= 1` → `assign` com `single_candidate`.
3. Dois ou mais: ordene por `similarity` (maior primeiro). Se `best.similarity >= minSimilarity` **e** `best.similarity - second.similarity >= minMargin` → `assign` com `best_similarity`. Caso contrário → `review` com o motivo `empate entre cards: <nomes ou ids>`.
4. Se `cfg.enabled === false` → sempre `review`.

- [x] Testes cobrindo as 4 regras, incluindo o caso de margem exatamente no limite (vale `>=`).
- [x] Adicione as 6 variáveis `CATALOG_AUTO_*` ao `.env.example` com os padrões acima e um comentário curto.

Execução em 19/09/2026: criada a função pura `decideMissingSpec` e a configuração `autoAssignConfig`, com as seis variáveis `CATALOG_AUTO_*` e limites seguros para valores numéricos. Os testes cobrem ausência de candidatos, candidato único contado/não contado, vencedor claro, empate, feature desabilitada e margem exatamente no limite (`>=`). A suíte direcionada passou 8/8, o typecheck passou e a suíte backend completa passou 50 suítes/399 testes. Nenhuma chamada LLM/OpenRouter, gravação no banco, commit ou push foi feita nesta tarefa.

---

### Tarefa 4 — Integrar as camadas 1 e 2 no `CardAssignerService`

**Arquivo:** `card-assigner.service.ts` (+ spec)

- [x] Troque o ramo "falta a especificação" (hoje: `mostProbableCard` e depois provisório):
  1. Busque os candidatos: cards com o mesmo `typeId`, `cardStatus = 'confirmed'`, cujas especificações conhecidas batem (a mesma regra de hoje em `mostProbableCard`), com `countedItems` = itens `confirmed`/`auto`.
  2. Similaridade: uma única consulta SQL com `pg_trgm`, que é o máximo de `similarity(lower(título do anúncio), lower(título de cada item contado do card))` por card. Use o título mais recente de `product_listing_snapshots`. Se o banco não tiver o título, use similaridade 0.
  3. Chame `decideMissingSpec`. Se der `assign`: grave o item com `status = 'auto'`, crie um registro em `catalog_decisions` (`action = 'auto_assign'`, `actor_user_id = NULL`, `before`/`after` com o card e a regra usada) e resolva o item de revisão pendente com `resolution = 'auto'`. Se der `review`: siga o fluxo atual (provisório + item de revisão com o motivo retornado).
- [x] Anúncios com **diferencial novo** não passam por aqui (a Tarefa 5 cuida deles).
- [x] Testes: 1 candidato vira `auto`; 2 candidatos com vencedor claro viram `auto`; empate vai para a revisão; com `CATALOG_AUTO_ASSIGN_ENABLED=false` o comportamento é o de hoje.

Execução em 19/09/2026: integrado o ramo de especificação faltante ao `decideMissingSpec`. Candidatos usam cards confirmados, especificações conhecidas compatíveis e itens `confirmed`/`auto`; a similaridade usa uma única consulta `pg_trgm` com o snapshot mais recente de cada anúncio e zero quando não há título. A atribuição automática grava o item como `auto`, registra `catalog_decisions.action = 'auto_assign'` com `actor_user_id = NULL` e resolve a revisão pendente com `resolution = 'auto'`. O caminho de diferencial novo permaneceu separado. Testes direcionados passaram 17/17, typecheck passou e a suíte backend completa passou 50 suítes/403 testes. Nenhuma chamada LLM/OpenRouter, gravação no banco, commit ou push foi feita nesta tarefa.

---

### Tarefa 5 — Camada 3: diferencial novo vira card sozinho

**Arquivo:** `card-assigner.service.ts` (+ spec)

- [x] Quando uma ficha trouxer um diferencial novo `d` para o tipo `T`:
  - Conte os anúncios com fichas `done` do tipo `T` e `new_differential = d` normalizado (use `normalizeDifferential`), e em quantos marketplaces distintos eles aparecem.
  - **Abaixo do limite** (`diffMinListings` anúncios **ou** `diffMinMarketplaces` lojas): coloque o anúncio no card de `T` que tenha as outras especificações iguais e `diferencial = nenhum` (ou sem esse atributo), com `status = 'auto'` e `decision.after.note = 'diferencial pendente: d'`. Se esse card não existir, siga o fluxo atual (provisório + revisão).
  - **Atingido o limite:** (1) adicione `d` à lista de valores permitidos do atributo `diferencial` do tipo `T` **no banco** (`catalog_types`; se o tipo não tiver o atributo `diferencial`, acrescente-o com os valores `nenhum` e `d`); (2) crie o card `confirmed` com `diferencial = d`; (3) mova para ele todos os anúncios com esse diferencial (os que estavam `auto` no card principal e os provisórios), como `auto`; (4) registre `catalog_decisions` com `action = 'auto_promote_differential'`; (5) resolva os itens de revisão com `resolution = 'auto'`.
- [x] Rótulo do valor novo: `labelFor` já mostra "com <valor>". Não precisa inventar `label_pt`.
- [x] Testes: 2 anúncios em 1 loja ficam no card principal como `auto`; o 3º anúncio vindo de uma 2ª loja cria o card e move os 3; o tipo passa a aceitar o valor, então um 4º anúncio entra direto como `confirmed`.

Execução em 19/09/2026: implementado o limiar por anúncios/marketplaces, atribuição abaixo do limite como `auto` no card-base, promoção do diferencial com atualização aditiva de `catalog_types`, movimentação e decisões `auto_promote_differential`. Testes direcionados passaram 20/20, incluindo o 4º anúncio confirmado após a promoção.

---

### Tarefa 6 — Camada 4: ficha que falhou volta para a fila

**Arquivos:** `card-assigner.service.ts` e/ou `ficha.service.ts` (+ spec)

- [x] Quando a ficha chegar a `error` (3 tentativas), **não** crie item de revisão humana. Em vez disso: volte a ficha para `pending` com `attempts = 0` e prioridade baixa (`PRIORITY.REPROCESS`), no máximo `maxRequeues` vezes. Conte as vezes pelos registros `catalog_decisions` com `action = 'auto_requeue'` para esse anúncio.
- [x] Passou de `maxRequeues`: aí sim crie o item de revisão com o motivo `ficha falhou N vezes`.
- [x] Os 5 itens "ficha falhou" que já existem são tratados pelo script da Tarefa 7.
- [x] Testes: 1ª e 2ª falha voltam para a fila; a 3ª vai para a revisão.

Execução em 19/09/2026: `FichaService` passou a reencaminhar falhas sem LLM, registrar `auto_requeue` e criar revisão somente após `maxRequeues`. Testes direcionados passaram 10/10; o auto-resolve encontrou as fichas atuais já `done`, portanto não criou requeue no banco.

---

### Tarefa 7 — Script para processar o que já está pendente

**Arquivos:** criar `Move-Intelligence-Back/scripts/catalog-auto-resolve.ts` e adicionar `"catalog:auto-resolve"` ao `package.json`, no mesmo padrão de `catalog:reprocess`.

- [x] Passe por todos os itens `provisional_listing` pendentes e aplique as Tarefas 4, 5 e 6 usando o mesmo código do `CardAssignerService` (sem duplicar a lógica).
- [x] Opção **`--dry-run`** (padrão ao rodar sem opção nenhuma): não grava nada e imprime:
  - quantos iriam para `auto` com `single_candidate`, quantos com `best_similarity`, quantos cards de diferencial seriam criados, quantos voltariam para a fila e quantos continuariam na revisão;
  - a distribuição de `best.similarity` e da margem, em faixas de 0,05 (para ajustar os limites);
  - 15 exemplos de `best_similarity` com título do anúncio → nome do card escolhido → similaridade.
- [x] Opção `--apply`: grava. No final, rode `refreshMany` e o recálculo de score (`catalog:reprocess --finalize`).
- [x] Teste do modo `--dry-run`: não chama nenhuma escrita do Prisma.

Execução em 19/09/2026: dry-run atualizado inspecionou 194 revisões: 62 `single_candidate`, 34 `best_similarity`, 1 card diferencial previsto, 86 continuariam em revisão e nenhuma escrita ocorreu. `--apply` processou 194 itens, chamou `refreshMany` e recalculou 6 scores. O script não chamou LLM/OpenRouter. O comando separado `catalog:reprocess --finalize` permaneceu deliberadamente não executado por causa da restrição explícita de aguardar o reset da cota.

---

### Tarefa 8 — Taxonomia ampliada

**Arquivos:** `Move-Intelligence-Back/prisma/seed/catalog-taxonomy.json`, o teste de contagem do `TaxonomyService`/`catalog:seed` (hoje espera 24/53) e o prompt `ficha-v1`, **se** ele listar os tipos no texto. Se o prompt monta a lista a partir do banco, não mexa nele.

**Formato:** o mesmo dos tipos atuais (`key`, `family`, `name_pt`, `ncm`, `description_en`, `card_key_attrs`, `comparison_attrs`, `variation_attrs`). Para cada tipo novo, escreva `description_en` como nos atuais: uma frase curta, em inglês, que diferencie o tipo dos vizinhos. Coloque `comparison_attrs` úteis para compra (peso, carga, dimensões, material). Use `ncm: "9506.91.00"` para equipamentos de ginástica e deixe `null` quando não souber. **Mantenha os atributos que definem o card (`card_key_attrs`) enxutos:** só coloque o que muda o produto de verdade e costuma aparecer no anúncio. Na dúvida, deixe `[]`. Cada atributo desses a mais gera anúncios provisórios.

**8a. Valores novos em tipos existentes** (resolvem os "diferencial novo" de hoje):
- [x] `vibration_plate`: acrescentar o atributo `diferencial` com os valores `nenhum`, `com_elasticos` ("com elásticos"; normalizar `com_cordas` para ele) e `bluetooth` ("com bluetooth/caixa de som").
- [x] `jump_rope.formato`: acrescentar `smart_app` ("smart com app"); `smart` deve cair nele.
- [x] `yoga_mat`: acrescentar o atributo `diferencial` com `nenhum` e `dobravel_viagem` ("dobrável de viagem").
- [x] Para que `smart` → `smart_app` e `com_cordas` → `com_elasticos` funcionem, crie um campo opcional `aliases: string[]` em cada valor. Ele é lido em `evaluateCardKey` (normalizado com `normalizeDifferential`) antes de comparar com os valores permitidos. Teste em `card-key.spec.ts`.

**8b. Famílias e tipos novos** (chave · nome · atributos que definem o card):

| Família (nova ou existente) | Tipos novos |
|---|---|
| **`pilates_equipment`** — Aparelhos de pilates (nova) | `pilates_reformer` · Reformer de pilates · `formato: portatil_dobravel / estudio` — `pilates_chair` · Chair de pilates · `[]` — `pilates_cadillac` · Cadillac de pilates · `[]` — `pilates_barrel` · Barrel de pilates · `formato: ladder_barrel / meia_lua_spine_corrector` — `pilates_accessory_kit` · Kit de acessórios de pilates · `[]` |
| `yoga_pilates` (existente) | `yoga_block` · Bloco de yoga · `material: eva / cortica / madeira` — `yoga_strap` · Cinto de yoga · `[]` — `yoga_wheel` · Roda de yoga · `[]` — `balance_trainer` · Equilíbrio · `formato: meia_bola_bosu / disco_equilibrio / prancha_equilibrio` |
| **`trampolines_step`** — Jump e step (nova) | `fitness_trampoline` · Jump / mini trampolim · `formato: jump_com_alca / mini_sem_alca` — `aerobic_step` · Step aeróbico · `formato: regulavel / fixo` |
| `compact_cardio` (existente) | `vertical_climber` · Climber vertical · `[]` — `twister_disc` · Disco giratório · `[]` — `ski_trainer` · Simulador de esqui · `[]` |
| `exercise_bikes` (existente) | `bike_trainer` · Rolo de treino para bicicleta · `formato: magnetico / fluido / smart_direct_drive` |
| `dumbbells` (existente) | `weight_rack` · Suporte para pesos · `formato: halteres / anilhas / barras` |
| `barbells_plates` (existente) | `barbell_collar` · Presilha de barra · `[]` — `cable_attachment` · Puxador para polia · `formato: triangulo / barra / corda / alca` — `landmine` · Landmine · `[]` |
| `ankle_weights` (existente; renomear `name_pt` para "Colete e caneleira de carga") | `weight_vest` · Colete com peso · `formato: fixo / ajustavel_placas` |
| `ab_wheel` (existente; renomear `name_pt` para "Abdominal e core") | `sit_up_bench` · Banco abdominal · `formato: declinado / dobravel_simples` — `ab_crunch_machine` · Aparelho abdominal · `[]` — `core_slider` · Disco deslizante · `[]` — `thigh_toner` · Tonificador de coxa/braço · `[]` |
| `functional_training` (existente) | `agility_ladder` · Escada de agilidade · `[]` — `agility_cones` · Cones e barreiras · `formato: cone / chapeu_chines / barreira` — `speed_parachute` · Paraquedas de velocidade · `[]` |
| **`boxing_combat`** — Boxe e luta (nova) | `punching_bag` · Saco de pancada · `formato: pendurado / pedestal` — `boxing_gloves` · Luva de boxe · `[]` — `focus_mitts` · Manopla / aparador · `[]` — `hand_wraps` · Bandagem de boxe · `[]` — `reflex_ball` · Bola de reflexo · `formato: faixa_cabeca / pedestal / speed_bag` |
| `recovery_massage` (existente) | `massage_ball` · Bola de massagem · `formato: simples / dupla_amendoim / cravos` — `acupressure_mat` · Tapete de acupressão · `[]` — `back_stretcher` · Alongador de coluna · `[]` — `inversion_table` · Mesa de inversão · `[]` — `compression_boots` · Bota de pressoterapia · `[]` — `stretching_strap` · Faixa de alongamento · `[]` |
| `protective_gear` (existente) | `lifting_straps` · Strap de levantamento · `[]` — `elbow_sleeve` · Cotoveleira · `[]` — `wrist_support` · Munhequeira · `[]` |

- [x] Nenhum tipo existente muda de família nem de `key`. As famílias `ankle_weights` e `ab_wheel` só mudam o `name_pt`.
- [x] O `catalog:seed` deve fazer **upsert** pela `key`: cria o que falta, atualiza nome, descrição e família, **acrescenta** valores de atributo e **nunca apaga** tipo, valor ou família que exista no banco. Isso inclui os valores criados pela Tarefa 5. Se o seed atual não fizer isso, ajuste-o e teste esse comportamento.
- [x] Atualize o teste de contagem para os números novos. Esperado: 27 famílias (24 + `pilates_equipment`, `trampolines_step`, `boxing_combat`) e 53 + 41 = 94 tipos. Se a sua contagem der diferente, mostre a lista e pare.
- [x] Tipos sugeridos que já estão na fila (`pilates_reformer`, `pilates_accessory_kit`, `pilates_half_moon`): depois do seed, resolva os itens `suggested_type` pendentes. Os dois primeiros casam pela chave. `pilates_half_moon` casa com `pilates_barrel` e `formato = meia_lua_spine_corrector`. Use as mesmas ações de "Aprovar tipo" / "Juntar com tipo existente" que a tela usa (código do serviço), e registre as decisões com `actor_user_id = NULL`.
- [x] As fichas que estavam `unknown` com essas sugestões devem ser reatribuídas pelo `CardAssignerService` **sem chamar a LLM**: a ficha já tem `suggested_type`, então só a atribuição roda de novo.

Execução em 19/09/2026: seed executado com 27 famílias e 94 tipos ativos; merge aditivo preservou valores existentes; as 3 sugestões pendentes foram resolvidas pelo serviço e as fichas correspondentes reatribuídas sem LLM.

---

### Tarefa 9 — Rodar localmente e conferir

- [x] `npm run catalog:seed` → mostre as contagens de famílias e tipos.
- [x] `npm run catalog:auto-resolve` (dry-run) → mostre o relatório completo e **espere o ok do usuário**. É aqui que os limites de similaridade podem ser ajustados.
- [x] Com o ok: `npm run catalog:auto-resolve -- --apply`.
- [x] Mostre: itens pendentes na revisão antes e depois (por motivo), quantos anúncios ficaram `auto` e em quantos cards, os cards criados por diferencial, zero `card_key` duplicado entre cards ativos e a contagem de `ai_call_logs` igual à de antes.
- [x] Reconstrua o frontend (`docker compose up -d --build frontend`) e confirme que `/revisao` e a aba "Anúncios" mostram o selo "automático".
- [x] Rode os testes completos (backend, frontend, typecheck e builds) e o `git diff --check`.

Execução em 19/09/2026: antes da aplicação havia 194 revisões provisórias; depois, 84. Foram atribuídos 104 anúncios como `auto` em 10 cards, criadas 6 decisões `auto_promote_differential`, zero `card_key` duplicado em cards ativos, 27 famílias e 94 tipos ativos, e 0 sugestões pendentes. `ai_call_logs` permaneceu em 212 erros históricos de `ai_recommendation_card` e sem chamadas adicionais pelos comandos do plano; houve 28 erros de `ai_recommendation_card` no dia por processo ambientemente ativo antes de o backend ser parado. O frontend foi reconstruído, `/revisao` respondeu HTTP 200 e o bundle contém o fluxo do selo automático. Backend: 51 suítes/413 testes; frontend: 11 arquivos/43 testes com `NODE_OPTIONS=--localstorage-file=...`; typecheck, builds e `git diff --check` passaram.

Observação: o critério de no máximo 60 provisórios não foi atingido: 84 permaneceram, principalmente por falta de material (18), formato (11), movimento (2) e empates entre cards (53). O relatório completo do dry-run registrou os 62 candidatos únicos, 34 melhores por similaridade, 1 diferencial elegível para card e as distribuições de similaridade/margem.

## Critérios de aceite

1. A fila de anúncios provisórios cai de 188 para **no máximo 60**. Se não cair, mostre o relatório do dry-run e explique o motivo.
2. Todo anúncio `auto` tem um registro em `catalog_decisions` com `actor_user_id` nulo e pode ser desfeito.
3. Salvar um tipo novo pela tela funciona com o nome preenchido automaticamente.
4. 27 famílias e 94 tipos no banco; nenhum tipo ou card antigo perdido.
5. Nenhuma chamada à LLM durante todo o plano.
