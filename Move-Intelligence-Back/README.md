# Move Intelligence Back

Backend NestJS para coleta, normalizacao e calculo de sinais do Move Intelligence.

## Objetivo

Esta base implementa a arquitetura inicial descrita no documento tecnico:

- conectores isolados por fonte externa;
- ingestao com persistencia de resposta bruta;
- normalizacao para modelo canonico;
- resolução de identidade por identificadores, trigramas e regras de veto;
- snapshots historicos;
- motores de tendencia, margem e oportunidade;
- alertas;
- API interna para o frontend.

Os valores marcados no documento como regra de negocio ficam centralizados em configuracao (`BusinessRulesService`) e podem evoluir para edicao via banco sem mudar codigo.

## Stack

- NestJS + TypeScript
- PostgreSQL + Prisma
- Redis/BullMQ preparado para filas
- Docker Compose para ambiente local

## Primeiros comandos

```bash
npm install
cp .env.example .env
docker compose up -d postgres redis
npm run prisma:generate
npx prisma migrate deploy
npm run start:dev
```

## Endpoints iniciais

```text
GET  /api/trends/products
GET  /api/trends/products/:id
GET  /api/products/:id/snapshots
GET  /api/products/:id/suppliers
GET  /api/products/:id/price-history
GET  /api/products/:id/review-history
GET  /api/products/:id/opportunity-score
GET  /api/alerts
GET  /api/sources/status
POST /api/collections/run
POST /api/collections/intelligence
GET  /api/collections/jobs
GET  /api/collections/jobs/:id
POST /api/keywords
POST /api/products/watchlist
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh
GET  /api/auth/me
GET  /api/search?q=produto
POST /api/copilot/chat
GET  /api/health
```

## Coleta Bright Data + ETL v2

`POST /api/collections/intelligence` cria um job assíncrono. O backend executa
o pipeline do projeto irmão `Move-Intelligence-Dados`, acompanha o resultado em
`collection_jobs`, persiste produtos e demanda nas tabelas normalizadas e
sincroniza snapshots para o ranking. O frontend expõe esse fluxo em
`/pipeline` com limites pequenos para testes.

O ETL abre diretamente uma sessão com o MCP Bright Data; o Codex não participa
da execução. Localmente, a conexão `bright_data` já registrada pode ser
descoberta automaticamente. Em produção, a URL MCP autenticada deve ser
injetada como segredo no backend/ETL. Nenhum JSON ou CSV intermediário é
necessário para a coleta da plataforma.

## Produção

O procedimento de implantação, backup, rotação de segredos e validação está em
[`docs/production.md`](docs/production.md). O schema de produção é administrado
exclusivamente por Prisma Migrate; o ETL não executa DDL no PostgreSQL.

## Escopo fitness

O catálogo usa os 16 clusters fitness oficiais e sinais de título de alta
precisão. Para auditar o banco antes de uma limpeza, execute:

```bash
npm run products:cleanup-non-fitness
```

O comando acima é somente prévia. Depois de criar um backup do PostgreSQL, a
remoção transacional exige a confirmação explícita:

```bash
npm run products:cleanup-non-fitness -- --apply --confirm=DELETE_NON_FITNESS
```
