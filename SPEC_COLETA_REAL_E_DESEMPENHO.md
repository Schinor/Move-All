# Especificação — Coleta real, pendências e desempenho

**Status:** desenho aprovado pelo usuário em 2026-09-23. Aguardando revisão do texto.
**Depende de:** Subprojetos A a D (branch `feat/catalogo-card`, commits até `2130aff`).
**Executor previsto:** Codex, a partir de `PLANO_COLETA_REAL_E_DESEMPENHO.md` (raiz).

## 1. Objetivo

1. **Resolver as pendências** que ficaram dos Subprojetos C e D.
2. **Deixar a coleta real pronta para ligar**: tudo agendado pelo Nest, seguro quando a Bright Data não está configurada, com o compose local atualizado e um checklist para a produção.
3. **Otimizar a plataforma sem mudar nada visível.** As telas, os textos e as respostas da API continuam idênticos, e isso é conferido por comparação automática. A única exceção é a correção de um defeito nas séries (§6.5).

## 2. Decisões do usuário

| # | Decisão |
|---|---|
| E-D1 | **Refazer pela LLM as 502 fichas `codex-manual`, sem mexer no que um humano confirmou.** As fichas novas ficam "seguradas" (sem mudar card), sai um relatório de quantos anúncios mudariam, e só depois do ok do usuário a atribuição é aplicada. Anúncio com decisão de ADMIN nunca muda de card: se a ficha nova discordar, ele vai para a revisão. |
| E-D2 | **Só o `docker-compose.yml` local é editado.** A produção vira o checklist `CHECKLIST_COLETA_REAL.md`. O `docker-compose.production.yml` não é tocado. |
| E-D3 | **Todo o agendamento fica no Nest.** O radar do Google Trends ganha um cron no Nest. O `collector-scheduler` do Python (perfil `python-scheduler`) continua desligado, para a coleta semanal não rodar duas vezes. |
| E-D4 | **Desempenho sem mudança visível**, garantido por uma comparação "antes e depois" das respostas da API em cards reais. |
| E-D5 | **Fica fora:** juntar as simulações do Monte Carlo num só processo Python, enxugar a resposta da tela inicial, o tamanho das linhas de snapshot, embeddings e a correção de preço do Alibaba (a página raspada não traz preço, nem nas faixas por quantidade). |

## 3. Diagnóstico (medido em 2026-09-23, base local: 127 cards e 58.116 snapshots)

Medição feita chamando os serviços direto, sem cache e sem LLM:

| Chamada | Tempo | Resposta |
|---|---|---|
| `GET /trends/products?limit=200` (tela inicial) | 630–720 ms | 262 KB |
| `GET /trends/products` paginado (Ranking) | cerca de 600 ms | 70 KB |
| `GET /dashboard/summary` | 540–640 ms | 1 KB |
| `GET /recommendations` | cerca de 680 ms | 29 KB |
| `GET /trends/products/:id` (página do produto) | 160–210 ms | 5 KB |
| Todas as outras | < 70 ms | — |

**Causas:**
1. `DashboardApiService.loadClusterRollups` roda uma única consulta SQL que varre **todo o histórico** de `product_listing_snapshots` (149 MB) em várias etapas (limites, janela, primeira e última linha, sparklines, demanda, TikTok e preço BR). A tela inicial, o Ranking, o resumo, as recomendações e a recomendação executiva dependem dela. **O custo cresce com o histórico**, então com meses de coleta diária passa de segundos.
2. `RedisCacheService.wrap` não junta pedidos simultâneos. Com o cache vazio, abrir a tela inicial dispara essa consulta 2 a 3 vezes em paralelo. O `getDashboardSummary` não tem cache nenhum. O `delPattern` usa `KEYS`, que trava o Redis enquanto percorre as chaves.
3. `getTrendProduct` carrega **todos** os snapshots do card, com colunas JSON grandes e o aninhamento `rawProduct → demandLinks → demandSignal`.
4. **Defeito:** as séries de preço, avaliações e volume (`seriesPoints` e `seriesPointsCompared`) buscam os 5.000 snapshots **mais antigos** (`orderBy asc` com `take 5000`) e aplicam a janela depois, em memória. Com mais de 5.000 snapshots no card, os gráficos deixam de mostrar os dados recentes.
5. `getAiRecommendation`, `getSuppliers` e `getSimulationCluster` carregam todos os snapshots do card com todas as colunas. A recomendação por IA é gerada de novo a cada 24 horas mesmo sem mudança no score. Foram 232 chamadas até hoje, com média de 4,4 s, e ela é a maior consumidora da cota da LLM.

