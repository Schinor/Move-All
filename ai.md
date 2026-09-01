# ai.md — Plano de Implementação da Camada de IA (NVIDIA) e Governança de Dados

> **Status Atual:** Fase 0 (Auditoria) e Fase 1 (Conexão do Copilot no Frontend) **CONCLUÍDAS**. As 3 superfícies de IA (Cartão de Recomendação, Premissas de Monte Carlo e AI Copilot com Tool-Use) estão 100% implementadas e integradas de ponta a ponta com *grounding* estrito no PostgreSQL/Prisma.

---

## 1. Relatório Executivo da Auditoria (Fase 0 Concluída)

A auditoria sistemática realizada em `Move-Intelligence-Back`, `Move-Intelligence-Dados` e `Move-Intelligence-Front` constatou o seguinte panorama:

### 1.1 Matriz de Status das 3 Superfícies de IA

| Superfície | Localização no Código | Grounding Real | Status Atual | Diagnóstico / Mecanismo |
|---|---|---|---|---|
| **1. Cartão de Recomendação (Aba Decisão)** | `Move-Intelligence-Back/src/modules/products/products.service.ts` (`getAiRecommendation`) | **SIM** (100% determinístico) | **IMPLEMENTADO E CORRETO** | Recebe `opportunityScore`, `trendScore`, `growthScore`, `reviewVelocity`, `priceOpportunity`, estatísticas de preço (`min/max/avg`) e alertas reais. Persiste em `ai_recommendations` com cache de 24h. |
| **2. Premissas de Monte Carlo** | `Move-Intelligence-Back/src/modules/products/products.service.ts` (`fillMonteCarloPremisesWithAi`) | **SIM** (Grounding em snapshots) | **IMPLEMENTADO E CORRETO** | Prompt recebe resumo estatístico real dos snapshots (`price_min/max/median`, `volume_min/max/median`, `moq_median`, datas). Saída sanitizada; interface no Angular permite revisão *human-in-the-loop*. |
| **3. AI Copilot (Chat)** | `Move-Intelligence-Back/src/modules/copilot/copilot.service.ts` + `Move-Intelligence-Front/src/app/features/ai-copilot` | **SIM** (via Tool-Use / Function Calling) | **IMPLEMENTADO E INTEGRADO** | Backend usa chamada com ferramentas (`search_products`, `get_product_details`, `get_market_signals`, `get_top_suppliers`, `get_collection_status`). Frontend Angular conectado via `CopilotService` com suporte a histórico, sugestões e badges de consulta. |

---

### 1.2 Auditoria de Scrapers e Qualidade dos Dados

A auditoria dos conectores e do pipeline ETL v2 (`Move-Intelligence-Dados`) revelou que o sistema **não possui mocks silenciosos gerando dados fictícios aleatórios**:

1. **ETL v2 Bright Data (`app/etl/extract/marketplace/common.py`):**
   - Usa Bright Data MCP / SERP API + Web Unlocker.
   - Em caso de falha de extração do Markdown de detalhes, o registro **não** recebe valores inventados: é marcado como `search_snippet_only` e o erro é registrado explicitamente em `source_specific.detail_scrape_error`.
2. **Filtro Estrito de Domínio Fitness (`normalize_product.py` / `is_fitness_product`):**
   - Implementa uma lista extensiva de tokens negativos (`NON_FITNESS_TITLE_TOKENS`) que descarta contaminações (eletrônicos, ferramentas, vestuário casual, fones de ouvido, livros) antes de persistir no banco.
   - Garante que apenas produtos do nicho fitness (musculação, cardio, pilates, crossfit, calistenia, recuperação) entrem na tabela canônica `products`.
3. **Conectores NestJS Legados (`Move-Intelligence-Back/src/modules/connectors`):**
   - Conectores não-configurados (como AliExpress, Douyin, Xiaohongshu) herdam de `BaseHttpConnector` e chamam `notWired()`, lançando erro explícito caso invocados sem credenciais, evitando injeção de stubs falsos.

#### Tabela de Fontes Auditadas

