# Plano de implementação — Subprojeto C: Radar de demanda + ajustes básicos

> **Para o agente executor (Codex):** execute as tarefas **na ordem**. Ao terminar cada uma: marque os checkboxes e registre a saída dos testes e o `git diff --stat`. Se um teste deste plano falhar de um jeito que o plano não previu, **pare e explique**; não altere o teste para passar. A **Tarefa 10, Passo 3 (primeira coleta real na Bright Data)** só roda com o "ok" explícito do usuário.

**Objetivo:** filtro por marketplace e preços com 2 casas nas abas Anúncios/Ofertas, fornecedores reais na página de Sourcing e radar semanal do Google Trends (um termo PT/BR e um EN/US por tipo), mostrado na aba Adoção do card, com as buscas em alta gravadas para o Subprojeto D.

**Arquitetura:** o frontend ganha um utilitário de filtro por marketplace, usado nas duas tabelas. O Nest ganha um script que registra em `suppliers` os vendedores dos anúncios de fornecedor, e uma rota `GET /products/:id/search-trends`. Os termos vivem na taxonomia (`trend_terms`) e são semeados em `keyword_terms`. O Python ganha um parser da resposta real da Bright Data, cálculo de crescimento dentro de cada coleta e um pipeline `run_search_trends`, que grava uma linha por termo/país/coleta em `search_trend_snapshots`.

**Stack:** NestJS 11 + Prisma 6 + Postgres 16 (jest); Python 3 + SQLAlchemy + pytest; Angular standalone + signals (vitest via `ng test`).

**Especificação:** [SPEC_SUBPROJETO_C_RADAR.md](SPEC_SUBPROJETO_C_RADAR.md). Leia antes de começar.

## Pré-requisitos

- [x] `git log --oneline -4` mostra `e28dcc4` (Subprojeto B) no topo da branch `feat/catalogo-card`.
- [x] Existe `Move-Intelligence-Dados/tests/fixtures/google_trends_bike_spinning_br_12m.md` (resposta real da Bright Data, salva na especificação).

## Regras globais

- **Nenhuma chamada à LLM/OpenRouter.** Mostre a contagem de `ai_call_logs` antes e depois da Tarefa 10.
- **Bright Data:** nenhuma chamada real antes da Tarefa 10, Passo 3, que precisa do "ok" do usuário. Nos testes, use o cliente falso e a amostra salva.
- **Sem commit, sem push, sem branch nova.**
- Arquivos não commitados que **não são deste trabalho** e devem ficar intactos: `planos_executados/`, `*.webp` na raiz, `.playwright-cli/`, `docker-compose.yml`, `docker-compose.production.yml`, `ai.md`, `architecture-flow.mermaid`, `docs/`, `ESTRUTURA_BANCO_DADOS_MOCK.md`, os `.md` removidos da raiz e `Move-Intelligence-Back/scripts/catalog-generate-manual-fichas.ts`.
- Banco: só mudanças aditivas, via SQL em `prisma/migrations/<timestamp>_<nome>/migration.sql`, aplicado com `docker exec -i move-postgres psql -U move -d move_intelligence -v ON_ERROR_STOP=1 < arquivo`, seguido de `npx prisma generate`. **Nada de `prisma db push`.** Não toque em `demand_signals`.
- Scripts locais que leem snapshots: rode com `INCLUDE_SYNTHETIC_DATA=true`, porque a plataforma no Docker usa os dados mock. Scripts que chamam o motor Python: `PYTHON_BIN=/usr/local/bin/python3`.
- Python: use o interpretador que tem as dependências do `Move-Intelligence-Dados` (confira com `python3 -c "import sqlalchemy, pytest"`; se falhar, use `/usr/local/bin/python3`). Comando: `cd Move-Intelligence-Dados && <python> -m pytest tests -q`.
- Se reconstruir ou reiniciar containers, **deixe `move-backend` e `move-frontend` rodando** no final.
- Comandos de teste: backend `cd Move-Intelligence-Back && npx jest <caminho>` (no fim, `npm test` + `npx tsc --noEmit -p tsconfig.json`); frontend `cd Move-Intelligence-Front && NODE_OPTIONS=--localstorage-file=/private/tmp/move-front-vitest-localstorage npx ng test --watch=false` e `npx ng build`.

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `Move-Intelligence-Front/src/app/shared/util/marketplace-filter.ts` (+ spec) | Criar | chips e filtragem por marketplace |
| `.../card-listings-table/card-listings-table.component.{ts,html,css,spec.ts}` | Modificar | preço com 2 casas + filtro |
| `Move-Intelligence-Front/src/app/features/tendencia/tendencia.component.{ts,html,css}` | Modificar | filtro na aba Ofertas + botão "Buscas (Google)" |
| `Move-Intelligence-Back/src/modules/catalog/supplier-identity.ts` (+ spec) | Criar | identidade do fornecedor a partir do snapshot |
| `Move-Intelligence-Back/scripts/catalog-sync-suppliers.ts` + `package.json` | Criar/Modificar | upsert em `suppliers` |
| `Move-Intelligence-Back/prisma/seed/catalog-taxonomy.json` | Modificar | `trend_terms` nos 94 tipos |
| `Move-Intelligence-Back/src/modules/catalog/taxonomy.types.ts`, `taxonomy.service.ts` (+ spec) | Modificar | semear `keyword_terms` |
| `Move-Intelligence-Back/prisma/migrations/20260921120000_search_trend_snapshots/migration.sql`, `schema.prisma` | Criar/Modificar | tabela `search_trend_snapshots` |
| `Move-Intelligence-Dados/app/etl/load/database.py` | Modificar | modelo SQLAlchemy da tabela nova |
| `Move-Intelligence-Dados/app/etl/extract/demand_signal/google_trends.py` | Modificar | URL com vírgula, `parse_trends_payload`, crescimento |
| `Move-Intelligence-Dados/app/pipelines/run_search_trends.py` | Criar | pipeline semanal |
| `Move-Intelligence-Dados/app/pipelines/run_live_intelligence.py` | Modificar | âncora opcional |
| `Move-Intelligence-Dados/scripts/collector_scheduler.py` | Modificar | `SEARCH_TRENDS_ENABLED` |
| `Move-Intelligence-Dados/app/connectors/apis/google_trends.py`, `.../apis/__init__.py` | Remover/Modificar | conector de números aleatórios |
| `Move-Intelligence-Dados/tests/test_search_trends.py` | Criar | testes do parser, crescimento e pipeline |
| `Move-Intelligence-Back/src/modules/products/search-trends.ts` (+ spec), `products.service.ts`, `products.controller.ts` | Criar/Modificar | `GET /products/:id/search-trends` |
| `Move-Intelligence-Front/src/app/shared/components/intel/search-trend-chart/*` | Criar | gráfico BR/US |
| `Move-Intelligence-Front/src/app/shared/util/search-trend-format.ts` (+ spec) | Criar | pontos do gráfico e textos |
| `Move-Intelligence-Front/src/app/core/models/contract.models.ts`, `core/services/trends.service.ts` | Modificar | tipos e chamada da rota |

---

### Tarefa 1: Filtro por marketplace e preço com 2 casas (aba Anúncios)

**Arquivos:**
- Criar: `Move-Intelligence-Front/src/app/shared/util/marketplace-filter.ts`
- Criar: `Move-Intelligence-Front/src/app/shared/util/marketplace-filter.spec.ts`
- Modificar: `Move-Intelligence-Front/src/app/shared/components/intel/card-listings-table/card-listings-table.component.ts`, `.html`, `.css`, `.spec.ts`

**Interfaces:**
- Produz (usadas também na Tarefa 2):
  - `interface MarketplaceChip { marketplace: string | null; label: string; count: number }` (`marketplace: null` = "Todos")
  - `marketplaceChips<T>(items: T[], getMarketplace: (item: T) => string, label: (marketplace: string) => string): MarketplaceChip[]`
  - `filterByMarketplace<T>(items: T[], getMarketplace: (item: T) => string, selected: string | null): T[]`

- [x] **Passo 1: escrever o teste do utilitário**

```ts
import { describe, expect, it } from 'vitest';
import { filterByMarketplace, marketplaceChips } from './marketplace-filter';

const rows = [
  { m: 'alibaba', id: 1 }, { m: 'amazon_br', id: 2 }, { m: 'alibaba', id: 3 }, { m: '1688', id: 4 },
];
const label = (m: string) => ({ alibaba: 'Alibaba', amazon_br: 'Amazon BR', '1688': '1688' })[m] ?? m;

describe('marketplace-filter', () => {
  it('monta "Todos" + um chip por marketplace, com contagem, ordenado pelo rótulo', () => {
    expect(marketplaceChips(rows, (r) => r.m, label)).toEqual([
      { marketplace: null, label: 'Todos', count: 4 },
      { marketplace: '1688', label: '1688', count: 1 },
      { marketplace: 'alibaba', label: 'Alibaba', count: 2 },
      { marketplace: 'amazon_br', label: 'Amazon BR', count: 1 },
    ]);
  });
  it('filtra pelo marketplace escolhido e devolve tudo com null', () => {
    expect(filterByMarketplace(rows, (r) => r.m, 'alibaba').map((r) => r.id)).toEqual([1, 3]);
    expect(filterByMarketplace(rows, (r) => r.m, null)).toHaveLength(4);
  });
  it('lista vazia devolve só "Todos (0)"', () => {
    expect(marketplaceChips([], (r: { m: string }) => r.m, label)).toEqual([{ marketplace: null, label: 'Todos', count: 0 }]);
  });
});
```

