# 🚀 Move Intelligence — Guia de Execução, Testes e Arquitetura

Este documento reúne o guia completo de inicialização, testes e a especificação das implementações realizadas no ecossistema Move Intelligence.

---

## 📌 1. Visão Geral das Funcionalidades Implementadas

### 💎 Otimizações Base:
1. **Séries Históricas Contínuas e Curva de Volume (2 Anos / 104 Semanas)**:
   - Consolidação de dados temporais de múltiplos marketplaces (Amazon, Mercado Livre, Shopee, Alibaba, 1688).
   - Cálculo de crescimento percentual no período e plotagem gráfica de trajetórias de demanda no frontend Angular.
2. **Cache de Alta Performance com Redis**:
   - `RedisCacheService` global com TTL configurável (padrão 1 hora) e fallback em memória automático.
   - Cache aplicado a listagens de tendências, séries históricas de produtos e simulações Monte Carlo.
3. **Streaming em Tempo Real (SSE) no AI Copilot**:
   - Respostas do Copilot transmitidas token a token via Server-Sent Events (`POST /copilot/chat/stream`), com execução prévia de ferramentas contra o PostgreSQL e digitação progressiva no frontend.
4. **Exportação Executiva em PDF e CSV (Dossiê de Produto)**:
   - Geração de relatório executivo formatado com CSS para impressão (`GET /products/:id/export/pdf`) e série histórica bruta em CSV (`GET /products/:id/export/csv`).
5. **Resiliência e Circuit Breaker nos Conectores**:
   - Padrão Circuit Breaker (`CLOSED` ➔ `OPEN` ➔ `HALF_OPEN`), retentativas com backoff exponencial e detecção de desafios anti-bot / Cloudflare / Captcha.

---

### 🌟 Novas Funcionalidades Avançadas:

6. **🧮 Simulador Interativo de Elasticidade de Preço & Unit Economics**:
   - Calculadora em tempo real na aba do produto com sliders para: Preço de Venda Final (BRL), Custo FOB (USD), Câmbio (USD/BRL), Frete Marítimo Unitário (USD), Imposto de Importação (II/IPI/PIS/COFINS), ICMS, Comissão do Marketplace, Custo Fulfillment, Custos Fixos e Coeficiente de Elasticidade-Preço da Demanda ($E_d$).
   - Métricas em tempo real: Custo Landed (Nacionalizado), Margem de Contribuição (R$ e %), Ponto de Equilíbrio (Break-Even em un/mês), Volume Projetado com Elasticidade, Lucro Líquido Mensal, ROI sobre Estoque e Tabela de Sensibilidade de Preço (-40% a +40%).
7. **🎯 Radar de Concorrência & Matriz de Vendedores (Marketplaces)**:
   - Identificação dos Top 5 concorrentes dominantes por cluster no Mercado Livre, Amazon e Shopee.
   - Detecção de Medalhas/Reputação (MercadoLíder Platinum/Gold, BuyBox Winner, Top Rated), Modalidade Logística (Mercado Livre Full, Amazon FBA, Envio Próprio), Faixa de Preço, Vendas Estimadas, Volume e Market Share (%) com barra visual.
8. **🔔 Central de Alertas Proativos de Oportunidade (Telegram / Slack / Webhook)**:
   - Disparo automático de notificações para Webhook (Slack, Telegram Bot API ou Webhook HTTP genérico) quando produtos romperem metas de crescimento (ex: `Trend Score >= 80` ou `Crescimento >= 40%`).
   - Interface completa na aba **Sinais & Alertas** para configurar canais, testar disparo em tempo real, definir gatilhos de corte e acompanhar o histórico de alertas emitidos.
9. **📅 Módulo de Sazonalidade Preditiva & Janela de Compra Internacional**:
   - Algoritmo de projeção de demanda para os próximos 6 meses com fatores sazonais calibrados para o mercado fitness brasileiro.
   - Cálculo automático da **Janela Ótima de Compra na China**, considerando Lead Time total de 90 dias (35d produção + 40d frete marítimo + 15d alfândega/desembaraço) com contagem regressiva de dias restantes e avisos de urgência.
10. **⚖️ Comparador de Produtos Lado a Lado**:
    - Tela dedicada (`/comparador`) com seletor multi-produto (2 a 4 produtos do catálogo).
    - Tabela comparativa estruturada contrastando: Risco de Mercado, Score Financeiro, Crescimento 2 anos, Volume Mensal Atual, Preço Médio, Margem %, Lucro Mensal Estimado, ROI sobre Estoque e Principal Fornecedor Homologado.

---

## 🛠️ 2. Como Rodar o Projeto

### 🐳 Opção A: Execução via Docker Compose (Recomendada)

Na raiz do projeto:

```bash
# 1. Subir toda a stack em segundo plano
docker compose up --build -d
```