**Já está bom, e não muda:**
- o frontend: 62 componentes, todos `OnPush`, com telas carregadas sob demanda, ECharts importado em partes e cerca de 112 kB no carregamento inicial;
- o nginx, com gzip, inclusive na API, e cache longo dos arquivos estáticos;
- os índices principais.

**Riscos encontrados para ligar a coleta:**
6. No container, o `BrightDataClient` fica sem URL do MCP. O erro "MCP Bright Data … **não encontrado** no Codex" é classificado por `run_track_listings._classify_error` como `not_found`, e com 3 desses o anúncio vira `DEAD`. **Ligar o acompanhamento sem a Bright Data configurada encerraria todos os anúncios em 3 dias.** Foi o que causou as 50 observações "não encontrado" do job acidental de 22/09.
7. `process.env.MOVE_INTELLIGENCE_DATA_DIR ?? …` não trata a variável vazia (o `.env` local tem `MOVE_INTELLIGENCE_DATA_DIR=`). Aparece em 4 lugares de `intelligence-collection.service.ts`.
8. O radar só roda pelo `collector_scheduler.py` do Python, e ligá-lo também dispara a coleta semanal em duplicidade. `run_search_trends.py` também não emite o resumo `MOVE_ETL_RESULT=` que o Nest espera.

## 4. Parte A — Pendências

### 4.1 Caminho do ETL
Um único método privado `dataDirectory()` em `IntelligenceCollectionService`, com `process.env.MOVE_INTELLIGENCE_DATA_DIR || <padrão>`, usado nos 4 pontos e no novo do §5.1.

### 4.2 Acompanhamento seguro sem Bright Data
- `_classify_error` (`run_track_listings.py`): `BrightDataMcpError` e erros de configuração **nunca** viram `not_found`. Só um HTTP 404 real, ou a mensagem "not found" vinda de uma resposta de página, conta como `not_found`.
- Verificação antes de começar: se o cliente não tem como chamar a Bright Data (sem URL do MCP, sem token da API e sem MCP do Codex), o `run` devolve `{"status": "not_configured", "processed": 0}` **sem tocar em nenhum anúncio**.

### 4.3 Precisão da descoberta
- A função `title_matches_term(title, term)` (Python, `app/etl/transform/term_match.py`) usa a mesma normalização e a mesma lista de palavras genéricas do filtro do D (`GENERIC_WORDS`). O título precisa conter **pelo menos metade** das palavras que contam no termo (arredondando para cima). O plural conta, por exemplo "dumbbells" com "dumbbell". Título vazio passa.
- No `live-intelligence`, **só com `--exact-term`**: um resultado da busca cujo título não passa **não é raspado**. O `source_stats` ganha `relevance_skipped`.
- `DISCOVERY_SOURCES.US` passa a ser `amazon`, `alibaba` e `aliexpress`, sem o 1688.
- Exemplos com o termo "adjustable aerobic step": "Adjustable Dumbbell & Weight Bench" **sai**, "Stair Stepper for Home" **sai**, "Fitness Equipment Adjustable Aerobic Step Stepper Pvc" **fica** e "Aerobic Step Platform" **fica**. Com "nike adjustable dumbbells": "NIKE Adjustable Dumbbell Set 50lb" **fica**.

### 4.4 Fichas sob controle e reprocessamento (E-D1)
- `FichaService.runOnce(now, opts?: { maxCalls?: number; hold?: boolean })`:
  - `maxCalls` para quando o número de chamadas chega ao limite (`stoppedBy: 'max_calls'`);
  - `hold` grava a ficha como `status = 'held'`, sem atribuir card. A cópia de ficha gêmea, no modo `hold`, aceita gêmeas `done` ou `held` e grava como `held`.
  - Sem `opts`, tudo funciona como hoje.
