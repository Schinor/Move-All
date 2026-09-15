## ETL de inteligência de produto (MVP)

### Testes

O comando oficial da suíte é:

```bash
python -m pytest tests
```

`tests/run_tests.py` é mantido por compatibilidade, mas não faz descoberta
automática de testes — use o pytest para validar todos os arquivos `test_*.py`.

O ETL v2 fica em `app/etl` e mantém o scaffold legado (`products/listings`)
isolado. O fluxo implementado é:

```text
Frontend -> backend -> ETL -> Bright Data MCP -> transform -> PostgreSQL
```

O ETL é um cliente MCP independente: ele abre sua própria sessão HTTP e chama
`search_engine` para descobrir URLs e `scrape_as_markdown` para extrair as
páginas. O Codex não executa a coleta e não precisa estar aberto. No ambiente
local, o projeto pode apenas descobrir a URL autenticada da conexão
`bright_data` já registrada no Codex; em produção, `BRIGHTDATA_MCP_URL` deve ser
injetada como segredo do servidor.

Fontes de produto do MVP: Alibaba, Amazon US, TikTok Shop, Taobao, 1688,
Amazon BR, Mercado Livre e Shopee BR. `tiktok_shop` é separado de
`tiktok_search`, que alimenta somente `demand_signals`.

### Executar o seed

O banco padrão é PostgreSQL, configurado em `config/sources.yaml` ou pela
variável `MOVE_ETL_DATABASE_URL`. Com o PostgreSQL do stack Move ativo:

Para subir o PostgreSQL oficial do projeto:

```bash
cd ../Move-Intelligence-Back
docker compose up -d postgres redis
docker compose ps
```

O PostgreSQL oficial pertence ao Compose do backend e usa o volume
`postgres_data`. O ETL deve apontar para esse banco com
`MOVE_ETL_DATABASE_URL`; ele não mantém um segundo Compose nem cria tabelas no
caminho de execução. O schema de produção é administrado por Prisma Migrate.

```bash
python3 main.py --pipeline intelligence-etl \
  --input /caminho/brightdata_fitness_products_v2.json
```

Para validar sem escrever e sem depender do banco:

```bash
python3 main.py --pipeline intelligence-etl \
  --input /caminho/brightdata_fitness_products_v2.json --dry-run
```

Um JSON de sinais pode ser passado com `--demand-input`. A normalização usa
Min-Max no conjunto comparável `geo × source`:

```text
trend_index = (raw_value - min(raw_value)) /
              (max(raw_value) - min(raw_value)) * 100
```

O `raw_value` nunca é descartado. O mapa de correlação fica em
`config/keyword_map.yaml`; a execução atual usa `match_method=cluster_map` e
upserts pelas chaves naturais das três tabelas.

### Demanda e operação

`GoogleTrendsExtractor` e `TikTokSearchExtractor` usam exclusivamente Bright
Data e não possuem fallback simulado ou `pytrends`. Google Trends pode carregar
`today 12-m` retroativamente; TikTok Search é tratado como snapshot atual.

O MVP é uma execução única. Scheduler não faz parte desta implementação; um
cron local pode chamar o mesmo comando no futuro, quando a re-coleta for
necessária. A conversão cambial permanece fora de `products` e, quando a
camada analítica precisar dela, a referência configurada é mensal.

### Coleta em tempo real

O comando operacional coleta diretamente pelo MCP Bright Data e grava no banco,
sem criar CSV ou JSON intermediário e sem exigir zonas SERP/Unlocker:

```bash
python3 main.py --pipeline live-intelligence \
  --term "haltere ajustável" \
  --sources amazon_br,mercado_livre \
  --limit 1 \
  --geos BR
```

As falhas são parciais: se o detalhe de uma página falhar, a evidência da SERP
é preservada; se uma fonte de demanda falhar, produtos das demais fontes ainda
são carregados. A interface `/pipeline` do frontend chama o mesmo fluxo por um
job assíncrono do backend e mostra produtos, sinais, correlações e avisos.

Configuração local, reutilizando a conexão já registrada:

```env
BRIGHTDATA_PROVIDER=mcp
BRIGHTDATA_MCP_NAME=bright_data
BRIGHTDATA_MCP_DISCOVER_CODEX=true
```

Configuração de servidor, sem dependência do executável do Codex:

```env
BRIGHTDATA_PROVIDER=mcp
BRIGHTDATA_MCP_DISCOVER_CODEX=false
BRIGHTDATA_MCP_URL=https://mcp.brightdata.com/SEU_ENDPOINT_AUTENTICADO
```

`BRIGHTDATA_MCP_URL` contém credencial e nunca deve ser enviada ao navegador,
persistida no PostgreSQL ou escrita em logs.

O MCP atualmente conectado oferece busca e extração de páginas, suficientes
para a coleta de marketplaces. Ele não oferece uma ferramenta estruturada de
Google Trends/TikTok; por isso a interface deixa demanda desmarcada por padrão.
Se a opção for ativada, fontes sem séries numéricas ficam registradas como
falhas parciais — nunca são substituídas por dados simulados.

### Coleta-base semanal do catálogo

A varredura semanal percorre todos os clusters de `config/keyword_map.yaml`,
suas variantes BR/US e as oito fontes. Cada termo é normalizado e persistido
imediatamente; repetir o comando na mesma data atualiza os mesmos snapshots.

```bash
python3 main.py --pipeline weekly-intelligence \
  --window-days 7 \
  --keyword-depth all \
  --sources amazon_br,mercado_livre,shopee_br,amazon,alibaba,tiktok_shop,taobao,1688 \
  --limit 10 \
  --geos BR,US
```

Para testar uma única unidade sem consumir a varredura inteira:

```bash
python3 main.py --pipeline weekly-intelligence \
  --clusters dumbbells --keyword-depth canonical --max-terms 1 \
  --sources amazon_br --limit 2 --geos BR --dry-run
```

O comando não fabrica sete dias retroativos de marketplace: ele salva o
snapshot observado no momento da execução e restringe o Google Trends à janela
real `now 7-d`. A série de marketplace cresce com execuções agendadas do mesmo
comando; TikTok Search permanece um snapshot da semana corrente.