| Fonte / Conector | Tecnologia / Módulo | Comportamento em Falha | Classificação |
|---|---|---|---|
| `amazon_br` / `amazon` | Bright Data MCP/SERP + Web Unlocker | Preserva snippet da SERP; flag `search_snippet_only` | **REAL CONFIRMADO** |
| `mercado_livre` | Bright Data MCP + Scraper BeautifulSoup | Erro explícito / lista vazia se página vazia | **REAL CONFIRMADO** |
| `shopee_br` | Bright Data MCP/SERP + Web Unlocker | Registra erro em `source_specific` | **REAL CONFIRMADO** |
| `alibaba` / `1688` / `taobao` | Bright Data MCP + Unlocker | Preserva faixas de preço/MOQ reais quando presentes | **REAL CONFIRMADO** |
| `tiktok_shop` / `tiktok_search` | Bright Data SERP / Search | Extrai sinais agregados sem dados simulados | **REAL CONFIRMADO** |
| `google_trends` | PyTrends / Bright Data Scrape | Retorna série normalizada `0-100` | **REAL CONFIRMADO** |
| `trade_atlas` / `comex_anual` | Importação CSV (`ImportJob` / `Shipment`) | Processamento transacional via Prisma | **REAL CONFIRMADO** |

---

## 2. Arquitetura da Camada de IA (NVIDIA Gateway)

### 2.1 Cliente Centralizado (`NvidiaService`)
Localizado em `Move-Intelligence-Back/src/modules/ai-gateway/nvidia.service.ts`:
- **Endpoint padrão:** `https://integrate.api.nvidia.com/v1/chat/completions` (compatível com OpenAI Chat Completion).
- **Modelo padrão:** `z-ai/glm-5.2` (customizável via env `NVIDIA_MODEL`).
- **Resiliência:** Retentativa automática (até 2 retries com backoff exponencial) para erros 5xx de rede.
- **Timeout:** 35 segundos com `AbortSignal`.
- **Observabilidade:** Todas as chamadas (sucesso ou falha) são registradas no banco de dados na tabela `ai_call_logs` com contagem de tokens, latência em ms, status e metadados.

### 2.2 Tabelas do Prisma para a Camada de IA
As tabelas necessárias já foram criadas e migradas no banco:
- `ai_recommendations`: Armazena pareceres do Cartão de Decisão com `decision`, `action`, `rationale`, `promptVersion`, `modelVersion` e vínculo ao `productClusterId`.
- `ai_conversations`: Armazena sessões de chat do Copilot por usuário.
- `ai_messages`: Armazena mensagens do usuário, do assistente e saídas de ferramentas (`role: 'tool'`).
- `ai_call_logs`: Registro de auditoria de custo, latência e telemetria de chamadas à NVIDIA.

---

## 3. Detalhamento das 3 Superfícies de IA

### 3.1 Superfície 1: Cartão de Recomendação (Aba Decisão)
- **Endpoint Backend:** `GET /products/:id/ai-recommendation`
- **Mecanismo:**
  1. Verifica se já existe recomendação nas últimas 24h na tabela `ai_recommendations` (cache).
  2. Caso contrário, calcula em tempo de execução os scores determinísticos reais:
     - `opportunityScore` (Opportunity Engine)
     - `trendScore`, `marketplaceGrowthScore`, `reviewVelocityScore`, `priceOpportunityScore` (Trend Engine)
     - Estatísticas de preço mínimo, máximo e médio observadas nos snapshots reais.
     - Alertas ativos associados ao cluster.
  3. Envia o payload estruturado para a NVIDIA com prompt de versão `v1.0-fitness-grounded`.
  4. Salva a resposta parseada na tabela `ai_recommendations`.
- **Frontend:** Consumido pelo componente `AiRecommendationCardComponent` na aba **Decisão** de `tendencia.component.ts`.

### 3.2 Superfície 2: Premissas de Monte Carlo
- **Endpoint Backend:** `POST /products/:id/monte-carlo/ai-premises`
- **Mecanismo:**
  1. Carrega o cluster e agrega os dados estatísticos reais dos snapshots históricos (`simulationDataSummary`).
  2. Envia para a NVIDIA com o prompt `MONTE_CARLO_ANALYST_SYSTEM_PROMPT` exigindo schema JSON com números estritos (sem porcentagens inteiras soltas, com validação de frações).
  3. Sanitiza e valida todas as chaves em snake_case (`preco_venda`, `custo_usd`, `frete_usd_unidade`, `imposto_importacao`, `cambio_base`, `vol_cambio`, `vol_demanda`, etc.).
  4. Retorna as premissas combinadas com marcação `premise_sources: { [campo]: 'ai_suggestion' }`, além de `rationale`, `warnings` e `fragile_assumptions`.