- [x] **Passo 2: rodar e ver falhar** (`npx ng test --watch=false`: "Failed to resolve import './marketplace-filter'").

- [x] **Passo 3: implementar `marketplace-filter.ts`**

```ts
export interface MarketplaceChip { marketplace: string | null; label: string; count: number }

export function marketplaceChips<T>(
  items: T[],
  getMarketplace: (item: T) => string,
  label: (marketplace: string) => string,
): MarketplaceChip[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const m = getMarketplace(item);
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  const chips = [...counts.entries()]
    .map(([marketplace, count]) => ({ marketplace, label: label(marketplace), count }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  return [{ marketplace: null, label: 'Todos', count: items.length }, ...chips];
}

export function filterByMarketplace<T>(items: T[], getMarketplace: (item: T) => string, selected: string | null): T[] {
  return selected === null ? items : items.filter((item) => getMarketplace(item) === selected);
}
```

- [x] **Passo 4: acrescentar ao `card-listings-table.component.spec.ts`**

```ts
  it('formata preço com 2 casas e filtra por marketplace', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CardListingsTableComponent],
      providers: [{ provide: CatalogService, useValue: { cardListings: () => of([
        { marketplace: 'mercado_livre', externalProductId: 'A', title: 'Remo ML', url: null, price: 3748.493, currency: 'BRL', rating: 4.3, status: 'confirmed', variation: null, brand: null },
        { marketplace: 'alibaba', externalProductId: 'B', title: 'Rower Ali 1', url: null, price: 79.733, currency: 'USD', rating: 4.2, status: 'confirmed', variation: null, brand: null },
        { marketplace: 'alibaba', externalProductId: 'C', title: 'Rower Ali 2', url: null, price: 81, currency: 'USD', rating: null, status: 'auto', variation: null, brand: null },
      ]) } }],
    });
    const fixture = TestBed.createComponent(CardListingsTableComponent);
    fixture.componentRef.setInput('productClusterId', 'c1');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('R$ 3.748,49');
    expect(el.textContent).toContain('USD 79,73');
    const chip = [...el.querySelectorAll<HTMLButtonElement>('.mp-chip')].find((b) => b.textContent?.includes('Alibaba'))!;
    expect(chip.textContent).toContain('(2)');
    chip.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(el.textContent).not.toContain('Remo ML');
  });
```

- [x] **Passo 5: implementar no componente**

`.ts` (acrescente os imports `computed`, `signal`, `CardListing` já importado e o utilitário):

```ts
  readonly selectedMarketplace = signal<string | null>(null);
  readonly rows = computed(() => {
    const state = this.listings();
    return state.status === 'ready' ? (state.data as CardListing[]) : [];
  });
  readonly chips = computed(() => marketplaceChips(this.rows(), (l) => l.marketplace, (m) => sourceLabel(m) || m));
  readonly visibleRows = computed(() => filterByMarketplace(this.rows(), (l) => l.marketplace, this.selectedMarketplace()));

  price(l: CardListing): string {
    if (l.price === null) return '—';
    const value = l.price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${l.currency === 'BRL' ? 'R$' : (l.currency ?? '')} ${value}`.trim();
  }
```

`.html`: logo depois do `<h3>`, dentro do bloco com dados, antes da `<table>`:

```html
    @if (chips().length > 2) {
      <div class="mp-chips" role="group" aria-label="Filtrar por marketplace">
        @for (c of chips(); track c.marketplace ?? 'todos') {
          <button type="button" class="mp-chip" [class.active]="selectedMarketplace() === c.marketplace"
            (click)="selectedMarketplace.set(c.marketplace)">{{ c.label }} ({{ c.count }})</button>
        }
      </div>
    }
```

Troque o `@for (l of $any(rows); ...)` por `@for (l of visibleRows(); track l.marketplace + l.externalProductId)`. Os chips só aparecem quando há 2 marketplaces ou mais (`"Todos"` + 2).

`.css` (use as variáveis de cor que o arquivo já usa; confira os nomes antes):

```css
.mp-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 12px; }
.mp-chip { border: 1px solid var(--border); border-radius: 999px; padding: 4px 12px; background: transparent; color: inherit; cursor: pointer; font-size: 13px; }
.mp-chip.active { border-color: var(--accent); }
```

- [x] **Passo 6: rodar e ver passar** (`npx ng test --watch=false`).

**Registro Tarefa 1:** teste inicial falhou conforme previsto por módulo ausente; após a implementação, `ng test --watch=false` passou (13 arquivos, 50 testes). `git diff --stat` no checkpoint: 16 arquivos já modificados no checkout, 113 inserções e 2.066 remoções; as remoções/alterações preexistentes fora do escopo foram preservadas.

---

### Tarefa 2: Filtro por marketplace na aba Ofertas

**Arquivos:** modificar `Move-Intelligence-Front/src/app/features/tendencia/tendencia.component.{ts,html,css}`.

**Interfaces:** consome `marketplaceChips` e `filterByMarketplace` (Tarefa 1) e `sourceName(...)` (já existe no componente).

- [x] **Passo 1: `.ts`**

```ts
  readonly offerMarketplace = signal<string | null>(null);
  readonly offerChips = computed(() => {
    const state = this.offers();
    return state.status === 'ready'
      ? marketplaceChips(state.data.offers, (o) => o.marketplace, (m) => this.sourceName(m))
      : [];
  });
  readonly visibleOffers = computed(() => {
    const state = this.offers();
    return state.status === 'ready'
      ? filterByMarketplace(state.data.offers, (o) => o.marketplace, this.offerMarketplace())
      : [];
  });
```

(Se `sourceName` não for um método público do componente, use a mesma função de formatação que o template usa para a coluna "Fonte".)

- [x] **Passo 2: `.html`** — na aba `sourcing` (Ofertas), antes da `<div class="table-scroll">`:

```html
                @if (offerChips().length > 2) {
                  <div class="mp-chips" role="group" aria-label="Filtrar ofertas por marketplace">
                    @for (c of offerChips(); track c.marketplace ?? 'todos') {
                      <button type="button" class="mp-chip" [class.active]="offerMarketplace() === c.marketplace"
                        (click)="offerMarketplace.set(c.marketplace)">{{ c.label }} ({{ c.count }})</button>
                    }
                  </div>
                }
```

No `<tbody>` da tabela de ofertas, troque `@for (o of data.offers; track o.key)` por `@for (o of visibleOffers(); track o.key)`. **Não** mude o resumo do topo (score do card, melhor oferta, quantidade de ofertas).

- [x] **Passo 3: `.css`** — copie as regras `.mp-chips`, `.mp-chip` e `.mp-chip.active` da Tarefa 1.

- [x] **Passo 4:** `npx ng test --watch=false && npx ng build`. Esperado: PASS e build OK.

**Registro Tarefa 2:** `ng test --watch=false` passou (13 arquivos, 50 testes). O primeiro `ng build` no sandbox abortou no esbuild com deadlock, inclusive no `HEAD`; repetido em contexto autorizado, passou com bundle gerado. `git diff --stat` no checkpoint: 19 arquivos, 140 inserções e 2.067 remoções, incluindo alterações preexistentes preservadas.

---

### Tarefa 3: Fornecedores na página de Sourcing

**Arquivos:**
- Criar: `Move-Intelligence-Back/src/modules/catalog/supplier-identity.ts` e `supplier-identity.spec.ts`
- Criar: `Move-Intelligence-Back/scripts/catalog-sync-suppliers.ts`
- Modificar: `Move-Intelligence-Back/package.json`

**Interfaces:**
- Consome: `SUPPLIER_MARKETPLACES` (`src/modules/products/offers/offer-rules.ts`), `COUNTED_ITEM_STATUSES` (`catalog.constants.ts`) e `syntheticSnapshotWhere()`.
- Produz: `supplierIdentity(s: { marketplace: string; sellerId: string | null; sellerName: string | null }): { source: string; nativeSupplierId: string; name: string } | null`.

- [x] **Passo 1: teste**

```ts
import { supplierIdentity } from './supplier-identity';

describe('supplierIdentity', () => {
  it('usa seller_id quando existe', () => {
    expect(supplierIdentity({ marketplace: 'alibaba', sellerId: 'S-9', sellerName: 'Xiamen FitSphere Co.' }))
      .toEqual({ source: 'alibaba', nativeSupplierId: 'S-9', name: 'Xiamen FitSphere Co.' });
  });
  it('sem seller_id usa o nome normalizado como id', () => {
    expect(supplierIdentity({ marketplace: '1688', sellerId: null, sellerName: '  Ningbo   Ação Fitness ' }))
      .toEqual({ source: '1688', nativeSupplierId: 'ningbo acao fitness', name: 'Ningbo Ação Fitness' });
  });
  it('varejo não é fornecedor', () => {
    expect(supplierIdentity({ marketplace: 'amazon_br', sellerId: 'X', sellerName: 'Loja' })).toBeNull();
  });
  it('sem vendedor é ignorado', () => {
    expect(supplierIdentity({ marketplace: 'aliexpress', sellerId: null, sellerName: '  ' })).toBeNull();
  });
});
```

- [x] **Passo 2:** `npx jest src/modules/catalog/supplier-identity.spec.ts` → FAIL (módulo não existe).

- [x] **Passo 3: `supplier-identity.ts`**

```ts
import { SUPPLIER_MARKETPLACES } from '../products/offers/offer-rules';

