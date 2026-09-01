# Move Intelligence — Plano Estratégico de Melhorias e Evolução do Banco de Dados

Este documento apresenta uma análise técnica e estratégica com propostas concretas para a evolução da plataforma **Move Intelligence**, dividida em:
1. **Evolução e Otimização do Banco de Dados (Schema, Performance e Extensões)**
2. **Novas Funcionalidades e Melhorias no Sistema Geral (Backend, ETL, IA e Frontend)**
3. **Roadmap de Implementação Sugerido**

---

## 1. Evolução e Otimização do Banco de Dados

Para transformar o banco de dados atual em uma base analítica de nível corporativo, capaz de suportar milhões de snapshots históricos sem degradação de performance, propomos as seguintes melhorias:

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                             EVOLUÇÃO DO BANCO DE DADOS (POSTGRESQL 16)                           │
├──────────────────────────────┬──────────────────────────────┬────────────────────────────────────┤
│ 1. SÉRIES TEMPORAIS          │ 2. BUSCA VETORIAL / IA       │ 3. INTELIGÊNCIA TRIBUTÁRIA / NCM   │
│ • Particionamento mensal     │ • Extensão pgvector          │ • Tabela ProductTaxClassification  │
│ • Compressão de dados antigos│ • Embeddings de títulos/desc │ • Alíquotas II, IPI, PIS/COFINS,   │
│ • Índices BRIN em datas      │ • Clusterização semântica 99%│   ICMS por estado e Antidumping    │
├──────────────────────────────┼──────────────────────────────┼────────────────────────────────────┤
│ 4. LOGÍSTICA & FRETE SPOT    │ 5. INTELIGÊNCIA DE REVIEWS   │ 6. MATRIZ DE CONCORRÊNCIA & BUYBOX │
│ • Tabela FreightMatrix       │ • Tabela ReviewInsight       │ • Tabela CompetitorSeller          │
│ • Rotas China -> Brasil      │ • Dores extraídas com IA     │ • Histórico de perda/ganho BuyBox  │
│ • Histórico 20ft / 40ft / LCL│ • Oportunidade de produto    │ • Estratégia Full vs FBA           │
└──────────────────────────────┴──────────────────────────────┴────────────────────────────────────┘
```

---

### 1.1. Particionamento Nativo de Tabelas de Séries Temporais
- **Problema Atual**: As tabelas `ProductListingSnapshot` e `DemandSignalSnapshot` crescem exponencialmente a cada coleta semanal/diária, sobrecarregando índices B-Tree tradicionais.
- **Melhoria Proposta**:
  - Implementar **Particionamento por Range de Datas (Mensal)** no PostgreSQL:
    ```sql
    CREATE TABLE product_listing_snapshots (
        id UUID NOT NULL,
        product_cluster_id UUID NOT NULL,
        collected_at TIMESTAMPTZ NOT NULL,
        price_min DECIMAL(12,2),
        sales_signal_raw DECIMAL(12,2),
        ...
    ) PARTITION BY RANGE (collected_at);

    -- Partições mensais automatizadas
    CREATE TABLE product_listing_snapshots_2026_01 PARTITION OF product_listing_snapshots
        FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
    ```
  - Adicionar índices **BRIN (Block Range Index)** no campo `collected_at`, que ocupam até 95% menos espaço em disco e aceleram pesquisas históricas em séries ordenadas.

---

### 1.2. Busca Semântica e Clusterização com `pgvector`
- **Problema Atual**: A clusterização atual depende de expressões regulares e similaridade textual (`pg_trgm`), podendo gerar falsos positivos ou não associar variações linguísticas (ex: *"faixa elástica látex"* vs *"loop band resistência para treino"*).
- **Melhoria Proposta**:
  - Habilitar a extensão `pgvector`.
  - Adicionar campo de embedding vetorial em `ProductCluster` e `ProductListingSnapshot`:
    ```prisma
    model ProductCluster {
      id          String                 @id @default(uuid()) @db.Uuid
      canonicalName String               @map("canonical_name")
      embedding   Unsupported("vector(1536)")? // OpenAI ou BGE-M3
      // ...
    }
    ```
  - **Benefício**: Clusterização automática em tempo de ingestão com 99% de assertividade usando busca de cosseno (`<=>`).

---

### 1.3. Modelagem de Inteligência Tributária e Classificação Fiscal (NCM)
- **Problema Atual**: Os cálculos de impostos de importação são aplicados com alíquotas médias globais.
- **Novo Modelo Proposto**:
  ```prisma
  model ProductTaxClassification {
    id              String          @id @default(uuid()) @db.Uuid
    productClusterId String         @unique @map("product_cluster_id") @db.Uuid
    ncmCode         String          @map("ncm_code") // Ex: 9506.91.00 (Equipamentos de ginástica)
    description     String
    iiRate          Decimal         @default(0.20) @map("ii_rate") @db.Decimal(5,4) // Imposto de Importação
    ipiRate         Decimal         @default(0.00) @map("ipi_rate") @db.Decimal(5,4)
    pisRate         Decimal         @default(0.0210) @map("pis_rate") @db.Decimal(5,4)
    cofinsRate      Decimal         @default(0.0965) @map("cofins_rate") @db.Decimal(5,4)
    icmsStandardRate Decimal        @default(0.18) @map("icms_standard_rate") @db.Decimal(5,4)
    hasAntidumping  Boolean         @default(false) @map("has_antidumping")
    antidumpingValue Decimal?       @map("antidumping_value") @db.Decimal(10,2) // US$/kg se houver

    productCluster  ProductCluster  @relation(fields: [productClusterId], references: [id], onDelete: Cascade)
    createdAt       DateTime        @default(now()) @map("created_at")

    @@map("product_tax_classifications")
  }
  ```

---

### 1.4. Matriz de Frete Internacional e Logística Spot
- **Novo Modelo Proposto**:
  ```prisma
  model FreightMatrix {
    id            String    @id @default(uuid()) @db.Uuid
    originPort    String    @map("origin_port")    // Ex: Ningbo, Shanghai, Shenzhen
    destPort      String    @map("dest_port")      // Ex: Santos, Paranaguá, Itajaí
    containerType String    @map("container_type") // 20GP, 40HQ, LCL_CBM
    costUsd       Decimal   @map("cost_usd") @db.Decimal(10,2)
    transitTimeDays Int     @map("transit_time_days") // Ex: 38 dias
    effectiveDate DateTime  @map("effective_date")

    @@index([originPort, destPort, containerType])
    @@map("freight_matrix")
  }
  ```

---

### 1.5. Inteligência de Avaliações e Dores de Consumidor (Voice of Customer)
- **Novo Modelo Proposto**:
  ```prisma
  model ReviewInsight {
    id              String          @id @default(uuid()) @db.Uuid
    productClusterId String         @map("product_cluster_id") @db.Uuid
    sentiment       String          // POSITIVE, NEUTRAL, NEGATIVE
    category        String          // QUALIDADE_MATERIAL, DURABILIDADE, ODOR, ENTREGA, TAMANHO
    painPointText   String          @map("pain_point_text") // Ex: "Costura rasga após 2 semanas"
    frequencyCount  Int             @default(1) @map("frequency_count")
    actionableFix   String?         @map("actionable_fix")  // Ex: "Solicitar costura dupla reforçada à fábrica"
    sampleReviews   Json            @map("sample_reviews")  // Citações reais de compradores

    productCluster  ProductCluster  @relation(fields: [productClusterId], references: [id], onDelete: Cascade)

    @@index([productClusterId, sentiment])
    @@map("review_insights")
  }
  ```

---

### 1.6. Tabela de Rastreamento de Concorrência & BuyBox
- **Novo Modelo Proposto**:
  ```prisma
  model CompetitorSeller {
    id              String    @id @default(uuid()) @db.Uuid
    productClusterId String   @map("product_cluster_id") @db.Uuid
    marketplace     String    // mercadolivre, amazon_br, shopee
    sellerName      String    @map("seller_name")
    sellerId        String?   @map("seller_id")
    isOfficialStore Boolean   @default(false) @map("is_official_store")
    reputationLevel String?   @map("reputation_level") // Platinum, Gold, Líder
    fulfillmentType String?   @map("fulfillment_type") // FULL, FBA, PROPRIO
    estimatedStock  Int?      @map("estimated_stock")
    isBuyboxWinner  Boolean   @default(false) @map("is_buybox_winner")
    lastSeenAt      DateTime  @default(now()) @map("last_seen_at")

    productCluster  ProductCluster @relation(fields: [productClusterId], references: [id], onDelete: Cascade)

    @@index([productClusterId, marketplace, isBuyboxWinner])
    @@map("competitor_sellers")
  }
  ```

---

## 2. Levantamento de Melhorias no Sistema Geral

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 ROADMAP DE MELHORIAS NO SISTEMA                                  │
├──────────────────────────────┬──────────────────────────────┬────────────────────────────────────┤
│ ETL & SCRAPING               │ ANALYTICS & INTELIGÊNCIA     │ EXPERIÊNCIA DO USUÁRIO (FRONTEND)  │
│ • Auto-Retry com Backoff     │ • Exportador de Dossiê PDF   │ • Busca Global Rápida (Cmd+K)      │
│ • Reconhecimento de imagem   │ • Preditor de Ruptura de     │ • Exportador Excel Multi-Planilhas │
│   (pHash) para anti-duplic.  │   Estoque de Concorrentes    │ • Modo Pitch Deck / Apresentação   │
│ • Webhook direto BrightData  │ • Detecção de Tendências     │ • Dark/Light Mode adaptativo       │
│   (sem polling bloqueante)   │   "Breakout" (< 14 dias)     │ • Notificações in-app em tempo real│
└──────────────────────────────┴──────────────────────────────┴────────────────────────────────────┘
```

