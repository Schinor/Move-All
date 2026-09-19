# Plano de implementação — Subprojeto B: Ofertas por fornecedor e score por oferta

> **Para o agente executor (Codex):** execute **uma tarefa por vez, na ordem**. Ao terminar cada tarefa: marque os checkboxes, mostre a saída dos testes e o `git diff --stat`, e **espere o "ok"** do usuário antes da próxima. Se um teste deste plano falhar de um jeito que o plano não previu, **pare e explique**; não altere o teste para passar.

**Objetivo:** cada anúncio de fornecedor de um card vira uma oferta com score financeiro próprio (Monte Carlo com o custo no MOQ e o MOQ como pedido mínimo), exibida na aba "Ofertas" da página do produto e selecionável na aba "Simulação".

**Arquitetura:** não existe tabela de ofertas. A lista é montada na hora a partir de `product_cluster_items` e do snapshot mais recente de cada anúncio. Regras puras ficam em `src/modules/products/offers/offer-rules.ts`, e o acesso ao banco fica em `offer-repository.ts`. O lote oficial (`simulateBatchForRanking`) simula as ofertas logo depois do card e grava `offer_scores`. O motor Python ganha a premissa `qtd_minima_pedido`.

**Stack:** NestJS 11 + Prisma 6 + Postgres 16 (jest), motor Python com numpy (pytest), Angular standalone + signals (vitest via `ng test`).

**Especificação:** [SPEC_SUBPROJETO_B_OFERTAS.md](SPEC_SUBPROJETO_B_OFERTAS.md). Leia antes de começar.

## Pré-requisitos (confira antes da Tarefa 1)

- [ ] O plano `PLANO_A2_AUTOMACAO_E_TAXONOMIA.md` foi concluído (existe `COUNTED_ITEM_STATUSES` em `src/modules/catalog/catalog.constants.ts`).
- [ ] O usuário fez o commit do Subprojeto A + A2 (`git log -1` mostra esse commit e `git status` está limpo ou só com o que o usuário indicar). **Se não estiver, pare e avise.**

## Regras globais

- **Sem chamadas à LLM/OpenRouter.** Não rode nada que chame IA. Ao final das tarefas que usam o banco, mostre a contagem de `ai_call_logs` antes e depois.
- **Sem commit, sem push, sem branch nova.** O usuário faz o commit.
- Banco: só mudanças aditivas, via SQL em `prisma/migrations/<timestamp>_<nome>/migration.sql`, aplicado com `docker exec -i move-postgres psql -U move -d move_intelligence -v ON_ERROR_STOP=1 < arquivo`. **Nada de `prisma db push` nem `prisma migrate dev`.** Depois de mexer no `schema.prisma`, rode `npx prisma generate`.
- Não apague `getSuppliers`, `GET /products/:id/suppliers` nem o componente `app-supplier-comparison-table`: eles são usados pelo comparador, pelo Copilot e pela tela `features/sourcing`.
- Não mude nada no ranking.
- Comandos de teste:
  - Backend: `cd Move-Intelligence-Back && npx jest <caminho> ` e, no fim, `npm test` + `npx tsc --noEmit -p tsconfig.json`.
  - Python: `cd Move-Intelligence-Back && python3 -m pytest scripts/tests/test_monte_carlo_vpl.py -q`.
  - Frontend: `cd Move-Intelligence-Front && npx ng test --watch=false` e `npx ng build`.

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `Move-Intelligence-Back/scripts/monte-carlo-vpl.py` | Modificar | premissa `qtd_minima_pedido` e saída `capital_primeiro_pedido` |
| `Move-Intelligence-Back/scripts/tests/test_monte_carlo_vpl.py` | Modificar | testes do MOQ |
| `Move-Intelligence-Back/src/modules/products/offers/offer-rules.ts` (+ `.spec.ts`) | Criar | regras puras: custo no MOQ, estado, ordenação, chave |
| `Move-Intelligence-Back/src/shared/business-rules/business-rules.defaults.ts` | Modificar | `offers.suspiciousPriceRatio` |
| `Move-Intelligence-Back/src/modules/scoring/premises-from-history.ts` (+ spec) | Modificar | custo mediano do card pelo preço no MOQ (B-D7) |
| `Move-Intelligence-Back/prisma/schema.prisma` + `prisma/migrations/20260920120000_offer_scores/migration.sql` | Modificar/Criar | tabela `offer_scores` |
| `Move-Intelligence-Back/src/modules/products/offers/offer-repository.ts` (+ `.spec.ts`) | Criar | ler ofertas do card e gravar/ler `offer_scores` |
| `Move-Intelligence-Back/src/modules/products/products.service.ts` (+ spec) | Modificar | lote com ofertas, `getOffers`, defaults e simulação com `offer_key` |
| `Move-Intelligence-Back/src/modules/products/products.controller.ts` | Modificar | `GET :id/offers` e `offer_key` nas rotas de Monte Carlo |
| `Move-Intelligence-Back/src/modules/products/dto/run-monte-carlo.dto.ts` | Modificar | `qtd_minima_pedido`, `offer_key` |
| `Move-Intelligence-Back/scripts/scores-resimulate.ts` + `package.json` | Criar/Modificar | resimular tudo e comparar scores antes/depois |
| `Move-Intelligence-Front/src/app/core/models/contract.models.ts` | Modificar | tipos das ofertas e premissa nova |
| `Move-Intelligence-Front/src/app/core/services/trends.service.ts` | Modificar | `offers()`, `monteCarloDefaults(id, offerKey?)` |
| `Move-Intelligence-Front/src/app/shared/util/offer-format.ts` (+ `.spec.ts`) | Criar | textos dos estados e formatação |
| `Move-Intelligence-Front/src/app/shared/util/format.ts` | Modificar | rótulo da fonte `offer` |
| `Move-Intelligence-Front/src/app/features/tendencia/tendencia.component.{ts,html,css}` | Modificar | aba "Ofertas" e seletor na Simulação |

---

### Tarefa 1: MOQ no motor Monte Carlo (Python)

**Arquivos:**
- Modificar: `Move-Intelligence-Back/scripts/monte-carlo-vpl.py`
- Testar: `Move-Intelligence-Back/scripts/tests/test_monte_carlo_vpl.py`

**Interfaces:**
- Produz: a premissa JSON `qtd_minima_pedido` (número ≥ 0, padrão 0) e o campo de resposta `capital_primeiro_pedido` (float, em BRL). Com 0, a resposta é idêntica à atual, inclusive `premises` e `premises_hash`.

- [ ] **Passo 1: escrever os testes (no fim de `test_monte_carlo_vpl.py`)**

```python
def test_moq_zero_preserva_resposta_anterior():
    legado = run_script(base_payload())
    com_zero = run_script(base_payload(premises={"qtd_minima_pedido": 0}))
    assert legado.returncode == 0 and com_zero.returncode == 0
    assert json.loads(legado.stdout) == json.loads(com_zero.stdout)
    assert "qtd_minima_pedido" not in json.loads(legado.stdout)["premises"]


def test_moq_alto_aumenta_capital_e_reduz_vpl():
    base = json.loads(run_script(base_payload()).stdout)
    alto = json.loads(run_script(base_payload(premises={"qtd_minima_pedido": 50000})).stdout)
    assert alto["capital_primeiro_pedido"] > base["capital_primeiro_pedido"]
    assert alto["metrics"]["vpl_mediano"] < base["metrics"]["vpl_mediano"]
    assert alto["premises"]["qtd_minima_pedido"] == 50000


def test_capital_primeiro_pedido_presente_e_positivo():
    resposta = json.loads(run_script(base_payload()).stdout)
    assert resposta["capital_primeiro_pedido"] > 0


def test_moq_negativo_e_rejeitado():
    resultado = run_script(base_payload(premises={"qtd_minima_pedido": -1}))
    assert resultado.returncode == 1
    assert "qtd_minima_pedido" in json.loads(resultado.stdout)["error"]
```

- [ ] **Passo 2: rodar e ver falhar**

Rode: `cd Move-Intelligence-Back && python3 -m pytest scripts/tests/test_monte_carlo_vpl.py -q`
Esperado: os 4 testes novos falham, com `KeyError: 'capital_primeiro_pedido'` e `TypeError ... unexpected keyword 'qtd_minima_pedido'`. Os antigos passam.

- [ ] **Passo 3: implementar**

Em `Premissas`, logo depois de `vol_crescimento: float = 0.0`:

```python
    # Pedido mínimo do fornecedor (Subprojeto B): o 1º pedido nunca é menor
    # que o MOQ. Zero = comportamento anterior (resultado bit a bit idêntico).
    qtd_minima_pedido: float = 0.0
```

Em `SimuladorVPL.simular`, troque a linha `qty = np.round(dem_planejada * (1 + p.folga_estoque))` por:

```python
        qty = np.maximum(np.round(dem_planejada * (1 + p.folga_estoque)), p.qtd_minima_pedido)
```

Em `NUMERIC_PREMISES`, acrescente `"qtd_minima_pedido"` ao final da tupla. Na tupla de campos que não podem ser negativos, dentro de `validar_premissas`, acrescente `"qtd_minima_pedido"`.

Substitua `premises_dict` por:

```python
def premises_dict(premissas: Premissas) -> Dict[str, object]:
    """Premissas efetivas como dict JSON-estável (listas, sem tuplas).

    `qtd_minima_pedido = 0` é omitido para manter o hash das premissas
    idêntico ao de antes do Subprojeto B.
    """
    data = dict(premissas.__dict__)
    data["curva_rampa"] = list(premissas.curva_rampa)
    if not data.get("qtd_minima_pedido"):
        data.pop("qtd_minima_pedido", None)
    return data
```

Crie a função, logo depois de `premises_hash`:

