# Especificação — Subprojeto B: Ofertas por fornecedor e score por oferta

**Status:** aprovada no desenho em 2026-09-19. Aguardando revisão do texto pelo usuário.
**Depende de:** Subprojeto A (cards) e plano A2 (status `auto`), na branch `feat/catalogo-card`.
**Executor previsto:** Codex, a partir de um plano em `PLANO_SUBPROJETO_B_OFERTAS.md` (raiz).

## 1. Objetivo

Dentro de cada card, mostrar **de quem comprar**. Cada anúncio de fornecedor vira uma **oferta** com um **score financeiro próprio**: o Monte Carlo do card, rodado com o custo e o pedido mínimo (MOQ) daquela oferta. O score do card continua sendo a "oportunidade típica" (custo mediano), e o ranking não muda.

## 2. Decisões do usuário

| # | Decisão |
|---|---|
| B-D1 | **Oferta = cada anúncio de fornecedor** (marketplaces `1688`, `alibaba`, `aliexpress`) do card. Varejo (Amazon, Mercado Livre, Shopee) não é oferta: é concorrência e dá o preço de venda. |
| B-D2 | **O score do card continua pela mediana** do custo das ofertas. Cada oferta tem seu próprio score, na mesma escala 0–100. |
| B-D3 | **Preço da oferta = preço no MOQ** (o que se paga no primeiro pedido), e **o MOQ vira o pedido mínimo** da simulação. |
| B-D4 | **O score da oferta é só financeiro.** A confiabilidade do fornecedor (nota, vendas, anos, verificado) **não** entra no score e não ganha selo: aparece só como coluna informativa, porque o próprio usuário verifica o fornecedor no contato. |
| B-D5 | **A aba "Sourcing" vira "Ofertas"**, e a aba "Simulação" ganha um seletor "Card (mediana)" / "Oferta X". Não há aba nova nem simulação dentro da linha da tabela. |
| B-D6 | **Sem tabela de ofertas.** A lista é montada na hora, a partir dos itens do card e do último snapshot de cada anúncio. Só o score da oferta é gravado (`offer_scores`). |
| B-D7 | **O custo mediano do card passa a usar a mesma regra de preço da oferta** (preço no MOQ), para o card não ficar mais otimista que as próprias ofertas. *(Proposta do assistente; confirmar na revisão.)* |

## 3. Como é hoje (fatos do código)

- Motor Monte Carlo: `Move-Intelligence-Back/scripts/monte-carlo-vpl.py` (chamado por `ProductsService.runMonteCarloPython`). A quantidade do pedido é `qty = round(dem_planejada * (1 + folga_estoque))`, e o investimento inicial é `qty * landed + marketing_inicial`.
- Lote oficial: `ProductsService.simulateBatchForRanking(limit)`, com 50.000 cenários (`OFFICIAL_SCENARIO_COUNT`) e semente 7 (`OFFICIAL_SEED`). Ele deriva as premissas com `derivePremisesFromHistory` (`src/modules/scoring/premises-from-history.ts`) e grava `product_scores`.
- Custo do card: a mediana de `priceMin` dos snapshots de `1688`/`alibaba`/`aliexpress` na janela, com conversão de CNY→USD por `fxCnyUsd` (dentro de `derivePremisesFromHistory`).
- Snapshots (`product_listing_snapshots`) já têm `price_min`, `price_max`, `currency`, `moq`, `rating`, `sales_signal_raw`, `seller_name`, `product_url` e `product_cluster_id`.
- A aba Sourcing (`features/tendencia`, `@case ('sourcing')`) mostra o bloco "Fornecedor de alto volume" (`topSupplier`) e `app-supplier-comparison-table`, com os dados de `GET /products/:id/suppliers` (`ProductsService.getSuppliers`). `getSuppliers` também é usado pelo comparador e pelo Copilot, por isso **não é removido**.
- Simulação "e se" (`POST /products/:id/monte-carlo` com `premises`) não grava o score oficial. Isso continua assim.
- A tabela `suppliers` existe, mas está vazia. **Não é usada no B.**

## 4. Regras da oferta

### 4.1 Quais anúncios são ofertas
Itens do card (`product_cluster_items`) com `marketplace ∈ {1688, alibaba, aliexpress}` e `status ∈ {confirmed, auto}` (`COUNTED_ITEM_STATUSES`, criado no A2). Itens provisórios **não** são ofertas. Os dados de cada oferta vêm do snapshot mais recente daquele anúncio que não seja sintético nem esteja em `analytics_excluded` (o mesmo filtro compartilhado `syntheticSnapshotWhere()`).