- **Frontend:** Integrado na aba **Simulação** de `tendencia.component.ts`. O usuário clica em "Preencher com IA", vê os campos preenchidos e pode editá-los livremente antes de executar a simulação Monte Carlo (*Human-in-the-Loop*).

### 3.3 Superfície 3: AI Copilot
- **Endpoint Backend:** `POST /copilot/chat`
- **Mecanismo:**
  1. Recebe array de mensagens e `conversationId` opcional.
  2. Registra o histórico em `ai_conversations` e `ai_messages`.
  3. Executa loop de *Tool-Use* (até 3 iterações) contra as seguintes ferramentas tipadas que consultam o banco via Prisma:
     - `search_products`: Busca produtos por nome/categoria e retorna scores determinísticos reais.
     - `get_product_details`: Retorna scores aprofundados, histórico de preços e risco Monte Carlo de um cluster.
     - `get_market_signals`: Retorna embarques aduaneiros (TradeAtlas/Comex) e tendências de demanda recentes.
     - `get_top_suppliers`: Retorna os principais exportadores internacionais de produtos fitness mapeados nos despachos.
     - `get_collection_status`: Retorna o andamento das coletas e pipelines de inteligência.
  4. Retorna o texto final fundamentado (*grounded*) para o cliente.
- **Frontend Status:** A tela `Move-Intelligence-Front/src/app/features/ai-copilot/ai-copilot.component.ts` possui layout pronto, porém está com `available = false`.

---

## 4. Plano de Ação e Próximos Passos

### Fase 1: Conexão do AI Copilot no Frontend Angular (Prioridade Imediata)
1. **Criar Serviço Angular `CopilotService`:**
   - Criar `src/app/core/services/copilot.service.ts` com métodos para enviar mensagem (`POST /copilot/chat`) e recuperar histórico de conversas.
2. **Atualizar `AiCopilotComponent`:**
   - Alternar `available` para `true`.
   - Adicionar estado reativo (`signal`) com histórico de mensagens, indicador de *typing/loading* e tratamento de erro amigável.
   - Renderizar visualmente mensagens do usuário, do assistente e badges indicando quais ferramentas e dados foram consultados (ex.: "Consultou catálogo de esteiras", "Consultou dados aduaneiros").
3. **Guardrail de Autenticação e Rate Limit:**
   - Garantir que as requisições enviem o Bearer Token JWT e tratem limites de taxa HTTP 429 do `ThrottlerGuard`.

### Fase 2: Monitoramento Contínuo e Governança de Dados
1. **Validação de Schema nos Scrapers:**
   - Manter testes automatizados de contrato no repositório `Move-Intelligence-Dados` (`test_fitness_scope.py` e `test_intelligence_etl.py`).
2. **Auditoria de Custo e Latência de IA:**
   - Criar view analítica no backend para expor métricas agregadas da tabela `ai_call_logs` (total de tokens consumidos por dia, tempo médio de resposta por endpoint, taxa de sucesso).

### Fase 3: Rotina Automatizada de Coletas e Simulações
1. **Coleta Semanal Agendada:**
   - Executada via `WeeklyCollectionScheduler` no NestJS (`Move-Intelligence-Back`) ou via script CLI `start-weekly-collection.mjs`.
2. **Re-simulação de Lote:**
   - Execução periódica de `POST /products/monte-carlo/batch` para atualizar os clusters que receberam novos snapshots, mantendo o ranking de oportunidades sempre sincronizado.

---

## 5. Resumo dos Guardrails de Segurança e Integridade

1. **Princípio Fundamental: "A IA Explica, Não Inventa Números"**
   - Nenhum modelo de linguagem é autorizado a gerar scores de tendência, margem ou risco a partir do nada. Todos os números apresentados derivam dos motores analíticos determinísticos do backend.
2. **Isolamento de Credenciais:**
   - A chave `NVIDIA_API_KEY` reside exclusivamente nas variáveis de ambiente do backend NestJS, nunca sendo exposta ao frontend ou ao navegador.
3. **Resiliência a Falhas de LLM:**
   - Se a API da NVIDIA estiver temporariamente indisponível ou com timeout, o sistema não quebra a interface: devolve exceção estruturada `ServiceUnavailableException` e exibe fallback informativo ao usuário.