```python
def capital_primeiro_pedido(p: Premissas) -> float:
    """Capital do 1º pedido em BRL no câmbio base (sem choques): qty × custo posto."""
    dem_planejada = p.demanda_referencia * (p.preco_referencia / p.preco_venda) ** p.elasticidade
    qty = max(float(np.round(dem_planejada * (1 + p.folga_estoque))), float(p.qtd_minima_pedido))
    custo_usd_efetivo = p.custo_usd * (p.cambio_cny_usd if p.moeda_custo == "CNY" else 1.0)
    landed = custo_usd_efetivo * p.cambio_base * (1 + p.imposto_importacao) + p.frete_usd_unidade * p.cambio_base
    return float(qty * landed)
```

Em `main`, dentro do dicionário `response`, logo depois de `"financial_score": ...`:

```python
        "capital_primeiro_pedido": capital_primeiro_pedido(premissas),
```

- [ ] **Passo 4: rodar e ver passar**

Rode: `python3 -m pytest scripts/tests/test_monte_carlo_vpl.py -q`
Esperado: todos passam (os 6 antigos e os 4 novos).

---

### Tarefa 2: Regras puras da oferta

**Arquivos:**
- Criar: `Move-Intelligence-Back/src/modules/products/offers/offer-rules.ts`
- Criar: `Move-Intelligence-Back/src/modules/products/offers/offer-rules.spec.ts`
- Modificar: `Move-Intelligence-Back/src/shared/business-rules/business-rules.defaults.ts`

**Interfaces:**
- Produz (usadas nas Tarefas 3, 5, 6 e 7):
  - `SUPPLIER_MARKETPLACES: readonly ['1688', 'alibaba', 'aliexpress']`
  - `offerUnitCostUsd(price: OfferPrice, fxCnyUsd: number): number | null`
  - `offerState(input: { unitCostUsd: number | null; cardUnitCostUsd: number | null; suspiciousRatio: number }): 'com_score' | 'sem_preco' | 'suspeito'`
  - `offerKey(marketplace: string, externalProductId: string): string`, que devolve `"marketplace:id"`
  - `parseOfferKey(key: string): { marketplace: string; externalProductId: string } | null`
  - `sortOffers<T extends { score: number | null; unitCostUsd: number | null }>(offers: T[]): T[]`
  - `normalizedMoq(moq: number | null | undefined): number`
  - `DEFAULT_BUSINESS_RULES.offers.suspiciousPriceRatio === 0.3`

- [ ] **Passo 1: escrever o teste**

```ts
import {
  normalizedMoq,
  offerKey,
  offerState,
  offerUnitCostUsd,
  parseOfferKey,
  sortOffers,
} from './offer-rules';
import { DEFAULT_BUSINESS_RULES } from '../../../shared/business-rules/business-rules.defaults';

describe('offer-rules', () => {
  describe('offerUnitCostUsd (preço no MOQ)', () => {
    it('usa price_max quando existe', () => {
      expect(offerUnitCostUsd({ priceMin: 90, priceMax: 120, currency: 'USD' }, 0.14)).toBe(120);
    });
    it('cai para price_min sem price_max', () => {
      expect(offerUnitCostUsd({ priceMin: 90, priceMax: null, currency: 'USD' }, 0.14)).toBe(90);
    });
    it('ignora price_max zero', () => {
      expect(offerUnitCostUsd({ priceMin: 90, priceMax: 0, currency: null }, 0.14)).toBe(90);
    });
    it('converte CNY para USD', () => {
      expect(offerUnitCostUsd({ priceMin: 500, priceMax: 700, currency: 'CNY' }, 0.14)).toBeCloseTo(98, 6);
    });
    it('moeda desconhecida é sem preço', () => {
      expect(offerUnitCostUsd({ priceMin: 90, priceMax: 100, currency: 'BRL' }, 0.14)).toBeNull();
    });
    it('sem preço válido devolve null', () => {
      expect(offerUnitCostUsd({ priceMin: null, priceMax: null, currency: 'USD' }, 0.14)).toBeNull();
      expect(offerUnitCostUsd({ priceMin: -1, priceMax: undefined, currency: 'USD' }, 0.14)).toBeNull();
    });
  });

  describe('offerState', () => {
    const ratio = DEFAULT_BUSINESS_RULES.offers.suspiciousPriceRatio;
    it('limite padrão é 30%', () => expect(ratio).toBe(0.3));
    it('sem custo → sem_preco', () => {
      expect(offerState({ unitCostUsd: null, cardUnitCostUsd: 100, suspiciousRatio: ratio })).toBe('sem_preco');
    });
    it('abaixo de 30% da mediana → suspeito', () => {
      expect(offerState({ unitCostUsd: 29.9, cardUnitCostUsd: 100, suspiciousRatio: ratio })).toBe('suspeito');
    });
    it('exatamente 30% ainda tem score', () => {
      expect(offerState({ unitCostUsd: 30, cardUnitCostUsd: 100, suspiciousRatio: ratio })).toBe('com_score');
    });
    it('sem mediana do card não marca suspeito', () => {
      expect(offerState({ unitCostUsd: 5, cardUnitCostUsd: null, suspiciousRatio: ratio })).toBe('com_score');
    });
  });

  it('offerKey e parseOfferKey são inversos', () => {
    expect(offerKey('alibaba', '123')).toBe('alibaba:123');
    expect(parseOfferKey('alibaba:123')).toEqual({ marketplace: 'alibaba', externalProductId: '123' });
    expect(parseOfferKey('1688:a:b')).toEqual({ marketplace: '1688', externalProductId: 'a:b' });
    expect(parseOfferKey('semdoispontos')).toBeNull();
    expect(parseOfferKey('varejo:1')).toBeNull();
  });

  it('normalizedMoq trata nulo e não positivo como 1', () => {
    expect(normalizedMoq(null)).toBe(1);
    expect(normalizedMoq(0)).toBe(1);
    expect(normalizedMoq(50)).toBe(50);
  });

  it('sortOffers: score desc, nulos por último, desempate por custo asc', () => {
    const sorted = sortOffers([
      { id: 'a', score: null, unitCostUsd: 10 },
      { id: 'b', score: 70, unitCostUsd: 120 },
      { id: 'c', score: 70, unitCostUsd: 100 },
      { id: 'd', score: 90, unitCostUsd: 200 },
      { id: 'e', score: null, unitCostUsd: null },
    ]);
    expect(sorted.map((o) => o.id)).toEqual(['d', 'c', 'b', 'a', 'e']);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rode: `npx jest src/modules/products/offers/offer-rules.spec.ts`
Esperado: FAIL com "Cannot find module './offer-rules'".

- [ ] **Passo 3: implementar**

Em `business-rules.defaults.ts`, dentro de `DEFAULT_BUSINESS_RULES`, como última propriedade do objeto:

```ts
  // Subprojeto B: oferta com custo < 30% da mediana do card fica sem score (preço de isca).
  offers: {
    suspiciousPriceRatio: 0.3,
  },
```

(Se o arquivo tiver um tipo/interface explícito para as regras, acrescente `offers: { suspiciousPriceRatio: number }` nele também.)

`offer-rules.ts`:

```ts
/** Regras puras das ofertas (Subprojeto B). Sem Prisma, sem rede. */

export const SUPPLIER_MARKETPLACES = ['1688', 'alibaba', 'aliexpress'] as const;

export type OfferStoredState = 'com_score' | 'sem_preco' | 'suspeito';

export interface OfferPrice {
  priceMin: number | null | undefined;
  priceMax?: number | null | undefined;
  currency?: string | null;
}

function positive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Preço no MOQ (B-D3): price_max, senão price_min; USD direto, CNY convertido, outra moeda = sem preço. */
export function offerUnitCostUsd(price: OfferPrice, fxCnyUsd: number): number | null {
  const base = positive(price.priceMax) ?? positive(price.priceMin);
  if (base === null) return null;
  const currency = (price.currency ?? '').toUpperCase();
  if (currency === 'CNY') return base * fxCnyUsd;
  if (currency === 'USD' || currency === '') return base;
  return null;
}

export function offerState(input: {
  unitCostUsd: number | null;
  cardUnitCostUsd: number | null;
  suspiciousRatio: number;
}): OfferStoredState {
  if (input.unitCostUsd === null) return 'sem_preco';
  if (input.cardUnitCostUsd !== null && input.cardUnitCostUsd > 0
      && input.unitCostUsd < input.cardUnitCostUsd * input.suspiciousRatio) {
    return 'suspeito';
  }
  return 'com_score';
}

export function offerKey(marketplace: string, externalProductId: string): string {
  return `${marketplace}:${externalProductId}`;
}

export function parseOfferKey(key: string): { marketplace: string; externalProductId: string } | null {
  const index = key.indexOf(':');
  if (index <= 0 || index === key.length - 1) return null;
  const marketplace = key.slice(0, index);
  if (!(SUPPLIER_MARKETPLACES as readonly string[]).includes(marketplace)) return null;
  return { marketplace, externalProductId: key.slice(index + 1) };
}

export function normalizedMoq(moq: number | null | undefined): number {
  return typeof moq === 'number' && Number.isFinite(moq) && moq > 0 ? Math.round(moq) : 1;
}

