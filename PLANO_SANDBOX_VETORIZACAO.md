# Sandbox isolado e teste de vetorização — Move Intelligence

> **Plano de execução v2** · Ambiente paralelo para validar embeddings sobre os dados
> reais de coleta, sem encostar no banco de produção. Sete fases, três delas bloqueantes.

---

## Estado verificado

> Medido em 04/09/2026 · commit `66ad8a6` · branch `feat/ranking-view-modes`

| Status | Item |
|---|---|
| ✅ **Aplicado** | Índices no Postgres: `idx_clusters_canonical_trgm` e `idx_clusters_category` confirmados em `pg_indexes` |
| ✅ **Íntegro** | Seed sem duplicatas: 53 clusters e 8.268 snapshots — exatamente `53 × 6 marketplaces × 26 semanas` |
| ✅ **Protegido** | Dumps em `_backups/`: 1,9 MB do seed e 1,2 MB do legacy, ambos validados com `pg_restore -l` |
| 🔴 **Pendente** | 10 arquivos não commitados, e a migration dos índices ainda ignorada pelo `*.sql` do `.gitignore:60` |

### Os dois bancos

| Container | Volume | Conteúdo |
|---|---|---|
| `move-postgres` (ativo) | `move-all_postgres_data` | 53 clusters · 8.268 snapshots — **seed sintético** |
| `move-postgres-legacy` | `move-intelligence-back_postgres_data` | 905 clusters · 1.091 produtos — **coleta real do Bright Data** |

### Arquivos de backup disponíveis

```
~/Desktop/Move-All/_backups/
  move-postgres_20260904-1007.dump          1.9M   ← seed, 53 clusters
  move-postgres-legacy_20260904-1007.dump   1.2M   ← 905 clusters REAIS
```

---

## Decisões travadas

O modelo de embedding foi definido: **`nemotron-3-embed-1b`, versão BF16**, consumido
via API em `https://integrate.api.nvidia.com/v1/embeddings`.

| Decisão | Valor |
|---|---|
| Modelo | `nemotron-3-embed-1b` (BF16) |
| Dimensão | 1024 — fatiado de 2048, com re-normalização L2 |
| Coluna | `vector(1024)` |
| Índice ANN | Desnecessário nesta escala, mas possível no futuro por causa do corte para 1024 |
| A verificar | `input_type` do endpoint (query vs passage); ID exato do modelo no payload |

**Por quê:** o `nemotron-3-embed-1b` avalia chinês e português no mesmo modelo — dois dos
34 idiomas do card — e marca 72,38 no RTEB contra 61,98 do `llama-nemotron-embed-vl-1b-v2`,
que é multimodal e existe para recuperar PDFs, não títulos de anúncio.

**Infraestrutura:** nenhuma. Mesma `NVIDIA_API_KEY`, mesmo host, mesmo `NvidiaService`
(retry, timeout, log em `ai_call_logs`). Muda só o path do endpoint e o nome do modelo.
Não há GPU, container ou download de pesos — a seção de hardware do card é para
self-hosting do NIM.

---

## FASE 0 — Preservar o trabalho atual

**🔴 BLOQUEANTE · ~10 min**

Todo o trabalho do agente anterior existe apenas na árvore de trabalho. `git worktree`
cria o checkout a partir de um *commit* — sem esta fase, o sandbox nasce sem nenhuma
das correções.

### 0.1 — Corrigir o `.gitignore` primeiro

Se commitar antes disto, a migration dos índices fica para trás. O `.gitignore:60` tem
um `*.sql` genérico (para bloquear dumps) que captura todo `migration.sql` como dano
colateral.

```bash
cd ~/Desktop/Move-All
printf '\n# Migrations do Prisma (exceção ao *.sql acima)\n!Move-Intelligence-Back/prisma/migrations/**/*.sql\n' >> .gitignore
git check-ignore -v Move-Intelligence-Back/prisma/migrations/*/migration.sql
# saída vazia = corrigido
```

### 0.2 — Commit de checkpoint

Tudo junto na branch atual. Separar ranking de correções de banco é desejável, mas o
risco agora é *perder* o trabalho, não organizá-lo.

```bash
git add -A && git status --short
git commit -m "fix(db): índices, seed idempotente, janela de histórico e rollup do ranking"
```

> ⚠️ **Não apague o legacy.** `move-postgres-legacy` guarda 905 clusters e 1.091 produtos
> reais do Bright Data. O seed de 53 você regenera com um script; as coletas reais não —
> os anúncios já mudaram de preço, estoque e review.

---

## FASE 1 — Criar o worktree

**~2 min**

Compartilha o `.git`, não duplica histórico, e deixa `feat/ranking-view-modes` intocada.

```bash
cd ~/Desktop/Move-All
git worktree add ../Move-Sandbox -b exp/vetorizacao
git worktree list
```

---

## FASE 2 — Isolar o ambiente

**🔴 BLOQUEANTE · ~15 min**

