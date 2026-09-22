# Especificação — Subprojeto C: Radar de demanda (Google Trends) + ajustes básicos

**Status:** escopo aprovado pelo usuário em 2026-09-19. Aguardando revisão do texto.
**Depende de:** Subprojetos A, A2 e B (branch `feat/catalogo-card`, commits `cc6c21d`, `37e6c22`, `e28dcc4`).
**Executor previsto:** Codex, a partir de `PLANO_SUBPROJETO_C_RADAR.md` (raiz).

## 1. Objetivo

Entregar o básico, sem implementações adicionais:

1. **Ajustes que faltam nas telas atuais:** filtro por marketplace nas abas Anúncios e Ofertas, preços com no máximo 2 casas decimais e fornecedores reais na página de Sourcing.
2. **Radar de demanda:** coleta semanal do Google Trends (BR em português, US em inglês) de um termo por **tipo** de produto, com a curva mostrada na aba **Adoção** do card. As buscas em alta vêm na mesma coleta e ficam **gravadas para o Subprojeto D**, sem tela.

## 2. Decisões do usuário

| # | Decisão |
|---|---|
| C-D1 | **C é só o radar.** A descoberta de produtos novos (termo em alta → busca de anúncios) e o acompanhamento com histórico ficam no **Subprojeto D**, depois de validar a LLM de fichas. |
| C-D2 | **Termos por tipo, gerados da taxonomia:** 1 termo em PT para o Brasil e 1 em EN para os EUA, por tipo (94 tipos → 188 termos). Todos os cards do mesmo tipo compartilham a curva. |
| C-D3 | **O radar aparece só na aba Adoção do card** (botão novo "Buscas (Google)"). **Sem selo no ranking**, sem página de radar. A página **Mercados continua desativada.** |
| C-D4 | **As buscas em alta (rising/Breakout) são gravadas, sem tela.** A lista do radar e a ação de buscar produtos vêm no D. |
| C-D5 | **Fornecedores na página de Sourcing:** os vendedores dos anúncios de fornecedor (1688, Alibaba, AliExpress) passam a ser registrados na tabela `suppliers`. Vendedores de varejo não são fornecedores. |
| C-D6 | **Filtro por marketplace** nas abas Anúncios e Ofertas. Um card pode ter vários anúncios da mesma loja (hoje, 104 cards têm; o máximo é 6). |

## 3. Como é hoje (fatos do código e dos dados)

- `Move-Intelligence-Dados/app/etl/extract/demand_signal/google_trends.py` (`GoogleTrendsExtractor`) monta a URL com um `q=` por termo (`q=a&q=b`). **A Bright Data recusa esse formato** ("parameter q is specified twice"); o formato que funciona é `q=a,b`. O pipeline `run_live_intelligence.py` usa a âncora `academia` por padrão (`TRENDS_ANCHOR_KEYWORD`), e o teste da sessão mostrou que essa âncora **zera** termos pequenos (a série de "haltere ajustável" veio toda 0).
- O índice do Google Trends é **relativo a cada requisição** (100 = pico daquela consulta). O gravador atual (`upsert_demand_signals`) guarda cada semana uma única vez e nunca sobrescreve, o que mistura escalas de requisições diferentes.
- O cliente MCP (`BrightDataClient._unwrap_mcp_text`) remove os marcadores de segurança, mas **não desfaz o escape de markdown** (`\[`, `\]`, `\_`, `\&`). O parser atual procura `timelineData` seguido de `[` e falha com `\[`.
- Resposta real, salva em `Move-Intelligence-Dados/tests/fixtures/google_trends_bike_spinning_br_12m.md` (1 termo, BR, 12 meses, URL com `brd_trends=timeseries,related_queries&brd_json=1`): o JSON tem `widgets` com os ids `TIMESERIES` (`data.default.timelineData[]`, com `time` em epoch-segundos, `value: [n]` e `isPartial: true` na última semana), `GEO_MAP` e `RELATED_QUERIES` (`data.default.rankedList[0]` = top e `[1]` = em alta; cada item tem `query`, `value` e `formattedValue`, por exemplo `"+60%"` ou `"Breakout"`). São 53 pontos semanais.
- `app/connectors/apis/google_trends.py` (`GoogleTrendsAPI`) gera **números aleatórios**. Só é exportado por `app/connectors/apis/__init__.py`, e ninguém o usa.
- `demand_signals` tem 10.816 linhas mock (57 termos, BR/US). `keyword_terms` está vazia.
- Agendamento: `Move-Intelligence-Dados/scripts/collector_scheduler.py` roda `run_weekly_intelligence` a cada `SCHEDULE_INTERVAL_HOURS` (168). O container `collector-scheduler` não está rodando localmente.
- Página de Sourcing (`features/sourcing`) lê `GET /dashboard/suppliers` → `DashboardApiService.getAllSuppliers` → tabela `suppliers` (vazia) e, como alternativa, `shipments` (vazia).
- A aba Anúncios usa `card-listings-table.component`; `price()` usa `toLocaleString('pt-BR')` sem limitar as casas decimais (daí "R$ 3.748,493").
- Lições do B: scripts locais precisam de `INCLUDE_SYNTHETIC_DATA=true` (a plataforma no Docker usa os dados mock) e de um Python com numpy (`PYTHON_BIN=/usr/local/bin/python3`).