export function sortOffers<T extends { score: number | null; unitCostUsd: number | null }>(offers: T[]): T[] {
  return [...offers].sort((a, b) => {
    if (a.score !== b.score) {
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return b.score - a.score;
    }
    const ca = a.unitCostUsd ?? Number.POSITIVE_INFINITY;
    const cb = b.unitCostUsd ?? Number.POSITIVE_INFINITY;
    return ca - cb;
  });
}
```

- [ ] **Passo 4: rodar e ver passar**

Rode: `npx jest src/modules/products/offers/offer-rules.spec.ts`
Esperado: PASS.

---

### Tarefa 3: Custo mediano do card pelo preço no MOQ (B-D7)

**Arquivos:**
- Modificar: `Move-Intelligence-Back/src/modules/scoring/premises-from-history.ts`
- Modificar: `Move-Intelligence-Back/src/modules/scoring/premises-from-history.spec.ts`
- Modificar: `Move-Intelligence-Back/src/modules/products/products.service.ts` (`toHistoryObservations` e o tipo `ClusterForSimulation`)

**Interfaces:**
- Consome: `offerUnitCostUsd`, `SUPPLIER_MARKETPLACES` (Tarefa 2).
- Produz: `HistoryObservation.priceMax?: number | null`. O `custo_usd` derivado passa a ser a mediana de `offerUnitCostUsd` das observações de fornecedor.

- [ ] **Passo 1: escrever o teste** (acrescente ao `premises-from-history.spec.ts`, reaproveitando os construtores de observação que já existem no arquivo; se o arquivo usa uma função `obs(...)`/`series(...)`, use-a)

```ts
it('B-D7: custo mediano usa o preço no MOQ (price_max) dos fornecedores', () => {
  const observations = [
    ...historicoSuficienteDeVarejoBr(), // use o helper existente que gera ≥ 4 observações BR em ≥ 21 dias
    { listingKey: '1688:a', marketplace: '1688', currency: 'USD', priceMin: 10, priceMax: 20, salesSignal: null, collectedAt: new Date('2026-08-25') },
    { listingKey: '1688:b', marketplace: '1688', currency: 'USD', priceMin: 12, priceMax: 22, salesSignal: null, collectedAt: new Date('2026-08-26') },
    { listingKey: 'alibaba:c', marketplace: 'alibaba', currency: 'USD', priceMin: 14, priceMax: null, salesSignal: null, collectedAt: new Date('2026-08-27') },
  ];
  const result = derivePremisesFromHistory(observations, { fxCnyUsd: 0.14 });
  expect(result.premises?.custo_usd).toBe(20); // mediana de [20, 22, 14]
});
```

Se não houver um helper equivalente a `historicoSuficienteDeVarejoBr`, copie as observações BR do teste existente que resulta em `dataConfidence: 'suficiente'` e ajuste as datas para caírem na mesma janela. **Não invente um helper novo dentro do código de produção.**

- [ ] **Passo 2: rodar e ver falhar**

Rode: `npx jest src/modules/scoring/premises-from-history.spec.ts`
Esperado: o teste novo falha (hoje ele devolve 12, a mediana de `priceMin`).

- [ ] **Passo 3: implementar**

Em `premises-from-history.ts`:
- No topo: `import { offerUnitCostUsd, SUPPLIER_MARKETPLACES } from '../products/offers/offer-rules';`
- Em `HistoryObservation`, depois de `priceMin`: `priceMax?: number | null;`
- Remova a constante local `COST_MARKETPLACES` e troque o trecho do custo por:

```ts
  const costUsd = inWindow
    .filter((obs) => (SUPPLIER_MARKETPLACES as readonly string[]).includes(obs.marketplace))
    .map((obs) => offerUnitCostUsd({ priceMin: obs.priceMin, priceMax: obs.priceMax, currency: obs.currency }, opts.fxCnyUsd))
    .filter((price): price is number => price !== null && price > 0);
```

Em `products.service.ts`:
- No tipo `ClusterForSimulation`, dentro de `snapshots`, depois de `priceMin: unknown;`: `priceMax?: unknown;`
- Em `toHistoryObservations`, depois de `priceMin: ...`: `priceMax: this.toPositiveNumber(snapshot.priceMax),`

- [ ] **Passo 4: rodar e ver passar**

Rode: `npx jest src/modules/scoring src/modules/products`
Esperado: PASS (os testes antigos continuam passando, porque sem `priceMax` o valor cai para `priceMin`).

---

### Tarefa 4: Tabela `offer_scores` e repositório de ofertas

**Arquivos:**
- Criar: `Move-Intelligence-Back/prisma/migrations/20260920120000_offer_scores/migration.sql`
- Modificar: `Move-Intelligence-Back/prisma/schema.prisma`
- Criar: `Move-Intelligence-Back/src/modules/products/offers/offer-repository.ts`
- Criar: `Move-Intelligence-Back/src/modules/products/offers/offer-repository.spec.ts`

**Interfaces:**
- Consome: `COUNTED_ITEM_STATUSES` (A2), `syntheticSnapshotWhere()` (`src/shared/synthetic-data/synthetic-data.filter.ts`), `SUPPLIER_MARKETPLACES` e `offerKey` (Tarefa 2).
- Produz:
  - `interface OfferListing { key: string; marketplace: string; externalProductId: string; itemStatus: string; title: string | null; sellerName: string | null; url: string | null; priceMin: number | null; priceMax: number | null; currency: string | null; moq: number | null; rating: number | null; salesSignal: number | null; collectedAt: Date | null }`
  - `interface OfferScoreRow { key: string; score: number | null; state: string; unitCostUsd: number | null; moq: number; capitalPrimeiroPedido: number | null; pVplPositivo: number | null; computedAt: Date }`
  - `class OfferRepository { constructor(prisma: PrismaService); listOfferListings(clusterId: string): Promise<OfferListing[]>; latestOfferScores(clusterId: string): Promise<Map<string, OfferScoreRow>>; createOfferScore(data: OfferScoreInput): Promise<void> }`
  - `interface OfferScoreInput { productClusterId: string; marketplace: string; externalProductId: string; score: number | null; state: 'com_score' | 'sem_preco' | 'suspeito'; unitCostUsd: number | null; moq: number; capitalPrimeiroPedido: number | null; pVplPositivo: number | null; vplMediano: number | null; cvar5: number | null; premises: Record<string, unknown>; premisesHash: string; dataVersion: string; scenarioCount: number }`

- [ ] **Passo 1: migration**

`migration.sql`:

```sql
-- Subprojeto B: score por oferta (anúncio de fornecedor) dentro do card.
CREATE TABLE IF NOT EXISTS offer_scores (
  id uuid PRIMARY KEY,
  product_cluster_id uuid NOT NULL REFERENCES product_clusters(id) ON DELETE CASCADE,
  marketplace text NOT NULL,
  external_product_id text NOT NULL,
  score integer,
  state text NOT NULL,
  unit_cost_usd numeric(14,4),
  moq integer NOT NULL,
  capital_primeiro_pedido double precision,
  p_vpl_positivo double precision,
  vpl_mediano double precision,
  cvar5 double precision,
  premises jsonb NOT NULL DEFAULT '{}'::jsonb,
  premises_hash text NOT NULL DEFAULT '',
  data_version text NOT NULL,
  scenario_count integer NOT NULL DEFAULT 0,
  computed_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS offer_scores_cluster_offer_computed_idx
  ON offer_scores (product_cluster_id, marketplace, external_product_id, computed_at);
```

Em `schema.prisma`, crie o model e a relação inversa em `ProductCluster` (`offerScores OfferScore[]`):

```prisma
model OfferScore {
  id                    String         @id @default(uuid()) @db.Uuid
  productClusterId      String         @map("product_cluster_id") @db.Uuid
  marketplace           String
  externalProductId     String         @map("external_product_id")
  score                 Int?
  state                 String
  unitCostUsd           Decimal?       @map("unit_cost_usd") @db.Decimal(14, 4)
  moq                   Int
  capitalPrimeiroPedido Float?         @map("capital_primeiro_pedido")
  pVplPositivo          Float?         @map("p_vpl_positivo")
  vplMediano            Float?         @map("vpl_mediano")
  cvar5                 Float?
  premises              Json           @default("{}")
  premisesHash          String         @default("") @map("premises_hash")
  dataVersion           String         @map("data_version")
  scenarioCount         Int            @default(0) @map("scenario_count")
  computedAt            DateTime       @default(now()) @map("computed_at")
  cluster               ProductCluster @relation(fields: [productClusterId], references: [id], onDelete: Cascade)

  @@index([productClusterId, marketplace, externalProductId, computedAt], map: "offer_scores_cluster_offer_computed_idx")
  @@map("offer_scores")
}
```

Aplique e gere:

```bash
cd Move-Intelligence-Back && docker exec -i move-postgres psql -U move -d move_intelligence -v ON_ERROR_STOP=1 < prisma/migrations/20260920120000_offer_scores/migration.sql && npx prisma generate
```

- [ ] **Passo 2: escrever o teste do repositório**

```ts
import { OfferRepository } from './offer-repository';
import { PrismaService } from '../../../shared/database/prisma.service';

function build(items: unknown[], snapshots: unknown[], scores: unknown[] = []) {
  const prisma = {
    productClusterItem: { findMany: jest.fn().mockResolvedValue(items) },
    productListingSnapshot: { findMany: jest.fn().mockResolvedValue(snapshots) },
    offerScore: {
      findMany: jest.fn().mockResolvedValue(scores),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  return { repo: new OfferRepository(prisma as unknown as PrismaService), prisma };
}

describe('OfferRepository', () => {
  it('lista só anúncios de fornecedor contados, com o snapshot mais recente', async () => {
    const { repo, prisma } = build(
      [
        { marketplace: 'alibaba', externalProductId: 'A', status: 'confirmed' },
        { marketplace: '1688', externalProductId: 'B', status: 'auto' },
      ],
      [
        { marketplace: 'alibaba', externalProductId: 'A', title: 'novo', sellerName: 'Y', productUrl: 'u', priceMin: 90, priceMax: 96, currency: 'USD', moq: 50, rating: 4.4, salesSignalRaw: 320, collectedAt: new Date('2026-09-10') },
        { marketplace: 'alibaba', externalProductId: 'A', title: 'antigo', sellerName: 'Y', productUrl: 'u', priceMin: 80, priceMax: 85, currency: 'USD', moq: 50, rating: 4.4, salesSignalRaw: 300, collectedAt: new Date('2026-09-01') },
      ],
    );

    const offers = await repo.listOfferListings('card-1');

    expect(prisma.productClusterItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        clusterId: 'card-1',
        marketplace: { in: ['1688', 'alibaba', 'aliexpress'] },
        status: { in: ['confirmed', 'auto'] },
      }),
    }));
    expect(offers).toHaveLength(2);
    const a = offers.find((o) => o.key === 'alibaba:A')!;
    expect(a).toMatchObject({ title: 'novo', priceMax: 96, moq: 50, itemStatus: 'confirmed', salesSignal: 320 });
    const b = offers.find((o) => o.key === '1688:B')!;
    expect(b).toMatchObject({ priceMin: null, priceMax: null, collectedAt: null, itemStatus: 'auto' });
  });

  it('latestOfferScores devolve o registro mais recente por oferta', async () => {
    const { repo } = build([], [], [
      { marketplace: 'alibaba', externalProductId: 'A', score: 81, state: 'com_score', unitCostUsd: 96, moq: 50, capitalPrimeiroPedido: 31000, pVplPositivo: 0.78, computedAt: new Date('2026-09-12') },
      { marketplace: 'alibaba', externalProductId: 'A', score: 60, state: 'com_score', unitCostUsd: 99, moq: 50, capitalPrimeiroPedido: 30000, pVplPositivo: 0.6, computedAt: new Date('2026-09-05') },
    ]);
    const map = await repo.latestOfferScores('card-1');
    expect(map.get('alibaba:A')).toMatchObject({ score: 81, unitCostUsd: 96 });
  });
});
```

- [ ] **Passo 3: rodar e ver falhar**

Rode: `npx jest src/modules/products/offers/offer-repository.spec.ts`
Esperado: FAIL com "Cannot find module './offer-repository'".

- [ ] **Passo 4: implementar `offer-repository.ts`**

```ts
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';
import { syntheticSnapshotWhere } from '../../../shared/synthetic-data/synthetic-data.filter';
import { COUNTED_ITEM_STATUSES } from '../../catalog/catalog.constants';
import { offerKey, SUPPLIER_MARKETPLACES } from './offer-rules';