- `FichaService.previewHeld()` monta um relatório por ficha `held`, com um destes resultados: `fica` (mesma chave do card atual), `muda` (chave diferente, ou tipo diferente), `fora_do_escopo`, `tipo_sugerido`, `revisao_admin` (há decisão de ADMIN e a ficha discorda) e `novo` (sem item atual). Traz totais e até 20 exemplos de cada resultado.
- `FichaService.applyHeld()`: para cada ficha `held`, grava `status = 'done'` e chama `assigner.assign(ficha, { deferRefresh: true, guardHuman: true })`. No fim, atualiza os cards tocados.
- `CardAssignerService.moveListing(..., opts.guardHuman)`: se o anúncio já está num card **por decisão de ADMIN** (a decisão mais recente, não desfeita, com `actor_user_id` preenchido e `after.clusterId` igual ao card atual) e o destino é outro, **não move**. Abre uma revisão com o motivo "ficha refeita discorda da decisão do ADMIN" e devolve `blocked: true`. O `assign` repassa `guardHuman` para todos os seus `moveListing` e, se receber `blocked`, devolve `outcome: 'error_review'` sem resolver a revisão.
- **Scripts:**
  - `catalog:run-fichas -- --max-calls N [--hold]`;
  - `catalog:held -- --report | --apply`;
  - `catalog:reprocess -- --llm-model codex-manual`, que volta para `pending` (prioridade `REPROCESS`) todas as fichas com esse `llm_model`.
- **Ordem:**
  1. processar as 6 fichas da descoberta normalmente (no máximo 2 chamadas);
  2. reenfileirar as `codex-manual`;
  3. processar com `--hold` (no máximo 30 chamadas);
  4. relatório → **ok do usuário** → `--apply`;
  5. `catalog:reprocess -- --finalize` para recalcular os scores (local, sem chamadas externas).

### 4.5 Teste instável do login
Um `src/test-setup.ts` no frontend instala um `localStorage` e um `sessionStorage` **em memória** para cada arquivo de teste (setup do `@angular/build:unit-test`, com `setupFiles` no `angular.json`). Os testes não mudam. Critério de aceite: 5 execuções seguidas da suíte, todas verdes.

## 5. Parte B — Ligar a coleta real

### 5.1 Radar pelo Nest (E-D3)
- `main.py --pipeline search-trends [--max-requests N] [--force]` roda `run_search_trends.run` e imprime `MOVE_ETL_RESULT=<json>`.
- `IntelligenceCollectionService.runSearchTrends()` roda o comando acima, com trava de "já rodando".
- `SearchTrendsScheduler`: cron `SEARCH_TRENDS_CRON` (padrão `0 20 * * 0`, domingo às 20:00, America/Sao_Paulo). Só roda com `SEARCH_TRENDS_CRON_ENABLED === 'true'`, sem ligar sozinho em produção, porque tem custo. Quando termina bem, chama `DiscoveryTermsService.refresh()`.
- O `SEARCH_TRENDS_ENABLED` do `collector_scheduler.py` continua existindo, mas o checklist diz para não usar o perfil `python-scheduler`.

### 5.2 Compose local (E-D2)
O serviço `backend` de `docker-compose.yml` ganha as variáveis abaixo, **todas desligadas por padrão**, sem mexer em nenhuma outra linha:

```yaml
      FICHA_ENABLED: ${FICHA_ENABLED:-false}
      TRACK_LISTINGS_CRON_ENABLED: ${TRACK_LISTINGS_CRON_ENABLED:-false}
      RADAR_DISCOVERY_ENABLED: ${RADAR_DISCOVERY_ENABLED:-false}
      SEARCH_TRENDS_CRON_ENABLED: ${SEARCH_TRENDS_CRON_ENABLED:-false}
```

Depois disso, o override temporário `/private/tmp/move-all-task11-override.yaml` deixa de ser usado. Os containers são recriados só com o `docker-compose.yml`.

### 5.3 Checklist de produção (`CHECKLIST_COLETA_REAL.md`, raiz)
1. **Variáveis obrigatórias:**
   - `BRIGHTDATA_MCP_URL`, ou o token da API;
   - `OPENROUTER_API_KEY`;
   - as do §5.2 e do D (`RADAR_DISCOVERY_*`, `TRACK_*`) e `DISCOVERY_MAX_CALLS`.
