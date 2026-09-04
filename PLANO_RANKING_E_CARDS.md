# Plano — Ranking: coluna duplicada, modo de visualização em cartões e seed de 50+ produtos

**Documento de execução para agente de IA.** Continuação do trabalho de
`REDESIGN_VISUAL_MOVE.md`, que já foi implementado.

- **Escopo:** `Move-Intelligence-Front/` (Angular 21, standalone, CSS puro).
- **Exceção única de backend:** o script de seed em `Move-Intelligence-Back/scripts/`
  (geração de dados de teste). **Nenhuma alteração em API, contrato, serviço ou
  regra de negócio.**
- **Idioma da UI:** pt-BR.

---

## 0. PRIMEIRO PASSO OBRIGATÓRIO — BRANCH

O trabalho anterior está em `feat/redesign-visual-move-brand` (commits `dedb498` e `809b627`).
Parta dela, não da `develop`.

```bash
cd /Users/raul/Desktop/Move-All
git checkout feat/redesign-visual-move-brand
git status                       # deve estar limpo (só REDESIGN_VISUAL_MOVE.md untracked)
git checkout -b feat/ranking-view-modes
```

Regras:

1. Commits pequenos, em português. Sugestão: um para o seed, um para a coluna removida,
   um para o modo de cartões, um para o polimento do cartão.
2. **Não commitar** `InovaSkills - Move iD_compressed.pdf` (arquivo temporário do cliente).
3. **Não fazer merge.** Ao final, deixe a branch pronta para revisão e relate o que mudou.
4. Se algo só puder ser resolvido no backend, **pare e reporte** — não altere a API.

---

## 1. Contexto: o que já existe

| Item | Estado |
|---|---|
| `features/ranking/` | Tabela com 7 colunas + variante `.mobile-cards` que aparece só por breakpoint |
| `shared/components/intel/trend-card/` | **Existe e está órfão** — nenhum template o referencia |
| `shared/ui/segmented/` | Componente pronto (`role="radiogroup"`, navegação por setas) |
| `core/services/layout.service.ts` | Padrão de preferência persistida em `localStorage` |
| `shared/util/format.ts` | `categoryLabel`, `humanizeSlug`, `STAGE_LABEL`, `formatBRL` |
| `shared/util/humanize.pipe.ts` | Pipe `humanize` já usado no ranking |

### Inconsistências conhecidas (o usuário está ciente e o backend não pode mudar agora)

- `trend_score` e `opportunity_score` voltam **idênticos** da API em 100% dos produtos.
- `marginPct`, `leadTimeDays` voltam `null` para todos os produtos.
- O Monte Carlo falha no seed (`No module named 'numpy'`) — o campo de risco fica sem
  simulação. Ver §2.4.

**Regra geral para estas inconsistências: não invente dado e não exiba métrica morta.**
Se um campo é `null` para todas as linhas, ele não deve ocupar espaço na interface.

---

## 2. Seed: popular o banco com pelo menos 50 produtos

### 2.1 Estado atual do seed

`Move-Intelligence-Back/scripts/seed-6months-fitness-dataset.ts` tem um array
`FIXED_FITNESS_CATALOG` com **23 entradas** que resultam em **20 clusters de produto**
(entradas que compartilham o mesmo `clusterKey` são agrupadas).

Distribuição atual por categoria:

| Categoria | Entradas |
|---|---|
| `musculacao_pesos_livres` | 5 |
| `cardio_fitness` | 4 |
| `treino_funcional_crossfit` | 4 |
| `pilates_yoga_mobilidade` | 3 |
| `calistenia_peso_corporal` | 2 |
| `recuperacao_fisioterapia` | 2 |

Não há parâmetro de linha de comando nem variável de ambiente para o volume.

### 2.2 O que fazer

**Estenda `FIXED_FITNESS_CATALOG` até que o seed gere no mínimo 50 clusters distintos.**

- Cada entrada nova precisa de um **`clusterKey` único** — clusterKey repetido agrupa
  produtos e não aumenta a contagem de clusters.