Todas as portas já são parametrizadas no `docker-compose.yml` (linhas 12, 28, 44 e 67),
então basta um `.env` próprio — o compose não precisa ser editado.

### 2.1 — Copiar o `.env` (é gitignored, não veio no worktree)

```bash
cd ~/Desktop/Move-Sandbox
cp ../Move-All/.env .env
```

### 2.2 — Deslocar portas e nomear o projeto

Editar o `.env` do sandbox:

```
COMPOSE_PROJECT_NAME=move-sandbox
POSTGRES_PORT=5433
REDIS_PORT=6380
BACKEND_PORT=3001
FRONTEND_PORT=8080
POSTGRES_DB=move_sandbox
```

> ⚠️ **A linha mais importante do plano.** `COMPOSE_PROJECT_NAME` é o que faz o Docker
> criar volumes `move-sandbox_*` em vez de reaproveitar `move-all_*`. Sem ela você acha
> que está isolado e está escrevendo no banco de produção.
>
> Ajuste também o `DATABASE_URL` para a porta 5433 e o database novo. Confira essa linha
> duas vezes: é o único ponto onde um erro de digitação te leva de volta ao banco real.

### 2.3 — Subir e conferir os volumes

```bash
docker compose up -d postgres redis
docker volume ls | grep sandbox     # esperado: move-sandbox_postgres_data
cd Move-Intelligence-Back && npm install
```

Se aparecer `move-all_*`, pare — o `COMPOSE_PROJECT_NAME` não pegou.

---

## FASE 3 — Carregar os dados reais

**~10 min**

Restaure o dump **legacy**, não o seed. Os 53 clusters sintéticos têm títulos limpos e
já alinhados entre marketplaces — não conseguem nem provar nem refutar nada sobre
matching entre idiomas. Os 905 reais conseguem.

```bash
cd ~/Desktop/Move-Sandbox
docker compose exec -T postgres psql -U move -d postgres -c "CREATE DATABASE move_sandbox;"
docker compose exec -T postgres pg_restore -U move -d move_sandbox --no-owner \
  < ../Move-All/_backups/move-postgres-legacy_20260904-1007.dump
```

Confirmar a distribuição de fontes:

```bash
docker compose exec -T postgres psql -U move -d move_sandbox \
  -c "SELECT source, count(*) FROM products GROUP BY source ORDER BY 2 DESC;"
```

**Esperado:** `alibaba 279 · shopee_br 209 · amazon 202 · amazon_br 144 · mercado_livre 137 · taobao 118 · 1688 2`

---

## FASE 4 — Provar que o isolamento funciona

**🔴 BLOQUEANTE · ~5 min**

Antes de confiar no sandbox, faça algo destrutivo-mas-reversível nele e confirme que
produção não se mexeu.

```bash
# no sandbox
docker compose exec -T postgres psql -U move -d move_sandbox \
  -c "DROP INDEX IF EXISTS idx_clusters_category;"

# em produção — idx_clusters_category DEVE continuar na lista
docker exec move-postgres psql -U move -d move_intelligence \
  -c "SELECT indexname FROM pg_indexes WHERE tablename='product_clusters';"
```

Se o índice sumir da produção, você estava no mesmo banco. **Pare tudo e revise a Fase 2.**

---

## FASE 5 — Vetorização

**2–3 dias**

### 5.1 — Baseline antes de mudar qualquer coisa

Sem isto não há como provar ganho depois.

```bash
docker compose exec -T postgres psql -U move -d move_sandbox -c "
SELECT count(*) FILTER (WHERE n > 1) AS agrupados,
       count(*) FILTER (WHERE n = 1) AS solitarios,
       count(*)                      AS total
FROM (SELECT cluster_id, count(*) n FROM product_cluster_items GROUP BY cluster_id) x;"
```

**Referência medida:** `68 agrupados · 837 solitários` → **92% de falha de agrupamento.**

Esse é o número que a vetorização precisa melhorar. A causa é o `calculate_jaccard_similarity`
em `Move-Intelligence-Dados/app/etl/entity_resolution.py:17`, que compara conjuntos de
tokens e por isso não casa português com inglês ou chinês.

### 5.2 — pgvector no container

O compose usa `postgres:16-alpine`, que **não traz pgvector**. Troque a imagem para
`pgvector/pgvector:pg16` — só no sandbox — e adicione a extensão ao `init-extensions.sql`.

```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE product_clusters ADD COLUMN embedding vector(1024);
ALTER TABLE product_clusters ADD COLUMN embedding_model text;
```

### 5.3 — Método `embed()` no `NvidiaService`

Segundo método apontando para `/v1/embeddings` em vez do `/v1/chat/completions` fixo em
`Move-Intelligence-Back/src/modules/ai-gateway/nvidia.service.ts:62`. Reaproveita chave,
retry, timeout e log em `ai_call_logs`. A resposta traz `data[].embedding` em vez de
`choices[].message.content`.