### 4.2 Preço no MOQ (função pura `offerUnitCostUsd`)
- Preço base: `price_max` se existir e for > 0; senão `price_min`; senão **sem preço**.
- Moeda: `USD` (ou vazio) usa o valor direto; `CNY` usa `valor * fxCnyUsd`; qualquer outra moeda é **sem preço**.
- A mesma função passa a ser usada no custo mediano do card (B-D7). Em `derivePremisesFromHistory`, a observação passa a carregar `priceMax`, e o filtro de custo usa `offerUnitCostUsd`.

### 4.3 MOQ
- `moq` do snapshot; nulo ou ≤ 0 conta como 1.

### 4.4 Preço suspeito
- Se o custo da oferta for **menor que 30%** do custo mediano do card, a oferta fica marcada `suspeito` e **sem score**. O limite fica em `DEFAULT_BUSINESS_RULES` como `offers.suspiciousPriceRatio = 0.30`.

### 4.5 Estados da oferta
Gravados: `com_score` · `sem_preco` · `suspeito`. Só na API: `aguardando_lote` (sem registro ainda) e `sem_score_card`, que vale quando o card não tem premissas, por exemplo com `historico_curto` ou `sem_custo`; nesse caso nenhuma oferta é simulada.

## 5. Simulação por oferta

### 5.1 Motor Python
- Premissa nova `qtd_minima_pedido: float = 0` em `Premissas`, incluída na lista de premissas válidas e no hash.
- `qty = np.maximum(np.round(dem_planejada * (1 + p.folga_estoque)), p.qtd_minima_pedido)`.
- Com `qtd_minima_pedido = 0`, o resultado tem que ser **bit a bit idêntico** ao de hoje, com a mesma semente.
- A saída ganha a métrica `capital_primeiro_pedido` = `qty * landed` no câmbio base (sem choque), em BRL. É um valor único, não uma distribuição.

### 5.2 Premissas da oferta
São as mesmas `scriptPremises` do card no lote oficial (demanda, crescimento, preço de venda BR, volatilidades, frete, impostos, câmbio, marketing). Só mudam:
- `custo_usd` = `offerUnitCostUsd` da oferta;
- `qtd_minima_pedido` = MOQ.

### 5.3 Quando roda
- Dentro de `simulateBatchForRanking`, **logo depois** de gravar o `product_scores` do card e só se o card tiver premissas. Roda para todas as ofertas `com_score` do card, com 50.000 cenários, semente 7 e sem `price_scan`.
- A falha de uma oferta não aborta o card nem o lote: registra um aviso no log e segue.
- Custo esperado: cerca de 350 ofertas, alguns minutos no lote. Não há fila nova.

### 5.4 Tabela nova `offer_scores`

| coluna | tipo | nota |
|---|---|---|
| id | uuid PK | |
| product_cluster_id | uuid FK → product_clusters (cascade) | |
| marketplace | text | |
| external_product_id | text | |
| score | int null | nulo quando o estado não é `com_score` |
| state | text | `com_score`/`sem_preco`/`suspeito` (os estados `aguardando_lote` e `sem_score_card` só existem na resposta da API, nunca gravados) |
| unit_cost_usd | numeric(14,4) null | custo usado |
| moq | int | |
| capital_primeiro_pedido | double null | BRL |
| p_vpl_positivo | double null | |
| vpl_mediano | double null | |
| cvar5 | double null | |
| premises | jsonb | |
| premises_hash | text | |
| data_version | text | `PREMISES_DATA_VERSION` |
| scenario_count | int | |
| computed_at | timestamp default now() | |

Índice: `(product_cluster_id, marketplace, external_product_id, computed_at)`. O histórico é mantido, e a leitura usa o registro mais recente de cada oferta. As ofertas `sem_preco`/`suspeito` também são gravadas (com `score` nulo), para a tela mostrar o motivo.

## 6. API

`GET /api/products/:id/offers` (autenticado, sem exigir ADMIN). Resposta em snake_case, como as demais:

```json
{
  "card": { "score": 74, "unit_cost_usd": 110.0, "data_confidence": "suficiente" },
  "best_offer_key": "alibaba:123",
  "offers": [
    {
      "key": "alibaba:123", "marketplace": "alibaba", "external_product_id": "123",
      "title": "…", "seller_name": "Loja Y", "url": "https://…",
      "unit_cost_usd": 96.0, "currency": "USD", "moq": 50, "rating": 4.4, "sales_signal": 320,
      "item_status": "confirmed",
      "state": "com_score", "score": 81, "p_vpl_positivo": 0.78,
      "capital_primeiro_pedido": 31000, "computed_at": "…"
    }
  ]
}
```