/** Vendedor de anúncio de fornecedor (1688/Alibaba/AliExpress) → registro de `suppliers`. Varejo nunca é fornecedor. */
export function supplierIdentity(s: {
  marketplace: string;
  sellerId: string | null;
  sellerName: string | null;
}): { source: string; nativeSupplierId: string; name: string } | null {
  if (!(SUPPLIER_MARKETPLACES as readonly string[]).includes(s.marketplace)) return null;
  const name = (s.sellerName ?? '').replace(/\s+/g, ' ').trim();
  const id = (s.sellerId ?? '').trim();
  if (!name && !id) return null;
  const nativeSupplierId = id || name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return { source: s.marketplace, nativeSupplierId, name: name || id };
}
```

- [x] **Passo 4: script `catalog-sync-suppliers.ts`**

```ts
import { PrismaClient } from '@prisma/client';
import { syntheticSnapshotWhere } from '../src/shared/synthetic-data/synthetic-data.filter';
import { COUNTED_ITEM_STATUSES } from '../src/modules/catalog/catalog.constants';
import { SUPPLIER_MARKETPLACES } from '../src/modules/products/offers/offer-rules';
import { supplierIdentity } from '../src/modules/catalog/supplier-identity';

/**
 * Subprojeto C: registra em `suppliers` os vendedores dos anúncios de fornecedor
 * que estão em cards (itens confirmed/auto). Idempotente; nunca apaga.
 * Uso: INCLUDE_SYNTHETIC_DATA=true npm run catalog:sync-suppliers
 */