export interface OfferListing {
  key: string;
  marketplace: string;
  externalProductId: string;
  itemStatus: string;
  title: string | null;
  sellerName: string | null;
  url: string | null;
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  moq: number | null;
  rating: number | null;
  salesSignal: number | null;
  collectedAt: Date | null;
}

export interface OfferScoreRow {
  key: string;
  score: number | null;
  state: string;
  unitCostUsd: number | null;
  moq: number;
  capitalPrimeiroPedido: number | null;
  pVplPositivo: number | null;
  computedAt: Date;
}

export interface OfferScoreInput {
  productClusterId: string;
  marketplace: string;
  externalProductId: string;
  score: number | null;
  state: 'com_score' | 'sem_preco' | 'suspeito';
  unitCostUsd: number | null;
  moq: number;
  capitalPrimeiroPedido: number | null;
  pVplPositivo: number | null;
  vplMediano: number | null;
  cvar5: number | null;
  premises: Record<string, unknown>;
  premisesHash: string;
  dataVersion: string;
  scenarioCount: number;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Acesso ao banco das ofertas (Subprojeto B). Sem regra de negócio: as regras ficam em offer-rules. */
export class OfferRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listOfferListings(clusterId: string): Promise<OfferListing[]> {
    const items = await this.prisma.productClusterItem.findMany({
      where: {
        clusterId,
        marketplace: { in: [...SUPPLIER_MARKETPLACES] },
        status: { in: [...COUNTED_ITEM_STATUSES] },
      },
      select: { marketplace: true, externalProductId: true, status: true },
    });
    if (items.length === 0) return [];
    const snapshots = await this.prisma.productListingSnapshot.findMany({
      where: {
        ...syntheticSnapshotWhere(),
        OR: items.map((item) => ({ marketplace: item.marketplace, externalProductId: item.externalProductId })),
      },
      orderBy: { collectedAt: 'desc' },
      select: {
        marketplace: true, externalProductId: true, title: true, sellerName: true, productUrl: true,
        priceMin: true, priceMax: true, currency: true, moq: true, rating: true, salesSignalRaw: true, collectedAt: true,
      },
    });
    const latest = new Map<string, (typeof snapshots)[number]>();
    for (const snap of snapshots) {
      const key = offerKey(snap.marketplace, snap.externalProductId);
      if (!latest.has(key)) latest.set(key, snap);
    }
    return items.map((item) => {
      const key = offerKey(item.marketplace, item.externalProductId);
      const snap = latest.get(key);
      return {
        key,
        marketplace: item.marketplace,
        externalProductId: item.externalProductId,
        itemStatus: item.status,
        title: snap?.title ?? null,
        sellerName: snap?.sellerName ?? null,
        url: snap?.productUrl ?? null,
        priceMin: num(snap?.priceMin),
        priceMax: num(snap?.priceMax),
        currency: snap?.currency ?? null,
        moq: snap?.moq ?? null,
        rating: num(snap?.rating),
        salesSignal: num(snap?.salesSignalRaw),
        collectedAt: snap?.collectedAt ?? null,
      };
    });
  }

  async latestOfferScores(clusterId: string): Promise<Map<string, OfferScoreRow>> {
    const rows = await this.prisma.offerScore.findMany({
      where: { productClusterId: clusterId },
      orderBy: { computedAt: 'desc' },
      take: 2_000,
    });
    const map = new Map<string, OfferScoreRow>();
    for (const row of rows) {
      const key = offerKey(row.marketplace, row.externalProductId);
      if (map.has(key)) continue;
      map.set(key, {
        key,
        score: row.score,
        state: row.state,
        unitCostUsd: num(row.unitCostUsd),
        moq: row.moq,
        capitalPrimeiroPedido: row.capitalPrimeiroPedido,
        pVplPositivo: row.pVplPositivo,
        computedAt: row.computedAt,
      });
    }
    return map;
  }

  async createOfferScore(data: OfferScoreInput): Promise<void> {
    await this.prisma.offerScore.create({
      data: {
        ...data,
        premises: JSON.parse(JSON.stringify(data.premises)) as Prisma.InputJsonValue,
      },
    });
  }
}
```

Os campos `title`, `externalProductId` e `productUrl` existem em `ProductListingSnapshot` (conferido); não crie coluna nova.

- [ ] **Passo 5: rodar e ver passar**

Rode: `npx jest src/modules/products/offers && npx tsc --noEmit -p tsconfig.json`
Esperado: PASS, sem erros de tipo.

---

### Tarefa 5: Lote oficial simula as ofertas

**Arquivos:**
- Modificar: `Move-Intelligence-Back/src/modules/products/products.service.ts`
- Modificar: `Move-Intelligence-Back/src/modules/products/products.service.spec.ts`

**Interfaces:**
- Consome: `OfferRepository` (Tarefa 4), `offerUnitCostUsd`, `offerState`, `normalizedMoq` (Tarefa 2), `DEFAULT_BUSINESS_RULES.offers`.
- Produz: o método privado `simulateCardOffers(clusterId: string, cardPremises: Record<string, unknown>, cardUnitCostUsd: number, fxCnyUsd: number): Promise<{ simulated: number; failed: number }>` e o getter privado `offerRepo`.

- [ ] **Passo 1: escrever os testes** (dentro do `describe('ProductsService — simulateBatchForRanking oficial (F2.4)')`)

Primeiro, no `buildBatchService` desse describe, acrescente ao objeto `prisma`:

```ts
      productClusterItem: { findMany: jest.fn().mockResolvedValue([]) },
      productListingSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
      offerScore: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({}) },
```

Depois, os testes novos:

```ts
  it('B: simula cada oferta com custo e MOQ dela e grava offer_scores', async () => {
    const snapshots = [
      snapshot(0, { salesSignalRaw: 100 }),
      snapshot(1, { salesSignalRaw: 110 }),
      snapshot(2, { salesSignalRaw: 120 }),
      snapshot(3, { salesSignalRaw: 130 }),
      { marketplace: '1688', currency: 'USD', priceMin: 100, priceMax: 110, salesSignalRaw: null, salesSignalType: null,
        reviewCount: null, rating: null, moq: 50, collectedAt: new Date(BASE + 21 * DAY), externalProductId: 'C1', sellerName: null },
    ];
    const { service, prisma, runPython } = buildBatchService(snapshots);
    prisma.productClusterItem.findMany.mockResolvedValue([
      { marketplace: '1688', externalProductId: 'C1', status: 'confirmed' },
      { marketplace: 'alibaba', externalProductId: 'C2', status: 'auto' },
      { marketplace: 'alibaba', externalProductId: 'C3', status: 'confirmed' },
    ]);
    prisma.productListingSnapshot.findMany.mockResolvedValue([
      { marketplace: '1688', externalProductId: 'C1', title: 't1', sellerName: 'X', productUrl: null, priceMin: 100, priceMax: 110, currency: 'USD', moq: 50, rating: null, salesSignalRaw: null, collectedAt: new Date(BASE + 21 * DAY) },
      { marketplace: 'alibaba', externalProductId: 'C2', title: 't2', sellerName: 'Y', productUrl: null, priceMin: null, priceMax: null, currency: 'USD', moq: 10, rating: null, salesSignalRaw: null, collectedAt: new Date(BASE + 21 * DAY) },
      { marketplace: 'alibaba', externalProductId: 'C3', title: 't3', sellerName: 'Z', productUrl: null, priceMin: 5, priceMax: 5, currency: 'USD', moq: 10, rating: null, salesSignalRaw: null, collectedAt: new Date(BASE + 21 * DAY) },
    ]);

    await service.simulateBatchForRanking(10);

    // 1 chamada do card + 1 da oferta C1 (C2 sem preço, C3 suspeito: sem Python)
    expect(runPython).toHaveBeenCalledTimes(2);
    expect(runPython).toHaveBeenLastCalledWith(expect.objectContaining({
      premises: expect.objectContaining({ custo_usd: 110, qtd_minima_pedido: 50 }),
      scenario_count: 50_000, seed: 7, price_scan: false,
    }));
    const states = prisma.offerScore.create.mock.calls.map((call: any[]) => [call[0].data.externalProductId, call[0].data.state]);
    expect(states).toEqual(expect.arrayContaining([['C1', 'com_score'], ['C2', 'sem_preco'], ['C3', 'suspeito']]));
  });

  it('B: falha na oferta não derruba o card', async () => {
    const snapshots = [
      snapshot(0, { salesSignalRaw: 100 }), snapshot(1, { salesSignalRaw: 110 }),
      snapshot(2, { salesSignalRaw: 120 }), snapshot(3, { salesSignalRaw: 130 }),
      { marketplace: '1688', currency: 'USD', priceMin: 100, priceMax: 110, salesSignalRaw: null, salesSignalType: null,
        reviewCount: null, rating: null, moq: 50, collectedAt: new Date(BASE + 21 * DAY), externalProductId: 'C1', sellerName: null },
    ];
    const { service, prisma } = buildBatchService(snapshots);
    prisma.productClusterItem.findMany.mockRejectedValue(new Error('boom'));

    const summary = await service.simulateBatchForRanking(10);

    expect(summary.simulated).toBe(1);
    expect(summary.failed).toBe(0);
    expect(prisma.productScore.create).toHaveBeenCalled();
  });

  it('B: card sem premissas não simula ofertas', async () => {
    const { service, prisma } = buildBatchService([]);
    await service.simulateBatchForRanking(10);
    expect(prisma.productClusterItem.findMany).not.toHaveBeenCalled();
    expect(prisma.offerScore.create).not.toHaveBeenCalled();
  });
