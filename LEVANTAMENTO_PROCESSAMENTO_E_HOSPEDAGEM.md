# Move Intelligence — Levantamento de Processamento e Guia de Hospedagem

Este documento apresenta o levantamento técnico detalhado de todos os pipelines de processamento da plataforma **Move Intelligence**, seus fluxos de dados, interdependências arquiteturais, bem como os **requisitos mínimos e recomendados de infraestrutura para hospedagem em produção**.

---

## 1. Visão Geral da Arquitetura

A plataforma é composta por 4 módulos principais operando de forma integrada:

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       MOVE INTELLIGENCE                                          │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                 │
          ┌──────────────────────────────────────┼──────────────────────────────────────┐
          ▼                                      ▼                                      ▼
┌──────────────────┐                  ┌────────────────────┐                 ┌────────────────────┐
│  FRONTEND (SPA)  │  ◄── HTTP/REST ──┤   BACKEND (API)    │  ◄── Ingestão ──┤    ETL / DADOS     │
│    Angular 19    │                  │  NestJS + Fastify  │                 │    Python 3.11     │
│   Tailwind/CSS   │                  │   Prisma ORM v6    │                 │   Bright Data MCP  │
│  ECharts Canvas  │                  │  BullMQ + Sched.   │                 │ Normalização/MinMax│
└──────────────────┘                  └─────────┬──────────┘                 └─────────┬──────────┘
                                                │                                      │
                                       ┌────────┴────────┐                    ┌────────┴────────┐
                                       ▼                 ▼                    ▼                 ▼
                              ┌────────────────┐ ┌────────────────┐  ┌────────────────┐ ┌────────────────┐
                              │ PostgreSQL 16  │ │  Redis 7 (AOF) │  │ Bright Data    │ │  LLM API       │
                              │ (pg_trgm/UUID) │ │ (Cache/Filas)  │  │ (Scraper/Prox) │ │ (NVIDIA/Gemini)│
                              └────────────────┘ └────────────────┘  └────────────────┘ └────────────────┘