## 4. Parte 1 — Ajustes básicos

### 4.1 Preço com 2 casas
`card-listings-table.component.ts → price()`: formatar com `minimumFractionDigits: 2, maximumFractionDigits: 2`. Moeda: `BRL` → `R$`; qualquer outra → o código (`USD`, `CNY`).

### 4.2 Filtro por marketplace
- Nas abas **Anúncios** e **Ofertas**: uma fileira de chips "Todos" + um chip por marketplace presente na lista, com a quantidade (ex.: "Alibaba (2)"). Filtro no próprio frontend, sem mudança de API. O padrão é "Todos".
- Nomes: use a função `sourceName(...)` que já existe no componente da página do produto.
- Na aba Ofertas, o filtro age só sobre a tabela; o resumo do topo (score do card, melhor oferta) não muda.

### 4.3 Fornecedores na página de Sourcing
- Função pura `supplierIdentity(snapshot)`: só para `marketplace ∈ {1688, alibaba, aliexpress}`. `native_supplier_id` = `seller_id` se existir; senão, `seller_name` normalizado (minúsculas, sem acento, espaços simples). Sem vendedor → ignorado.
- Script `npm run catalog:sync-suppliers` (Nest): lê os snapshots dos anúncios de fornecedor que estão em cards contados (`product_cluster_items` com status `confirmed`/`auto`), respeitando `syntheticSnapshotWhere()`, e faz **upsert** em `suppliers` (`source`, `native_supplier_id`, `name`, `country` quando o snapshot tiver). Idempotente e sem apagar nada.
- A página de Sourcing não muda de código, a menos que falte um campo. Se a tabela vier preenchida, ela já lista. Se o mapeamento em `getAllSuppliers` exigir algo que não existe (ex.: contagem de anúncios via `tracked_listings`, que está vazia), mostrar o que houver sem inventar número.

## 5. Parte 2 — Radar de demanda

### 5.1 Termos
- Em `prisma/seed/catalog-taxonomy.json`, cada tipo ganha `"trend_terms": { "pt": "<termo>", "en": "<term>" }`.
- Regra para escrever os termos: é **como as pessoas pesquisam** (não o nome técnico), com 1 a 3 palavras, minúsculas, sem marca e sem acento desnecessário no inglês. Exemplos: `spin_bike` → pt "bike spinning", en "spin bike"; `walking_pad` → pt "walking pad", en "walking pad"; `adjustable_dumbbell` → pt "halter ajustável", en "adjustable dumbbells".
- O `catalog:seed` faz upsert em `keyword_terms` (`term`, `language` = `pt`|`en`, `category` = chave do tipo, `active = true`). Termo trocado no JSON → o antigo fica `active = false` (nunca é apagado).

### 5.2 Coleta (Python, `Move-Intelligence-Dados`)
- Corrigir `GoogleTrendsExtractor.build_url`: vários termos no **mesmo** `q`, separados por vírgula; `brd_trends=timeseries,related_queries`; `brd_json=1`.
- Novo parser `parse_trends_payload(text) -> TrendsPayload`: desfaz o escape de markdown (`\[`, `\]`, `\_`, `\&`, `\*`) antes do `json.loads`; devolve os pontos (semana, valor, parcial) de `TIMESERIES` e as listas top e em alta de `RELATED_QUERIES`. Erro de formato → exceção com mensagem clara (sem simulação).
- Pipeline novo `app/pipelines/run_search_trends.py`: lê os termos ativos de `keyword_terms` (pt → geo BR, en → geo US); **1 termo por requisição, sem âncora**; `date=today 12-m`; limite `TRENDS_MAX_REQUESTS_PER_RUN` (padrão 200); modo `--dry-run` (lista os termos e a quantidade de requisições, sem chamar a Bright Data); grava 1 linha por termo/geo/coleta em `search_trend_snapshots`. A falha de um termo é gravada com `status = 'erro'` e não para a coleta.
- `run_live_intelligence.py`: a âncora passa a ser **opcional** (`TRENDS_ANCHOR_KEYWORD` padrão vazio). Sem a variável, não usa âncora.
- Remover `app/connectors/apis/google_trends.py` e a exportação dele em `app/connectors/apis/__init__.py`.
- Agendamento: `collector_scheduler.py` roda `run_search_trends` uma vez por ciclo **só se** `SEARCH_TRENDS_ENABLED=true` (padrão `false`), em bloco `try` separado do `run_weekly_intelligence`.