```

Observação: o `derived.custo_usd` nesse cenário é 110 (preço no MOQ da única observação de fornecedor), e C3 (5) fica abaixo de 30% de 110, portanto suspeito. Se o helper `snapshot(...)` do arquivo gerar observações de fornecedor, recalcule a mediana esperada e **explique a diferença antes de mudar o teste**.

- [ ] **Passo 2: rodar e ver falhar**

Rode: `npx jest src/modules/products/products.service.spec.ts -t "B:"`
Esperado: FAIL nos 2 primeiros testes (o Python é chamado 1 vez; `offerScore.create` nunca é chamado).

- [ ] **Passo 3: implementar**

Imports no topo de `products.service.ts`:

```ts
import { OfferRepository } from './offers/offer-repository';
import { normalizedMoq, offerState, offerUnitCostUsd } from './offers/offer-rules';
```

(`DEFAULT_BUSINESS_RULES` já é importado no arquivo; se não for, importe de `../../shared/business-rules/business-rules.defaults`.)

Campo e getter na classe (logo depois do construtor):

```ts
  private offerRepository?: OfferRepository;

  private get offerRepo(): OfferRepository {
    this.offerRepository ??= new OfferRepository(this.prisma);
    return this.offerRepository;
  }
```

Em `simulateBatchForRanking`, **logo depois** do `await this.prisma.productScore.create({...})` do caminho com score (antes de `summary.simulated += 1;`), acrescente:

```ts
        const offers = await this.simulateCardOffers(
          cluster.id,
          (result.premises ?? scriptPremises) as Record<string, unknown>,
          derived.custo_usd,
          fxCnyUsd,
        );
        if (offers.failed > 0) {
          this.logger.warn(`Ofertas do cluster ${cluster.id}: ${offers.failed} falharam, ${offers.simulated} simuladas.`);
        }
```

Novo método privado (perto de `persistSimulationOutcome`):

```ts
  /**
   * Subprojeto B: simula cada oferta (anúncio de fornecedor contado) com as
   * premissas do card, trocando só o custo (preço no MOQ) e o MOQ. Nunca lança:
   * falha de oferta não afeta o score do card.
   */
  private async simulateCardOffers(
    clusterId: string,
    cardPremises: Record<string, unknown>,
    cardUnitCostUsd: number,
    fxCnyUsd: number,
  ): Promise<{ simulated: number; failed: number }> {
    const outcome = { simulated: 0, failed: 0 };
    let listings;
    try {
      listings = await this.offerRepo.listOfferListings(clusterId);
    } catch (error) {
      this.logger.warn(`Ofertas do cluster ${clusterId} não carregaram: ${error instanceof Error ? error.message : error}`);
      return outcome;
    }
    const ratio = DEFAULT_BUSINESS_RULES.offers.suspiciousPriceRatio;
    for (const listing of listings) {
      try {
        const unitCostUsd = offerUnitCostUsd(listing, fxCnyUsd);
        const moq = normalizedMoq(listing.moq);
        const state = offerState({ unitCostUsd, cardUnitCostUsd, suspiciousRatio: ratio });
        const base = {
          productClusterId: clusterId,
          marketplace: listing.marketplace,
          externalProductId: listing.externalProductId,
          unitCostUsd,
          moq,
          dataVersion: PREMISES_DATA_VERSION,
        };
        if (state !== 'com_score' || unitCostUsd === null) {
          await this.offerRepo.createOfferScore({
            ...base, state, score: null, capitalPrimeiroPedido: null, pVplPositivo: null,
            vplMediano: null, cvar5: null, premises: {}, premisesHash: '', scenarioCount: 0,
          });
          continue;
        }
        const premises = {
          ...cardPremises,
          custo_usd: Math.round(unitCostUsd * 100) / 100,
          moeda_custo: 'USD',
          qtd_minima_pedido: moq,
        };
        const result = await this.runMonteCarloPython({
          premises,
          scenario_count: OFFICIAL_SCENARIO_COUNT,
          seed: OFFICIAL_SEED,
          price_scan: false,
          data_version: PREMISES_DATA_VERSION,
        });
        const metrics = (result.metrics ?? {}) as Record<string, number>;
        const score = Number(result.financial_score);
        await this.offerRepo.createOfferScore({
          ...base,
          state,
          score: Number.isFinite(score) ? Math.round(score) : null,
          capitalPrimeiroPedido: Number.isFinite(Number(result.capital_primeiro_pedido)) ? Number(result.capital_primeiro_pedido) : null,
          pVplPositivo: Number.isFinite(metrics.p_vpl_positivo) ? metrics.p_vpl_positivo : null,
          vplMediano: Number.isFinite(metrics.vpl_mediano) ? metrics.vpl_mediano : null,
          cvar5: Number.isFinite(metrics.cvar_5) ? metrics.cvar_5 : null,
          premises: (result.premises ?? premises) as Record<string, unknown>,
          premisesHash: typeof result.premises_hash === 'string' ? result.premises_hash : '',
          scenarioCount: OFFICIAL_SCENARIO_COUNT,
        });
        outcome.simulated += 1;
      } catch (error) {
        outcome.failed += 1;
        this.logger.warn(`Oferta ${listing.key} falhou: ${error instanceof Error ? error.message : error}`);
      }
    }
    return outcome;
  }