- Distribua entre as **6 categorias existentes**. Não crie categorias novas: elas teriam
  que ser adicionadas a `CATEGORY_LABEL` em `shared/util/format.ts`, e o objetivo aqui é
  volume de dados, não taxonomia nova.
- Varie `growthProfile` entre `explosive`, `rising`, `steady` e `mature` de forma
  equilibrada. **Isto é importante para a revisão visual**: hoje quase todos os produtos
  caem em "Em pico" e os filtros de estágio do ranking (Emergentes / Ascensão / Pico /
  Lançar agora) ficam praticamente vazios. Mire em algo próximo de 25% para cada perfil.
- Varie `basePriceBrl` / `basePriceUsd` em faixas realistas (de acessório de R$ 50 a
  equipamento de R$ 8.000) para que a formatação de moeda seja exercitada em várias ordens
  de grandeza.
- Varie `baseMonthlySales`, `baseReviews` e `baseRating` para que os scores não saiam todos
  no mesmo patamar (hoje ficam entre 66 e 70, o que deixa o ranking visualmente monótono).
- Produtos devem ser plausíveis para o catálogo fitness da Move. Siga o padrão de nomes das
  entradas existentes (`Halteres Ajustáveis Selecionáveis 24kg Par`).
- Mantenha `keywords.BR` e `keywords.US` preenchidas e os `suppliers` com nome/país/cidade
  coerentes — a tela de Sourcing lê esses dados.

### 2.3 Rodar o seed

```bash
# 1. Infra
docker ps                       # move-postgres e move-redis devem estar "healthy"

# 2. Backend precisa estar de pé em outra aba (o seed usa os serviços do Nest)
cd /Users/raul/Desktop/Move-All/Move-Intelligence-Back
npm run start:dev

# 3. Seed
npm run seed:fitness-6m
```

### 2.4 ⚠️ Três armadilhas conhecidas — leia antes de rodar

**a) Limpe o Redis depois do seed. Sempre.**

O backend cacheia respostas por chave de query. Se qualquer tela foi aberta com o banco
vazio, a resposta `[]` fica em cache e **continua sendo servida mesmo depois do seed** —
inclusive só para alguns `limit`, o que dá a falsa impressão de bug no backend.

```bash
docker exec move-redis redis-cli FLUSHALL
```

Sintoma se você esquecer: `/api/trends/products?limit=50` devolve `[]` enquanto
`?limit=20` devolve 20 itens.

**b) Monte Carlo exige `numpy`.**

`scripts/monte-carlo-vpl.py` importa `numpy`, que não está no Python do sistema. Sem ele o
seed loga `Monte Carlo em lote: 0 simulados, N falhas` e segue. Para ter os dados de risco:

```bash
python3 -m pip install numpy       # ou pipx/venv, conforme o ambiente
```

Se preferir não instalar, **siga assim mesmo** — só registre no relatório final que a
coluna de risco foi revisada sem simulação.

**c) Registre o estado do banco antes de semear.**

O usuário pode querer o banco limpo depois. Antes de rodar o seed:

```bash
docker exec move-postgres psql -U move -d move_intelligence -Atc \
  "select relname||'='||n_live_tup from pg_stat_user_tables order by relname;" > /tmp/db_baseline.txt
```

Para restaurar depois (mantendo as tabelas que já tinham linhas):

```bash
KEEP="ai_call_logs|ai_conversations|ai_messages"
TABLES=$(docker exec move-postgres psql -U move -d move_intelligence -Atc \
  "select relname from pg_stat_user_tables where n_live_tup>0 order by relname;" \
  | grep -vE "^($KEEP)$" | paste -sd, -)
docker exec move-postgres psql -U move -d move_intelligence -c \
  "TRUNCATE TABLE $TABLES RESTART IDENTITY CASCADE;"
docker exec move-redis redis-cli FLUSHALL
```