#### Acessos:
* **Frontend Web**: [http://localhost](http://localhost)
* **Backend API**: [http://localhost:3000/api/health](http://localhost:3000/api/health)

---

### 💻 Opção B: Execução Local em Modo Desenvolvimento

#### 1. Iniciar Banco e Cache
```bash
docker compose up -d postgres redis
```

#### 2. Sincronizar o Schema do Banco
```bash
cd Move-Intelligence-Back
npx prisma db push --accept-data-loss
```

#### 3. Carregar o Histórico de 2 Anos (104 semanas)
```bash
cd ../Move-Intelligence-Dados
DATABASE_URL="postgresql://move:move@localhost:5432/move_intelligence" python3 -m app.pipelines.run_historical_collection --period-years 2
```

#### 4. Iniciar o Backend (NestJS)
```bash
cd ../Move-Intelligence-Back
npm run start:dev
```
> Disponível em: `http://localhost:3000`

#### 5. Iniciar o Frontend (Angular)
```bash
cd ../Move-Intelligence-Front
npm start
```
> Disponível em: `http://localhost:4200`

---

## 🧪 3. Roteiro de Testes das Novas Funcionalidades

| Funcionalidade | Como testar na interface |
|---|---|
| **1. Unit Economics & Elasticidade** | Abra qualquer produto (ex: *Halteres Ajustáveis*) e clique na aba **Unit Economics**. Arraste o slider de Preço de Venda ou altere o Câmbio. Observe a atualização instantânea da Margem de Contribuição, Lucro Mensal, Ponto de Equilíbrio e da Tabela de Sensibilidade de Preço. |
| **2. Radar de Concorrência** | Na página do produto, clique na aba **Concorrência**. Verifique os Top 5 vendedores mapeados, identificação de quem ganhou a BuyBox (👑), medalhas Platinum/Gold, modalidade Full/FBA e barra de Market Share %. |
| **3. Sazonalidade & Janela de Compra** | Na página do produto, clique na aba **Sazonalidade**. Visualize o gráfico de barras dos próximos 6 meses e o card estratégico destacando o Lead Time de importação e a data limite para emissão do pedido FOB. |
| **4. Alertas Proativos & Webhook** | Acesse **Sinais & Alertas** no menu lateral. Configure um Webhook (ou selecione Slack/Telegram) e clique em **🧪 Testar Disparo** para validar a integração. Clique em **⚡ Executar Varredura Agora** para escanear a base e disparar alertas para os produtos com maior tração. |
| **5. Comparador Lado a Lado** | Acesse **Comparador** no menu lateral. Selecione 2 a 4 produtos nos botões superiores. A tabela comparativa exibirá instantaneamente o contraste lado a lado de margens, scores, ROI e volumes. |
| **6. Suíte de Testes Automatizada** | Em `Move-Intelligence-Back`, execute `npm test`. Todas as 16 suítes (140 testes) devem passar com 100% de sucesso. |

---

## 📂 4. Relação de Commits nos Submódulos

### `Move-Intelligence-Dados`
* `877fca6` — `feat(pipeline): add multi-year historical data collection pipeline and CLI options`
* `22f9581` — `feat(scheduler): add continuous periodic collector timer daemon and utility script`
* `d6eea30` — `feat(resilience): implement circuit breaker with backoff retry and anti-bot detection`
* `4e9a19a` — `ci(docker): add production Dockerfile for data collector container`

### `Move-Intelligence-Back`
* `b801c94` — `fix(trends): aggregate historical snapshots across marketplaces and improve cluster matching`
* `8e86244` — `feat(cache): implement global RedisCacheService with in-memory fallback`
* `8997e0d` — `feat(cache): add Redis caching for dashboard metrics, summary and trend products`
* `50e5de7` — `feat(copilot): add SSE real-time streaming for AI Copilot chat`
* `83720ba` — `feat(products): add Redis caching for series and Monte Carlo, and executive PDF/CSV exports`
* `4ff6556` — `ci(docker): add init-extensions sql script and auto-sync in Dockerfile boot`
* `4fe6475` — `feat(products): add unit economics simulation, competitor matrix, seasonality forecast and product comparison endpoints`
* `bd6a894` — `feat(alerts): implement proactive opportunity alerts with Slack/Telegram/Webhook dispatcher`

### `Move-Intelligence-Front`
* `71b3fdd` — `feat(charts): update adoption curve chart to display real volume series and growth badges`
* `13e242a` — `feat(copilot): add SSE real-time token streaming to AI Copilot component`
* `675f478` — `feat(export): add executive PDF and CSV export buttons in product header`
* `61dc094` — `ci(docker): add production multi-stage Dockerfile and Nginx configuration`
* `bbaf5f1` — `feat(product-detail): add Unit Economics, Competitor Matrix and Seasonality Forecast tabs`
* `7c1a461` — `feat(alerts): add proactive opportunity alerts configuration and live webhook testing in signals page`
* `82de97e` — `feat(comparator): add side-by-side product comparator view and navigation`