2. **Ordem para ligar:** (a) `FICHA_ENABLED`; (b) `TRACK_LISTINGS_CRON_ENABLED`; (c) `WEEKLY_COLLECTION_CRON_ENABLED`; (d) `SEARCH_TRENDS_CRON_ENABLED`; (e) `RADAR_DISCOVERY_ENABLED`. Cada passo tem uma consulta SQL para conferir que funcionou.
3. **Calendário semanal:**
   - radar no domingo às 20:00;
   - lista de termos todo dia às 06:00, e também logo depois do radar;
   - coleta semanal com os termos aprovados na segunda às 03:00;
   - acompanhamento todo dia às 02:00;
   - fichas a cada 30 minutos;
   - pré-cálculo dos cards a cada 30 minutos.
4. **Custos estimados por semana:**
   - Bright Data: cerca de 1.000 requisições (radar 188, coleta semanal até 300, descoberta até cerca de 150 e acompanhamento cerca de 360);
   - LLM: as fichas usam até 35 das 50 chamadas diárias do modelo gratuito, e as outras funções dividem o resto.
5. **Como desligar:** voltar a flag para `false` e reiniciar o backend.
6. **Avisos:**
   - não usar o perfil `python-scheduler`;
   - não publicar sem a Bright Data configurada. Mesmo com a correção do §4.2, o acompanhamento só não estraga os anúncios; ele não coleta nada.

## 6. Parte C — Desempenho (E-D4)

### 6.1 Medição e comparação
- `npm run perf:probe` mede cada chamada do §3 duas vezes, sem cache e sem LLM, e imprime tempo e tamanho.
- `npm run perf:golden -- --save <pasta> | --compare <pasta>`:
  - grava e compara, em JSON, as respostas de `listTrendingProducts({limit:200})`, das páginas 1 e 2 do Ranking, de `getDashboardSummary`, de `getRecommendations` e, para 3 cards (o maior, o do meio e o menor em número de anúncios), de `getTrendProduct`, das séries de preço, avaliações e volume (30d, 12m, `all`, e 30d com `compare=previous`), de `getSuppliers`, de `getMonteCarloDefaults` e de `listCardListings`;
  - a comparação é igualdade profunda. Diferença = falha, com o caminho do primeiro campo diferente.
- O "antes" é gravado **antes de qualquer mudança de código**. O banco não pode receber coleta nem reprocessamento enquanto as comparações da Parte C estão sendo feitas.

### 6.2 Cache (Redis)
- `wrap` junta pedidos simultâneos da mesma chave: uma única execução, e todos recebem o mesmo resultado.
- `delPattern` usa `SCAN` (em lotes de 200) no lugar de `KEYS`.
- `getDashboardSummary` passa a usar cache com a chave `dashboard:trends:products:summary`. Assim, a limpeza que já existe (`dashboard:trends:products:*`) também vale para ele.

### 6.3 Pré-cálculo dos cards (`card_rollups`)
- Tabela `card_rollups (include_synthetic bool, product_cluster_id uuid, category text, sort_order int, row jsonb, PK(include_synthetic, product_cluster_id))` e tabela `card_rollup_state (include_synthetic bool PK, computed_at timestamp, stale bool)`.
- O SQL de `loadClusterRollups` vai **sem nenhuma alteração** para `src/shared/card-rollups/card-rollup.sql.ts` (`queryCardRollupRows`).
- `CardRollupsService` (módulo global):
  - `getRows(category?)`: se não há estado, ou está marcado como desatualizado, ou tem mais de `CARD_ROLLUPS_MAX_AGE_SECONDS` (3600, igual ao cache de hoje), recalcula na hora. Depois lê as linhas em ordem de `sort_order`, filtrando por `category` quando pedido;
  - `refresh()`: recalcula e grava numa transação, sem cálculos simultâneos no mesmo processo;
  - `markStale()`: marca `stale = true` (no máximo uma escrita a cada 2 segundos por processo) e agenda um recálculo em segundo plano.