- A lista é ordenada por `score` (nulos por último) e, em seguida, por `unit_cost_usd`.
- Uma oferta que ainda não tem registro em `offer_scores` (anúncio novo desde o último lote) aparece com `state` calculado na hora (`sem_preco`/`suspeito`) ou `"aguardando_lote"`, e `score` nulo.
- `best_offer_key` é a oferta `com_score` de maior score, ou `null`.

`POST /api/products/:id/monte-carlo` passa a aceitar `offer_key` (opcional). Com ele, as premissas padrão da simulação usam o custo e o MOQ daquela oferta, como em 5.2. Continua sendo um cenário "e se": **não grava score oficial**. `GET /api/products/:id/monte-carlo/defaults` também aceita `offer_key` (query), para o seletor preencher as premissas.

## 7. Tela (Angular, `features/tendencia`)

- Aba `sourcing`: o rótulo passa a ser **"Ofertas"** (o id interno `sourcing` pode continuar).
- Topo da aba: "Score do card" (com o custo mediano), "Melhor oferta" (score + vendedor) e "Ofertas" (quantidade e número de lojas).
- Tabela: Score · Oferta (vendedor + título curto) · Fonte · Preço no MOQ (US$) · MOQ · Capital 1º pedido (R$) · P(VPL>0) · Nota · ações ("Simular" e "abrir"). Os estados sem score aparecem com o texto do motivo: "sem preço", "preço suspeito", "aguardando cálculo" e "card sem dados".
- O bloco "Fornecedor de alto volume" (`topSupplier`) sai da aba. O `app-supplier-comparison-table` sai da aba, mas **o componente não é apagado** se outra tela o usar (verificar com grep antes).
- Aba "Simulação": seletor no topo com "Card (custo mediano)" e cada oferta `com_score`. Trocar a opção recarrega as premissas padrão (`defaults?offer_key=`). "Simular" na tabela muda para a aba Simulação com a oferta selecionada.
- Nada muda no ranking nem no topo da página.

## 8. Fora do escopo (não fazer)

- Confiabilidade do fornecedor no score ou em selo.
- Preencher ou usar a tabela `suppliers`.
- Histórico de preço por oferta ou gráfico de oferta no tempo (Subprojeto D).
- Mudanças no ranking, filtros ou cards da listagem.
- Frete diferente por oferta (o frete continua sendo o do card).
- Qualquer chamada à LLM.

## 9. Testes

- **Python** (`Move-Intelligence-Back/scripts/tests/test_monte_carlo_vpl.py`): (a) com `qtd_minima_pedido=0`, as métricas ficam iguais às de antes, com a mesma semente; (b) com MOQ alto, o investimento sobe e o VPL mediano cai; (c) `capital_primeiro_pedido` presente.
- **Pura** `offerUnitCostUsd`: prioridade de `price_max`, fallback para `price_min`, CNY, moeda desconhecida e valores zero/nulos.
- **Pura** do estado da oferta: suspeito abaixo de 30%, `sem_preco` e `com_score`.
- `derivePremisesFromHistory`: o custo mediano usa o preço no MOQ (B-D7).
- `simulateBatchForRanking`: grava `offer_scores` para cada oferta; a falha de uma oferta não derruba o card; card sem premissas não simula ofertas.
- `GET /products/:id/offers`: ordenação, `best_offer_key`, itens provisórios fora e `aguardando_lote`.
- `POST monte-carlo` com `offer_key`: usa o custo e o MOQ da oferta e não grava score.
- **Front:** a aba se chama "Ofertas"; a tabela mostra os estados; "Simular" troca de aba com a oferta selecionada; o seletor recarrega as premissas.

## 10. Critérios de aceite

1. Depois do lote oficial local, todo card com score tem `offer_scores` para as suas ofertas.
2. Uma oferta com MOQ muito alto tem score menor que outra de custo parecido e MOQ baixo.
3. O score do card muda só por causa de B-D7 (preço no MOQ). Mostrar, antes e depois, a quantidade de cards cujo score mudou e a variação média.
4. A aba "Ofertas" e o seletor da Simulação funcionam no frontend reconstruído.
5. Nenhuma chamada à LLM; nenhum commit ou push.