**Não limpe o banco por conta própria ao final** — deixe os dados no lugar para o usuário
poder revisar, e diga no relatório como limpar.

### 2.5 Verificação do seed

```bash
curl -s "http://localhost:3000/api/trends/products?limit=100" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d),'clusters')"
```

Deve imprimir **50 ou mais**. Confira também a variedade:

```bash
curl -s "http://localhost:3000/api/trends/products?limit=100" | python3 -c "
import sys,json,collections
d=json.load(sys.stdin)
print('categorias:', collections.Counter(p['category'] for p in d))
print('estágios  :', collections.Counter(p.get('stage') for p in d))
print('scores    : min', min(p['trend_score']['value'] for p in d), 'max', max(p['trend_score']['value'] for p in d))"
```

Se todos os estágios saírem iguais ou os scores ficarem numa faixa estreita (menos de ~25
pontos de amplitude), volte ao §2.2 e diversifique mais os perfis.

---

## 3. Ranking: remover a coluna "Oportunidade"

`trend_score` e `opportunity_score` mostram o mesmo número em toda linha. Duas colunas com
o mesmo valor sugerem dois sinais independentes que não existem.

### 3.1 Remover da interface

Em `features/ranking/ranking.component.html`:

1. Apagar o `<th>` de "Oportunidade" (o bloco com `sortDirection('opportunity')`).
2. Apagar o `<td class="num opportunity">` correspondente.
3. No bloco `.mobile-cards`, apagar o item `<div><dt>Oportunidade</dt>…</div>` da `<dl>`.

Em `features/ranking/ranking.component.css`: remover a regra `.opportunity` se ficar órfã.

### 3.2 ⚠️ NÃO remover o campo do componente

`opportunityValue()` continua sendo usado pelo filtro de estágio **"Lançar agora"**:

```ts
(stage === 'launch' && this.opportunityValue(product) >= 35 && product.risk !== 'alto')
```

**Mantenha `opportunityValue()` e o `import` do contrato.** Remova apenas:

- `'opportunity'` do type `SortKey`;
- o ramo `if (key === 'opportunity')` dentro de `sortValue()`.

Se o TypeScript acusar `opportunityValue` como não utilizado depois disso, **investigue —
não apague**: significa que o filtro "Lançar agora" foi quebrado.

### 3.3 Ajuste de layout

Com 6 colunas em vez de 7, revise:

- `table { min-width: 850px }` em `ranking.component.css` — provavelmente cabe reduzir para
  ~760px, o que adia o scroll horizontal em telas médias.
- A largura da coluna "Produto" pode crescer e acomodar nomes longos sem truncar.

---

## 4. Modo de visualização: tabela ↔ cartões

O usuário quer poder **alternar** entre a tabela atual e os cartões do design anterior.
Ambos permanecem; quem escolhe é o usuário.

### 4.1 Onde vive o controle

No `app-page-header` do ranking, junto do seletor existente. Use o
**`app-segmented` já pronto** (`shared/ui/segmented/`) — ele já entrega
`role="radiogroup"`, `aria-checked` e navegação por setas.

```
[ Tabela | Cartões ]
```

Opções com ícone + rótulo: `columns` para Tabela, `boxes` (ou `kanban`) para Cartões.
Se o `SegmentedComponent` atual não aceitar ícone, **não o reescreva** — use só rótulos de
texto. Um controle com dois rótulos claros é suficiente.

### 4.2 Persistir a escolha

Crie `core/services/view-mode.service.ts` seguindo **exatamente** o padrão de
`layout.service.ts` (que já faz isso certo):

- signal com o valor inicial lido de `localStorage`;
- chave `move:ranking-view`;
- `try/catch` em toda leitura e escrita (o storage pode estar indisponível);
- valor padrão `'table'` quando não houver preferência salva.

Não use `localStorage` direto no componente.

### 4.3 Relação com o `.mobile-cards` que já existe

**Atenção — este é o ponto onde é fácil errar.**