```

---

## 2. Levantamento de Processamento do Projeto

### 2.1. Ingestão de Dados e Web Scraping (`Move-Intelligence-Dados`)
- **Fontes Globais e Nacionais de E-commerce**:
  - *Origem / Fabricação*: Alibaba, Taobao, 1688.
  - *Varejo Internacional*: Amazon US, TikTok Shop.
  - *Varejo Nacional (Brasil)*: Mercado Livre, Amazon BR, Shopee BR.
  - *Sinais de Demanda*: TikTok Search, Google Trends, Baidu, Douyin, Xiaohongshu.
- **Mecanismo de Coleta (MCP - Model Context Protocol)**:
  - Cliente MCP independente integrado ao Bright Data (`search_engine` para descoberta de URLs e `scrape_as_markdown` para extração estruturada).
  - Execução agendada via cron/scheduler (`scripts/collector_scheduler.py`) a cada 168 horas (semanal) com janela histórica padrão de até 2 anos.
- **Processamento de Carga Bruta**:
  - Armazenamento em `RawApiResponse` com schema JSON flexível para auditoria e reprocessamento sem perda de dados brutos (`raw_value`).

---

### 2.2. Normalização, Deduplicação e Clusterização (`app/etl`)
- **Normalização Estatística**:
  - Aplicação de Min-Max por fatia comparável de mercado (`geo × source`):
    $$\text{trend\_index} = \frac{\text{raw\_value} - \min(\text{raw\_value})}{\max(\text{raw\_value}) - \min(\text{raw\_value})} \times 100$$
  - Preservação do `salesSignalRaw`, `priceMin`, `reviewCount` e métricas originais em `ProductListingSnapshot`.
- **Clusterização de Produtos (Clustering Engine)**:
  - Mapeamento semântico de produtos similares em `ProductCluster` via `config/keyword_map.yaml` e correspondência de similaridade textual (`pg_trgm`).
  - Geração de nomes canônicos unificados (`canonicalName`), categorização fitness e agregação de histórico multicanal.

---

### 2.3. Motor de Score de Tendência (Trend Engine — `Move-Intelligence-Back`)
O motor consolida **6 sub-sinais estratégicos** com pesos paramétricos de negócio:

| Sub-Sinal | Peso | Indicador de Origem | Objetivo |
| :--- | :---: | :--- | :--- |
| **Marketplace Growth** | 25% | Vendas e reviews no ML, Amazon, Shopee | Adoção no varejo de consumo |
| **Supplier Growth** | 20% | Densidade de fornecedores na China (Alibaba/1688) | Pressão de oferta e fabricação |
| **Price Opportunity** | 20% | Diferencial Preço Venda Nacional vs. FOB Importação | Margem bruta de arbitragem |
| **Search Growth** | 15% | Volume de consultas (Google Trends / Baidu) | Interesse orgânico pré-compra |
| **Review Velocity** | 10% | Aceleração da taxa de novas avaliações/dia | Tração recente de vendas |
| **Social Buzz** | 10% | Menções e engajamento no TikTok/Douyin/Instagram | Viralização e awareness |

- **Escala de Saída**: Score unificado de 0 a 100 pontos (`trendScore`), com nível de risco (`baixo`, `medio`, `alto`, `critico`) e índice de confiança estatística.

---

### 2.4. Motor Financeiro & Simulação de Monte Carlo
- **Simulação Estocástica de VPL (Valor Presente Líquido)**:
  - Processamento vetorial de 1.000 a 1.000.000 de iterações por chamada.
  - Distribuição probabilística de variáveis incertas: elasticidade de demanda, oscilação cambial USD/BRL, custo de frete internacional (FOB/CFR/CIF) e impostos de importação (II, IPI, PIS, COFINS, ICMS).
  - Cálculo de métricas financeiras de saída: **VPL Mediano**, **Probabilidade de Lucro $P(VPL > 0)$**, **CVaR 5%** (Value at Risk Condicional) e **Curva de Preço Ótimo**.
- **Unit Economics Interativo**:
  - Simulação em tempo real de margem de contribuição líquida, ponto de equilíbrio (Break-even) e curva de sensibilidade de preço.

---

### 2.5. Sazonalidade Preditiva & Janela de Compra Internacional
- Projeção de demanda para os próximos 6 meses com cálculo preditivo de fatores sazonais ($1.0\times$ a $2.5\times$).
- **Cálculo da Linha do Tempo Aduaneira**:
  - Produção na Fábrica (35-45 dias) $\rightarrow$ Frete Marítimo Internacional (35-40 dias) $\rightarrow$ Desembaraço Aduaneiro / Porto (15-20 dias).
  - Determinação da **Janela Crítica de Emissão do Pedido FOB** antes do pico de vendas no mercado nacional.

---

### 2.6. Central de Alertas Proativos & Webhooks
- Monitoramento contínuo de produtos em relação a metas de ruptura (ex: Trend Score $\ge 80$, Crescimento $\ge 40\%$).
- Motor de despacho multicanal:
  - **Telegram Bot API**: Mensagens ricas formatadas em Markdown com link direto para o dossiê.
  - **Slack Incoming Webhooks**: Cards estruturados com botões de ação e alertas de severidade.
  - **Webhooks HTTP Genéricos**: Payloads JSON para integração com CRMs, ERPs ou automações (n8n, Zapier).

---

### 2.7. Camada de IA & LLM Copilot
- Auditoria de premissas financeiras do Monte Carlo com modelos LLM (NVIDIA NIM / Gemini / OpenAI).
- Síntese executiva automatizada com recomendações estratégicas, identificação de gargalos de fornecimento e alertas de concorrência.

---

### 2.8. Camada de Cache & Gerenciamento de Estado
- **Redis 7**:
  - Cache de séries históricas de preços, volumes e avaliações com TTL configurável (1h a 24h).
  - Filas de processamento assíncrono via **BullMQ** para coleta, clusterização e disparos de webhook.
  - Invalidação seletiva de cache ao atualizar cadastros ou rodar novos snapshots.

---

## 3. Requisitos de Infraestrutura para Hospedagem

### 3.1. Requisitos Mínimos (Ambiente MVP / Single-Node VPS)
Ideal para desenvolvimento, validação de mercado, homologação ou operação de pequeno porte com coleta semanal agendada:

| Componente | Requisito Mínimo |
| :--- | :--- |
| **Processador (vCPU)** | **2 vCPUs** (x86_64 ou ARM64) |
| **Memória RAM** | **4 GB RAM** *(com 2 GB de SWAP configurado)* |
| **Armazenamento** | **40 GB SSD / NVMe** |
| **Sistema Operacional** | Ubuntu 22.04 LTS / Debian 12 / Rocky Linux 9 |
| **Docker & Compose** | Docker Engine 24+ com Docker Compose v2 |
| **Largura de Banda** | 100 Mbps (Tráfego mensal: ~500 GB) |

> **Observação:** Em 4 GB de RAM, o PostgreSQL e Redis devem ter seus limites de memória configurados para não exceder 512 MB cada, deixando ~2.5 GB livres para o Backend NestJS, Frontend Nginx e execução dos scripts Python.

---

### 3.2. Requisitos Recomendados (Produção Corporativa / Alta Disponibilidade)
Ideal para produção contínua, múltiplos analistas simultâneos, coletas diárias e simulações Monte Carlo de alta precisão (100k+ iterações):

| Componente | Requisito Recomendado |
| :--- | :--- |
| **Processador (vCPU)** | **4 a 8 vCPUs** (Alta performance mono-core e multi-core) |
| **Memória RAM** | **8 GB a 16 GB RAM** |
| **Armazenamento** | **100 GB a 250 GB NVMe** (I/O de alta velocidade para PostgreSQL) |
| **Banco de Dados** | PostgreSQL 16 Gerenciado (AWS RDS, DigitalOcean Managed DB, Supabase ou Cloud SQL) |
| **Cache / Filas** | Redis 7 Gerenciado (AWS ElastiCache, Upstash ou Redis Cloud) |
| **Largura de Banda** | 1 Gbps (Tráfego ilimitado) |

---

### 3.3. Dimensionamento Detalhado por Serviço em Produção

```text
┌───────────────────────────┬──────────────┬──────────────┬────────────────────────────┐
│ Serviço                   │ CPU Mínima   │ RAM Mínima   │ Volume / Storage           │
├───────────────────────────┼──────────────┼──────────────┼────────────────────────────┤
│ PostgreSQL 16             │ 0.75 vCPU    │ 1.5 GB       │ 30 GB+ (crescimento ~2GB/m)│
│ Redis 7                   │ 0.25 vCPU    │ 512 MB       │ 5 GB (Persistência AOF)    │
│ Backend (NestJS/Fastify)  │ 0.50 vCPU    │ 768 MB       │ Stateless                  │
│ Frontend (Nginx/SPA)      │ 0.10 vCPU    │ 128 MB       │ Stateless                  │
│ Coletor / ETL (Python)    │ 0.50 vCPU    │ 1.0 GB       │ 5 GB (buffers temporários) │
└───────────────────────────┴──────────────┴──────────────┴────────────────────────────┘
```

---

## 4. Variáveis de Ambiente Essenciais

Abaixo estão as variáveis de ambiente necessárias para inicialização em produção:

```bash
# ==========================================
# AMBIENTE & PORTAS
# ==========================================
NODE_ENV=production
PORT=3000
FRONTEND_PORT=80