### 5.3 Crescimento (função pura)
Sobre os pontos **da mesma coleta**, descartando a semana parcial:
- `growth_4w` = média das últimas 4 semanas ÷ média das 4 anteriores − 1.
- `growth_12w` = média das últimas 12 ÷ média das 12 anteriores − 1.
- Denominador 0 → `null`. Todas as semanas em 0 → `status = 'sem_volume'`.

### 5.4 Tabela nova `search_trend_snapshots`

| coluna | tipo | nota |
|---|---|---|
| id | uuid PK | |
| type_key | text | chave do tipo |
| term | text | |
| geo | text | `BR` ou `US` |
| timeframe | text | `today 12-m` |
| status | text | `ok` / `sem_volume` / `erro` |
| error | text null | |
| points | jsonb | `[{ "week_start": "2026-09-13", "value": 56, "partial": true }]` |
| last_value | int null | última semana completa |
| growth_4w | double null | |
| growth_12w | double null | |
| related_top | jsonb | `[{ "query", "value" }]` |
| related_rising | jsonb | `[{ "query", "value", "label", "breakout" }]`; `breakout = true` quando `formattedValue` é "Breakout" |
| captured_at | timestamp default now() | |

Índice: `(type_key, geo, captured_at)`. Criada por migration SQL aditiva (Prisma) e com o modelo SQLAlchemy equivalente em `app/etl/load/database.py`. `demand_signals` não é tocada.

### 5.5 API e tela
- `GET /api/products/:id/search-trends` (autenticado): pega o `type_id` do card → chave do tipo → a coleta mais recente com `status ≠ 'erro'` de cada geo. Resposta: `{ "type_key", "series": [{ "geo", "term", "captured_at", "status", "points", "growth_4w", "growth_12w" }] }`. Card sem tipo ou tipo sem coleta → `series: []`.
- Aba **Adoção**: quarto botão **"Buscas (Google)"**. Ao escolher, mostra um gráfico simples de linhas (BR e US, 52 semanas, índice 0–100 de cada país) com o termo e o crescimento de 4 e 12 semanas embaixo. Nota fixa: "Índice relativo do Google (100 = pico do período em cada país); não compare BR com US em valor absoluto." Sem dados → "Ainda não há coleta de buscas para este tipo." O seletor de janela e o "comparar com período anterior" ficam ocultos nesse modo.

## 6. Custo e primeira coleta

- 188 termos × 1 coleta/semana ≈ **810 requisições Bright Data por mês** (a cota grátis é de 5.000). Nenhuma chamada à LLM.
- A **primeira coleta real** (188 requisições) só roda depois de o usuário ver o `--dry-run` e aprovar.

## 7. Fora do escopo (não fazer)

- Lista ou página do radar, selo no ranking, filtro "demanda em alta" e ativar a página Mercados.
- Buscar anúncios novos a partir de termos em alta (é do D).
- China (Baidu/1688 como sinal de demanda).
- Mudar o score ou o Monte Carlo com dados de busca.
- Apagar ou migrar `demand_signals`.
- Tela para editar termos (os termos são editados no JSON da taxonomia).
- Qualquer chamada à LLM.

## 8. Testes

- **Front:** o preço formata com 2 casas; o filtro de marketplace nas duas abas (chips, contagem, filtragem, "Todos"); o gráfico de buscas (com dados, sem dados, `sem_volume`).
- **Nest:** `supplierIdentity` (seller_id, nome normalizado, varejo ignorado, sem vendedor); upsert idempotente do `sync-suppliers`; `GET search-trends` (card sem tipo, tipo sem coleta, última coleta válida por geo, ignora `erro`); o seed grava `keyword_terms` e desativa o termo trocado.
- **Python:** `build_url` com vírgula e sem âncora; `parse_trends_payload` com a amostra real (53 pontos, última parcial, 3 buscas em alta, top com 8 itens); escape de markdown; crescimento 4/12 semanas (incluindo denominador 0 e `sem_volume`); o pipeline em `--dry-run` não chama o cliente; a falha de um termo grava `erro` e segue; o limite de requisições é respeitado; o agendador só roda com `SEARCH_TRENDS_ENABLED=true`.

## 9. Critérios de aceite

1. Os preços da aba Anúncios aparecem com 2 casas.
2. O filtro de marketplace funciona nas abas Anúncios e Ofertas.
3. A página de Sourcing lista os fornecedores reais dos anúncios de fornecedor.
4. 94 tipos com termos PT e EN; 188 termos ativos em `keyword_terms`.
5. Depois da primeira coleta aprovada, cada tipo tem uma linha BR e uma US em `search_trend_snapshots` (status `ok` ou `sem_volume`), e a aba Adoção mostra a curva.
6. Nenhuma chamada à LLM; nenhum commit ou push.
