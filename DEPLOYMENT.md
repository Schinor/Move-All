# Move-All — deploy Railway + Cloudflare Pages

Estado deste documento: checklist operacional do deploy da branch
`feat/ranking-view-modes`. Nenhum segredo deve ser salvo neste arquivo ou no Git.

## Topologia

| Plataforma | Serviço | Configuração |
|---|---|---|
| Railway | `move-api` | contexto raiz, `Move-Intelligence-Back/Dockerfile`, health `/api/health`, volume `/data` |
| Railway | Postgres | banco gerenciado, volume persistente |
| Railway | Redis | Redis gerenciado, volume persistente |
| Cloudflare Pages | frontend Angular | root `Move-Intelligence-Front`, output `dist/move-front/browser` |

O projeto Railway existente deve permanecer com exatamente três serviços. Não criar
um serviço separado para o ETL ou para o frontend. Os serviços gerenciados existentes
foram criados como `Postgres` e `Redis`; eles cumprem os papéis `move-db` e
`move-redis` descritos no plano.

## Railway — `move-api`

- Repository: `Schinor/Move-All`
- Branch: `feat/ranking-view-modes`
- Root directory: `/`
- Dockerfile path: `Move-Intelligence-Back/Dockerfile`
- Build command: vazio
- Start command: vazio
- Healthcheck: `/api/health`
- Watch paths: `Move-Intelligence-Back/**` e `Move-Intelligence-Dados/**`
- Volume: `/data`, usado por `IMPORTS_STORAGE_DIR=/data/imports`

Variáveis mínimas, configuradas na aba Variables do serviço, são as do arquivo
[`Move-Intelligence-Back/.env.production.example`](/Users/raul/Desktop/Move-All/Move-Intelligence-Back/.env.production.example).
No Railway, prefira referências privadas aos serviços gerenciados:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}?family=0
```

`MOVE_ETL_DATABASE_URL` precisa usar o mesmo banco com o esquema
`postgresql+psycopg2://`. Não definir `PORT`: o Railway injeta essa variável.
`JWT_SECRET` deve ser novo, forte e exclusivo deste ambiente. `NVIDIA_API_KEY`,
`APIFY_TOKEN`, Bright Data e URLs de providers ficam vazios até serem autorizados e
configurados manualmente.

## Bootstrap inicial do Postgres

Confirmar primeiro que o Postgres Railway está vazio. Usar a URL pública apenas da
máquina de administração e nunca registrar a URL em arquivos versionados:

```bash
cd Move-Intelligence-Back
DATABASE_URL="<URL pública>" npx prisma validate
DATABASE_URL="<URL pública>" npx prisma generate
DATABASE_URL="<URL pública>" npx prisma db push
DATABASE_URL="<URL pública>" npx prisma migrate resolve --applied 20260904120000_add_cluster_search_indexes
DATABASE_URL="<URL pública>" npx prisma migrate resolve --applied 20260910150000_add_copilot_conversation_metadata
```

Antes do `db push`, executar no banco:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

É proibido usar `prisma migrate reset` ou `prisma migrate dev` neste banco.

## Cloudflare Pages

- Root directory: `Move-Intelligence-Front`
- Build command: `npm ci && npm run build:cloud`
- Build output directory: `dist/move-front/browser`
- Node: 20 ou 22
- A configuração `cloud` substitui somente `environment.ts` por `environment.prod.ts`.

Depois de obter o domínio final do `move-api`, atualizar
`Move-Intelligence-Front/src/environments/environment.prod.ts`, refazer o build e
publicar o Pages. Depois, substituir `CORS_ORIGINS` pela URL final do Pages.
Testar refresh em `/`, `/login`, `/dashboard` e `/products` antes de criar `_redirects`.

## Trial e saída

```text
Início do trial: <confirmar no painel Railway>
Expira em (30 dias): <AAAA-MM-DD>
Volume deletado em (+30d): <AAAA-MM-DD>
```

Fazer `pg_dump` antes de qualquer data de deleção de volume. Anotar consumo de RAM,
CPU e disco no relatório final. A configuração contém endpoints públicos sem
autenticação herdados do MVP (`health`, dashboard, products, copilot e alerts); isso
é aceitável apenas como deploy de teste e deve ser corrigido antes de produção real.

## Evidência local antes do deploy

- Backend build e 17 suítes / 158 testes: OK.
- Imagem Docker back + ETL: OK.
- Angular `build` e `build:cloud`: OK após `npm ci` com Node 24.15.0 local.
- Stack temporário: health direto e via proxy, 25 tabelas, extensões, login, CORS,
  Bearer, BullMQ e SSE: OK.
- Coleta externa, persistência Railway, volume após redeploy, métricas do Railway e
  validação do Pages: pendentes até o deploy autenticado.