- `DashboardApiService.loadClusterRollups` usa `CardRollupsService` quando ele está disponível. Sem ele (nos testes), faz a consulta direta como hoje.
- **Quem chama `markStale()`:**
  - os 6 lugares que hoje chamam `delPattern('dashboard:trends:products:*')`;
  - `CardAssignerService.moveListing`, `createCard` e `refreshCard`;
  - `CatalogReviewService.renameCard`, `approveType`, `mergeType` e `undo`;
  - o `TaxonomyService`, ao semear.
- Cron `CARD_ROLLUPS_CRON` (padrão `*/30 * * * *`) recalcula se o pré-cálculo estiver desatualizado ou tiver mais de 45 minutos. Ele só lê e grava no banco, então fica sempre ligado.

### 6.4 Página do produto
Em `getTrendProduct`:
- os snapshots são carregados com `select` só dos campos de `SnapshotRow`, sem o aninhamento;
- os sinais de demanda vêm de **uma** consulta (`DISTINCT` em `demand_signals` ligados aos snapshots do card, com o mesmo filtro de sintéticos) e são anexados de forma que `demandSignals()` devolva o mesmo conjunto.

A resposta é idêntica, conferida pelo `perf:golden`.

### 6.5 Séries por janela no banco (corrige o defeito do §3.4)
- O novo `loadSeriesSnapshots(clusterId, lookbackMs | null)` busca primeiro o `collectedAt` mais recente. Com janela, busca `collectedAt ≥ mais recente − lookback`, em ordem crescente. Sem janela (`all`), busca os 5.000 **mais recentes** e inverte a ordem. Usa `select` só dos campos usados.
- É usado por `seriesPoints` e `seriesPointsCompared` (lookback de 2× a janela).
- Com os dados de hoje (menos de 5.000 snapshots por card), a resposta é idêntica.

### 6.6 Menos dados carregados
- `getAiRecommendation`:
  - preços (média, mínimo e máximo, com `price_min > 0`), contagem e id do último snapshot vêm de **uma agregação SQL**, no lugar de carregar os snapshots;
  - o texto em cache vale enquanto não houver um `product_scores` do card mais novo que ele. Sem score, vale a regra de 24 h de hoje.
- `getSuppliers` e `getSimulationCluster`: `select` só dos campos usados pelas funções que recebem os snapshots, com o mesmo número de linhas.

## 7. Variáveis novas

| Variável | Padrão | Onde |
|---|---|---|
| `SEARCH_TRENDS_CRON_ENABLED` | `false` | Nest |
| `SEARCH_TRENDS_CRON` | `0 20 * * 0` | Nest |
| `CARD_ROLLUPS_CRON` | `*/30 * * * *` | Nest |
| `CARD_ROLLUPS_MAX_AGE_SECONDS` | `3600` | Nest |

## 8. Paradas de segurança

1. Antes de qualquer chamada à LLM: fichas da descoberta (no máximo 2 chamadas) e reprocessamento com `--hold` (no máximo 30 chamadas). A autorização precisa dizer o destino (OpenRouter) e o conteúdo (títulos e trechos das páginas dos anúncios, prompt e taxonomia).
2. Antes do `catalog:held -- --apply`, que muda cards: o usuário lê o relatório.
3. Nenhuma chamada à Bright Data neste plano.

## 9. Não fazer

- Editar o `docker-compose.production.yml`, publicar ou tocar na EC2.
- Mudar layout, textos, ordem ou conteúdo das telas.
- Mudar o formato das respostas da API. A exceção é o defeito do §6.5.
- Os itens do E-D5.

## 10. Critérios de aceite

- As suítes do backend, do Python e do frontend passam (o frontend 5 vezes seguidas), assim como o `tsc` e o build.
- `perf:golden --compare` passa sem diferenças depois de cada tarefa da Parte C.
- `perf:probe` depois das mudanças:
  - tela inicial, Ranking, resumo e recomendações ≤ 150 ms com o pré-cálculo pronto;
  - página do produto ≤ 120 ms;
  - nenhuma chamada fica mais lenta que antes.
- Acompanhamento sem a Bright Data configurada termina com `not_configured` e 0 anúncios alterados.
- Relatório do reprocessamento entregue antes do `--apply`, e nenhum anúncio com decisão de ADMIN muda de card.
- Compose local sem override, com os crons de coleta desligados e o checklist de produção escrito.