> ⚠️ **Fatiar 2048 → 1024 e re-normalizar.**
>
> O modelo devolve 2048 dimensões. **pgvector indexa no máximo 2.000** — o tipo `vector`
> aceita até 16.000, mas HNSW e IVFFlat param em 2.000. Ficar em 2048 deixa o projeto
> permanentemente sem opção de índice.
>
> O card é explícito: vetores fatiados **precisam ser re-normalizados em L2** antes de
> comparar. Sem isso o cosseno sai errado *em silêncio* — sem erro, sem exceção, só
> resultado ruim que se vai culpar no modelo. Isso mora dentro do `embed()`, não em quem
> chama.
>
> Se o endpoint aceitar um parâmetro `dimensions`, ainda assim prefira fatiar no cliente:
> não há como saber se o servidor renormaliza depois de truncar.

### 5.4 — Backfill dos 905 títulos

Lotes de 64. Cerca de 20 mil tokens no total — menos que uma única conversa do Copilot
consumia antes da janela de histórico.

Grave a versão do modelo em `embedding_model`: se metade do corpus vier de BF16 e metade
de NVFP4, o ruído da mistura contamina a medição. O card avisa que as duas versões
compartilham o mesmo espaço vetorial "generally", mas pede validação antes de trocar.

> ⚠️ **Verificar antes de rodar o backfill.**
>
> Modelos de retrieval costumam ser assimétricos — consulta e documento recebem
> tratamentos diferentes, via prefixo ou `input_type`. Os dois usos deste projeto pedem
> coisas opostas:
>
> - **Busca no Copilot** — assimétrica: consulta como `query`, títulos como `passage`
> - **Entity resolution** — simétrica: os dois lados como `passage`
>
> Embedar o título do Alibaba como `query` e o do Mercado Livre como `passage` piora o
> matching sem motivo aparente.

### 5.5 — As duas medições que decidem tudo

**Teste 1 — busca conceitual.** Rodar `"produtos fitness residencial pequeno"` e verificar
se equipamento leve sobe e equipamento comercial desce.

**Teste 2 — matching entre idiomas.** Re-rodar o agrupamento com cosseno como segundo
sinal, ao lado do Jaccard (híbrido, não substituição), e comparar com o baseline de 5.1:

```
68 agrupados  →  ?
```

> 🚦 **GATE DO PROJETO.** Se esse número não subir de forma relevante *nos dados reais*,
> a vetorização não se paga — e isso foi descoberto em dias, não em semanas. **Nada da
> Fase 6 acontece sem passar por aqui.**

### 5.6 — Brinde

O sandbox é o lugar certo para resolver o `numpy` ausente que travou o Monte Carlo no
seed, sem arriscar o ambiente principal.

---

## FASE 6 — Levar de volta

**~30 min**

Só o que passar no gate 5.5 volta.

```bash
cd ~/Desktop/Move-All
git merge exp/vetorizacao

# desmontar o sandbox
git worktree remove ../Move-Sandbox
docker volume rm move-sandbox_postgres_data move-sandbox_redis_data
```

Com o `.gitignore` corrigido na Fase 0, as migrations viajam junto — que era o buraco
original.

---

## Resumo

| Fase | O quê | Tempo | Bloqueia |
|---|---|---|---|
| 0 | Corrigir gitignore e commitar | 10 min | **Sim** — sem isso o sandbox nasce sem as correções |
| 1 | Criar worktree | 2 min | — |
| 2 | `.env` isolado, portas, `COMPOSE_PROJECT_NAME` | 15 min | **Sim** |
| 3 | Restaurar dump legacy (905 reais) | 10 min | — |
| 4 | Provar o isolamento | 5 min | **Sim** — não confie antes |
| 5 | Vetorização e medição | 2–3 dias | — |
| 6 | Merge do que passar no gate | 30 min | — |

## Riscos que o plano neutraliza

- Perder as 10 alterações não commitadas do agente anterior — **Fase 0.2**
- A migration dos índices sumir de novo no merge — **Fase 0.1**
- Achar que está isolado sem estar — **Fases 2.2 e 4**
- Testar vetorização em dados sintéticos que não provam nada — **Fase 3**
- Cosseno errado em silêncio por falta de re-normalização — **Fase 5.3**
- Ficar sem opção de índice por manter 2048 dimensões — **Fase 5.2**
- Construir a busca inteira antes de saber se o embedding ajuda — **gate 5.5**

---

## Fora de escopo, de propósito

- Prompt cache na NVIDIA (o endpoint cloud rejeita `prompt_cache_key`)
- Monte Carlo no seed (falha por `numpy` ausente — tratado como brinde em 5.6)
- Índice HNSW — desnecessário abaixo de ~100k vetores
- Rate limit da API NVIDIA: o tier de avaliação atende o backfill de ~1.000 títulos com
  folga, mas vale verificar o limite antes de embedar coleta contínua em produção

## Pendência aberta (decisão do Raul)

Os 905 clusters do `move-postgres-legacy` migram para o banco ativo ou ficam arquivados?
Enquanto os dois containers coexistirem, há risco de rodar migration no container errado.