# ==========================================
# BANCO DE DADOS POSTGRESQL
# ==========================================
POSTGRES_USER=move_admin
POSTGRES_PASSWORD=DefinaUmaSenhaForteAqui123!
POSTGRES_DB=move_intelligence
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public
MOVE_ETL_DATABASE_URL=postgresql+psycopg2://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}

# ==========================================
# REDIS (CACHE & FILAS)
# ==========================================
REDIS_URL=redis://redis:6379

# ==========================================
# SEGURANÇA & AUTENTICAÇÃO
# ==========================================
JWT_SECRET=ChaveSuperSecretaDePeloMenos32Caracteres!

# ==========================================
# INTEGRAÇÕES DE DADOS & IA
# ==========================================
BRIGHTDATA_MCP_URL=https://sua-url-autenticada-brightdata-mcp.com
NVIDIA_API_KEY=nvapi-... # ou OPENAI_API_KEY / GEMINI_API_KEY

# ==========================================
# AGENDAMENTO DE COLETA (ETL)
# ==========================================
SCHEDULE_INTERVAL_HOURS=168
RUN_INIT_COLLECTION=false
COLLECTION_PERIOD_YEARS=2
```

---

## 5. Estratégias de Deploy Recomendadas

### Opção A: VPS Única com Docker Compose (Mais Econômica e Direta)
- **Provedores recomendados**: Hetzner (CX32/CX42), DigitalOcean (Droplet 8GB), Contabo, Linode ou AWS EC2 (t4g.xlarge).
- **Execução**:
  ```bash
  # 1. Clonar repositório no servidor
  git clone <repo-url> /opt/move-intelligence
  cd /opt/move-intelligence

  # 2. Configurar variáveis de ambiente
  cp .env.example .env
  nano .env

  # 3. Subir toda a stack em produção
  docker compose -f docker-compose.production.yml up -d --build
  ```

### Opção B: PaaS / Containers Gerenciados (Sem gestão de servidor)
- **Render / Railway / Fly.io**:
  - *PostgreSQL*: Managed PostgreSQL do provedor.
  - *Redis*: Managed Redis do provedor.
  - *Backend*: Web Service Docker apontando para `Move-Intelligence-Back/Dockerfile`.
  - *Frontend*: Static Site ou Web Service Docker apontando para `Move-Intelligence-Front/Dockerfile`.
  - *Collector Scheduler*: Background Worker Docker apontando para `Move-Intelligence-Dados/Dockerfile`.

### Opção C: Cloud Corporativa (AWS / GCP / Azure)
- **AWS**:
  - *Compute*: AWS ECS Fargate para Backend, Frontend e Collector.
  - *Database*: AWS RDS PostgreSQL 16 Multi-AZ.
  - *Cache*: AWS ElastiCache for Redis.
  - *CDN / SSL*: CloudFront + AWS Certificate Manager (HTTPS automático).

---

## 6. Rotinas de Manutenção, Backup e Segurança

1. **Backup Diário do Banco de Dados**:
   ```bash
   pg_dump -U move_admin -d move_intelligence -Fc > /backups/move_$(date +%Y%m%d_%H%M%S).dump
   ```
2. **Reverse Proxy & SSL**:
   - Recomenda-se utilizar **Traefik**, **Caddy** ou **Nginx Proxy Manager** para terminação SSL automática via Let's Encrypt na porta 443.
3. **Limpeza e Vacuuming Periódico**:
   - O PostgreSQL deve executar rotina de `VACUUM ANALYZE` semanal para otimizar os índices das tabelas `ProductListingSnapshot` e `RawApiResponse`.
4. **Monitoramento**:
   - Adicionar healthchecks nas rotas `/api/health` para acompanhamento de uptime com ferramentas como Uptime Kuma, Datadog ou Better Stack.

---
*Documento gerado para a plataforma Move Intelligence.*