```

Observação: `fxCnyUsd` já existe dentro do laço de `simulateBatchForRanking` (`const fxCnyUsd = await this.fxCnyUsd();`). Use essa variável. `offerUnitCostUsd(listing, fxCnyUsd)` funciona porque `OfferListing` tem `priceMin`, `priceMax` e `currency`.

- [ ] **Passo 4: rodar e ver passar**

Rode: `npx jest src/modules/products`
Esperado: PASS, incluindo os testes antigos do lote.

---

### Tarefa 6: API `GET /products/:id/offers`

**Arquivos:**
- Modificar: `Move-Intelligence-Back/src/modules/products/products.service.ts` (+ spec)
- Modificar: `Move-Intelligence-Back/src/modules/products/products.controller.ts`

**Interfaces:**
- Consome: `offerRepo` (Tarefa 5), `offerUnitCostUsd`, `offerState`, `normalizedMoq`, `sortOffers` (Tarefa 2), `fxCnyUsd()` (privado já existente).
- Produz: `ProductsService.getOffers(productClusterId: string)`, que devolve o JSON da seção 6 da especificação (snake_case). Estados possíveis em `state`: `com_score`, `sem_preco`, `suspeito`, `aguardando_lote`, `sem_score_card`.

- [ ] **Passo 1: escrever os testes** (novo `describe` em `products.service.spec.ts`)

```ts
describe('ProductsService — getOffers (Subprojeto B)', () => {
  function build(latestScore: unknown, listings: unknown[], scores: Map<string, unknown>) {
    const prisma = {
      productCluster: { findUnique: jest.fn().mockResolvedValue({ id: 'card-1' }) },
      productScore: { findFirst: jest.fn().mockResolvedValue(latestScore) },
      exchangeRate: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new ProductsService(prisma as unknown as PrismaService, {} as OpenRouterService);
    jest.spyOn(service as never, 'offerRepo', 'get').mockReturnValue({
      listOfferListings: jest.fn().mockResolvedValue(listings),
      latestOfferScores: jest.fn().mockResolvedValue(scores),
    } as never);
    jest.spyOn(service as never, 'fxCnyUsd').mockResolvedValue(0.14 as never);
    return service;
  }
  const listing = (id: string, over: Record<string, unknown> = {}) => ({
    key: `alibaba:${id}`, marketplace: 'alibaba', externalProductId: id, itemStatus: 'confirmed',
    title: `t${id}`, sellerName: `S${id}`, url: null, priceMin: 90, priceMax: 100, currency: 'USD',
    moq: 10, rating: 4.5, salesSignal: 10, collectedAt: new Date('2026-09-10'), ...over,
  });

  it('ordena por score, aponta a melhor oferta e marca aguardando_lote', async () => {
    const service = build(
      { score: 74, dataConfidence: 'suficiente', premises: { custo_usd: 110 } },
      [listing('A'), listing('B'), listing('C')],
      new Map([
        ['alibaba:A', { key: 'alibaba:A', score: 60, state: 'com_score', unitCostUsd: 100, moq: 10, capitalPrimeiroPedido: 1000, pVplPositivo: 0.6, computedAt: new Date() }],
        ['alibaba:B', { key: 'alibaba:B', score: 81, state: 'com_score', unitCostUsd: 100, moq: 10, capitalPrimeiroPedido: 900, pVplPositivo: 0.8, computedAt: new Date() }],
      ]),
    );
    const out = await service.getOffers('card-1');
    expect(out.card).toEqual({ score: 74, unit_cost_usd: 110, data_confidence: 'suficiente' });
    expect(out.best_offer_key).toBe('alibaba:B');
    expect(out.offers.map((o) => o.key)).toEqual(['alibaba:B', 'alibaba:A', 'alibaba:C']);
    expect(out.offers[2]).toMatchObject({ state: 'aguardando_lote', score: null, unit_cost_usd: 100 });
  });

  it('card sem score → ofertas com preço ficam sem_score_card', async () => {
    const service = build({ score: null, dataConfidence: 'historico_curto', premises: {} }, [listing('A'), listing('B', { priceMin: null, priceMax: null })], new Map());
    const out = await service.getOffers('card-1');
    expect(out.best_offer_key).toBeNull();
    expect(out.offers.map((o) => o.state).sort()).toEqual(['sem_preco', 'sem_score_card']);
  });

  it('sem registro e com preço de isca → suspeito calculado na hora', async () => {
    const service = build({ score: 74, dataConfidence: 'suficiente', premises: { custo_usd: 110 } }, [listing('A', { priceMin: 5, priceMax: 5 })], new Map());
    const out = await service.getOffers('card-1');
    expect(out.offers[0].state).toBe('suspeito');
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rode: `npx jest src/modules/products/products.service.spec.ts -t "getOffers"`
Esperado: FAIL com "service.getOffers is not a function".

- [ ] **Passo 3: implementar** (método público em `ProductsService`)

```ts
  /** Subprojeto B: ofertas do card (anúncios de fornecedor contados) com o score mais recente. */
  async getOffers(productClusterId: string) {
    const cluster = await this.prisma.productCluster.findUnique({ where: { id: productClusterId }, select: { id: true } });
    if (!cluster) throw new NotFoundException(`Produto não encontrado: ${productClusterId}`);
    const latest = await this.prisma.productScore.findFirst({
      where: { productClusterId },
      orderBy: { computedAt: 'desc' },
      select: { score: true, dataConfidence: true, premises: true },
    });
    const cardPremises = (latest?.premises ?? {}) as Record<string, unknown>;
    const cardUnitCost = Number(cardPremises.custo_usd);
    const cardUnitCostUsd = Number.isFinite(cardUnitCost) && cardUnitCost > 0 ? cardUnitCost : null;
    const cardHasScore = latest?.score !== null && latest?.score !== undefined;
    const [listings, scores, fx] = await Promise.all([
      this.offerRepo.listOfferListings(productClusterId),
      this.offerRepo.latestOfferScores(productClusterId),
      this.fxCnyUsd(),
    ]);
    const ratio = DEFAULT_BUSINESS_RULES.offers.suspiciousPriceRatio;
    const offers = sortOffers(
      listings.map((listing) => {
        const stored = scores.get(listing.key);
        const liveCost = offerUnitCostUsd(listing, fx);
        let state: string;
        let score: number | null = null;
        if (liveCost === null) state = 'sem_preco';
        else if (!cardHasScore) state = 'sem_score_card';
        else if (stored) { state = stored.state; score = stored.score; }
        else state = offerState({ unitCostUsd: liveCost, cardUnitCostUsd, suspiciousRatio: ratio }) === 'suspeito' ? 'suspeito' : 'aguardando_lote';
        return {
          key: listing.key,
          marketplace: listing.marketplace,
          external_product_id: listing.externalProductId,
          title: listing.title,
          seller_name: listing.sellerName,
          url: listing.url,
          unit_cost_usd: stored?.unitCostUsd ?? liveCost,
          currency: listing.currency,
          moq: normalizedMoq(listing.moq),
          rating: listing.rating,
          sales_signal: listing.salesSignal,
          item_status: listing.itemStatus,
          state,
          score,
          p_vpl_positivo: state === 'com_score' ? stored?.pVplPositivo ?? null : null,
          capital_primeiro_pedido: state === 'com_score' ? stored?.capitalPrimeiroPedido ?? null : null,
          computed_at: stored?.computedAt ?? null,
          // campos camel usados só pela ordenação
          unitCostUsd: stored?.unitCostUsd ?? liveCost,
        };
      }),
    ).map(({ unitCostUsd: _ignored, ...rest }) => rest);
    const best = offers.find((o) => o.state === 'com_score' && o.score !== null) ?? null;
    return {
      card: { score: latest?.score ?? null, unit_cost_usd: cardUnitCostUsd, data_confidence: latest?.dataConfidence ?? null },
      best_offer_key: best?.key ?? null,
      offers,
    };
  }
```

(`NotFoundException` já é importado no arquivo; confira.)

No controller, junto das outras rotas `:id/...`:

```ts
  @Get(':id/offers')
  getOffers(@Param('id') id: string) {
    return this.products.getOffers(id);
  }
```

- [ ] **Passo 4: rodar e ver passar**

Rode: `npx jest src/modules/products && npx tsc --noEmit -p tsconfig.json`
Esperado: PASS.

---

### Tarefa 7: Simulação e premissas padrão com `offer_key`

**Arquivos:**
- Modificar: `Move-Intelligence-Back/src/modules/products/dto/run-monte-carlo.dto.ts`
- Modificar: `Move-Intelligence-Back/src/modules/products/products.service.ts` (+ spec)
- Modificar: `Move-Intelligence-Back/src/modules/products/products.controller.ts`

**Interfaces:**
- Consome: `parseOfferKey`, `offerUnitCostUsd`, `normalizedMoq` (Tarefa 2), `offerRepo` (Tarefa 5).
- Produz:
  - `MonteCarloPremisesDto.qtd_minima_pedido?: number`; `RunMonteCarloDto.offer_key?: string`
  - `getMonteCarloDefaults(productClusterId: string, offerKey?: string)`: a resposta ganha `offer_key` (string ou null)
  - fonte de premissa nova `'offer'`
  - `runMonteCarloSimulation` com `offer_key` é sempre um cenário "e se" (não grava score oficial)

- [ ] **Passo 1: escrever os testes** (no `describe('ProductsService — runMonteCarloSimulation (S7)')`, reaproveitando a construção do serviço que o describe já usa)

```ts
  it('B: offer_key troca custo e MOQ e NÃO grava score oficial', async () => {
    const { service, prisma, runPython } = buildService(); // use a fábrica que este describe já tem
    jest.spyOn(service as never, 'offerRepo', 'get').mockReturnValue({
      listOfferListings: jest.fn().mockResolvedValue([
        { key: 'alibaba:A', marketplace: 'alibaba', externalProductId: 'A', itemStatus: 'confirmed', priceMin: 90, priceMax: 96, currency: 'USD', moq: 50 },
      ]),
    } as never);
    jest.spyOn(service as never, 'fxCnyUsd').mockResolvedValue(0.14 as never);

    const out = await service.runMonteCarloSimulation('cluster-1', { offer_key: 'alibaba:A' });

    expect(runPython).toHaveBeenCalledWith(expect.objectContaining({
      premises: expect.objectContaining({ custo_usd: 96, qtd_minima_pedido: 50 }),
    }));
    expect(out.is_user_scenario).toBe(true);
    expect(prisma.productCluster.update).not.toHaveBeenCalled();
  });

  it('B: offer_key inexistente → 400', async () => {
    const { service } = buildService();
    jest.spyOn(service as never, 'offerRepo', 'get').mockReturnValue({ listOfferListings: jest.fn().mockResolvedValue([]) } as never);
    await expect(service.runMonteCarloSimulation('cluster-1', { offer_key: 'alibaba:X' })).rejects.toThrow('Oferta não encontrada');
  });
```

Se o describe não tiver uma fábrica chamada `buildService`, use a construção que ele já faz no `it` de "não persiste riskLevel/financialScore" (com `defaultMonteCarloPremises` e `runMonteCarloPython` mockados), sem criar uma fábrica nova em código de produção.

- [ ] **Passo 2: rodar e ver falhar**

Rode: `npx jest src/modules/products/products.service.spec.ts -t "offer_key"`
Esperado: FAIL.

- [ ] **Passo 3: implementar**

DTO:

```ts
// em MonteCarloPremisesDto, depois de corr_cambio_lead:
  qtd_minima_pedido?: number;
// em RunMonteCarloDto:
  offer_key?: string;
```

Em `products.service.ts`:
- Acrescente `| 'offer'` ao tipo `PremiseSource`.
- Em `defaultMonteCarloPremises`, no objeto `premises`, depois de `corr_cambio_lead: 0.35,`: `qtd_minima_pedido: 0,`.
- Importe `BadRequestException` de `@nestjs/common`, se ainda não estiver importado, e `parseOfferKey` de `./offers/offer-rules`.
- Novo método privado:

```ts
  /** Subprojeto B: custo (preço no MOQ) e MOQ de uma oferta do card, para premissas "e se". */
  private async applyOfferPremises(
    productClusterId: string,
    offerKeyValue: string,
    premises: MonteCarloPremises,
    sources: Record<keyof MonteCarloPremises, PremiseSource>,
  ): Promise<void> {
    const parsed = parseOfferKey(offerKeyValue);
    const listing = parsed
      ? (await this.offerRepo.listOfferListings(productClusterId)).find((o) => o.key === offerKeyValue)
      : undefined;
    if (!listing) throw new BadRequestException('Oferta não encontrada neste card.');
    const cost = offerUnitCostUsd(listing, await this.fxCnyUsd());
    if (cost === null) throw new BadRequestException('Oferta sem preço: não dá para simular.');
    premises.custo_usd = this.round(cost);
    premises.qtd_minima_pedido = normalizedMoq(listing.moq);
    sources.custo_usd = 'offer';
    sources.qtd_minima_pedido = 'offer';
  }
```

- Em `getMonteCarloDefaults`, mude a assinatura para `(productClusterId: string, offerKey?: string)`, mude a chave do cache para `` `monte-carlo:defaults:${productClusterId}:${offerKey ?? 'card'}` `` e, depois de `defaultMonteCarloPremises`: `if (offerKey) await this.applyOfferPremises(productClusterId, offerKey, premises, sources);`. Na resposta: `offer_key: offerKey ?? null,`.
- Em `runMonteCarloSimulation`:
  - troque a primeira linha por `const hasOverrides = Boolean(dto.offer_key) || Boolean(dto.premises && Object.keys(dto.premises).length > 0);`
  - depois de `defaultMonteCarloPremises`, antes de `applyPremiseOverrides`: `if (dto.offer_key) await this.applyOfferPremises(productClusterId, dto.offer_key, premises, sources);`
  - no retorno, acrescente `offer_key: dto.offer_key ?? null,`.
- `this.round` já arredonda para 2 casas (conferido).

No controller:

```ts
  @Get(':id/monte-carlo/defaults')
  getMonteCarloDefaults(@Param('id') id: string, @Query('offer_key') offerKey?: string) {
    return this.products.getMonteCarloDefaults(id, offerKey || undefined);
  }
```

(Importe `Query` de `@nestjs/common` se ainda não estiver importado. O `POST :id/monte-carlo` já repassa o `dto` inteiro.)

- [ ] **Passo 4: rodar e ver passar**

Rode: `npx jest src/modules/products && npm test && npx tsc --noEmit -p tsconfig.json`
Esperado: tudo PASS.

---

### Tarefa 8: Frontend — contratos, serviço e formatação

**Arquivos:**
- Modificar: `Move-Intelligence-Front/src/app/core/models/contract.models.ts`
- Modificar: `Move-Intelligence-Front/src/app/core/services/trends.service.ts`
- Modificar: `Move-Intelligence-Front/src/app/shared/util/format.ts`
- Criar: `Move-Intelligence-Front/src/app/shared/util/offer-format.ts`
- Criar: `Move-Intelligence-Front/src/app/shared/util/offer-format.spec.ts`

**Interfaces:**
- Consome: `GET /products/:id/offers` e `GET /products/:id/monte-carlo/defaults?offer_key=` (Tarefas 6 e 7). O `ApiClient` já converte snake_case para camelCase.
- Produz:
  - `interface CardOffer { key: string; marketplace: string; externalProductId: string; title: string | null; sellerName: string | null; url: string | null; unitCostUsd: number | null; currency: string | null; moq: number; rating: number | null; salesSignal: number | null; itemStatus: string; state: OfferState; score: number | null; pVplPositivo: number | null; capitalPrimeiroPedido: number | null; computedAt: string | null }`
  - `type OfferState = 'com_score' | 'sem_preco' | 'suspeito' | 'aguardando_lote' | 'sem_score_card'`
  - `interface CardOffers { card: { score: number | null; unitCostUsd: number | null; dataConfidence: string | null }; bestOfferKey: string | null; offers: CardOffer[] }`
  - `TrendsService.offers(id: string): Observable<CardOffers>`
  - `TrendsService.monteCarloDefaults(id: string, offerKey?: string)`
  - `offerStateLabel(state: OfferState): string`, `offerLabel(offer: CardOffer): string`, `offerStoreCount(offers: CardOffer[]): number`

- [ ] **Passo 1: escrever o teste** (`offer-format.spec.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { offerLabel, offerStateLabel, offerStoreCount } from './offer-format';
import { CardOffer } from '../../core/models/contract.models';

const offer = (over: Partial<CardOffer> = {}): CardOffer => ({
  key: 'alibaba:1', marketplace: 'alibaba', externalProductId: '1', title: 'Bike Spinning Magnetic Flywheel 13kg Home Gym Equipment',
  sellerName: 'Loja Y', url: null, unitCostUsd: 96, currency: 'USD', moq: 50, rating: 4.4, salesSignal: 10,
  itemStatus: 'confirmed', state: 'com_score', score: 81, pVplPositivo: 0.78, capitalPrimeiroPedido: 31000, computedAt: null, ...over,
});

describe('offer-format', () => {
  it('rótulos dos estados sem score', () => {
    expect(offerStateLabel('sem_preco')).toBe('sem preço');
    expect(offerStateLabel('suspeito')).toBe('preço suspeito');
    expect(offerStateLabel('aguardando_lote')).toBe('aguardando cálculo');
    expect(offerStateLabel('sem_score_card')).toBe('card sem dados');
    expect(offerStateLabel('com_score')).toBe('');
  });
  it('rótulo da oferta: vendedor + título curto (até 40 caracteres)', () => {
    expect(offerLabel(offer())).toBe('Loja Y · Bike Spinning Magnetic Flywheel 13kg H…');
    expect(offerLabel(offer({ sellerName: null, title: 'Curto' }))).toBe('Curto');
    expect(offerLabel(offer({ sellerName: null, title: null }))).toBe('alibaba:1');
  });
  it('conta lojas distintas por vendedor', () => {
    expect(offerStoreCount([offer(), offer({ key: 'alibaba:2' }), offer({ key: '1688:3', sellerName: 'Loja X' })])).toBe(2);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rode: `cd Move-Intelligence-Front && npx ng test --watch=false`
Esperado: FAIL em `offer-format.spec.ts` ("Failed to resolve import './offer-format'").

- [ ] **Passo 3: implementar**

Em `contract.models.ts`: acrescente `| 'offer'` a `PremiseSource`, `qtdMinimaPedido: number;` a `MonteCarloPremises` (depois de `corrCambioLead`) e os tipos `OfferState`, `CardOffer` e `CardOffers` exatamente como na seção "Interfaces" desta tarefa. Em `MonteCarloDefaults`, acrescente `offerKey: string | null;`.

Em `format.ts`, dentro de `PREMISE_SOURCE_LABEL`, acrescente `offer: 'Oferta selecionada',`.

Em `trends.service.ts`:

```ts
  offers(id: string): Observable<CardOffers> {
    return this.api.get<CardOffers>(`/products/${id}/offers`);
  }

  monteCarloDefaults(id: string, offerKey?: string): Observable<MonteCarloDefaults> {
    return this.api.get<MonteCarloDefaults>(
      `/products/${id}/monte-carlo/defaults`,
      offerKey ? { offer_key: offerKey } : undefined,
    );
  }
```

(Confira a assinatura de `ApiClient.get` em `core/api/`: se o segundo parâmetro de query não aceitar `undefined`, passe `{}`.)

`offer-format.ts`:

```ts
import { CardOffer, OfferState } from '../../core/models/contract.models';

const STATE_LABEL: Record<OfferState, string> = {
  com_score: '',
  sem_preco: 'sem preço',
  suspeito: 'preço suspeito',
  aguardando_lote: 'aguardando cálculo',
  sem_score_card: 'card sem dados',
};

export function offerStateLabel(state: OfferState): string {
  return STATE_LABEL[state] ?? state;
}

export function offerLabel(offer: CardOffer): string {
  const title = offer.title ? (offer.title.length > 40 ? `${offer.title.slice(0, 40).trimEnd()}…` : offer.title) : null;
  if (offer.sellerName && title) return `${offer.sellerName} · ${title}`;
  return title ?? offer.sellerName ?? offer.key;
}

export function offerStoreCount(offers: CardOffer[]): number {
  return new Set(offers.map((o) => o.sellerName ?? o.key)).size;
}
```

- [ ] **Passo 4: rodar e ver passar**

Rode: `npx ng test --watch=false`
Esperado: PASS (se o corte do título do teste não bater por causa de espaço no fim, ajuste só o `trimEnd`, não a regra dos 40 caracteres).

---

### Tarefa 9: Frontend — aba "Ofertas" e seletor na Simulação

**Arquivos:**
- Modificar: `Move-Intelligence-Front/src/app/features/tendencia/tendencia.component.ts`
- Modificar: `Move-Intelligence-Front/src/app/features/tendencia/tendencia.component.html`
- Modificar: `Move-Intelligence-Front/src/app/features/tendencia/tendencia.component.css`

**Interfaces:**
- Consome: `TrendsService.offers`, `TrendsService.monteCarloDefaults(id, offerKey?)`, `offerStateLabel`, `offerLabel`, `offerStoreCount` (Tarefa 8).

- [ ] **Passo 1: componente (`.ts`)**

- Imports: `switchMap` de `rxjs`; `toObservable` já é importado (usado em `historyParams$`); `CardOffer` e `CardOffers` dos modelos; `offerLabel`, `offerStateLabel` e `offerStoreCount` de `../../shared/util/offer-format`.
- Na lista `tabs`, troque `{ id: 'sourcing', label: 'Sourcing' }` por `{ id: 'sourcing', label: 'Ofertas' }`.
- Troque `readonly simulationDefaults = toAsyncState(this.trends.monteCarloDefaults(this.id));` por:

```ts
  readonly selectedOfferKey = signal<string | null>(null);
  readonly simulationDefaults = toAsyncState(
    toObservable(this.selectedOfferKey).pipe(
      switchMap((key) => this.trends.monteCarloDefaults(this.id, key ?? undefined)),
    ),
  );
  readonly offers = toAsyncState(this.trends.offers(this.id), (v: CardOffers) => v.offers.length === 0);
  readonly offerLabel = offerLabel;
  readonly offerStateLabel = offerStateLabel;
  readonly offerStoreCount = offerStoreCount;
  readonly simulatableOffers = computed(() => {
    const state = this.offers();
    return state.status === 'ready' ? state.data.offers.filter((o) => o.state === 'com_score') : [];
  });
```

(Declare `selectedOfferKey` **antes** de `simulationDefaults`: a ordem dos campos importa.)

- Remova `readonly suppliers = toAsyncState(this.trends.suppliers(this.id));` **somente se** `suppliers()` não for mais usado em nenhum lugar do template ou do `.ts` depois do Passo 2 (confira com grep).
- Métodos novos:

```ts
  selectSimulationOffer(key: string | null): void {
    this.selectedOfferKey.set(key);
    this.premiseForm.set({});
    this.simulation.set(null);
    this.aiPremises.set(null);
  }

  simulateOffer(offer: CardOffer): void {
    this.selectSimulationOffer(offer.key);
    this.setTab('simulation');
  }
```

- Em `premiseGroups`, no grupo `'Importação'`, depois de `custoUsd`: `{ key: 'qtdMinimaPedido', label: 'Pedido mínimo (un.)', step: '1' },`.

- [ ] **Passo 2: template (`.html`)**

Substitua todo o conteúdo de `@case ('sourcing') { ... }` por:

```html
      @case ('sourcing') {
        <section class="block offers-block">
          <h2>Ofertas de fornecedores</h2>
          @switch (offers().status) {
            @case ('ready') {
              @if ($any(offers()).data; as data) {
                <div class="offers-summary">
                  <div><span>Score do card</span><strong>{{ data.card.score ?? '—' }}</strong>
                    @if (data.card.unitCostUsd !== null) { <small>custo mediano US$ {{ data.card.unitCostUsd | number: '1.2-2' }}</small> }</div>
                  <div><span>Melhor oferta</span>
                    @if (data.bestOfferKey) {
                      @for (o of data.offers; track o.key) { @if (o.key === data.bestOfferKey) { <strong class="offer-best">{{ o.score }}</strong><small>{{ o.sellerName ?? o.marketplace }}</small> } }
                    } @else { <strong>—</strong> }</div>
                  <div><span>Ofertas</span><strong>{{ data.offers.length }}</strong><small>{{ offerStoreCount(data.offers) }} lojas</small></div>
                </div>
                <div class="table-scroll">
                  <table class="offers-table">
                    <thead><tr><th>Score</th><th>Oferta</th><th>Fonte</th><th>Preço no MOQ</th><th>MOQ</th><th>Capital 1º pedido</th><th>P(VPL&gt;0)</th><th>Nota</th><th></th></tr></thead>
                    <tbody>
                      @for (o of data.offers; track o.key) {
                        <tr>
                          <td>@if (o.score !== null) { <strong>{{ o.score }}</strong> } @else { <span class="muted">{{ offerStateLabel(o.state) }}</span> }</td>
                          <td>{{ offerLabel(o) }}</td>
                          <td>{{ sourceName(o.marketplace) }}</td>
                          <td>@if (o.unitCostUsd !== null) { US$ {{ o.unitCostUsd | number: '1.2-2' }} } @else { — }</td>
                          <td>{{ o.moq | number }}</td>
                          <td>@if (o.capitalPrimeiroPedido !== null) { R$ {{ o.capitalPrimeiroPedido | number: '1.0-0' }} } @else { — }</td>
                          <td>@if (o.pVplPositivo !== null) { {{ o.pVplPositivo * 100 | number: '1.0-0' }}% } @else { — }</td>
                          <td>{{ o.rating ?? '—' }}</td>
                          <td class="offer-actions">
                            @if (o.state === 'com_score') { <button type="button" (click)="simulateOffer(o)">Simular</button> }
                            @if (o.url) { <a [href]="o.url" target="_blank" rel="noopener">abrir</a> }
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            }
            @default {
              <app-state-panel [state]="offers()" emptyMessage="Nenhuma oferta de fornecedor neste card." />
            }
          }
        </section>
      }
```

(`sourceName(...)` já existe no componente; confira. Se o `DecimalPipe`/`number` não estiver nos `imports` do componente, acrescente `DecimalPipe`.)

Na aba Simulação, logo depois do `<div class="simulation-head">…</div>` (antes dos campos de premissas), acrescente:

```html
          @if (simulatableOffers().length > 0) {
            <div class="offer-selector" role="group" aria-label="Simular com">
              <span>Simular com:</span>
              <button type="button" [class.active]="selectedOfferKey() === null" (click)="selectSimulationOffer(null)">Card (custo mediano)</button>
              @for (o of simulatableOffers(); track o.key) {
                <button type="button" [class.active]="selectedOfferKey() === o.key" (click)="selectSimulationOffer(o.key)">
                  {{ o.sellerName ?? o.marketplace }} — US$ {{ o.unitCostUsd | number: '1.2-2' }}, MOQ {{ o.moq | number }}
                </button>
              }
            </div>
          }
```

- [ ] **Passo 3: estilos (`.css`)**

Use as variáveis de cor que o arquivo já usa (confira os nomes no topo do `.css`, por exemplo `--surface`, `--border`, `--accent`). Não crie cores fixas novas.

```css
.offers-summary { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 12px; }
.offers-summary > div { display: flex; flex-direction: column; gap: 2px; }
.offers-summary span, .offers-summary small { color: var(--text-muted); font-size: 12px; }
.table-scroll { overflow-x: auto; }
.offers-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.offers-table th, .offers-table td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; }
.offers-table .muted { color: var(--text-muted); }
.offer-actions { display: flex; gap: 10px; align-items: center; }
.offer-selector { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 12px 0; }
.offer-selector button { border: 1px solid var(--border); border-radius: 999px; padding: 4px 12px; background: transparent; color: inherit; cursor: pointer; }
.offer-selector button.active { border-color: var(--accent); }
```

(Se `--text-muted`, `--border` e `--accent` não existirem, troque pelos nomes equivalentes que o arquivo já usa.)

- [ ] **Passo 4: build e testes**

Rode: `cd Move-Intelligence-Front && npx ng test --watch=false && npx ng build`
Esperado: PASS e build OK.

---

### Tarefa 10: Resimular, conferir e aceitar (local)

**Arquivos:**
- Criar: `Move-Intelligence-Back/scripts/scores-resimulate.ts`
- Modificar: `Move-Intelligence-Back/package.json` (script `scores:resimulate`)

- [ ] **Passo 1: criar o script**

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/shared/database/prisma.service';
import { ProductsService } from '../src/modules/products/products.service';

/**
 * Subprojeto B: força o lote oficial a recalcular todos os cards ativos (B-D7 muda
 * o custo mediano) e imprime a comparação de scores antes/depois.
 * Uso: npm run scores:resimulate            (só mostra quantos cards seriam resimulados)
 *      npm run scores:resimulate -- --apply (resimula)
 */
async function latestScores(prisma: PrismaService): Promise<Map<string, number | null>> {
  const rows = await prisma.productScore.findMany({
    orderBy: { computedAt: 'desc' },
    select: { productClusterId: true, score: true },
  });
  const map = new Map<string, number | null>();
  for (const row of rows) if (!map.has(row.productClusterId)) map.set(row.productClusterId, row.score);
  return map;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const active = await prisma.productCluster.count({ where: { cardStatus: { notIn: ['provisional', 'merged'] } } });
    if (!process.argv.includes('--apply')) {
      console.log(`${active} cards ativos seriam resimulados. Rode com --apply para executar.`);
      return;
    }
    const before = await latestScores(prisma);
    await prisma.productCluster.updateMany({
      where: { cardStatus: { notIn: ['provisional', 'merged'] } },
      data: { simulatedAt: null },
    });
    const products = app.get(ProductsService);
    let total = 0;
    for (let i = 0; i < 40; i += 1) {
      const batch = await products.simulateBatchForRanking(50);
      total += batch.simulated;
      if (batch.candidates === 0) break;
    }
    const after = await latestScores(prisma);
    let changed = 0;
    let deltaSum = 0;
    for (const [id, score] of after) {
      const prev = before.get(id);
      if (prev === undefined || prev === null || score === null || prev === score) continue;
      changed += 1;
      deltaSum += score - prev;
    }
    const offers = await prisma.offerScore.groupBy({ by: ['state'], _count: { _all: true } });
    console.log(`Resimulados: ${total}. Cards com score alterado: ${changed}. Variação média: ${changed ? (deltaSum / changed).toFixed(1) : '0'} pontos.`);
    console.log('offer_scores por estado:', offers.map((o) => `${o.state}=${o._count._all}`).join(', '));
  } finally {
    await app.close();
  }
}

void main();
```

`package.json`, junto dos outros scripts:

```json
    "scores:resimulate": "node --env-file-if-exists=.env -r ts-node/register -r tsconfig-paths/register scripts/scores-resimulate.ts",
```

- [ ] **Passo 2: simulação sem gravar**

Mostre a contagem de `ai_call_logs`. Rode `npm run scores:resimulate` (sem `--apply`) e mostre a saída. **Espere o ok do usuário.**

- [ ] **Passo 3: aplicar (com o ok)**

Rode `npm run scores:resimulate -- --apply` e mostre a saída completa (cards alterados, variação média e `offer_scores` por estado).

- [ ] **Passo 4: conferir os critérios de aceite da especificação**

```bash
docker exec move-postgres psql -U move -d move_intelligence -At -c "select count(distinct product_cluster_id) from offer_scores;"
docker exec move-postgres psql -U move -d move_intelligence -At -c "select state, count(*) from offer_scores group by 1;"
docker exec move-postgres psql -U move -d move_intelligence -At -c "select marketplace, external_product_id, score, moq, round(unit_cost_usd,2), round(capital_primeiro_pedido) from offer_scores where state='com_score' order by moq desc limit 5;"
```

- Mostre um card com duas ofertas de custo parecido e MOQ muito diferente, e confirme que a de MOQ alto tem score menor (critério 2).
- Reconstrua o frontend: `cd /Users/raul/Desktop/Move-All && docker compose up -d --build frontend backend`. Abra a página de um card com ofertas e confirme: a aba "Ofertas", a tabela ordenada, os estados sem score, o "Simular" abrindo a aba Simulação com a oferta selecionada, e que trocar o seletor recarrega o custo e o MOQ.
- Rode tudo: `npm test`, `npx tsc --noEmit -p tsconfig.json`, `python3 -m pytest scripts/tests/test_monte_carlo_vpl.py -q`, `npx ng test --watch=false`, `npx ng build` e `git diff --check`.
- Mostre a contagem de `ai_call_logs`: tem que ser igual à do Passo 2.

## Critérios de aceite (da especificação)

1. Depois do lote, todo card com score tem `offer_scores` para as suas ofertas.
2. Uma oferta com MOQ muito alto tem score menor que outra de custo parecido e MOQ baixo.
3. O score dos cards muda só por B-D7; a quantidade e a variação média aparecem na saída do `scores:resimulate`.
4. A aba "Ofertas" e o seletor da Simulação funcionam no frontend reconstruído.
5. Nenhuma chamada à LLM; nenhum commit ou push.
