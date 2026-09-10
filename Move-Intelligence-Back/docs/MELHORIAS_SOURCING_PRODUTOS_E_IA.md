# 📊 Documentação Técnica — Sourcing 5★, Inteligência Artificial e Métricas de Produto

Este documento detalha a arquitetura, fórmulas matemáticas, configurações de ambiente e guias de uso para as novas funcionalidades implementadas no Move Intelligence.

---

## 📑 Sumário

1. [⭐ Sistema de Qualificação e Score de Fornecedores (0 a 5.0 Estrelas & Tiers)](#1--sistema-de-qualificação-e-score-de-fornecedores-0-a-50-estrelas--tiers)
2. [🤖 Arquitetura, Gateway e Configuração da Inteligência Artificial (Muse Glimmer 30B)](#2--arquitetura-gateway-e-configuração-da-inteligência-artificial-muse-glimmer-30b)
3. [🕸️ Motor de Sub-Sinais em 6 Dimensões & Explicabilidade do Score](#3-️-motor-de-sub-sinais-em-6-dimensões--explicabilidade-do-score)
4. [📈 Normalização e Agregação das Séries Históricas de Produtos](#4--normalização-e-agregação-das-séries-históricas-de-produtos)
5. [🧪 Guia Prático de Testes e Validação](#5--guia-prático-de-testes-e-validação)

---

## 1. ⭐ Sistema de Qualificação e Score de Fornecedores (0 a 5.0 Estrelas & Tiers)

### 🎯 Objetivo
Transformar a página de Sourcing (`/sourcing`) em uma central de inteligência de negociação com fábricas asiáticas e distribuidores locais, permitindo filtrar e elencar os melhores parceiros por capacidade produtiva, reputação e volume.

### 🧮 Lógica e Formulação Matemática

O score de cada fornecedor $S_{\text{fornecedor}} \in [0.0, 5.0]$ é calculado combinando 4 pilares estratégicos:

$$\text{Rating Final} = (S_{\text{avaliações}} \times 0.35) + (S_{\text{vendas}} \times 0.30) + (S_{\text{catálogo}} \times 0.20) + (S_{\text{confiabilidade}} \times 0.15)$$

#### Detalhamento dos Pilares:
1. **⭐ Qualidade & Avaliações ($35\%$)**: Média ponderada das avaliações dos anúncios vinculados ao fornecedor ($1.0$ a $5.0$).
2. **📦 Volume de Vendas Mensais ($30\%$)**: Escala logarítmica sobre as vendas totais estimadas:
   $$S_{\text{vendas}} = \min\left(5.0, \frac{\log_{10}(1 + \text{VendasTotais})}{\log_{10}(1 + 10.000)} \times 5.0\right)$$
   *(Ex.: +10.000 un/mês $\rightarrow$ 5.0★; 2.500 un/mês $\rightarrow$ 4.2★; 300 un/mês $\rightarrow$ 3.1★)*.
3. **🏭 Amplitude de Catálogo ($20\%$)**: Quantidade de SKUs/produtos ativos fornecidos pela fábrica:
   $$S_{\text{catálogo}} = \min\left(5.0, \frac{\text{Qtd Produtos}}{8} \times 5.0\right)$$
4. **⏱️ Confiabilidade de Entrega & MOQ ($15\%$)**: Histórico de embarques, prazos médios e flexibilidade de pedido mínimo.

### 🎖️ Tiers e Medalhas:
* 💎 **Tier Diamante ($4.5$ a $5.0\star$)**: Fábricas com escala industrial consolidada, notas $> 4.7$ e certificações internacionais (ISO 9001 / BSCI).
* 🥇 **Tier Ouro ($3.8$ a $4.4\star$)**: Fornecedores com vendas consistentes e alta confiabilidade.
* 🥈 **Tier Prata ($3.0$ a $3.7\star$)**: Fornecedores em observação ou sortimento intermediário.
* 🥉 **Tier Bronze ($< 3.0\star$)**: Fábricas com histórico reduzido.

### 🎨 Recursos de Interface Adicionados:
* **Filtros por Tier**: Botões rápidos tipo pílula (`Todos`, `💎 Diamante`, `🥇 Ouro`, `🥈 Prata`).
* **Barra de Busca Instantânea**: Pesquisa por nome da fábrica, país de origem (China, Índia, etc.) ou categoria.
* **Cards Informativos**: Exibição da nota com estrelas douradas (`★ 4.8/5.0`), total de SKUs, vendas/mês e FOB médio.
* **Tabela Comparativa Matriz**: Colunas ordenáveis com barra de score visual e selos de certificação.

---

## 2. 🤖 Arquitetura, Gateway e Configuração da Inteligência Artificial (Muse Glimmer 30B)

### 🔌 Gateway de IA (`NvidiaService`):
O backend do Move possui um gateway corporativo de IA implementado em `src/modules/ai-gateway/nvidia.service.ts`, equipado com:
* **Streaming em Tempo Real (SSE)**: Transmissão token a token para o frontend via Server-Sent Events.
* **Suporte Nativo a Fastify & Express**: Manipulação direta dos headers e chunks via `res.raw.setHeader()` e `res.raw.write()`.
* **Function Calling (Tools)**: Acesso em tempo real ao banco PostgreSQL para consultar produtos, fornecedores e histórico.
* **Auditoria Completa (`AiCallLog`)**: Registro de latência, tokens de entrada/saída, endpoint e status.

### ⚙️ Configuração de Ambiente (`.env`):
No arquivo `Move-Intelligence-Back/.env`:

```env
# Modelo Validado e Ativo:
NVIDIA_MODEL=meta/muse-glimmer-30b

# Chave de API:
NVIDIA_API_KEY=nvapi-<sua-chave-aqui>

# URL do Endpoint (Padrão NVIDIA NIM):
# NVIDIA_API_URL=https://integrate.api.nvidia.com/v1/chat/completions
```

---

## 3. 🕸️ Motor de Sub-Sinais em 6 Dimensões & Explicabilidade do Score

### 📐 As 6 Dimensões do Score de Oportunidade:

| Dimensão | Identificador | Como é Calculado |
|---|---|---|
| **Marketplace** | `marketplaceGrowthScore` | Crescimento histórico de vendas e aceleração nos canais de varejo. |
| **Reviews** | `reviewVelocityScore` | Velocidade de acúmulo de novas avaliações e satisfação dos clientes. |
| **Preço** | `priceOpportunityScore` | Oportunidade de margem bruta entre custo de fábrica e preço final praticado. |
| **Busca** | `searchGrowthScore` | Tração de pesquisas correlacionadas a termos fitness e Google Trends. |
| **Fornecedores** | `supplierGrowthScore` | Disponibilidade e expansão de fornecedores competitivos no mercado. |
| **Social** | `socialBuzzScore` | Menções e engajamento em redes visuais (TikTok Shop, Douyin, Instagram). |

O card **Radar de Oportunidade (6 Dimensões)** em `OpportunityRadarComponent` agora renderiza uma área poligonal completa com percentuais realistas ($60\%$ a $95\%$).

---

## 4. 📈 Normalização e Agregação das Séries Históricas de Produtos

Reescrevemos o método `seriesPoints` no `ProductsService` com agregação consistente:

1. **Volume de Vendas (`volume`)**: Soma consolidada das vendas mensais dos canais de varejo em cada semana ($V = \sum V_{\text{marketplace}}$).
2. **Preço Médio (`price`)**: Conversão cambial automática de USD $\rightarrow$ BRL para produtos importados e cálculo do preço médio final praticado ao consumidor em Reais.
3. **Avaliações (`reviews`)**: Total acumulado de reviews no mercado.
4. **Filtros de Período**: Seleção exata dos pontos dentro do intervalo selecionado:
   - `7d`: 1 a 2 semanas recentes.
   - `30d`: Últimas 4 a 5 semanas (~1 mês).
   - `3m`: 13 semanas (~1 trimestre).
   - `6m`: 26 semanas (~1 semestre).
   - `all`: 104 semanas (série histórica de 2 anos completos).

---

## 5. 🧪 Guia Prático de Testes e Validação

### A. Testar a Página de Sourcing:
1. Abra o navegador em: [http://localhost:4200/sourcing](http://localhost:4200/sourcing)
2. Verifique os cards em destaque com as estrelas douradas (`★ 4.8 / 5.0`) e o selo de Tier (`💎 Tier Diamante`, `🥇 Tier Ouro`).
3. Teste os botões de filtro (`💎 Tier Diamante`) e a busca por nome de fornecedor/país.

### B. Testar a Página de Detalhes do Produto:
1. Acesse qualquer produto em: [http://localhost:4200/tendencia/00000000-0000-0000-0000-000000000001](http://localhost:4200/tendencia/00000000-0000-0000-0000-000000000001)
2. Verifique no Header os badges de **Confiança** (`96% Alta`) e **Pipeline** (`🎯 Em Sourcing`).
3. No gráfico principal, alterne entre **Volume**, **Preço Médio** e **Avaliações** e teste os seletores de período (`7d`, `30d`, `3m`, `6m`, `all`).
4. No card **Radar de Oportunidade**, confirme que todos os 6 vértices estão preenchidos.
5. Na aba **Explicabilidade**, confira o detalhamento de cada uma das 6 dimensões.

### C. Testar o Copilot de IA:
1. Acesse o Copilot em: [http://localhost:4200/ai-copilot](http://localhost:4200/ai-copilot)
2. Envie uma pergunta e observe a resposta fluida em streaming do modelo **Muse Glimmer 30B**.