---

### 2.1. Ingestão & ETL
1. **Deduplicação Visual por Perceptual Hashing (pHash)**:
   - Muitos fornecedores cadastram o mesmo item com títulos ligeiramente alterados. Gerar um hash perceptivo da imagem principal permite vincular automaticamente anúncios com 100% de precisão visual.
2. **Recepção Assíncrona via Webhooks da Bright Data**:
   - Em vez de reter conexões abertas aguardando o scraping, configurar endpoint de webhook no NestJS (`/api/webhooks/brightdata`) para ingestão imediata via fila BullMQ assim que o dataset estiver compilado.
3. **Coleta de Redes Sociais com Extração de Vídeos em Alta**:
   - Monitoramento contínuo de hashtags no TikTok (`#fitnessbrasil`, `#treinoemcasa`, `#smartgym`) com rankeamento dos top 10 vídeos da semana vinculados a cada cluster.

---

### 2.2. Inteligência & Modelos Analíticos
1. **Gerador Automatizado de Dossiê PDF Executivo (Server-Side)**:
   - Implementar renderização server-side (via Puppeteer ou `@react-pdf`) para gerar relatórios em PDF com diagramas, histórico de preços, fornecedores homologados e recomendação de IA prontos para impressão/apresentação executiva.
2. **Detecção de "Breakout Trends" (Crescimento Explosivo)**:
   - Algoritmo baseado em desvio-padrão ($\ge 3\sigma$) de aceleração de busca e reviews em janelas curtas (7 a 14 dias), alertando o time antes que o produto se torne saturado no mercado nacional.