async function main() {
  const prisma = new PrismaClient();
  try {
    const items = await prisma.productClusterItem.findMany({
      where: { marketplace: { in: [...SUPPLIER_MARKETPLACES] }, status: { in: [...COUNTED_ITEM_STATUSES] } },
      select: { marketplace: true, externalProductId: true },
    });
    const seen = new Map<string, { source: string; nativeSupplierId: string; name: string }>();
    for (let i = 0; i < items.length; i += 200) {
      const chunk = items.slice(i, i + 200);
      const snaps = await prisma.productListingSnapshot.findMany({
        where: { ...syntheticSnapshotWhere(), OR: chunk.map((c) => ({ marketplace: c.marketplace, externalProductId: c.externalProductId })) },
        orderBy: { collectedAt: 'desc' },
        select: { marketplace: true, sellerId: true, sellerName: true },
      });
      for (const s of snaps) {
        const identity = supplierIdentity(s);
        if (identity) seen.set(`${identity.source}::${identity.nativeSupplierId}`, identity);
      }
    }
    let upserts = 0;
    for (const identity of seen.values()) {
      await prisma.supplier.upsert({
        where: { source_nativeSupplierId: { source: identity.source, nativeSupplierId: identity.nativeSupplierId } },
        create: identity,
        update: { name: identity.name },
      });
      upserts += 1;
    }
    const total = await prisma.supplier.count();
    console.log(`catalog:sync-suppliers — ${upserts} fornecedores atualizados/criados; total na tabela: ${total}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
```

Confira o nome da chave única composta gerada pelo Prisma para `@@unique([source, nativeSupplierId])` (normalmente `source_nativeSupplierId`). O snapshot não tem país, então `country` fica nulo.

`package.json`: `"catalog:sync-suppliers": "node --env-file-if-exists=.env -r ts-node/register -r tsconfig-paths/register scripts/catalog-sync-suppliers.ts",`

- [x] **Passo 5:** `npx jest src/modules/catalog/supplier-identity.spec.ts && npx tsc --noEmit -p tsconfig.json` → PASS. (O script roda na Tarefa 10.)

**Registro Tarefa 3:** teste inicial falhou conforme previsto por módulo ausente; depois `supplier-identity.spec.ts` passou (4 testes) e `tsc --noEmit` passou. `git diff --stat` no checkpoint: 20 arquivos, 141 inserções e 2.067 remoções, com a sujeira preexistente intacta.

---

### Tarefa 4: Termos do radar na taxonomia e em `keyword_terms`

**Arquivos:**
- Modificar: `Move-Intelligence-Back/prisma/seed/catalog-taxonomy.json` (94 tipos)
- Modificar: `Move-Intelligence-Back/src/modules/catalog/taxonomy.types.ts`
- Modificar: `Move-Intelligence-Back/src/modules/catalog/taxonomy.service.ts` + `taxonomy.service.spec.ts`

**Interfaces:**
- Produz: `TaxonomySeedFile.types[].trend_terms?: { pt: string; en: string }`; `TaxonomyService.seedTrendTerms(file: TaxonomySeedFile): Promise<{ activated: number; deactivated: number }>`, chamado no fim de `seedFromFile`.
- Linhas de `keyword_terms`: `language` `'pt'` ou `'en'`, `category` = chave do tipo.

- [x] **Passo 1: escrever os termos no JSON**

Em **cada um dos 94 tipos**, acrescente `"trend_terms": { "pt": "...", "en": "..." }`. Regra: é **como as pessoas pesquisam** no Google do país (não o nome técnico), com 1 a 3 palavras, minúsculas, sem marca. Em português, mantenha os acentos que as pessoas usam ("halter ajustável"); em inglês, use o termo comum nos EUA. Exemplos obrigatórios:

| tipo | pt | en |
|---|---|---|
| `spin_bike` | bike spinning | spin bike |
| `walking_pad` | walking pad | walking pad |
| `adjustable_dumbbell` | halter ajustável | adjustable dumbbells |
| `treadmill` | esteira ergométrica | treadmill |
| `yoga_mat` | tapete de yoga | yoga mat |
| `pilates_reformer` | reformer pilates | pilates reformer |
| `kettlebell` | kettlebell | kettlebell |
| `resistance_band` | elástico extensor | resistance bands |

Depois, mostre a lista completa (tipo · pt · en) na saída da tarefa.

- [x] **Passo 2: teste** (no `taxonomy.service.spec.ts`, seguindo o mock de Prisma que o arquivo já usa)

```ts
describe('TaxonomyService.seedTrendTerms', () => {
  function build(existing: Array<{ id: string; term: string; language: string; category: string; active: boolean }>) {
    const prisma = {
      keywordTerm: {
        findMany: jest.fn().mockResolvedValue(existing),
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    return { service: new TaxonomyService(prisma as never), prisma };
  }
  const file = { families: [], types: [{ key: 'spin_bike', trend_terms: { pt: 'bike spinning', en: 'spin bike' } }] } as never;

  it('cria/ativa os termos pt e en do tipo', async () => {
    const { service, prisma } = build([]);
    const out = await service.seedTrendTerms(file);
    expect(prisma.keywordTerm.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { term_language_category: { term: 'bike spinning', language: 'pt', category: 'spin_bike' } },
      create: expect.objectContaining({ term: 'bike spinning', language: 'pt', category: 'spin_bike', active: true }),
      update: { active: true },
    }));
    expect(prisma.keywordTerm.upsert).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ activated: 2, deactivated: 0 });
  });

  it('termo trocado desativa o antigo (não apaga)', async () => {
    const { service, prisma } = build([{ id: 'k1', term: 'bicicleta spinning', language: 'pt', category: 'spin_bike', active: true }]);
    const out = await service.seedTrendTerms(file);
    expect(prisma.keywordTerm.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['k1'] } }, data: { active: false } });
    expect(out.deactivated).toBe(1);
  });

  it('tipo sem trend_terms é ignorado', async () => {
    const { service, prisma } = build([]);
    await service.seedTrendTerms({ families: [], types: [{ key: 'x' }] } as never);
    expect(prisma.keywordTerm.upsert).not.toHaveBeenCalled();
  });
});
```

(Confira o nome da chave única de `@@unique([term, language, category])` no Prisma Client gerado; normalmente é `term_language_category`.)

- [x] **Passo 3:** `npx jest src/modules/catalog/taxonomy.service.spec.ts` → FAIL.

- [x] **Passo 4: implementar**

`taxonomy.types.ts`, dentro do item de `types` de `TaxonomySeedFile`: `trend_terms?: { pt: string; en: string };`

`taxonomy.service.ts`:

```ts
  /** Subprojeto C: termos do radar por tipo → keyword_terms (pt = BR, en = US). Nunca apaga. */
  async seedTrendTerms(file: TaxonomySeedFile): Promise<{ activated: number; deactivated: number }> {
    const wanted: Array<{ term: string; language: 'pt' | 'en'; category: string }> = [];
    for (const t of file.types) {
      const terms = (t as { trend_terms?: { pt?: string; en?: string } }).trend_terms;
      if (!terms) continue;
      for (const language of ['pt', 'en'] as const) {
        const term = terms[language]?.trim().toLowerCase();
        if (term) wanted.push({ term, language, category: t.key });
      }
    }
    if (wanted.length === 0) return { activated: 0, deactivated: 0 };
    const categories = [...new Set(wanted.map((w) => w.category))];
    const existing = await this.prisma.keywordTerm.findMany({ where: { category: { in: categories }, active: true } });
    const wantedKeys = new Set(wanted.map((w) => `${w.term}|${w.language}|${w.category}`));
    const stale = existing.filter((e) => !wantedKeys.has(`${e.term}|${e.language}|${e.category}`)).map((e) => e.id);
    if (stale.length > 0) {
      await this.prisma.keywordTerm.updateMany({ where: { id: { in: stale } }, data: { active: false } });
    }
    for (const w of wanted) {
      await this.prisma.keywordTerm.upsert({
        where: { term_language_category: w },
        create: { ...w, active: true, priority: 100 },
        update: { active: true },
      });
    }
    return { activated: wanted.length, deactivated: stale.length };
  }
```

No fim de `seedFromFile`, antes do `return`: `await this.seedTrendTerms(file);`. Se o `seedFromFile` tiver teste que conta chamadas de Prisma e quebrar por causa de `keywordTerm`, acrescente ao mock desse teste `keywordTerm: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn(), updateMany: jest.fn() }`, **sem mudar o que o teste confere**.

- [x] **Passo 5:** `npx jest src/modules/catalog && npx tsc --noEmit -p tsconfig.json` → PASS. Confira também que os 94 tipos têm `trend_terms`:

```bash
cd Move-Intelligence-Back && node -e "const f=require('./prisma/seed/catalog-taxonomy.json');const miss=f.types.filter(t=>!t.trend_terms||!t.trend_terms.pt||!t.trend_terms.en).map(t=>t.key);console.log(f.types.length,'tipos; sem termo:',miss)"
```

Esperado: `94 tipos; sem termo: []`.

**Registro Tarefa 4:** foram adicionados termos PT/EN aos 94 tipos; a checagem retornou `94 tipos; sem termo: []` e a lista completa foi exibida na saída da execução. O teste inicial falhou pela ausência de `seedTrendTerms`; depois `taxonomy.service.spec.ts` passou (13 testes), o módulo `catalog` passou (13 suítes, 108 testes) e `tsc --noEmit` passou. `git diff --stat` no checkpoint: 24 arquivos, 319 inserções e 2.161 remoções, com as alterações preexistentes preservadas.

---

### Tarefa 5: Tabela `search_trend_snapshots`

**Arquivos:**
- Criar: `Move-Intelligence-Back/prisma/migrations/20260921120000_search_trend_snapshots/migration.sql`
- Modificar: `Move-Intelligence-Back/prisma/schema.prisma`
- Modificar: `Move-Intelligence-Dados/app/etl/load/database.py`

- [x] **Passo 1: migration**

```sql
-- Subprojeto C: uma linha por termo/país/coleta do Google Trends (índice relativo à própria coleta).
CREATE TABLE IF NOT EXISTS search_trend_snapshots (
  id uuid PRIMARY KEY,
  type_key text NOT NULL,
  term text NOT NULL,
  geo text NOT NULL,
  timeframe text NOT NULL,
  status text NOT NULL,
  error text,
  points jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_value integer,
  growth_4w double precision,
  growth_12w double precision,
  related_top jsonb NOT NULL DEFAULT '[]'::jsonb,
  related_rising jsonb NOT NULL DEFAULT '[]'::jsonb,
  captured_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS search_trend_snapshots_type_geo_captured_idx
  ON search_trend_snapshots (type_key, geo, captured_at);
```

- [x] **Passo 2: Prisma**

```prisma
/// Subprojeto C: coleta do Google Trends por termo/país. O índice (0–100) é relativo
/// a cada coleta; crescimento é calculado dentro da mesma coleta.
model SearchTrendSnapshot {
  id            String   @id @default(uuid()) @db.Uuid
  typeKey       String   @map("type_key")
  term          String
  geo           String
  timeframe     String
  status        String
  error         String?
  points        Json     @default("[]")
  lastValue     Int?     @map("last_value")
  growth4w      Float?   @map("growth_4w")
  growth12w     Float?   @map("growth_12w")
  relatedTop    Json     @default("[]") @map("related_top")
  relatedRising Json     @default("[]") @map("related_rising")
  capturedAt    DateTime @default(now()) @map("captured_at")

  @@index([typeKey, geo, capturedAt], map: "search_trend_snapshots_type_geo_captured_idx")
  @@map("search_trend_snapshots")
}
```

- [x] **Passo 3: SQLAlchemy** — em `database.py`, logo depois de `DemandSignalModel` (importe `DateTime`, `Integer`, `Float` e `Text` de `sqlalchemy` se ainda não estiverem importados):

```python
class SearchTrendSnapshotModel(ETLBase):
    """Subprojeto C: espelha a tabela Prisma `search_trend_snapshots`."""

    __tablename__ = "search_trend_snapshots"

    id = Column(IDENTIFIER_TYPE, primary_key=True)
    type_key = Column(String, nullable=False)
    term = Column(String, nullable=False)
    geo = Column(String(16), nullable=False)
    timeframe = Column(String(32), nullable=False)
    status = Column(String(16), nullable=False)
    error = Column(Text)
    points = Column(JSON_TYPE, nullable=False, default=list)
    last_value = Column(Integer)
    growth_4w = Column(Float)
    growth_12w = Column(Float)
    related_top = Column(JSON_TYPE, nullable=False, default=list)
    related_rising = Column(JSON_TYPE, nullable=False, default=list)
    captured_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
```

- [x] **Passo 4: aplicar e gerar**

```bash
cd Move-Intelligence-Back && docker exec -i move-postgres psql -U move -d move_intelligence -v ON_ERROR_STOP=1 < prisma/migrations/20260921120000_search_trend_snapshots/migration.sql && npx prisma generate && npx tsc --noEmit -p tsconfig.json
cd ../Move-Intelligence-Dados && <python> -c "from app.etl.load.database import SearchTrendSnapshotModel; print(SearchTrendSnapshotModel.__tablename__)"
```

**Registro Tarefa 5:** a migration retornou `CREATE TABLE` e `CREATE INDEX`; `prisma generate` e `tsc --noEmit` passaram; o modelo SQLAlchemy imprimiu `search_trend_snapshots`. Os Pythons padrão não tinham `pytest`/SQLAlchemy; foi usado o ambiente já existente `/Users/raul/Desktop/Move-Sandbox/Move-Intelligence-Dados/.venv/bin/python`, sem instalar nada e sem misturar o checkout. `git diff --stat` no checkpoint: 26 arquivos, 373 inserções e 2.161 remoções; a migration nova é não rastreada e não aparece no `git diff --stat`.

---

### Tarefa 6: Parser da resposta real, crescimento e URL corrigida (Python)

**Arquivos:**
- Modificar: `Move-Intelligence-Dados/app/etl/extract/demand_signal/google_trends.py`
- Modificar: `Move-Intelligence-Dados/app/pipelines/run_live_intelligence.py` (âncora opcional)
- Remover: `Move-Intelligence-Dados/app/connectors/apis/google_trends.py`; modificar `app/connectors/apis/__init__.py`
- Criar: `Move-Intelligence-Dados/tests/test_search_trends.py`

**Interfaces:**
- Produz:
  - `@dataclass TrendsPayload: points: list[dict]` (`{"week_start": "YYYY-MM-DD", "value": int, "partial": bool}`), `related_top: list[dict]` (`{"query", "value"}`), `related_rising: list[dict]` (`{"query", "value", "label", "breakout"}`)
  - `parse_trends_payload(response: Any) -> TrendsPayload`
  - `trend_growth(points: list[dict]) -> dict` → `{"last_value": int | None, "growth_4w": float | None, "growth_12w": float | None, "status": "ok" | "sem_volume"}`
  - `GoogleTrendsExtractor.fetch_payload(term: str, geo: str, client=None) -> TrendsPayload` (1 termo, sem âncora)

- [x] **Passo 1: testes (`tests/test_search_trends.py`)**

```python
from datetime import date
from pathlib import Path

import pytest

from app.etl.extract.demand_signal.google_trends import (
    GoogleTrendsExtractor,
    parse_trends_payload,
    trend_growth,
)

FIXTURE = Path(__file__).parent / "fixtures" / "google_trends_bike_spinning_br_12m.md"


def test_build_url_varios_termos_no_mesmo_q_com_virgula():
    url = GoogleTrendsExtractor().build_url(["bike spinning", "academia"], "BR")
    assert url.count("q=") == 1
    assert "q=bike%20spinning%2Cacademia" in url
    assert "brd_trends=timeseries%2Crelated_queries" in url
    assert "brd_json=1" in url and "geo=br" in url


def test_parse_resposta_real_com_escape_de_markdown():
    payload = parse_trends_payload(FIXTURE.read_text(encoding="utf-8"))
    assert len(payload.points) == 53
    assert payload.points[-1]["partial"] is True
    assert payload.points[-1]["week_start"] == "2026-09-13"
    assert payload.points[0] == {"week_start": "2025-09-14", "value": 74, "partial": False}
    assert len(payload.related_top) == 8
    assert payload.related_top[0] == {"query": "bicicleta spinning", "value": 100}
    assert [r["query"] for r in payload.related_rising][1:] == ["bike spinning magnetica", "comprar bike spinning"]
    assert payload.related_rising[1] == {"query": "bike spinning magnetica", "value": 60, "label": "+60%", "breakout": False}


def test_parse_marca_breakout():
    text = '{"widgets":[{"id":"TIMESERIES","data":{"default":{"timelineData":[{"time":"1789257600","value":[5]}]}}},' \
           '{"id":"RELATED_QUERIES","data":{"default":{"rankedList":[{"rankedKeyword":[]},' \
           '{"rankedKeyword":[{"query":"reformer dobravel","value":5000,"formattedValue":"Breakout"}]}]}}}]}'
    payload = parse_trends_payload(text)
    assert payload.related_rising == [{"query": "reformer dobravel", "value": 5000, "label": "Breakout", "breakout": True}]


def test_parse_sem_timeseries_da_erro_claro():
    with pytest.raises(ValueError, match="TIMESERIES"):
        parse_trends_payload('{"widgets":[]}')


def _weeks(values, partial_last=False):
    pts = [{"week_start": f"2026-01-{i + 1:02d}", "value": v, "partial": False} for i, v in enumerate(values)]
    if partial_last:
        pts[-1]["partial"] = True
    return pts


def test_growth_4_e_12_semanas_ignorando_parcial():
    values = [10] * 12 + [20] * 8 + [40] * 4 + [999]
    out = trend_growth(_weeks(values, partial_last=True))
    assert out["status"] == "ok"
    assert out["last_value"] == 40
    assert out["growth_4w"] == pytest.approx(1.0)       # 40 vs 20
    assert out["growth_12w"] == pytest.approx(80 / 30 - 1)  # média(20×8, 40×4) = 26,67 vs 10


def test_growth_denominador_zero_e_sem_volume():
    assert trend_growth(_weeks([0] * 20))["status"] == "sem_volume"
    out = trend_growth(_weeks([0] * 4 + [5] * 4))
    assert out["growth_4w"] is None and out["status"] == "ok"


def test_fetch_payload_um_termo_sem_ancora():
    class Fake:
        def __init__(self):
            self.urls = []

        def google_trends(self, url):
            self.urls.append(url)
            return FIXTURE.read_text(encoding="utf-8")

    fake = Fake()
    payload = GoogleTrendsExtractor(client=fake).fetch_payload("bike spinning", "BR")
    assert len(fake.urls) == 1 and "academia" not in fake.urls[0]
    assert len(payload.points) == 53
```

Observação sobre `growth_12w`: as últimas 12 semanas completas são `[20]*8 + [40]*4` (média 26,67) e as 12 anteriores são `[10]*12` (média 10), então o esperado é `1,6667`.

- [x] **Passo 2:** `<python> -m pytest tests/test_search_trends.py -q` → FAIL (`ImportError: parse_trends_payload`).

- [x] **Passo 3: implementar em `google_trends.py`**

Imports: acrescente `from dataclasses import dataclass, field`.

`build_url` (substitua o corpo):

```python
    def build_url(self, keywords: Sequence[str] | str, geo: str) -> str:
        terms = [keywords] if isinstance(keywords, str) else [term for term in keywords if str(term).strip()]
        if not terms:
            raise ValueError("Google Trends exige ao menos 1 termo")
        # A Bright Data recusa `q` repetido; vários termos vão no MESMO q, separados por vírgula.
        params = [
            ("date", self.timeframe),
            ("q", ",".join(str(term).strip() for term in terms)),
            ("brd_trends", "timeseries,related_queries"),
            ("brd_json", "1"),
        ]
        if geo.upper() != "GLOBAL":
            params.append(("geo", geo.lower()))
        return f"{self.base_url}?{urlencode(params, quote_via=quote, doseq=True)}"
```

Novas funções (antes de `class GoogleTrendsExtractor`):

```python
_MD_ESCAPES = (("\\[", "["), ("\\]", "]"), ("\\_", "_"), ("\\&", "&"), ("\\*", "*"))


def _unescape_markdown(text: str) -> str:
    for escaped, plain in _MD_ESCAPES:
        text = text.replace(escaped, plain)
    return text


@dataclass
class TrendsPayload:
    points: list = field(default_factory=list)
    related_top: list = field(default_factory=list)
    related_rising: list = field(default_factory=list)


def parse_trends_payload(response: Any) -> TrendsPayload:
    """Resposta do Trends via Bright Data (MCP devolve JSON com escape de markdown)."""
    data = response
    if isinstance(response, str):
        try:
            data = json.loads(_unescape_markdown(response.strip()))
        except json.JSONDecodeError as error:
            raise ValueError(f"Resposta do Trends não é JSON: {error}") from error
    widgets = data.get("widgets") if isinstance(data, Mapping) else None
    if not isinstance(widgets, list):
        raise ValueError("Resposta do Trends sem 'widgets' (TIMESERIES ausente)")
    by_id = {str(w.get("id")): w for w in widgets if isinstance(w, Mapping)}
    series = by_id.get("TIMESERIES")
    if series is None:
        raise ValueError("Resposta do Trends sem o widget TIMESERIES")
    points = []
    for row in series.get("data", {}).get("default", {}).get("timelineData", []):
        week = _date_from_value(row.get("time"))
        values = row.get("value")
        value = _as_number(values[0] if isinstance(values, list) and values else values)
        if week is None or value is None:
            continue
        points.append({"week_start": week.isoformat(), "value": int(round(value)), "partial": bool(row.get("isPartial"))})
    payload = TrendsPayload(points=points)
    related = next((w for key, w in by_id.items() if key.startswith("RELATED_QUERIES")), None)
    if related is not None:
        ranked = related.get("data", {}).get("default", {}).get("rankedList", [])
        if len(ranked) > 0:
            payload.related_top = [
                {"query": k.get("query"), "value": k.get("value")} for k in ranked[0].get("rankedKeyword", [])
            ]
        if len(ranked) > 1:
            payload.related_rising = [
                {
                    "query": k.get("query"),
                    "value": k.get("value"),
                    "label": k.get("formattedValue"),
                    "breakout": str(k.get("formattedValue", "")).strip().lower() == "breakout",
                }
                for k in ranked[1].get("rankedKeyword", [])
            ]
    return payload


def _mean(values: Sequence[float]) -> Optional[float]:
    return sum(values) / len(values) if values else None


def trend_growth(points: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Crescimento dentro da MESMA coleta (índice relativo por requisição); ignora a semana parcial."""
    complete = [float(p["value"]) for p in points if not p.get("partial")]
    if not complete or all(v == 0 for v in complete):
        return {"last_value": int(complete[-1]) if complete else None, "growth_4w": None, "growth_12w": None, "status": "sem_volume"}

    def growth(window: int) -> Optional[float]:
        if len(complete) < 2 * window:
            return None
        recent = _mean(complete[-window:])
        previous = _mean(complete[-2 * window:-window])
        if not previous:
            return None
        return recent / previous - 1

    return {"last_value": int(complete[-1]), "growth_4w": growth(4), "growth_12w": growth(12), "status": "ok"}
```

Método novo em `GoogleTrendsExtractor`:

```python
    def fetch_payload(self, term: str, geo: str, client: Optional[BrightDataClient] = None) -> TrendsPayload:
        """Subprojeto C: 1 termo por requisição, sem âncora."""
        active_client = client or self.client or BrightDataClient()
        return parse_trends_payload(active_client.google_trends(self.build_url([term], geo)))
```

Em `__all__`, acrescente `"TrendsPayload"`, `"parse_trends_payload"` e `"trend_growth"`.

- [x] **Passo 4: âncora opcional em `run_live_intelligence.py`** — troque a linha da âncora por:

```python
        # Subprojeto C: âncora opcional (a âncora "academia" zerava termos pequenos).
        demand_anchor = os.getenv("TRENDS_ANCHOR_KEYWORD", "").strip() or None
```

(`extract(..., anchor_keyword=None)` já funciona sem âncora.)

- [x] **Passo 5: remover o conector aleatório** — apague `app/connectors/apis/google_trends.py` e, em `app/connectors/apis/__init__.py`, remova a importação `from .google_trends import GoogleTrendsAPI` e a entrada `"GoogleTrendsAPI"` do `__all__`. Antes, confirme com `grep -rn "GoogleTrendsAPI" app scripts main.py tests` que não há outro uso.

- [x] **Passo 6:** `<python> -m pytest tests -q` → todos passam, incluindo os antigos de `test_intelligence_etl.py`. (O teste antigo que confere `"brd_trends=timeseries" in url` continua passando, porque a URL agora tem `brd_trends=timeseries%2Crelated_queries`. O teste de âncora continua passando, porque a âncora ainda é aceita quando informada.)

**Registro Tarefa 6:** o teste inicial falhou conforme previsto por `ImportError`; depois o teste novo passou (7 testes) e a suíte Python passou (93 testes, 3 ignorados). `git diff --stat` no checkpoint: 30 arquivos, 494 inserções e 2.227 remoções, sem contar arquivos novos não rastreados; o conector aleatório foi removido após confirmar ausência de usos adicionais.

---

### Tarefa 7: Pipeline `run_search_trends` e agendamento

**Arquivos:**
- Criar: `Move-Intelligence-Dados/app/pipelines/run_search_trends.py`
- Modificar: `Move-Intelligence-Dados/scripts/collector_scheduler.py`
- Modificar: `Move-Intelligence-Dados/tests/test_search_trends.py`

**Interfaces:**
- Consome: `GoogleTrendsExtractor.fetch_payload`, `trend_growth` (Tarefa 6), `SearchTrendSnapshotModel` (Tarefa 5), `get_session`.
- Produz: `run(*, terms=None, client=None, session=None, dry_run=False, max_requests=None, database_url=None) -> dict` com `{"planned": int, "requested": int, "ok": int, "sem_volume": int, "erro": int, "skipped_by_budget": int}`; `load_active_terms(session) -> list[tuple[str, str, str]]` (type_key, term, geo).

- [x] **Passo 1: testes (acrescente ao `tests/test_search_trends.py`)**

```python
from app.pipelines import run_search_trends


class _FakeClient:
    def __init__(self, fail_terms=()):
        self.urls = []
        self.fail_terms = set(fail_terms)

    def google_trends(self, url):
        self.urls.append(url)
        if any(t.replace(" ", "%20") in url for t in self.fail_terms):
            raise RuntimeError("bloqueado")
        return FIXTURE.read_text(encoding="utf-8")


class _FakeSession:
    def __init__(self):
        self.added = []
        self.commits = 0

    def add(self, row):
        self.added.append(row)

    def commit(self):
        self.commits += 1

    def rollback(self):
        pass

    def close(self):
        pass


TERMS = [("spin_bike", "bike spinning", "BR"), ("spin_bike", "spin bike", "US"), ("yoga_mat", "yoga mat", "US")]


def test_dry_run_nao_chama_cliente_nem_grava():
    client, session = _FakeClient(), _FakeSession()
    out = run_search_trends.run(terms=TERMS, client=client, session=session, dry_run=True)
    assert out["planned"] == 3 and out["requested"] == 0
    assert client.urls == [] and session.added == []


def test_grava_uma_linha_por_termo_e_segue_apos_erro():
    client, session = _FakeClient(fail_terms=["spin bike"]), _FakeSession()
    out = run_search_trends.run(terms=TERMS, client=client, session=session)
    assert out["requested"] == 3 and out["ok"] == 2 and out["erro"] == 1
    assert len(session.added) == 3
    erro = next(r for r in session.added if r.status == "erro")
    assert erro.term == "spin bike" and "bloqueado" in erro.error
    ok = next(r for r in session.added if r.term == "bike spinning")
    assert ok.type_key == "spin_bike" and ok.geo == "BR" and len(ok.points) == 53 and len(ok.related_rising) == 3


def test_limite_de_requisicoes():
    client, session = _FakeClient(), _FakeSession()
    out = run_search_trends.run(terms=TERMS, client=client, session=session, max_requests=2)
    assert out["requested"] == 2 and out["skipped_by_budget"] == 1 and len(client.urls) == 2
```

- [x] **Passo 2:** `<python> -m pytest tests/test_search_trends.py -q` → FAIL (módulo não existe).

- [x] **Passo 3: implementar `run_search_trends.py`**

```python
"""Subprojeto C: coleta semanal do Google Trends por tipo (1 termo por requisição, sem âncora).

Uso:
  python -m app.pipelines.run_search_trends --dry-run
  python -m app.pipelines.run_search_trends
"""

from __future__ import annotations

import argparse
import logging
import os
import uuid
from typing import Any, Optional, Sequence

from sqlalchemy import text

from app.etl.extract.demand_signal.google_trends import GoogleTrendsExtractor, trend_growth
from app.etl.load.database import SearchTrendSnapshotModel, get_session

LOGGER = logging.getLogger(__name__)
TIMEFRAME = "today 12-m"
GEO_BY_LANGUAGE = {"pt": "BR", "en": "US"}


def load_active_terms(session) -> list[tuple[str, str, str]]:
    rows = session.execute(
        text("SELECT category, term, language FROM keyword_terms WHERE active = true AND category IS NOT NULL ORDER BY category, language")
    ).fetchall()
    return [(row[0], row[1], GEO_BY_LANGUAGE[row[2]]) for row in rows if row[2] in GEO_BY_LANGUAGE]


def run(
    *,
    terms: Optional[Sequence[tuple[str, str, str]]] = None,
    client: Any = None,
    session: Any = None,
    dry_run: bool = False,
    max_requests: Optional[int] = None,
    database_url: Optional[str] = None,
) -> dict[str, int]:
    owns_session = session is None
    db = session or get_session(database_url)
    try:
        jobs = list(terms) if terms is not None else load_active_terms(db)
        budget = max_requests if max_requests is not None else int(os.getenv("TRENDS_MAX_REQUESTS_PER_RUN", "200"))
        summary = {"planned": len(jobs), "requested": 0, "ok": 0, "sem_volume": 0, "erro": 0, "skipped_by_budget": 0}
        if dry_run:
            for type_key, term, geo in jobs:
                LOGGER.info("[dry-run] %s · %s · %s", type_key, geo, term)
            summary["skipped_by_budget"] = max(0, len(jobs) - budget)
            return summary
        extractor = GoogleTrendsExtractor(client=client, timeframe=TIMEFRAME)
        for type_key, term, geo in jobs:
            if summary["requested"] >= budget:
                summary["skipped_by_budget"] += 1
                continue
            summary["requested"] += 1
            row = SearchTrendSnapshotModel(id=str(uuid.uuid4()), type_key=type_key, term=term, geo=geo, timeframe=TIMEFRAME)
            try:
                payload = extractor.fetch_payload(term, geo)
                growth = trend_growth(payload.points)
                row.status = growth["status"]
                row.points = payload.points
                row.last_value = growth["last_value"]
                row.growth_4w = growth["growth_4w"]
                row.growth_12w = growth["growth_12w"]
                row.related_top = payload.related_top
                row.related_rising = payload.related_rising
            except Exception as error:  # noqa: BLE001 — falha de um termo não para a coleta
                row.status = "erro"
                row.error = str(error)[:500]
                row.points, row.related_top, row.related_rising = [], [], []
                LOGGER.warning("Trends falhou para %s/%s: %s", term, geo, error)
            summary[row.status] += 1
            db.add(row)
            db.commit()
        return summary
    finally:
        if owns_session:
            db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Radar de demanda (Google Trends por tipo)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-requests", type=int, default=None)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    print(run(dry_run=args.dry_run, max_requests=args.max_requests))


if __name__ == "__main__":
    main()
```

- [x] **Passo 4: agendador** — em `collector_scheduler.py`, importe `run_search_trends` junto dos outros (`from app.pipelines import run_historical_collection, run_search_trends, run_weekly_intelligence`) e, dentro do laço, **depois** do bloco `try/except` do `run_weekly_intelligence` e antes de `last_run = time.time()`:

```python
                if os.getenv("SEARCH_TRENDS_ENABLED", "false").lower() in ("true", "1", "yes"):
                    try:
                        LOGGER.info("Radar de demanda: %s", run_search_trends.run(database_url=database_url))
                    except Exception as err:
                        LOGGER.error("Falha no radar de demanda: %s", err, exc_info=True)
```

Se `app/pipelines/__init__.py` exportar os pipelines explicitamente, acrescente `run_search_trends`. Documente `SEARCH_TRENDS_ENABLED=false` e `TRENDS_MAX_REQUESTS_PER_RUN=200` no `.env.example` do `Move-Intelligence-Dados`, se existir.

- [x] **Passo 5:** `<python> -m pytest tests -q` → PASS.

**Registro Tarefa 7:** o teste inicial falhou conforme previsto porque o módulo não existia; depois o teste do pipeline passou (10 testes) e a suíte Python passou (96 testes, 3 ignorados). O agendador ficou condicionado a `SEARCH_TRENDS_ENABLED=true`, com teto documentado em `.env.example`. `git diff --stat` no checkpoint: 33 arquivos, 509 inserções e 2.229 remoções, sem contar arquivos novos não rastreados.

---

### Tarefa 8: API `GET /products/:id/search-trends`

**Arquivos:**
- Criar: `Move-Intelligence-Back/src/modules/products/search-trends.ts` e `search-trends.spec.ts`
- Modificar: `Move-Intelligence-Back/src/modules/products/products.service.ts` e `products.controller.ts`

**Interfaces:**
- Produz: `latestSeriesByGeo(rows: SearchTrendRow[]): SearchTrendRow[]` (pura); `ProductsService.getSearchTrends(productClusterId: string)`, que devolve `{ type_key: string | null; series: Array<{ geo; term; captured_at; status; points; growth_4w; growth_12w }> }`.

- [x] **Passo 1: teste da função pura**

```ts
import { latestSeriesByGeo } from './search-trends';

const row = (geo: string, status: string, at: string) => ({
  geo, status, term: 't', capturedAt: new Date(at), points: [], growth4w: null, growth12w: null,
});

describe('latestSeriesByGeo', () => {
  it('pega a coleta mais recente válida de cada país e ignora erro', () => {
    const out = latestSeriesByGeo([
      row('BR', 'erro', '2026-09-20'),
      row('BR', 'ok', '2026-09-13'),
      row('US', 'sem_volume', '2026-09-20'),
      row('BR', 'ok', '2026-09-06'),
    ]);
    expect(out.map((r) => [r.geo, r.status, r.capturedAt.toISOString().slice(0, 10)])).toEqual([
      ['BR', 'ok', '2026-09-13'],
      ['US', 'sem_volume', '2026-09-20'],
    ]);
  });
});
```

- [x] **Passo 2:** `npx jest src/modules/products/search-trends.spec.ts` → FAIL.

- [x] **Passo 3: implementar `search-trends.ts`**

```ts
export interface SearchTrendRow {
  geo: string;
  status: string;
  term: string;
  capturedAt: Date;
  points: unknown;
  growth4w: number | null;
  growth12w: number | null;
}

/** Mais recente por país (BR antes de US), ignorando coletas com erro. */
export function latestSeriesByGeo<T extends SearchTrendRow>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    if (row.status === 'erro') continue;
    const current = best.get(row.geo);
    if (!current || row.capturedAt > current.capturedAt) best.set(row.geo, row);
  }
  return [...best.values()].sort((a, b) => a.geo.localeCompare(b.geo));
}
```

Em `ProductsService`:

```ts
  /** Subprojeto C: curva de buscas (Google Trends) do tipo do card. */
  async getSearchTrends(productClusterId: string) {
    const cluster = await this.prisma.productCluster.findUnique({ where: { id: productClusterId }, select: { typeId: true } });
    if (!cluster) throw new NotFoundException(`Produto não encontrado: ${productClusterId}`);
    if (!cluster.typeId) return { type_key: null, series: [] };
    const type = await this.prisma.catalogType.findUnique({ where: { id: cluster.typeId }, select: { key: true } });
    if (!type) return { type_key: null, series: [] };
    const rows = await this.prisma.searchTrendSnapshot.findMany({
      where: { typeKey: type.key },
      orderBy: { capturedAt: 'desc' },
      take: 20,
    });
    return {
      type_key: type.key,
      series: latestSeriesByGeo(rows).map((r) => ({
        geo: r.geo,
        term: r.term,
        captured_at: r.capturedAt,
        status: r.status,
        points: r.points,
        growth_4w: r.growth4w,
        growth_12w: r.growth12w,
      })),
    };
  }
```

(Importe `latestSeriesByGeo` de `./search-trends`. Confira os nomes `typeId` e `catalogType` no `schema.prisma`, criados no Subprojeto A.)

No controller:

```ts
  @Get(':id/search-trends')
  getSearchTrends(@Param('id') id: string) {
    return this.products.getSearchTrends(id);
  }
```

- [x] **Passo 4: teste do serviço** (novo `describe` em `products.service.spec.ts`)

```ts
describe('ProductsService — getSearchTrends (Subprojeto C)', () => {
  it('card sem tipo devolve series vazia', async () => {
    const prisma = { productCluster: { findUnique: jest.fn().mockResolvedValue({ typeId: null }) } };
    const service = new ProductsService(prisma as unknown as PrismaService, {} as OpenRouterService);
    await expect(service.getSearchTrends('c1')).resolves.toEqual({ type_key: null, series: [] });
  });
  it('devolve a última coleta válida de cada país do tipo', async () => {
    const prisma = {
      productCluster: { findUnique: jest.fn().mockResolvedValue({ typeId: 't1' }) },
      catalogType: { findUnique: jest.fn().mockResolvedValue({ key: 'spin_bike' }) },
      searchTrendSnapshot: { findMany: jest.fn().mockResolvedValue([
        { geo: 'BR', status: 'ok', term: 'bike spinning', capturedAt: new Date('2026-09-20'), points: [{ week_start: '2026-09-13', value: 56, partial: true }], growth4w: 0.1, growth12w: -0.2 },
        { geo: 'US', status: 'erro', term: 'spin bike', capturedAt: new Date('2026-09-20'), points: [], growth4w: null, growth12w: null },
      ]) },
    };
    const service = new ProductsService(prisma as unknown as PrismaService, {} as OpenRouterService);
    const out = await service.getSearchTrends('c1');
    expect(out.type_key).toBe('spin_bike');
    expect(out.series).toHaveLength(1);
    expect(out.series[0]).toMatchObject({ geo: 'BR', term: 'bike spinning', growth_4w: 0.1 });
  });
});
```

- [x] **Passo 5:** `npx jest src/modules/products && npx tsc --noEmit -p tsconfig.json` → PASS.

**Registro Tarefa 8:** o teste inicial falhou conforme previsto porque `search-trends.ts` ainda não existia; depois `search-trends.spec.ts` passou (1 teste), `src/modules/products` passou (7 suítes, 56 testes) e `tsc --noEmit` passou. A API filtra a coleta mais recente válida por país, expõe `GET /products/:id/search-trends` e devolve os campos em snake_case do contrato. `git diff --stat` no checkpoint será registrado após a Tarefa 9 junto da validação da interface.

---

### Tarefa 9: Aba Adoção — botão "Buscas (Google)"

**Arquivos:**
- Criar: `Move-Intelligence-Front/src/app/shared/util/search-trend-format.ts` e `.spec.ts`
- Criar: `Move-Intelligence-Front/src/app/shared/components/intel/search-trend-chart/search-trend-chart.component.{ts,html,css}`
- Modificar: `Move-Intelligence-Front/src/app/core/models/contract.models.ts`, `core/services/trends.service.ts`, `features/tendencia/tendencia.component.{ts,html}`

**Interfaces:**
- Consome: `GET /products/:id/search-trends` (Tarefa 8); o `ApiClient` converte para camelCase.
- Produz:
  - `interface SearchTrendPoint { weekStart: string; value: number; partial: boolean }`
  - `interface SearchTrendSeries { geo: 'BR' | 'US' | string; term: string; capturedAt: string; status: 'ok' | 'sem_volume'; points: SearchTrendPoint[]; growth4w: number | null; growth12w: number | null }`
  - `interface SearchTrends { typeKey: string | null; series: SearchTrendSeries[] }`
  - `TrendsService.searchTrends(id: string): Observable<SearchTrends>`
  - `trendPolyline(points: SearchTrendPoint[], width: number, height: number): string`; `formatGrowth(value: number | null): string`

Atenção: o `ApiClient` converte chaves, mas `points` vem dentro de JSON (`week_start`). Confira se o `toCamel` do `ApiClient` é recursivo em arrays de objetos; se for, os pontos chegam como `weekStart`. Se não for, use `week_start` no tipo e na função. **Não** converta nos dois lugares.

- [x] **Passo 1: teste (`search-trend-format.spec.ts`)**

```ts
import { describe, expect, it } from 'vitest';
import { formatGrowth, trendPolyline } from './search-trend-format';

describe('search-trend-format', () => {
  it('polyline escala 0–100 na altura e distribui na largura', () => {
    const pts = [
      { weekStart: '2026-01-01', value: 0, partial: false },
      { weekStart: '2026-01-08', value: 100, partial: false },
      { weekStart: '2026-01-15', value: 50, partial: true },
    ];
    expect(trendPolyline(pts, 200, 100)).toBe('0,100 100,0 200,50');
  });
  it('um ponto ou nenhum', () => {
    expect(trendPolyline([], 200, 100)).toBe('');
    expect(trendPolyline([{ weekStart: 'x', value: 40, partial: false }], 200, 100)).toBe('0,60');
  });
  it('formatGrowth', () => {
    expect(formatGrowth(0.712)).toBe('+71%');
    expect(formatGrowth(-0.09)).toBe('−9%');
    expect(formatGrowth(0)).toBe('0%');
    expect(formatGrowth(null)).toBe('—');
  });
});
```

- [x] **Passo 2:** `ng test` → FAIL.

- [x] **Passo 3: implementar**

`search-trend-format.ts`:

```ts
import { SearchTrendPoint } from '../../core/models/contract.models';

export function trendPolyline(points: SearchTrendPoint[], width: number, height: number): string {
  if (points.length === 0) return '';
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  return points
    .map((p, i) => `${Math.round(i * step * 100) / 100},${Math.round((height - (p.value / 100) * height) * 100) / 100}`)
    .join(' ');
}

export function formatGrowth(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const pct = Math.round(value * 100);
  if (pct === 0) return '0%';
  return pct > 0 ? `+${pct}%` : `−${Math.abs(pct)}%`;
}
```

Modelos e serviço: acrescente os três tipos de "Interfaces" ao `contract.models.ts` e, em `TrendsService`:

```ts
  searchTrends(id: string): Observable<SearchTrends> {
    return this.api.get<SearchTrends>(`/products/${id}/search-trends`);
  }
```

Componente `search-trend-chart` (standalone, OnPush):

```ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SearchTrendSeries } from '../../../../core/models/contract.models';
import { formatGrowth, trendPolyline } from '../../../util/search-trend-format';

@Component({
  selector: 'app-search-trend-chart',
  standalone: true,
  templateUrl: './search-trend-chart.component.html',
  styleUrl: './search-trend-chart.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchTrendChartComponent {
  readonly series = input<SearchTrendSeries[]>([]);
  readonly width = 640;
  readonly height = 160;
  readonly polyline = trendPolyline;
  readonly growth = formatGrowth;
}
```

`.html`:

```html
@if (series().length === 0) {
  <p class="empty">Ainda não há coleta de buscas para este tipo.</p>
} @else {
  <svg [attr.viewBox]="'0 0 ' + width + ' ' + height" class="trend-svg" role="img" aria-label="Buscas no Google por semana">
    @for (s of series(); track s.geo) {
      @if (s.status === 'ok') {
        <polyline [attr.points]="polyline(s.points, width, height)" [class]="'line line-' + s.geo" fill="none" />
      }
    }
  </svg>
  <ul class="trend-legend">
    @for (s of series(); track s.geo) {
      <li [class]="'legend-' + s.geo">
        <strong>{{ s.geo }}</strong> · "{{ s.term }}"
        @if (s.status === 'sem_volume') { · volume baixo demais no Google }
        @else { · 4 sem.: {{ growth(s.growth4w) }} · 12 sem.: {{ growth(s.growth12w) }} }
      </li>
    }
  </ul>
  <p class="note">Índice relativo do Google (100 = pico do período em cada país); não compare BR com US em valor absoluto.</p>
}
```

`.css` (use as variáveis de cor do projeto; confira os nomes em `src/styles.css` ou equivalente, e escolha duas cores de série já usadas em outros gráficos):

```css
.trend-svg { width: 100%; height: 160px; display: block; }
.line { stroke-width: 2; }
.line-BR { stroke: var(--accent); }
.line-US { stroke: var(--text-muted); }
.trend-legend { list-style: none; padding: 0; margin: 8px 0 0; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.note, .empty { color: var(--text-muted); font-size: 12px; }
```

Página do produto (`tendencia.component.ts`):
- O tipo de `historyMetric` passa a aceitar `'search'`. Se `HistoryMetricType` for compartilhado com o `adoption-curve-chart`, **não** mude esse tipo: crie `readonly adoptionView = signal<'history' | 'search'>('history')`, e o botão novo liga `adoptionView` em vez de mexer em `historyMetric`.
- `readonly searchTrends = toAsyncState(this.trends.searchTrends(this.id));`
- Importe `SearchTrendChartComponent` nos `imports` do componente.

`tendencia.component.html` (aba Adoção): acrescente um quarto botão ao grupo `.metric-selector-tabs`, com o mesmo estilo dos outros e o texto **"Buscas (Google)"**. Quando ele estiver ativo:
- esconda o `<app-window-selector>` e o "Comparar com período anterior";
- no lugar do gráfico, mostre:

```html
@switch (searchTrends().status) {
  @case ('ready') { <app-search-trend-chart [series]="$any(searchTrends()).data.series" /> }
  @default { <app-state-panel [state]="searchTrends()" emptyMessage="Ainda não há coleta de buscas para este tipo." /> }
}
```

Os outros três botões continuam funcionando como hoje.

- [x] **Passo 4:** `npx ng test --watch=false && npx ng build` → PASS.

**Registro Tarefa 9:** o teste inicial falhou conforme previsto porque `search-trend-format.ts` ainda não existia. Depois a suíte frontend passou com 14 arquivos e 53 testes; houve uma falha transitória do teste de `auth.interceptor` na primeira execução, mas o teste focado e a repetição integral passaram sem alterações nele. O build Angular passou com Node 24.15.0 fora do sandbox, gerando `dist/move-front`. `git diff --stat` no checkpoint: 38 arquivos rastreados, 655 inserções e 2.238 remoções, sem contar arquivos novos não rastreados.

---

### Tarefa 10: Rodar localmente e conferir

- [x] **Passo 1: preparar**

```bash
docker exec move-postgres psql -U move -d move_intelligence -At -c "select count(*) from ai_call_logs;"
cd Move-Intelligence-Back && npm run catalog:seed
docker exec move-postgres psql -U move -d move_intelligence -At -c "select language, count(*) from keyword_terms where active group by 1;"
INCLUDE_SYNTHETIC_DATA=true npm run catalog:sync-suppliers
docker exec move-postgres psql -U move -d move_intelligence -At -c "select source, count(*) from suppliers group by 1;"
```

Esperado: `pt|94` e `en|94`; `suppliers` com registros de `1688`, `alibaba` e/ou `aliexpress`.

- [x] **Passo 2: dry-run do radar (sem Bright Data)**

```bash
cd ../Move-Intelligence-Dados && <python> -m app.pipelines.run_search_trends --dry-run
```

Mostre a saída (188 termos planejados) e **a lista completa de termos**. **Pare e peça o "ok" do usuário para a primeira coleta real** (188 requisições da cota grátis da Bright Data).

**Registro Tarefa 10 até o ponto de autorização:** `ai_call_logs` antes: 353. `catalog:seed` passou (27 famílias, 94 tipos ativos); `keyword_terms` ativos: `en|94`, `pt|94`. `catalog:sync-suppliers` passou (51 fornecedores atualizados/criados); `suppliers`: `1688|18`, `alibaba|18`, `aliexpress|15`. O dry-run passou com `planned=188`, `requested=0`, `ok=0`, `sem_volume=0`, `erro=0`, `skipped_by_budget=0`; sem chamadas reais à Bright Data. Na conferência posterior, a contagem estava em 354: a nova linha foi criada às 13:25:44 por `recommendations_executive` com status `SUCCESS`, fora das ações deste plano; nenhuma chamada à LLM foi iniciada por esta execução. O `git diff --stat` no checkpoint mostrou 38 arquivos rastreados, 655 inserções e 2.238 remoções, sem contar arquivos novos não rastreados. A execução fica pausada aqui aguardando o "ok" explícito para a primeira coleta real.

- [x] **Passo 3 (só com o ok): primeira coleta real**

```bash
<python> -m app.pipelines.run_search_trends
docker exec move-postgres psql -U move -d move_intelligence -At -c "select geo, status, count(*) from search_trend_snapshots group by 1,2 order by 1,2;"
docker exec move-postgres psql -U move -d move_intelligence -At -c "select type_key, geo, last_value, round(growth_12w::numeric,2), jsonb_array_length(related_rising) from search_trend_snapshots where status='ok' order by growth_12w desc nulls last limit 10;"
```

Variáveis de ambiente da Bright Data: as que o `BrightDataClient` já usa (confira no `.env` do `Move-Intelligence-Dados`; **não** mostre os valores). Se a maioria dos termos vier com `erro`, pare e mostre 3 mensagens de erro, sem tentar de novo.

**Registro Tarefa 10, Passo 3:** após o `ok`, a primeira coleta real foi iniciada uma única vez. Foram persistidos 20 snapshots antes da interrupção: 12 `ok` e 8 `erro`, configurando maioria de erros. A execução foi interrompida sem retry. Mensagens representativas: `Falha de conexão com o MCP Bright Data`; `MCP Bright Data recusou a inicialização com HTTP 502`; `Falha de conexão com o MCP Bright Data`. Os Passos 4 e 5 não foram executados por determinação do plano.

**Registro do ajuste do radar:** a suíte Python passou com 103 testes e 3 ignorados; o dry-run atualizado encontrou 24 snapshots recentes pulados e 164 termos elegíveis. A coleta real corrigida terminou com `requested=164`, `ok=20`, `sem_volume=0`, `erro=144`, `skipped_recent=24`; como a maioria das tentativas finais falhou, a execução foi encerrada sem retry adicional. A contagem acumulada na tabela ficou `BR/erro=76`, `BR/ok=22`, `US/erro=77`, `US/ok=22`. Os Passos 4 e 5 continuam não executados pela regra de parada.

**Registro do Ajuste 2:** `BrightDataClient` agora descarta a sessão MCP em falhas de transporte, HTTP de sessão e respostas com marcador de sessão; `run_search_trends` usa `BRIGHTDATA_TRENDS_TIMEOUT=180`, espera 5 s entre requisições, retenta erros temporários (incluindo as três falhas de inicialização) e aplica disjuntor de 5 erros consecutivos/10 min, no máximo 3 pausas. Os testes direcionados passaram (38 testes) e a suíte Python final passou (109 testes, 3 ignorados). O dry-run final planejou 188, pulou 44 recentes e deixou 144 elegíveis. Após o `ok`, a coleta terminou com `requested=144`, `ok=129`, `sem_volume=11`, `erro=4`, `skipped_recent=44`, `circuit_breaker_pauses=0`, `stopped_by_circuit_breaker=0`.

- [x] **Passo 4: conferir as telas**

Reconstrua e deixe rodando: `cd /Users/raul/Desktop/Move-All && docker compose up -d --build backend frontend`. Confira:
- aba Anúncios: preços com 2 casas e chips de marketplace filtrando;
- aba Ofertas: chips filtrando a tabela, com o resumo do topo inalterado;
- página de Sourcing listando fornecedores;
- aba Adoção de um card cujo tipo teve coleta `ok`: o botão "Buscas (Google)" mostra as linhas BR/US, os crescimentos e a nota; um card sem coleta mostra a mensagem de vazio.

**Registro Tarefa 10, Passo 4:** `docker compose up -d --build backend frontend` concluiu e os quatro containers ficaram ativos. A conferência visual confirmou preços com duas casas e chips/filtragem em Anúncios e Ofertas, resumo do topo inalterado, fornecedores listados em Sourcing e, no card `rowing_machine`, linhas BR/US, crescimentos e a nota de índice relativo em Buscas (Google). O caminho de série vazia também está coberto pelo componente e pelos testes do serviço; cards legados não catalogados exibem o estado geral de produto não coletado.

- [x] **Passo 5: tudo verde** — `npm test`, `npx tsc --noEmit -p tsconfig.json`, `<python> -m pytest tests -q`, `ng test`, `ng build` e `git diff --check`. Mostre a contagem de `ai_call_logs` (igual à do Passo 1, exceto chamadas de `ai_recommendation_card`/`recommendations_executive` disparadas ao abrir telas, que devem ser listadas à parte).

**Registro Tarefa 10, Passo 5:** backend `npm test` passou com 55 suítes/448 testes; `npx tsc --noEmit -p tsconfig.json` passou; Python passou com 109 testes e 3 ignorados; frontend `ng test --watch=false` passou com 14 arquivos/53 testes; `npx ng build` passou; `git diff --check` não apontou problemas. `ai_call_logs`: 353 no início do Passo 1 e 357 na conferência final; as 4 entradas posteriores são deriva externa/abertura de telas (`recommendations_executive` e `ai_recommendation_card`), não chamadas feitas pelo radar, testes ou coleta Bright Data.

**Contagem final de `search_trend_snapshots`, considerando só a coleta mais recente de cada termo/geo:** `BR`: 81 `ok`, 10 `sem_volume`, 3 `erro`; `US`: 92 `ok`, 1 `sem_volume`, 1 `erro`.

## Critérios de aceite (da especificação)

1. Os preços da aba Anúncios aparecem com 2 casas.
2. O filtro de marketplace funciona nas abas Anúncios e Ofertas.
3. A página de Sourcing lista os fornecedores reais dos anúncios de fornecedor.
4. 94 tipos com termos PT e EN; 188 termos ativos em `keyword_terms`.
5. Depois da primeira coleta aprovada, cada tipo tem uma linha BR e uma US em `search_trend_snapshots` (status `ok` ou `sem_volume`), e a aba Adoção mostra a curva.
6. Nenhuma chamada à LLM; nenhum commit ou push.