O ranking já tem um bloco `.mobile-cards` que é exibido **por breakpoint** (abaixo de
768px a tabela some e os cartões simples aparecem). Isso é uma decisão de responsividade,
não uma escolha do usuário.

Resolva assim:

- **Acima de 768px:** o `app-segmented` decide — tabela ou cartões `app-trend-card`.
- **Abaixo de 768px:** a tabela nunca aparece, independente da preferência. Mostre sempre
  os cartões. **Esconda o controle de alternância** (`app-segmented`) nesse breakpoint —
  um controle que não muda nada é pior do que nenhum controle.
- Quando o modo cartões estiver ativo, use o `app-trend-card` também no mobile e
  **remova o bloco `.mobile-cards` duplicado** — dois componentes de cartão para a mesma
  lista é dívida garantida. Se o `app-trend-card` cobrir bem o mobile, apague
  `.mobile-cards` e seu CSS por completo.

### 4.4 Grid dos cartões

```css
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--sp-4);
}
```

Com 50+ produtos a lista fica longa. **Não adicione paginação nem virtualização neste
plano** — é escopo novo. Se a rolagem ficar pesada, registre no relatório.

### 4.5 Estados

Os estados de loading, vazio, erro e "nenhum resultado para o filtro" já existem no
ranking e **valem para os dois modos**. Não duplique: o `@switch` de status fica por fora,
e só o trecho `ready` alterna entre tabela e grid.

O skeleton de loading hoje tem forma de linha de tabela. No modo cartões, o skeleton deve
ter forma de cartão. Reaproveite `app-skeleton`.

---

## 5. Consertar o `app-trend-card` antes de reativá-lo

O componente está órfão em `shared/components/intel/trend-card/`. Ele tem o desenho que o
usuário gostou, mas carrega defeitos visíveis na captura de referência. **Corrija antes de
colocá-lo em produção.**

### 5.1 Métricas mortas

O cartão mostra três métricas: **Crescimento**, **Margem** e **Lead-time**.
`marginPct` e `leadTimeDays` voltam `null` da API para todos os produtos — ou seja, duas
das três caixas exibem `—` em 100% dos cartões.

**Não renderize métrica que está `null`.** Faça o bloco `.stats` montar dinamicamente só as
métricas com valor. Se sobrar apenas "Crescimento", o cartão mostra uma métrica — e fica
honesto. Quando o backend passar a preencher os campos, elas voltam sozinhas.

Depois do seed, confira o que realmente vem preenchido:

```bash
curl -s "http://localhost:3000/api/trends/products?limit=3" | python3 -m json.tool | head -60
```

### 5.2 Slug cru no rótulo

O cartão renderiza `{{ trend().category ?? '—' }}`. Aplique o pipe `humanize`
(já existe em `shared/util/humanize.pipe.ts`), como o ranking faz:

```html
{{ (trend().category | humanize) || 'Categoria não informada' }}
```

Na captura de referência aparece `SPINNING_BIKE`, `RECOVERY_MASSAGE` etc. — nomenclatura
interna não deve chegar à tela.

### 5.3 Nome do produto cortado

Na referência, nomes longos são cortados no meio da palavra, sem reticências
("Rolo de Liberação Miofascial Foam Roller Te"). Resolva com duas linhas e reticências:

```css
.name {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

Adicione `[attr.title]` com o nome completo para quem passa o mouse. Garanta que todos os
cartões da grade tenham a mesma altura mesmo com nomes de 1 ou 2 linhas.

### 5.4 "Pipeline"

O rodapé mostra `Pipeline {{ pipeline() }}`, que vem de `formatBRL(projectedRevenue)`.
Verifique após o seed se `projectedRevenue` é real. Se vier `null`, `formatBRL` devolve
`—` e o rótulo "Pipeline —" não informa nada: **oculte o bloco inteiro nesse caso.**

### 5.5 Badge de risco

O cartão usa `of="de mercado"`, que dentro de uma caixa estreita alonga o badge.
Como o cartão não tem cabeçalho de coluna dizendo "Risco", **mantenha o sufixo** — mas
confirme que o badge não quebra a linha nem estoura a largura do cartão em 280px.

### 5.6 Sparkline

Já foi corrigido (`vector-effect="non-scaling-stroke"` + teto de altura). No cartão,
confira que ele ocupa uma faixa proporcional e não estica. A referência mostra um
sparkline com preenchimento em gradiente; o componente atual desenha só a linha.
**Se for adicionar área preenchida, use `color-mix` sobre `var(--success)`** — nada de hex
solto e nada de gradiente na assinatura da marca (regra do brand book).

### 5.7 Tema claro

O cartão foi desenhado no tema escuro. **Verifique-o no tema claro** — a captura de
referência é de uma versão anterior, quando o tema claro ainda era branco puro. Nenhuma
cor hardcoded: tudo por token.

---

## 6. O que NÃO fazer

- [ ] Não alterar API, contrato (`core/models/contract.models.ts`), serviços ou regra de
      negócio do backend.
- [ ] Não "consertar" o `opportunity_score` duplicado no front inventando um cálculo local.
      A coluna sai da tela; o campo continua alimentando o filtro "Lançar agora".
- [ ] Não remover `opportunityValue()` do `RankingComponent`.
- [ ] Não exibir métrica que é `null` para todos os registros.
- [ ] Não reintroduzir o que o `REDESIGN_VISUAL_MOVE.md` §8 proíbe: gradiente em botão ou
      assinatura, glow, glassmorphism como padrão, texto em gradiente, animação infinita
      decorativa, raio acima de 10px, número inventado.
- [ ] Não adicionar biblioteca nova. `app-segmented`, `app-skeleton` e `app-trend-card` já
      resolvem tudo aqui.
- [ ] Não criar um segundo componente de cartão. Se `app-trend-card` não servir, conserte-o.

---

## 7. Verificação antes de entregar

Rode e **reporte a saída real** — não presuma.

```bash
cd /Users/raul/Desktop/Move-All/Move-Intelligence-Front
npm run build          # deve passar dentro dos budgets
npm test
npm start
```

Checklist no navegador, com o banco já populado:

- [ ] `/api/trends/products?limit=100` devolve **≥ 50** clusters.
- [ ] Os 4 filtros de estágio do ranking retornam resultado (nenhum vazio).
- [ ] Alternar Tabela ↔ Cartões funciona e **a preferência sobrevive ao reload**.
- [ ] A tabela tem 6 colunas; "Oportunidade" não aparece em nenhum lugar.
- [ ] O filtro "Lançar agora" continua filtrando (é ele que usa o opportunity score).
- [ ] Ordenação funciona em todas as colunas restantes, com `aria-sort` correto.
- [ ] Nenhum cartão mostra `—` como métrica; nenhum slug cru (`spinning_bike`) na tela.
- [ ] Nome longo de produto trunca com reticências e os cartões ficam da mesma altura.
- [ ] Os dois modos funcionam em **tema claro e escuro**.
- [ ] Abaixo de 768px: cartões sempre, controle de alternância oculto.
- [ ] Console sem erro e sem warning em todas as rotas.
- [ ] Busca + filtro + modo cartões combinados continuam coerentes.

Confira também as proibições com grep:

```bash
grep -rn "linear-gradient\|backdrop-filter\|infinite\|background-clip: text" src/ | grep -v node_modules
```

---

## 8. Relatório final

Ao terminar, informe ao usuário:

1. Quantos clusters o seed gerou e como está a distribuição por categoria e estágio.
2. Quais métricas do cartão vieram vazias da API e foram ocultadas.
3. Se o Monte Carlo rodou (numpy instalado) ou não.
4. **Como limpar o banco** (comando do §2.4c) — deixe os dados no lugar, mas diga como
   remover.
5. O que não foi possível verificar e por quê.
6. Qualquer inconsistência nova encontrada que exija mudança de backend — **descreva, não
   conserte**.