3. **Preditor de Ruptura de Estoque da Concorrência (Out-of-Stock Opportunity)**:
   - Rastrear quando os maiores vendedores de um produto pausarem anúncios ou ficarem sem estoque, disparando recomendação imediata para capturar a BuyBox e aumentar o preço de venda.

---

### 2.3. Frontend & Interface (UI/UX)
1. **Busca Global Rápida (`Cmd + K` / `Ctrl + K`)**:
   - Modal de busca instantânea no frontend para navegar diretamente entre produtos, fornecedores, alertas e simulações.
2. **Exportador de Planilhas Excel Multi-Abas (`.xlsx`)**:
   - Gerar arquivos Excel estruturados com abas separadas: *Resumo Executivo*, *Série Histórica*, *Fornecedores*, *Unit Economics* e *Simulação Monte Carlo* com fórmulas dinâmicas embutidas.
3. **Modo Apresentação / Pitch Deck**:
   - Visualização de tela cheia sem menus laterais, otimizada para projetores e reuniões com comitês de novos produtos e diretoria.

---

### 2.4. Governança, Segurança e Autenticação
1. **Controle de Acesso Baseado em Perfis (RBAC)**:
   - **Administrador**: Gestão de usuários, chaves de API, webhooks e parâmetros de scoring.
   - **Analista de Sourcing**: Visualização de produtos, simulação de premissas e homologação de fornecedores.
   - **Diretoria / Investidor**: Acesso a relatórios executivos, VPL e ranking consolidado de oportunidades.
2. **Auditoria de Alterações (Audit Logs)**:
   - Registro de todas as edições manuais em premissas de Monte Carlo, alertas e pipelines de sourcing para total rastreabilidade.

---

## 3. Roadmap Sugerido de Implementação

| Fase | Prioridade | Escopo Principal | Prazo Estimado |
| :---: | :--- | :--- | :---: |
| **Fase 1** | 🔴 Alta | • Particionamento mensal de `ProductListingSnapshot`<br>• Implementação de `ProductTaxClassification` (NCM e alíquotas reais)<br>• Exportação de Dossiê PDF Server-Side | **2 a 3 semanas** |
| **Fase 2** | 🟡 Média | • Extensão `pgvector` para clusterização semântica<br>• Tabela `CompetitorSeller` e rastreamento de BuyBox<br>• Busca rápida global (`Cmd+K`) e exportador Excel multi-abas | **3 a 4 semanas** |
| **Fase 3** | 🟢 Estratégica | • Tabela `ReviewInsight` com análise de sentimentos e dores de clientes<br>• Tabela `FreightMatrix` para custos de frete marítimo spot<br>• RBAC e Perfis de Acesso corporativos | **4 a 5 semanas** |

---
*Documento estratégico elaborado para a evolução da plataforma Move Intelligence.*
