# Plano de implementação — Subprojeto D: Descoberta pelos termos em alta + acompanhamento por níveis

> **Para o agente executor (Codex):** execute as tarefas **na ordem, até o fim do plano, sem esperar "ok" entre elas**. Ao terminar cada uma: marque os checkboxes e registre a saída dos testes e o `git diff --stat` num bloco "**Registro Tarefa N:**" logo abaixo dela. Se um teste deste plano falhar de um jeito que o plano não previu, **pare e explique**; não altere o teste para passar. As únicas paradas previstas estão na **Tarefa 12** (chamadas à LLM e primeira busca real na Bright Data): pare ali e peça o "ok" explícito do usuário.

**Objetivo:** transformar as buscas em alta do radar numa lista que o ADMIN aprova e que alimenta a busca semanal de anúncios novos, e recalcular com vagas a frequência de acompanhamento de cada anúncio (top 50 / descoberta / radar / demais), dentro do orçamento atual de raspagens.

**Arquitetura:**
- **Nest:**
  - um módulo novo, `radar-discovery`, com a função pura de filtro, o serviço da lista (atualização diária, aprovação e API só para ADMIN) e o serviço de busca dos aprovados;
  - a coleta semanal chama a busca antes da rotação normal, usando o comando de termo avulso que já existe, agora com `--exact-term`;
  - uma função pura de níveis (`assignTiers`) e um serviço (`TrackingTiersService`) substituem o `promoteTiers()`.
- **Python:** ganha a opção `--exact-term`, o nível 3 mensal, a decodificação UTF-8 do SSE e um script que conserta os acentos já gravados.
- **Angular:** ganha a aba "Termos em alta" na Revisão e a coluna "Acompanhamento" na aba Anúncios.

**Stack:** NestJS 11 + Prisma 6 + Postgres 16 (jest); Python 3 + SQLAlchemy + pytest; Angular standalone + signals (vitest via `ng test`).

**Especificação:** [SPEC_SUBPROJETO_D_DESCOBERTA.md](SPEC_SUBPROJETO_D_DESCOBERTA.md). Leia antes de começar.

## Pré-requisitos

- [x] Branch `feat/catalogo-card`. O Subprojeto C pode estar sem commit (arquivos modificados do C no `git status`). **Não** faça commit dele.
- [x] `docker ps` mostra `move-postgres`, `move-backend` e `move-frontend` rodando.

## Regras globais

- **Sem commit, sem push, sem branch nova.**
- **LLM/OpenRouter:** nenhuma chamada antes da Tarefa 12, que precisa do "ok" do usuário. Mostre a contagem de `ai_call_logs` no começo e no fim do trabalho.
- **Bright Data:** nenhuma chamada real antes da Tarefa 12, que precisa do "ok" do usuário. Nos testes, use clientes falsos e mocks.
- Arquivos não commitados que **não são deste trabalho** e devem ficar intactos: `planos_executados/`, `*.webp` na raiz, `.playwright-cli/`, `docker-compose.yml`, `docker-compose.production.yml`, `ai.md`, `architecture-flow.mermaid`, `docs/`, `ESTRUTURA_BANCO_DADOS_MOCK.md`, os `.md` removidos da raiz e `Move-Intelligence-Back/scripts/catalog-generate-manual-fichas.ts`. **Não edite nenhum `docker-compose*.yml`.**
- **Banco:** só mudanças aditivas, via SQL em `prisma/migrations/<timestamp>_<nome>/migration.sql`, aplicado com `docker exec -i move-postgres psql -U move -d move_intelligence -v ON_ERROR_STOP=1 < arquivo`, seguido de `npx prisma generate`. **Nada de `prisma db push`.**
- O `src/modules/discovery/` que já existe (rota `dashboard/quote`) **não** é usado nem alterado. O código novo vai em `src/modules/radar-discovery/`.
- **Scripts locais:** rode com `INCLUDE_SYNTHETIC_DATA=true`. Scripts que chamam o Python: `PYTHON_BIN=/usr/local/bin/python3`.
- **Python:** use o interpretador que tem as dependências do `Move-Intelligence-Dados`. Confira com `<python> -c "import sqlalchemy, pytest"`. No C funcionou `/Users/raul/Desktop/Move-Sandbox/Move-Intelligence-Dados/.venv/bin/python`. Comando: `cd Move-Intelligence-Dados && <python> -m pytest tests -q`.
- **Comandos de teste:**
  - backend: `cd Move-Intelligence-Back && npx jest <caminho>`; no fim, `npm test` e `npx tsc --noEmit -p tsconfig.json`;
  - frontend: `cd Move-Intelligence-Front && NODE_OPTIONS=--localstorage-file=/private/tmp/move-front-vitest-localstorage npx ng test --watch=false` e `npx ng build`.
- Se reconstruir ou reiniciar containers, **deixe `move-backend` e `move-frontend` rodando** no final.

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `Move-Intelligence-Dados/app/etl/extract/marketplace/common.py` | Modificar | SSE decodificado como UTF-8 |
| `Move-Intelligence-Dados/scripts/repair_trends_encoding.py` | Criar | consertar os acentos já gravados |
| `Move-Intelligence-Dados/tests/test_trends_encoding.py` | Criar | testes das duas linhas acima |
| `Move-Intelligence-Dados/app/pipelines/run_live_intelligence.py`, `main.py` | Modificar | `--exact-term` |
| `Move-Intelligence-Dados/app/pipelines/run_track_listings.py` | Modificar | nível 3 mensal |
| `Move-Intelligence-Dados/tests/test_discovery_tracking.py`, `tests/test_track_listings.py` | Modificar | testes de `--exact-term` e da cadência |
| `Move-Intelligence-Back/prisma/migrations/20260922120000_discovery_terms_and_tiers/migration.sql`, `prisma/schema.prisma` | Criar/Modificar | tabela `discovery_terms` + colunas de motivo do nível |
| `Move-Intelligence-Back/src/modules/radar-discovery/discovery-candidates.ts` (+ spec) | Criar | normalização e filtro de ruído (puro) |
| `.../radar-discovery/discovery-terms.service.ts` (+ spec) | Criar | atualizar a lista, listar, contar, aprovar/ignorar/restaurar |
| `.../radar-discovery/discovery-terms.controller.ts` (+ spec), `dto/discovery-terms.dto.ts` | Criar | API só ADMIN |
| `.../radar-discovery/discovery-terms.scheduler.ts` | Criar | cron diário da lista |
| `.../radar-discovery/discovery-search.service.ts` (+ spec) | Criar | busca dos termos aprovados |
| `.../radar-discovery/radar-discovery.module.ts`, `src/app.module.ts` | Criar/Modificar | módulo |
| `Move-Intelligence-Back/src/modules/ingestion/intelligence-collection.service.ts` (+ spec), `dto/run-intelligence-collection.dto.ts`, `ingestion.module.ts` | Modificar | `exactTerm`, `runTermAndWait`, gancho na coleta semanal, troca do `promoteTiers` |
| `Move-Intelligence-Back/src/modules/ingestion/tracking-tiers.ts` (+ spec) | Criar | regra de níveis (pura) |
| `Move-Intelligence-Back/src/modules/ingestion/tracking-tiers.service.ts` (+ spec) | Criar | recálculo com status e gravação |
| `Move-Intelligence-Back/scripts/discovery-refresh.ts`, `discovery-search.ts`, `tracking-recalc.ts`, `package.json` | Criar/Modificar | scripts |
| `Move-Intelligence-Back/src/modules/catalog/catalog-review.service.ts` (+ spec) | Modificar | `tracking` em `listCardListings` |
| `Move-Intelligence-Back/.env.example` | Modificar | variáveis novas |
| `Move-Intelligence-Front/src/app/core/models/contract.models.ts` | Modificar | tipos novos |
| `Move-Intelligence-Front/src/app/core/services/discovery-terms.service.ts` | Criar | chamadas da API |
| `Move-Intelligence-Front/src/app/features/revisao/discovery-terms/discovery-terms.component.{ts,html,css,spec.ts}` | Criar | aba "Termos em alta" |
| `Move-Intelligence-Front/src/app/features/revisao/revisao.component.{ts,html}` (+ spec) | Modificar | terceira aba |
| `Move-Intelligence-Front/src/app/shared/components/intel/card-listings-table/*` | Modificar | coluna "Acompanhamento" |

---

### Tarefa 1: Acentos do radar (Python)

**Arquivos:**
- Modificar: `Move-Intelligence-Dados/app/etl/extract/marketplace/common.py` (método `_decode_mcp_response`, bloco `text/event-stream`)
- Criar: `Move-Intelligence-Dados/scripts/repair_trends_encoding.py`
- Criar: `Move-Intelligence-Dados/tests/test_trends_encoding.py`

**Interfaces:**
- Produz: `repair_text(value: str) -> str`, `repair_value(value: Any) -> Any` e `run(*, database_url: str | None = None, apply: bool = False) -> dict[str, int]` (chaves `inspected`, `changed`, `applied`) em `scripts/repair_trends_encoding.py`.

- [x] **Passo 1: testes que falham** — `tests/test_trends_encoding.py`:

```python
"""Subprojeto D: acentos do radar (SSE sem charset) e conserto das linhas gravadas."""

from __future__ import annotations

import importlib.util
import json
import uuid
from pathlib import Path

from app.etl.extract.marketplace.common import BrightDataClient
from app.etl.load.database import SearchTrendSnapshotModel, get_session

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "repair_trends_encoding.py"


def _load_script():
    spec = importlib.util.spec_from_file_location("repair_trends_encoding", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeSseResponse:
    """Imita o requests: com decode_unicode, decodifica com `self.encoding`."""

    def __init__(self, payload: str):
        self.headers = {"content-type": "text/event-stream"}
        self.encoding = "ISO-8859-1"
        self._raw = ("event: message\ndata: " + payload + "\n\n").encode("utf-8")

    def iter_lines(self, decode_unicode=False):
        for line in self._raw.split(b"\n"):
            yield line.decode(self.encoding) if decode_unicode and self.encoding else line

    def close(self):
        pass


def test_sse_sem_charset_mantem_acentos():
    payload = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "result": {"content": [{"type": "text", "text": "tapete de acupressão"}]}},
        ensure_ascii=False,
    )
    decoded = BrightDataClient._decode_mcp_response(FakeSseResponse(payload))
    assert decoded["result"]["content"][0]["text"] == "tapete de acupressão"


def test_repair_text_conserta_e_preserva():
    script = _load_script()
    quebrado = "tapete de acupressão".encode("utf-8").decode("latin-1")
    assert quebrado == "tapete de acupressÃ£o"
    assert script.repair_text(quebrado) == "tapete de acupressão"
    assert script.repair_text("sem acento") == "sem acento"
    # "Ã" legítimo que não é UTF-8 quebrado: mantém o original.
    assert script.repair_text("SÃO") == "SÃO"
    assert script.repair_value([{"query": quebrado, "value": 50}]) == [{"query": "tapete de acupressão", "value": 50}]


def test_run_dry_run_nao_grava_e_apply_grava(tmp_path):
    script = _load_script()
    database_url = f"sqlite:///{tmp_path / 'trends.db'}"
    quebrado = "tapete de acupressão".encode("utf-8").decode("latin-1")
    db = get_session(database_url)
    try:
        row_id = str(uuid.uuid4())
        db.add(SearchTrendSnapshotModel(
            id=row_id, type_key="acupressure_mat", term="tapete de acupressão", geo="BR",
            timeframe="today 12-m", status="ok", points=[],
            related_top=[{"query": quebrado, "value": 100}],
            related_rising=[{"query": quebrado, "value": 50, "label": "+50%", "breakout": False}],
        ))
        db.commit()
    finally:
        db.close()

    assert script.run(database_url=database_url, apply=False) == {"inspected": 1, "changed": 1, "applied": 0}
    db = get_session(database_url)
    try:
        assert db.get(SearchTrendSnapshotModel, row_id).related_rising[0]["query"] == quebrado
    finally:
        db.close()

    assert script.run(database_url=database_url, apply=True) == {"inspected": 1, "changed": 1, "applied": 1}
    db = get_session(database_url)
    try:
        row = db.get(SearchTrendSnapshotModel, row_id)
        assert row.related_rising[0]["query"] == "tapete de acupressão"
        assert row.related_top[0]["query"] == "tapete de acupressão"
    finally:
        db.close()
```

- [x] **Passo 2: rodar e ver falhar**

Run: `cd Move-Intelligence-Dados && <python> -m pytest tests/test_trends_encoding.py -q`
Expected: FAIL (o SSE devolve "acupressÃ£o" e o script não existe).

- [x] **Passo 3: correção no cliente** — em `common.py`, dentro de `_decode_mcp_response`, logo depois de `if "text/event-stream" in content_type and hasattr(response, "iter_lines"):` e antes de `messages: list[Any] = []`:

```python
            # SSE sem charset: o requests assume ISO-8859-1 e quebra os acentos
            # (ex.: "acupressÃ£o" no radar, Subprojeto D). A Bright Data envia UTF-8.
            try:
                response.encoding = "utf-8"
            except AttributeError:
                pass
```

- [x] **Passo 4: script** — `scripts/repair_trends_encoding.py`:

```python
#!/usr/bin/env python3
"""Subprojeto D: conserta acentos quebrados (UTF-8 lido como latin-1) em search_trend_snapshots.

Uso: python scripts/repair_trends_encoding.py --dry-run | --apply
Não chama a Bright Data; só lê e grava no banco.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv

load_dotenv()

from app.etl.load.database import SearchTrendSnapshotModel, get_session

MARKERS = ("Ã", "Â")


def repair_text(value: str) -> str:
    if not isinstance(value, str) or not any(marker in value for marker in MARKERS):
        return value
    try:
        return value.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value


def repair_value(value: Any) -> Any:
    if isinstance(value, str):
        return repair_text(value)
    if isinstance(value, list):
        return [repair_value(item) for item in value]
    if isinstance(value, dict):
        return {key: repair_value(item) for key, item in value.items()}
    return value


def run(*, database_url: Optional[str] = None, apply: bool = False) -> dict[str, int]:
    db = get_session(database_url)
    inspected = 0
    changed = 0
    try:
        for row in db.query(SearchTrendSnapshotModel).all():
            inspected += 1
            term = repair_text(row.term)
            rising = repair_value(row.related_rising)
            top = repair_value(row.related_top)
            if term != row.term or rising != row.related_rising or top != row.related_top:
                changed += 1
                if apply:
                    row.term = term
                    row.related_rising = rising
                    row.related_top = top
        if apply:
            db.commit()
        else:
            db.rollback()
    finally:
        db.close()
    return {"inspected": inspected, "changed": changed, "applied": int(apply)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    database_url = os.getenv("MOVE_ETL_DATABASE_URL") or os.getenv("DATABASE_URL")
    print(run(database_url=database_url, apply=args.apply))


if __name__ == "__main__":
    main()
```

- [x] **Passo 5: rodar e ver passar**

Run: `cd Move-Intelligence-Dados && <python> -m pytest tests/test_trends_encoding.py tests/test_search_trends.py -q`
Expected: PASS.

- [x] **Passo 6: consertar a base local** (só banco, não é parada)

```bash
cd Move-Intelligence-Dados && <python> scripts/repair_trends_encoding.py --dry-run
cd Move-Intelligence-Dados && <python> scripts/repair_trends_encoding.py --apply
docker exec move-postgres psql -U move -d move_intelligence -At -c "select count(*) from search_trend_snapshots where related_rising::text ~ 'Ã' or related_top::text ~ 'Ã' or term ~ 'Ã';"
```
Expected: o dry-run mostra `changed` perto de 12, e o apply grava. A contagem final é `0`, ou são só linhas cujo "Ã" é legítimo. Registre os números.

---

**Registro Tarefa 1:**
- Red: `pytest tests/test_trends_encoding.py -q` → 3 falhas esperadas (SSE com `acupressÃ£o`; script ausente).
- Green: `pytest tests/test_trends_encoding.py tests/test_search_trends.py -q` → **25 passed**.
- Reparo local: dry-run `inspected=341, changed=29, applied=0`; SQL explicou 12 linhas com mojibake em `related_rising`, 29 em `related_top`, nenhuma em `term` (a estimativa de ~12 referia-se às coletas em `related_rising`). Apply `inspected=341, changed=29, applied=1`; consulta final de `Ã` em `term`/JSON → **0**.
- `git diff --stat`: checkout **40 files changed, 772 insertions(+), 2,244 deletions(-)** (inclui alterações anteriores e exclui arquivos novos não rastreados); arquivos novos da tarefa via `git diff --no-index --stat`: script **82 linhas**, teste **90 linhas**. `common.py` aparece com **47 linhas** acumuladas, incluindo alterações pré-existentes do C.

### Tarefa 2: `--exact-term` e nível 3 mensal (Python)

**Arquivos:**
- Modificar: `Move-Intelligence-Dados/app/pipelines/run_live_intelligence.py` (`_source_term`, `run`, `collect_source`)
- Modificar: `Move-Intelligence-Dados/main.py` (argumento e chamada do `live-intelligence`)
- Modificar: `Move-Intelligence-Dados/app/pipelines/run_track_listings.py` (`TIER_CADENCE_DAYS` e os dois `get(..., 14.0)`)
- Testes: `Move-Intelligence-Dados/tests/test_discovery_tracking.py`, `tests/test_track_listings.py`

**Interfaces:**
- Produz: `_source_term(term, source, cluster, keyword_map, variant=0, exact=False)`, `run(..., exact_term: bool = False)` e a flag de linha de comando `--exact-term`. A Tarefa 6 passa `--exact-term`.

- [x] **Passo 1: testes que falham** — no fim de `tests/test_discovery_tracking.py`:

```python
def test_exact_term_busca_o_termo_literal_em_todas_as_fontes():
    from app.pipelines.run_live_intelligence import _source_term

    keyword_map = {"spin": {"keywords": {"BR": ["bike spinning"], "US": ["spin bike"]}}}
    # Sem a opção: comportamento de hoje (termo padrão do grupo por país).
    assert _source_term("spin bike dobrável", "amazon", "spin", keyword_map) == "spin bike"
    assert _source_term("spin bike dobrável", "amazon_br", "spin", keyword_map) == "bike spinning"
    # Com a opção: o termo pedido, literal, em qualquer fonte.
    assert _source_term("spin bike dobrável", "amazon", "spin", keyword_map, exact=True) == "spin bike dobrável"
    assert _source_term("spin bike dobrável", "1688", "spin", keyword_map, exact=True) == "spin bike dobrável"


def test_main_aceita_exact_term(monkeypatch):
    import main as entrypoint

    captured = {}

    def fake_run(**kwargs):
        captured.update(kwargs)
        return {"term": kwargs["term"], "failures": []}

    monkeypatch.setattr(entrypoint.run_live_intelligence, "run", fake_run)
    monkeypatch.setattr(
        "sys.argv",
        ["main.py", "--pipeline", "live-intelligence", "--term", "nike adjustable dumbbells",
         "--sources", "amazon", "--skip-demand", "--exact-term"],
    )
    entrypoint.main()
    assert captured["exact_term"] is True
    assert captured["term"] == "nike adjustable dumbbells"
```

No fim de `tests/test_track_listings.py`:

```python
def test_cadencia_nivel_3_mensal():
    from app.pipelines.run_track_listings import TIER_CADENCE_DAYS

    assert TIER_CADENCE_DAYS == {1: 3.5, 2: 7.0, 3: 30.0}
```

Antes de rodar, confira como `main.py` importa `run_live_intelligence` (`from app.pipelines import run_live_intelligence`). Se o nome do módulo no `main` for outro, ajuste só o alvo do `monkeypatch.setattr` para o nome real.

- [x] **Passo 2: rodar e ver falhar**

Run: `cd Move-Intelligence-Dados && <python> -m pytest tests/test_discovery_tracking.py tests/test_track_listings.py -q`
Expected: FAIL (`exact` inesperado, `--exact-term` desconhecido e cadência 14.0).

- [x] **Passo 3: implementar**

Em `run_live_intelligence.py`, troque `_source_term` por:

```python
def _source_term(
    term: str,
    source: str,
    cluster: str,
    keyword_map: Mapping[str, Mapping[str, list[str]]],
    variant: int = 0,
    exact: bool = False,
) -> str:
    # Subprojeto D: termo aprovado no radar é buscado literalmente.
    if exact:
        return term
    if source in BR_SOURCES:
        return _keyword_for_geo(term, cluster, "BR", keyword_map, variant)
    return _keyword_for_geo(term, cluster, "US", keyword_map, variant)
```

Em `run(...)`, acrescente o parâmetro `exact_term: bool = False` (depois de `max_calls`). Em `collect_source`, troque a linha da query por:

```python
        query = _source_term(requested_term, source, cluster, base_keyword_map, variant, exact=exact_term)
```

No dicionário `summary` que `run` devolve, acrescente `"exact_term": exact_term`.

Em `main.py`, logo depois do argumento `--skip-demand`:

```python
    parser.add_argument(
        "--exact-term",
        action="store_true",
        help="Busca o --term literal em todas as fontes (descoberta pelos termos em alta).",
    )
```

E na chamada `run_live_intelligence.run(...)` do ramo `live-intelligence`, acrescente `exact_term=args.exact_term,`.

Em `run_track_listings.py`:

```python
# Cadência por nível (Subprojeto D): 1 = 2x/semana, 2 = semanal, 3 = mensal.
# Espelho de TRACK_CADENCE_DAYS em Move-Intelligence-Back/src/modules/ingestion/tracking-tiers.ts.
TIER_CADENCE_DAYS = {1: 3.5, 2: 7.0, 3: 30.0}
```

Troque também os dois `TIER_CADENCE_DAYS.get(listing.tier or 3, 14.0)` por `TIER_CADENCE_DAYS.get(listing.tier or 3, 30.0)`.

- [x] **Passo 4: rodar e ver passar**

Run: `cd Move-Intelligence-Dados && <python> -m pytest tests -q`
Expected: toda a suíte Python passa. Se algum teste antigo esperava 14 dias para o nível 3, ele deve ser atualizado para 30, porque essa é a mudança pedida. Registre qual teste foi.

---

**Registro Tarefa 2:**
- Red: `pytest tests/test_discovery_tracking.py tests/test_track_listings.py -q` → 3 falhas esperadas (`exact`/`--exact-term` ausente e cadência 14 dias).
- Green: `pytest tests -q` → **115 passed, 3 skipped** em 18.68s; `rg` não encontrou expectativas legadas de 14 dias.
- `git diff --stat` dos 5 arquivos Python da tarefa → **5 files changed, 62 insertions(+), 12 deletions(-)**; inclui 14 linhas pré-existentes no `run_live_intelligence.py` do C. `git diff --check` limpo.

### Tarefa 3: Tabela `discovery_terms` e colunas do nível

**Arquivos:**
- Criar: `Move-Intelligence-Back/prisma/migrations/20260922120000_discovery_terms_and_tiers/migration.sql`
- Modificar: `Move-Intelligence-Back/prisma/schema.prisma` (novo model + 2 campos em `TrackedListing`)

**Interfaces:**
- Produz: `prisma.discoveryTerm` (chave única composta `geo_termNorm`) e os campos `TrackedListing.tierReason` e `TrackedListing.tierUpdatedAt`.

- [x] **Passo 1: migration**

```sql
-- Subprojeto D: termos em alta do radar para o ADMIN aprovar e buscar anúncios.
CREATE TABLE IF NOT EXISTS discovery_terms (
  id uuid PRIMARY KEY,
  type_key text NOT NULL,
  geo text NOT NULL,
  term text NOT NULL,
  term_norm text NOT NULL,
  rising_value integer NOT NULL DEFAULT 0,
  rising_label text NOT NULL DEFAULT '',
  breakout boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'new',
  first_seen_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by uuid,
  decided_at timestamp(3),
  searched_at timestamp(3),
  search_job_id uuid,
  new_listings integer,
  search_error text
);
CREATE UNIQUE INDEX IF NOT EXISTS discovery_terms_geo_term_norm_key ON discovery_terms (geo, term_norm);
CREATE INDEX IF NOT EXISTS discovery_terms_status_idx ON discovery_terms (status);

-- Subprojeto D: motivo do nível de acompanhamento (top50, descoberta, radar, demais, watchlist).
ALTER TABLE tracked_listings ADD COLUMN IF NOT EXISTS tier_reason text;
ALTER TABLE tracked_listings ADD COLUMN IF NOT EXISTS tier_updated_at timestamp(3);
```

- [x] **Passo 2: Prisma** — em `TrackedListing`, depois de `nextDueAt`:

```prisma
  // Subprojeto D: motivo do nível (watchlist | top50 | descoberta | radar | demais).
  tierReason          String?              @map("tier_reason")
  tierUpdatedAt       DateTime?            @map("tier_updated_at")
```

Model novo, logo depois de `SearchTrendSnapshot`:

```prisma
/// Subprojeto D: termos em alta do radar. O ADMIN aprova; a coleta semanal busca anúncios.
model DiscoveryTerm {
  id          String    @id @default(uuid()) @db.Uuid
  typeKey     String    @map("type_key")
  geo         String
  term        String
  termNorm    String    @map("term_norm")
  risingValue Int       @default(0) @map("rising_value")
  risingLabel String    @default("") @map("rising_label")
  breakout    Boolean   @default(false)
  status      String    @default("new")
  firstSeenAt DateTime  @default(now()) @map("first_seen_at")
  lastSeenAt  DateTime  @default(now()) @map("last_seen_at")
  decidedBy   String?   @map("decided_by") @db.Uuid
  decidedAt   DateTime? @map("decided_at")
  searchedAt  DateTime? @map("searched_at")
  searchJobId String?   @map("search_job_id") @db.Uuid
  newListings Int?      @map("new_listings")
  searchError String?   @map("search_error")

  @@unique([geo, termNorm], map: "discovery_terms_geo_term_norm_key")
  @@index([status], map: "discovery_terms_status_idx")
  @@map("discovery_terms")
}
```

- [x] **Passo 3: aplicar e gerar**

```bash
cd Move-Intelligence-Back && docker exec -i move-postgres psql -U move -d move_intelligence -v ON_ERROR_STOP=1 < prisma/migrations/20260922120000_discovery_terms_and_tiers/migration.sql && npx prisma generate && npx tsc --noEmit -p tsconfig.json
```
Expected: `CREATE TABLE`, `CREATE INDEX` ×2 e `ALTER TABLE` ×2; `tsc` sem erro.

---

**Registro Tarefa 3:**
- Verificação antes da migration: tabela `discovery_terms` ausente e colunas `tier_reason`/`tier_updated_at` ausentes.
- Aplicação SQL: `CREATE TABLE`, 2 índices e 2 `ALTER TABLE`; `npx prisma generate` (Prisma 6.19.3) e `npx tsc --noEmit -p tsconfig.json` → **passaram**.
- `git diff --stat` do schema → **50 linhas** acumuladas (inclui as alterações C existentes); `git diff --no-index --stat` da migration nova → **26 linhas**.

### Tarefa 4: Filtro de ruído (função pura)

**Arquivos:**
- Criar: `Move-Intelligence-Back/src/modules/radar-discovery/discovery-candidates.ts`
- Teste: `Move-Intelligence-Back/src/modules/radar-discovery/discovery-candidates.spec.ts`

**Interfaces:**
- Produz:
  - `normalizeTerm(value: string): string`;
  - `buildDiscoveryCandidates(snapshots: SnapshotInput[], types: TypeTerms[]): DiscoveryCandidate[]`;
  - os tipos `RisingItem`, `SnapshotInput`, `TypeTerms` e `DiscoveryCandidate`;
  - as constantes `BLOCK_WORDS`, `GENERIC_WORDS` e `MAX_TERMS_PER_SNAPSHOT`.

- [x] **Passo 1: teste que falha** — `discovery-candidates.spec.ts`:

```ts
import { buildDiscoveryCandidates, normalizeTerm, RisingItem, TypeTerms } from './discovery-candidates';

const types: TypeTerms[] = [
  { typeKey: 'adjustable_dumbbell', pt: 'halter ajustável', en: 'adjustable dumbbells' },
  { typeKey: 'ab_crunch_machine', pt: 'máquina abdominal', en: 'ab crunch machine' },
  { typeKey: 'ab_wheel', pt: 'roda abdominal', en: 'ab roller' },
  { typeKey: 'aerobic_step', pt: 'step aeróbico', en: 'aerobic step' },
  { typeKey: 'pilates_reformer', pt: 'reformer pilates', en: 'pilates reformer' },
];
const r = (query: string, value: number, label = `+${value}%`, breakout = false): RisingItem => ({ query, value, label, breakout });
const terms = (list: ReturnType<typeof buildDiscoveryCandidates>) => list.map((c) => c.term).sort();

describe('buildDiscoveryCandidates', () => {
  it('normaliza sem acento, pontuação e espaços extras', () => {
    expect(normalizeTerm('  Step   Aeróbico, Ajustável! ')).toBe('step aerobico ajustavel');
  });

  it('aplica os exemplos da especificação (§5.2)', () => {
    const out = buildDiscoveryCandidates([
      { typeKey: 'adjustable_dumbbell', geo: 'US', relatedRising: [r('coffee grinder', 19750, 'Breakout', true), r('nike adjustable dumbbells', 800), r('best adjustable dumbbells', 190)] },
      { typeKey: 'ab_crunch_machine', geo: 'US', relatedRising: [r('hip thrust machine', 103950, 'Breakout', true)] },
      { typeKey: 'ab_wheel', geo: 'US', relatedRising: [r('ab roller with elbow support', 140)] },
      { typeKey: 'aerobic_step', geo: 'US', relatedRising: [r('adjustable aerobic step', 500)] },
      { typeKey: 'pilates_reformer', geo: 'US', relatedRising: [r('what is pilates', 300)] },
    ], types);
    expect(terms(out)).toEqual(['ab roller with elbow support', 'adjustable aerobic step', 'nike adjustable dumbbells']);
    const nike = out.find((c) => c.term === 'nike adjustable dumbbells')!;
    expect(nike).toEqual({
      typeKey: 'adjustable_dumbbell', geo: 'US', term: 'nike adjustable dumbbells', termNorm: 'nike adjustable dumbbells',
      risingValue: 800, risingLabel: '+800%', breakout: false,
    });
  });

  it('mantém só os 3 de maior alta por coleta', () => {
    const out = buildDiscoveryCandidates([{
      typeKey: 'adjustable_dumbbell', geo: 'US',
      relatedRising: [r('a dumbbells', 10), r('b dumbbells', 50), r('c dumbbells', 30), r('d dumbbells', 40), r('e dumbbells', 20)],
    }], types);
    expect(out.map((c) => c.risingValue).sort((a, b) => b - a)).toEqual([50, 40, 30]);
  });

  it('descarta termo igual ao termo do radar de qualquer tipo', () => {
    const out = buildDiscoveryCandidates([
      { typeKey: 'ab_wheel', geo: 'BR', relatedRising: [r('roda abdominal', 90), r('Roda Abdominal com apoio', 60)] },
    ], types);
    expect(terms(out)).toEqual(['Roda Abdominal com apoio']);
  });

  it('mesmo termo em dois tipos no mesmo país: fica o de maior alta', () => {
    const out = buildDiscoveryCandidates([
      { typeKey: 'ab_wheel', geo: 'US', relatedRising: [r('abdominal roller pro', 100)] },
      { typeKey: 'ab_crunch_machine', geo: 'US', relatedRising: [r('abdominal roller pro', 300)] },
    ], types);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ typeKey: 'ab_crunch_machine', risingValue: 300 });
  });

  it('ignora tipo sem termos e itens vazios', () => {
    const out = buildDiscoveryCandidates([
      { typeKey: 'desconhecido', geo: 'US', relatedRising: [r('adjustable dumbbells rack', 100)] },
      { typeKey: 'adjustable_dumbbell', geo: 'US', relatedRising: [r('   ', 100)] },
    ], types);
    expect(out).toEqual([]);
  });
});
```

- [x] **Passo 2: rodar e ver falhar**

Run: `cd Move-Intelligence-Back && npx jest src/modules/radar-discovery/discovery-candidates.spec.ts`
Expected: FAIL (módulo não existe).

- [x] **Passo 3: implementar** — `discovery-candidates.ts`:

```ts
/** Subprojeto D (spec §5.2): filtro de ruído dos termos em alta do radar. Função pura. */

export interface RisingItem { query: string; value: number; label: string; breakout: boolean }
export interface SnapshotInput { typeKey: string; geo: string; relatedRising: RisingItem[] }
export interface TypeTerms { typeKey: string; pt: string | null; en: string | null }
export interface DiscoveryCandidate {
  typeKey: string;
  geo: string;
  term: string;
  termNorm: string;
  risingValue: number;
  risingLabel: string;
  breakout: boolean;
}

export const MAX_TERMS_PER_SNAPSHOT = 3;

/** Termo com qualquer uma destas palavras é pergunta/conteúdo, não produto: sai. */
export const BLOCK_WORDS = new Set([
  'what', 'is', 'are', 'how', 'why', 'when', 'who', 'which', 'does', 'do', 'can', 'vs', 'versus',
  'benefits', 'benefit', 'beneficios', 'beneficio', 'meaning', 'significado', 'near', 'como', 'que',
  'qual', 'quais', 'serve', 'funciona', 'funcionam', 'calories', 'calorias', 'exercises', 'exercise',
  'exercicios', 'exercicio', 'workout', 'workouts', 'routine', 'rotina', 'plan', 'plano', 'class',
  'classes', 'aula', 'aulas', 'lesson', 'lessons', 'tutorial', 'video', 'videos', 'youtube', 'reddit',
  'wiki', 'definition', 'definicao', 'lunges', 'squats', 'squat', 'curls', 'curl', 'press', 'pushups',
  'results', 'resultados', 'before', 'after', 'antes', 'depois', 'diet', 'dieta', 'loss', 'emagrecer',
  'emagrece', 'best', 'melhor', 'melhores', 'review', 'reviews', 'top',
]);

/** Palavras que não contam na comparação com o vocabulário do tipo. */
export const GENERIC_WORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'para', 'com', 'sem', 'em', 'the', 'for', 'with', 'and', 'of', 'me',
  'buy', 'price', 'preco', 'cheap', 'barato', 'used', 'usado', 'amazon', 'machine', 'maquina', 'aparelho',
  'equipment', 'equipamento', 'set', 'kit', 'fitness', 'gym', 'academia', 'home', 'casa',
]);

export function normalizeTerm(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countingWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of normalizeTerm(text).split(' ')) {
    if (word.length < 3 || GENERIC_WORDS.has(word)) continue;
    out.add(word);
    if (word.endsWith('s')) out.add(word.slice(0, -1));
  }
  return out;
}

export function buildDiscoveryCandidates(snapshots: SnapshotInput[], types: TypeTerms[]): DiscoveryCandidate[] {
  const vocab = new Map(
    types.map((t) => [t.typeKey, new Set([...countingWords(t.pt ?? ''), ...countingWords(t.en ?? '')])]),
  );
  const radarTerms = new Set(
    types.flatMap((t) => [t.pt, t.en]).filter((v): v is string => !!v).map(normalizeTerm),
  );
  const best = new Map<string, DiscoveryCandidate>();

  for (const snapshot of snapshots) {
    const words = vocab.get(snapshot.typeKey);
    if (!words || words.size === 0) continue;
    const kept: DiscoveryCandidate[] = [];
    for (const item of snapshot.relatedRising ?? []) {
      const query = String(item?.query ?? '').trim();
      const termNorm = normalizeTerm(query);
      if (!termNorm) continue;
      if (termNorm.split(' ').some((w) => BLOCK_WORDS.has(w))) continue;
      if (radarTerms.has(termNorm)) continue;
      if (![...countingWords(query)].some((w) => words.has(w))) continue;
      kept.push({
        typeKey: snapshot.typeKey,
        geo: snapshot.geo,
        term: query,
        termNorm,
        risingValue: Number(item.value) || 0,
        risingLabel: String(item.label ?? ''),
        breakout: item.breakout === true,
      });
    }
    kept.sort((a, b) => b.risingValue - a.risingValue || a.termNorm.localeCompare(b.termNorm));
    for (const candidate of kept.slice(0, MAX_TERMS_PER_SNAPSHOT)) {
      const key = `${candidate.geo}::${candidate.termNorm}`;
      const previous = best.get(key);
      if (!previous || candidate.risingValue > previous.risingValue) best.set(key, candidate);
    }
  }
  return [...best.values()];
}
```

- [x] **Passo 4: rodar e ver passar**

Run: `cd Move-Intelligence-Back && npx jest src/modules/radar-discovery/discovery-candidates.spec.ts`
Expected: PASS.

---

**Registro Tarefa 4:**
- Red: Jest falhou como esperado (`discovery-candidates` ainda inexistente).
- Green: `npx jest src/modules/radar-discovery/discovery-candidates.spec.ts` → **1 suíte, 6 testes passaram**.
- `git diff --stat`: ambos os arquivos novos não rastreados foram conferidos via `git diff --no-index --stat`: implementação **95 linhas**, teste **65 linhas**.

### Tarefa 5: Lista de termos — serviço, API só ADMIN, cron e script

**Arquivos:**
- Criar: `Move-Intelligence-Back/src/modules/radar-discovery/discovery-terms.service.ts` (+ `.spec.ts`)
- Criar: `Move-Intelligence-Back/src/modules/radar-discovery/dto/discovery-terms.dto.ts`
- Criar: `Move-Intelligence-Back/src/modules/radar-discovery/discovery-terms.controller.ts` (+ `.spec.ts`)
- Criar: `Move-Intelligence-Back/src/modules/radar-discovery/discovery-terms.scheduler.ts`
- Criar: `Move-Intelligence-Back/src/modules/radar-discovery/radar-discovery.module.ts`
- Modificar: `Move-Intelligence-Back/src/app.module.ts` (importar `RadarDiscoveryModule`)
- Criar: `Move-Intelligence-Back/scripts/discovery-refresh.ts` e o script em `package.json`

**Interfaces:**
- Consome: `buildDiscoveryCandidates`, `normalizeTerm`, `RisingItem` e `TypeTerms` (Tarefa 4).
- Produz:
  - `DiscoveryTermsService.refresh(opts?: { dryRun?: boolean; now?: Date }): Promise<DiscoveryRefreshSummary>`;
  - `list(query: DiscoveryTermsQuery): Promise<DiscoveryTermView[]>`;
  - `counts(): Promise<{ new: number; approved: number; searched: number; ignored: number }>`;
  - `approve(id: string, userId: string)`, `ignore(id, userId)` e `restore(id, userId)`, que devolvem `Promise<{ id: string; status: string }>`;
  - `RadarDiscoveryModule` (exporta `DiscoveryTermsService`; a Tarefa 6 acrescenta `DiscoverySearchService`).

- [x] **Passo 1: testes que falham** — `discovery-terms.service.spec.ts`:

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import { DiscoveryTermsService } from './discovery-terms.service';

function build() {
  const prisma = {
    searchTrendSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
    keywordTerm: { findMany: jest.fn().mockResolvedValue([]) },
    catalogType: { findMany: jest.fn().mockResolvedValue([]) },
    discoveryTerm: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  };
  return { prisma, service: new DiscoveryTermsService(prisma as unknown as PrismaService) };
}

describe('DiscoveryTermsService', () => {
  const now = new Date('2026-09-22T09:00:00.000Z');

  function seedRadar(prisma: ReturnType<typeof build>['prisma']) {
    prisma.searchTrendSnapshot.findMany.mockResolvedValue([
      { typeKey: 'adjustable_dumbbell', geo: 'US', relatedRising: [
        { query: 'coffee grinder', value: 19750, label: 'Breakout', breakout: true },
        { query: 'nike adjustable dumbbells', value: 800, label: '+800%', breakout: false },
      ] },
      { typeKey: 'aerobic_step', geo: 'US', relatedRising: [
        { query: 'adjustable aerobic step', value: 500, label: '+500%', breakout: false },
      ] },
    ]);
    prisma.keywordTerm.findMany.mockResolvedValue([
      { term: 'halter ajustável', language: 'pt', category: 'adjustable_dumbbell' },
      { term: 'adjustable dumbbells', language: 'en', category: 'adjustable_dumbbell' },
      { term: 'step aeróbico', language: 'pt', category: 'aerobic_step' },
      { term: 'aerobic step', language: 'en', category: 'aerobic_step' },
    ]);
  }

  it('refresh: lê a coleta mais recente com status ok de cada tipo/país', async () => {
    const { prisma, service } = build();
    await service.refresh({ dryRun: true, now });
    expect(prisma.searchTrendSnapshot.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'ok' }, orderBy: { capturedAt: 'desc' }, distinct: ['typeKey', 'geo'],
    }));
  });

  it('refresh: upsert sem mexer no status e resumo por país', async () => {
    const { prisma, service } = build();
    seedRadar(prisma);
    prisma.discoveryTerm.findMany.mockResolvedValue([{ geo: 'US', termNorm: 'adjustable aerobic step' }]);
    const summary = await service.refresh({ now });
    expect(summary).toMatchObject({ dry_run: false, candidates: 2, created: 1, updated: 1, created_by_geo: { US: 1 } });
    expect(prisma.discoveryTerm.upsert).toHaveBeenCalledTimes(2);
    for (const [arg] of prisma.discoveryTerm.upsert.mock.calls) {
      expect(arg.update).not.toHaveProperty('status');
      expect(arg.update).toEqual(expect.objectContaining({ lastSeenAt: now }));
    }
    const created = prisma.discoveryTerm.upsert.mock.calls.map(([a]) => a.create.term);
    expect(created).not.toContain('coffee grinder');
  });

  it('refresh --dry-run não grava', async () => {
    const { prisma, service } = build();
    seedRadar(prisma);
    const summary = await service.refresh({ dryRun: true, now });
    expect(summary.created).toBe(2);
    expect(prisma.discoveryTerm.upsert).not.toHaveBeenCalled();
  });

  it('approve só de new, grava quem e quando', async () => {
    const { prisma, service } = build();
    await expect(service.approve('t1', 'u1')).resolves.toEqual({ id: 't1', status: 'approved' });
    const arg = prisma.discoveryTerm.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 't1', status: { in: ['new'] } });
    expect(arg.data).toEqual(expect.objectContaining({ status: 'approved', decidedBy: 'u1' }));
    expect(arg.data.decidedAt).toBeInstanceOf(Date);
  });

  it('transição inválida → 409; id inexistente → 404', async () => {
    const { prisma, service } = build();
    prisma.discoveryTerm.updateMany.mockResolvedValue({ count: 0 });
    prisma.discoveryTerm.findUnique.mockResolvedValueOnce({ id: 't1', status: 'searched' });
    await expect(service.ignore('t1', 'u1')).rejects.toBeInstanceOf(ConflictException);
    prisma.discoveryTerm.findUnique.mockResolvedValueOnce(null);
    await expect(service.restore('x', 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ignore aceita new e approved; restore volta ignored para new', async () => {
    const { prisma, service } = build();
    await service.ignore('t1', 'u1');
    expect(prisma.discoveryTerm.updateMany.mock.calls[0][0].where).toEqual({ id: 't1', status: { in: ['new', 'approved'] } });
    await service.restore('t1', 'u1');
    expect(prisma.discoveryTerm.updateMany.mock.calls[1][0]).toEqual(expect.objectContaining({
      where: { id: 't1', status: { in: ['ignored'] } },
      data: expect.objectContaining({ status: 'new' }),
    }));
  });

  it('list: aceita vários status, filtra país e família e devolve snake_case com nome do tipo', async () => {
    const { prisma, service } = build();
    prisma.catalogType.findMany.mockResolvedValue([
      { key: 'aerobic_step', namePt: 'Step aeróbico', family: { key: 'accessories' } },
      { key: 'spin_bike', namePt: 'Bike spinning', family: { key: 'bikes' } },
    ]);
    prisma.discoveryTerm.findMany.mockResolvedValue([{
      id: 't1', typeKey: 'aerobic_step', geo: 'US', term: 'adjustable aerobic step', risingLabel: '+500%', breakout: false,
      firstSeenAt: now, lastSeenAt: now, status: 'searched', searchedAt: now, newListings: 14, searchError: null,
    }]);
    const out = await service.list({ status: 'approved,searched', geo: 'US', family: 'accessories' });
    const where = prisma.discoveryTerm.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ status: { in: ['approved', 'searched'] }, geo: 'US', typeKey: { in: ['aerobic_step'] } });
    expect(out[0]).toEqual({
      id: 't1', term: 'adjustable aerobic step', geo: 'US', type_key: 'aerobic_step', type_name: 'Step aeróbico',
      family_key: 'accessories', rising_label: '+500%', breakout: false, first_seen_at: now.toISOString(),
      last_seen_at: now.toISOString(), status: 'searched', searched_at: now.toISOString(), new_listings: 14, search_error: null,
    });
  });

  it('counts: devolve as 4 chaves mesmo sem linhas', async () => {
    const { prisma, service } = build();
    prisma.discoveryTerm.groupBy.mockResolvedValue([{ status: 'new', _count: { _all: 3 } }]);
    await expect(service.counts()).resolves.toEqual({ new: 3, approved: 0, searched: 0, ignored: 0 });
  });
});
```

`discovery-terms.controller.spec.ts`:

```ts
import { AdminGuard } from '../auth/admin.guard';
import { DiscoveryTermsController } from './discovery-terms.controller';

describe('DiscoveryTermsController', () => {
  it('é só para ADMIN (AdminGuard na classe)', () => {
    const guards = Reflect.getMetadata('__guards__', DiscoveryTermsController) as unknown[];
    expect(guards).toContain(AdminGuard);
  });

  it('passa o id do usuário do JWT nas decisões', async () => {
    const terms = { approve: jest.fn().mockResolvedValue({ id: 't1', status: 'approved' }) };
    const controller = new DiscoveryTermsController(terms as never);
    await controller.approve('t1', { user: { sub: 'u1' } });
    expect(terms.approve).toHaveBeenCalledWith('t1', 'u1');
  });
});
```

- [x] **Passo 2: rodar e ver falhar**

Run: `cd Move-Intelligence-Back && npx jest src/modules/radar-discovery`
Expected: FAIL (arquivos não existem).

- [x] **Passo 3: implementar**

`dto/discovery-terms.dto.ts`:

```ts
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class DiscoveryTermsQueryDto {
  /** Um ou mais status separados por vírgula (ex.: "approved,searched"). */
  @IsOptional()
  @Matches(/^(new|approved|searched|ignored)(,(new|approved|searched|ignored))*$/)
  status?: string;

  @IsOptional()
  @IsIn(['BR', 'US'])
  geo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  family?: string;
}
```

`discovery-terms.service.ts`:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import { buildDiscoveryCandidates, RisingItem, TypeTerms } from './discovery-candidates';

export interface DiscoveryTermsQuery { status?: string; geo?: string; family?: string }
export interface DiscoveryRefreshSummary {
  dry_run: boolean;
  snapshots: number;
  candidates: number;
  created: number;
  updated: number;
  created_by_geo: Record<string, number>;
  sample: string[];
}
export interface DiscoveryTermView {
  id: string; term: string; geo: string; type_key: string; type_name: string | null; family_key: string | null;
  rising_label: string; breakout: boolean; first_seen_at: string; last_seen_at: string; status: string;
  searched_at: string | null; new_listings: number | null; search_error: string | null;
}

const STATUSES = ['new', 'approved', 'searched', 'ignored'] as const;

@Injectable()
export class DiscoveryTermsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Spec §5.2: gera/atualiza a lista a partir da coleta mais recente (status ok) de cada tipo/país. */
  async refresh(opts: { dryRun?: boolean; now?: Date } = {}): Promise<DiscoveryRefreshSummary> {
    const dryRun = opts.dryRun === true;
    const now = opts.now ?? new Date();
    const snapshots = await this.prisma.searchTrendSnapshot.findMany({
      where: { status: 'ok' },
      orderBy: { capturedAt: 'desc' },
      distinct: ['typeKey', 'geo'],
      select: { typeKey: true, geo: true, relatedRising: true },
    });
    const keywordRows = await this.prisma.keywordTerm.findMany({
      where: { active: true, category: { not: null }, language: { in: ['pt', 'en'] } },
      select: { term: true, language: true, category: true },
    });
    const byType = new Map<string, TypeTerms>();
    for (const row of keywordRows) {
      const key = row.category as string;
      const entry = byType.get(key) ?? { typeKey: key, pt: null, en: null };
      if (row.language === 'pt') entry.pt = row.term;
      if (row.language === 'en') entry.en = row.term;
      byType.set(key, entry);
    }
    const candidates = buildDiscoveryCandidates(
      snapshots.map((s) => ({
        typeKey: s.typeKey,
        geo: s.geo,
        relatedRising: Array.isArray(s.relatedRising) ? (s.relatedRising as unknown as RisingItem[]) : [],
      })),
      [...byType.values()],
    );
    const existing = await this.prisma.discoveryTerm.findMany({ select: { geo: true, termNorm: true } });
    const existingKeys = new Set(existing.map((e) => `${e.geo}::${e.termNorm}`));
    const created = candidates.filter((c) => !existingKeys.has(`${c.geo}::${c.termNorm}`));
    const createdByGeo: Record<string, number> = {};
    for (const c of created) createdByGeo[c.geo] = (createdByGeo[c.geo] ?? 0) + 1;

    if (!dryRun) {
      for (const c of candidates) {
        await this.prisma.discoveryTerm.upsert({
          where: { geo_termNorm: { geo: c.geo, termNorm: c.termNorm } },
          create: { ...c, firstSeenAt: now, lastSeenAt: now },
          // O status nunca muda aqui: ignorado continua ignorado.
          update: { lastSeenAt: now, risingValue: c.risingValue, risingLabel: c.risingLabel, breakout: c.breakout },
        });
      }
    }
    return {
      dry_run: dryRun,
      snapshots: snapshots.length,
      candidates: candidates.length,
      created: created.length,
      updated: candidates.length - created.length,
      created_by_geo: createdByGeo,
      sample: created.slice(0, 15).map((c) => `${c.geo} · ${c.term} (${c.typeKey}, ${c.risingLabel})`),
    };
  }

  async list(query: DiscoveryTermsQuery): Promise<DiscoveryTermView[]> {
    const statuses = (query.status ?? 'new').split(',').filter((s) => (STATUSES as readonly string[]).includes(s));
    const types = await this.prisma.catalogType.findMany({
      select: { key: true, namePt: true, family: { select: { key: true } } },
    });
    const typeBy = new Map(types.map((t) => [t.key, t]));
    const where: Record<string, unknown> = { status: { in: statuses } };
    if (query.geo) where['geo'] = query.geo;
    if (query.family) where['typeKey'] = { in: types.filter((t) => t.family?.key === query.family).map((t) => t.key) };
    const onlyNew = statuses.length === 1 && statuses[0] === 'new';
    const rows = await this.prisma.discoveryTerm.findMany({
      where,
      orderBy: onlyNew ? [{ breakout: 'desc' }, { risingValue: 'desc' }] : [{ decidedAt: 'desc' }],
      take: 500,
    });
    return rows.map((row) => {
      const type = typeBy.get(row.typeKey);
      return {
        id: row.id,
        term: row.term,
        geo: row.geo,
        type_key: row.typeKey,
        type_name: type?.namePt ?? null,
        family_key: type?.family?.key ?? null,
        rising_label: row.risingLabel,
        breakout: row.breakout,
        first_seen_at: row.firstSeenAt.toISOString(),
        last_seen_at: row.lastSeenAt.toISOString(),
        status: row.status,
        searched_at: row.searchedAt ? row.searchedAt.toISOString() : null,
        new_listings: row.newListings ?? null,
        search_error: row.searchError ?? null,
      };
    });
  }

  async counts(): Promise<Record<(typeof STATUSES)[number], number>> {
    const rows = await this.prisma.discoveryTerm.groupBy({ by: ['status'], _count: { _all: true } });
    const out = { new: 0, approved: 0, searched: 0, ignored: 0 };
    for (const row of rows) {
      if (row.status in out) out[row.status as keyof typeof out] = row._count._all;
    }
    return out;
  }

  approve(id: string, userId: string) { return this.transition(id, ['new'], 'approved', userId); }
  ignore(id: string, userId: string) { return this.transition(id, ['new', 'approved'], 'ignored', userId); }
  restore(id: string, userId: string) { return this.transition(id, ['ignored'], 'new', userId); }

  private async transition(id: string, from: string[], to: string, userId: string) {
    const result = await this.prisma.discoveryTerm.updateMany({
      where: { id, status: { in: from } },
      data: { status: to, decidedBy: userId, decidedAt: new Date() },
    });
    if (result.count === 0) {
      const current = await this.prisma.discoveryTerm.findUnique({ where: { id }, select: { id: true, status: true } });
      if (!current) throw new NotFoundException('Termo não encontrado.');
      throw new ConflictException(`O termo está em "${current.status}" e não pode ir para "${to}".`);
    }
    return { id, status: to };
  }
}
```

Se o `tsc` reclamar do tipo de `where` no `findMany`, tipe como `Prisma.DiscoveryTermWhereInput` (importe `Prisma` de `@prisma/client`), sem mudar a lógica.

`discovery-terms.controller.ts`:

```ts
import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { DiscoveryTermsService } from './discovery-terms.service';
import { DiscoveryTermsQueryDto } from './dto/discovery-terms.dto';

type AuthedRequest = { user: { sub: string } };

@Controller('discovery')
@UseGuards(AdminGuard)
export class DiscoveryTermsController {
  constructor(private readonly terms: DiscoveryTermsService) {}

  @Get('terms')
  list(@Query() query: DiscoveryTermsQueryDto) {
    return this.terms.list(query);
  }

  @Get('terms/counts')
  counts() {
    return this.terms.counts();
  }

  @Post('terms/:id/approve')
  approve(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.terms.approve(id, req.user.sub);
  }

  @Post('terms/:id/ignore')
  ignore(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.terms.ignore(id, req.user.sub);
  }

  @Post('terms/:id/restore')
  restore(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.terms.restore(id, req.user.sub);
  }
}
```

Antes de gravar, confira se as rotas `GET /discovery/terms*` não colidem com o controller do `src/modules/discovery/`. Ele usa `@Controller()` com `dashboard/quote`, então não há colisão.

`discovery-terms.scheduler.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DiscoveryTermsService } from './discovery-terms.service';

/** Spec §5.2: atualiza a lista de termos em alta todo dia. Só banco, idempotente: sempre ligado. */
@Injectable()
export class DiscoveryTermsScheduler {
  private readonly logger = new Logger(DiscoveryTermsScheduler.name);

  constructor(private readonly terms: DiscoveryTermsService) {}

  @Cron(process.env.DISCOVERY_TERMS_CRON || '0 6 * * *', { name: 'discovery-terms-refresh', timeZone: 'America/Sao_Paulo' })
  async tick() {
    try {
      const summary = await this.terms.refresh();
      this.logger.log(`Termos em alta: ${summary.created} novos, ${summary.updated} atualizados`);
    } catch (error) {
      this.logger.warn(`Atualização dos termos em alta falhou: ${error instanceof Error ? error.message : error}`);
    }
  }
}
```

`radar-discovery.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DiscoveryTermsController } from './discovery-terms.controller';
import { DiscoveryTermsScheduler } from './discovery-terms.scheduler';
import { DiscoveryTermsService } from './discovery-terms.service';

@Module({
  controllers: [DiscoveryTermsController],
  providers: [DiscoveryTermsService, DiscoveryTermsScheduler],
  exports: [DiscoveryTermsService],
})
export class RadarDiscoveryModule {}
```

Em `src/app.module.ts`, importe `RadarDiscoveryModule` e coloque-o na lista `imports`, logo depois de `DiscoveryModule`. O `PrismaService` vem do `DatabaseModule` global. Se ele não for global, importe o `DatabaseModule` no `RadarDiscoveryModule` do mesmo jeito que o `CatalogModule` faz.

`scripts/discovery-refresh.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DiscoveryTermsService } from '../src/modules/radar-discovery/discovery-terms.service';

/** Subprojeto D: atualiza a lista de termos em alta. `--dry-run` só mostra o que entraria. */
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const summary = await app.get(DiscoveryTermsService).refresh({ dryRun });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

No `package.json`, depois de `scores:resimulate`:

```json
    "discovery:refresh": "node --env-file-if-exists=.env -r ts-node/register -r tsconfig-paths/register scripts/discovery-refresh.ts",
```

- [x] **Passo 4: rodar e ver passar**

Run: `cd Move-Intelligence-Back && npx jest src/modules/radar-discovery && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [x] **Passo 5: rodar na base local** (só banco, não é parada)

```bash
cd Move-Intelligence-Back && INCLUDE_SYNTHETIC_DATA=true npm run discovery:refresh -- --dry-run
cd Move-Intelligence-Back && INCLUDE_SYNTHETIC_DATA=true npm run discovery:refresh
docker exec move-postgres psql -U move -d move_intelligence -At -c "select geo, count(*) from discovery_terms group by 1 order by 1;" -c "select count(*) from discovery_terms where term_norm in ('coffee grinder','solar panels','hotel booking','goblet squat');"
```
Expected: cerca de 200 US e 36 BR (a spec mediu 201 e 36 antes do conserto dos acentos). A segunda consulta dá `0`. Registre os números e as 15 amostras.

---

**Registro Tarefa 5:**
- Red: Jest executou o teste puro da Tarefa 4 e falhou nos dois specs novos porque serviço/controller ainda não existiam (falha prevista).
- Green: `npx jest src/modules/radar-discovery && npx tsc --noEmit -p tsconfig.json` → **3 suítes, 16 testes passaram**; typecheck passou.
- `discovery:refresh --dry-run` e apply: `snapshots=173`, `candidates=238`, `created=238`, `updated=0`; US **201**, BR **37**. SQL confirmou US 201, BR 37 e **0** ocorrências entre `coffee grinder`, `solar panels`, `hotel booking`, `goblet squat`.
- 15 amostras: `gaiam yoga wheel`, `adidas yoga mat`, `lenovo yoga pen`, `yoga mat with strap`, `tapete de yoga farm`, `tapete de yoga daiso`, `nike mastery yoga mat`, `yune yoga mat`, `hugger mugger cork yoga block`, `manduka cork yoga block`, `manduka yoga block`, `harbinger red line wrist wraps`, `leather wrist wraps`, `villain wrist wraps`, `neo g wrist support`.
- `git diff --stat`: arquivos rastreados (`app.module.ts`, `package.json`) → **2 arquivos, 4 inserções**; novos arquivos via `git diff --no-index --stat`: DTO 17, service 146, controller 37, scheduler 21, module 11, specs 127 e 16, script 20 linhas.

### Tarefa 6: Busca dos termos aprovados (Nest + gancho na coleta semanal)

**Arquivos:**
- Criar: `Move-Intelligence-Back/src/modules/radar-discovery/discovery-search.service.ts` (+ `.spec.ts`)
- Modificar: `Move-Intelligence-Back/src/modules/radar-discovery/radar-discovery.module.ts` (provider + export)
- Modificar: `Move-Intelligence-Back/src/modules/ingestion/dto/run-intelligence-collection.dto.ts` (`exactTerm`)
- Modificar: `Move-Intelligence-Back/src/modules/ingestion/intelligence-collection.service.ts` (`buildLiveArgs`, `runTermAndWait`, `COLLECTION_CATEGORIES`, `executeWeekly`, construtor)
- Modificar: `Move-Intelligence-Back/src/modules/ingestion/ingestion.module.ts` (importar `RadarDiscoveryModule`)
- Modificar: `Move-Intelligence-Back/src/modules/ingestion/intelligence-collection.service.spec.ts`
- Criar: `Move-Intelligence-Back/scripts/discovery-search.ts` e o script em `package.json`

**Interfaces:**
- Consome: `prisma.discoveryTerm` (Tarefa 3) e a flag Python `--exact-term` (Tarefa 2).
- Produz:
  - `DISCOVERY_SOURCES`, `RADAR_DISCOVERY_CATEGORY = 'radar_discovery'` e `radarDiscoveryConfig(env)`;
  - `DiscoverySearchService.runApproved(opts: { runTerm: RunTermFn; dryRun?: boolean; maxTerms?: number; env?: NodeJS.ProcessEnv }): Promise<RadarDiscoverySummary>`;
  - `IntelligenceCollectionService.runTermAndWait(dto: RunIntelligenceCollectionDto, category: string)`, que devolve o `collectionJob` já terminado.
  - A Tarefa 8 muda o construtor de novo. Nesta tarefa, a ordem fica `(prisma, fichas, products, discovery, cache?)`.

- [x] **Passo 1: testes que falham** — `discovery-search.service.spec.ts`:

```ts
import { PrismaService } from '../../shared/database/prisma.service';
import { DISCOVERY_SOURCES, DiscoverySearchService } from './discovery-search.service';

const ON = { RADAR_DISCOVERY_ENABLED: 'true', FICHA_ENABLED: 'true' } as NodeJS.ProcessEnv;

function build(rows: Array<{ id: string; term: string; geo: string }>) {
  const prisma = {
    discoveryTerm: {
      findMany: jest.fn().mockResolvedValue(rows),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  return { prisma, service: new DiscoverySearchService(prisma as unknown as PrismaService) };
}

describe('DiscoverySearchService', () => {
  it('desligado → skipped, sem chamar nada', async () => {
    const { prisma, service } = build([{ id: 't1', term: 'x', geo: 'US' }]);
    const runTerm = jest.fn();
    const out = await service.runApproved({ runTerm, env: { RADAR_DISCOVERY_ENABLED: 'true' } as NodeJS.ProcessEnv });
    expect(out.skipped).toBe('disabled');
    expect(runTerm).not.toHaveBeenCalled();
    expect(prisma.discoveryTerm.findMany).not.toHaveBeenCalled();
  });

  it('busca os aprovados mais antigos, um por vez, com as fontes do país e o termo literal', async () => {
    const { prisma, service } = build([
      { id: 't1', term: 'nike adjustable dumbbells', geo: 'US' },
      { id: 't2', term: 'reformer dobrável', geo: 'BR' },
    ]);
    const runTerm = jest.fn()
      .mockResolvedValueOnce({ id: 'job-1', status: 'SUCCESS', stats: { tracked_new: 14 }, errorMessage: null })
      .mockResolvedValueOnce({ id: 'job-2', status: 'PARTIAL', stats: {}, errorMessage: 'shopee falhou' });
    const out = await service.runApproved({ runTerm, env: ON });

    expect(prisma.discoveryTerm.findMany).toHaveBeenCalledWith({
      where: { status: 'approved' }, orderBy: [{ decidedAt: 'asc' }, { id: 'asc' }], take: 5,
    });
    expect(runTerm).toHaveBeenNthCalledWith(1, {
      term: 'nike adjustable dumbbells', sources: DISCOVERY_SOURCES.US, limit: 10, geos: ['US'],
      includeDemand: false, exactTerm: true, windowDays: 7,
    }, 'radar_discovery');
    expect(runTerm.mock.calls[1][0].sources).toEqual(['amazon_br', 'mercado_livre', 'shopee_br']);
    expect(prisma.discoveryTerm.update).toHaveBeenNthCalledWith(1, {
      where: { id: 't1' },
      data: expect.objectContaining({ status: 'searched', searchJobId: 'job-1', newListings: 14, searchError: null }),
    });
    expect(prisma.discoveryTerm.update.mock.calls[1][0].data).toEqual(expect.objectContaining({ status: 'searched', newListings: 0 }));
    expect(out).toMatchObject({ skipped: null, searched: 2, failed: 0 });
  });

  it('falha grava search_error, mantém approved e segue para o próximo', async () => {
    const { prisma, service } = build([
      { id: 't1', term: 'a', geo: 'US' },
      { id: 't2', term: 'b', geo: 'US' },
    ]);
    const runTerm = jest.fn()
      .mockResolvedValueOnce({ id: 'job-1', status: 'FAILED', stats: {}, errorMessage: 'Bright Data fora do ar' })
      .mockRejectedValueOnce(new Error('spawn python3 ENOENT'));
    const out = await service.runApproved({ runTerm, env: ON });
    const first = prisma.discoveryTerm.update.mock.calls[0][0];
    expect(first.data).toEqual({ searchError: 'Bright Data fora do ar', searchJobId: 'job-1' });
    expect(first.data).not.toHaveProperty('status');
    expect(prisma.discoveryTerm.update.mock.calls[1][0].data.searchError).toBe('spawn python3 ENOENT');
    expect(out).toMatchObject({ searched: 0, failed: 2 });
  });

  it('respeita o limite (env e parâmetro) e o dry-run só lista', async () => {
    const { prisma, service } = build([{ id: 't1', term: 'a', geo: 'BR' }]);
    const runTerm = jest.fn();
    const out = await service.runApproved({ runTerm, dryRun: true, maxTerms: 1, env: {} as NodeJS.ProcessEnv });
    expect(prisma.discoveryTerm.findMany.mock.calls[0][0].take).toBe(1);
    expect(runTerm).not.toHaveBeenCalled();
    expect(out.terms).toEqual([{ id: 't1', term: 'a', geo: 'BR', sources: ['amazon_br', 'mercado_livre', 'shopee_br'] }]);
    await service.runApproved({ runTerm: jest.fn(), env: { ...ON, RADAR_DISCOVERY_MAX_TERMS: '2' } });
    expect(prisma.discoveryTerm.findMany.mock.calls[1][0].take).toBe(2);
  });
});
```

Em `intelligence-collection.service.spec.ts`:
1. Em `buildService()`, acrescente `findUniqueOrThrow: jest.fn()` a `collectionJob` e crie `const discovery = { runApproved: jest.fn().mockResolvedValue({ skipped: 'disabled', searched: 0, failed: 0, terms: [] }) };`.
2. Passe `discovery as unknown as DiscoverySearchService` como **4º** argumento do construtor, importando `DiscoverySearchService` de `'../radar-discovery/discovery-search.service'`.
3. Devolva `discovery` no objeto de retorno.
4. Acrescente no fim do arquivo:

```ts
import { RunIntelligenceCollectionDto } from './dto/run-intelligence-collection.dto';
import { RunWeeklyIntelligenceCollectionDto } from './dto/run-weekly-intelligence-collection.dto';

describe('IntelligenceCollectionService — descoberta pelo radar (Subprojeto D)', () => {
  it('buildLiveArgs passa --exact-term só quando pedido', () => {
    const { service } = buildService();
    const dto = Object.assign(new RunIntelligenceCollectionDto(), {
      term: 'nike adjustable dumbbells', sources: ['amazon'], limit: 10, geos: ['US'], includeDemand: false,
    });
    expect((service as any).buildLiveArgs('main.py', dto)).not.toContain('--exact-term');
    const args = (service as any).buildLiveArgs('main.py', { ...dto, exactTerm: true });
    expect(args).toEqual(expect.arrayContaining(['--term', 'nike adjustable dumbbells', '--skip-demand', '--exact-term']));
  });

  it('runTermAndWait cria o job com a categoria, espera o execute e devolve o job final', async () => {
    const { service, prisma } = buildService();
    prisma.collectionJob.create.mockResolvedValue({ id: 'job-1' });
    prisma.collectionJob.findUniqueOrThrow.mockResolvedValue({ id: 'job-1', status: 'SUCCESS', stats: { tracked_new: 3 }, errorMessage: null });
    const execute = jest.spyOn(service as any, 'execute').mockResolvedValue(undefined);
    const dto = Object.assign(new RunIntelligenceCollectionDto(), { term: 'x', sources: ['amazon'], limit: 10, geos: ['US'], includeDemand: false, exactTerm: true });
    const job = await service.runTermAndWait(dto, 'radar_discovery');
    expect(prisma.collectionJob.create.mock.calls[0][0].data).toEqual(expect.objectContaining({ category: 'radar_discovery', queryTerm: 'x' }));
    expect(execute).toHaveBeenCalledWith('job-1', dto);
    expect(job).toEqual(expect.objectContaining({ id: 'job-1', stats: { tracked_new: 3 } }));
  });

  it('coleta semanal roda a descoberta antes e não cai se ela falhar', async () => {
    const { service, prisma, discovery } = buildService();
    discovery.runApproved.mockRejectedValue(new Error('boom'));
    const order: string[] = [];
    discovery.runApproved.mockImplementation(async () => { order.push('discovery'); throw new Error('boom'); });
    jest.spyOn(service as any, 'runPythonWeekly').mockImplementation(async () => {
      order.push('weekly');
      return { term: '', cluster: '', products: 0, demand_signals: 0, product_demand_links: 0, product_ids: [], failures: [] };
    });
    jest.spyOn(service as any, 'syncAnalyticalModels').mockResolvedValue(0);
    jest.spyOn(service as any, 'scheduleRankingSimulation').mockImplementation(() => undefined);
    await (service as any).executeWeekly('job-w', new RunWeeklyIntelligenceCollectionDto());
    expect(order).toEqual(['discovery', 'weekly']);
    const finalUpdate = prisma.collectionJob.update.mock.calls.at(-1)![0];
    expect(finalUpdate.data.status).toBe('SUCCESS');
    expect(finalUpdate.data.stats).toEqual(expect.objectContaining({ radar_discovery: { error: 'boom' } }));
  });
});
```

(Se os imports acima já existirem no topo do arquivo, não os repita.)

- [x] **Passo 2: rodar e ver falhar**

Run: `cd Move-Intelligence-Back && npx jest src/modules/radar-discovery/discovery-search.service.spec.ts src/modules/ingestion/intelligence-collection.service.spec.ts`
Expected: FAIL.

- [x] **Passo 3: implementar**

`discovery-search.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';

/** Spec D-D3: termo BR → marketplaces BR; termo US → Amazon US + fornecedores. */
export const DISCOVERY_SOURCES: Record<string, string[]> = {
  BR: ['amazon_br', 'mercado_livre', 'shopee_br'],
  US: ['amazon', 'alibaba', 'aliexpress', '1688'],
};
export const RADAR_DISCOVERY_CATEGORY = 'radar_discovery';

export interface DiscoveryTermRunRequest {
  term: string;
  sources: string[];
  limit: number;
  geos: string[];
  includeDemand: false;
  exactTerm: true;
  windowDays: number;
}
export interface FinishedJob { id: string; status: string; stats: unknown; errorMessage: string | null }
export type RunTermFn = (request: DiscoveryTermRunRequest, category: string) => Promise<FinishedJob>;
export interface RadarDiscoverySummary {
  skipped: 'disabled' | null;
  dry_run: boolean;
  searched: number;
  failed: number;
  terms: Array<{ id: string; term: string; geo: string; sources: string[] }>;
}

function intEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function radarDiscoveryConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    enabled: env.RADAR_DISCOVERY_ENABLED === 'true' && env.FICHA_ENABLED === 'true',
    maxTerms: intEnv(env.RADAR_DISCOVERY_MAX_TERMS, 5, 1, 50),
    limitPerSource: intEnv(env.RADAR_DISCOVERY_LIMIT_PER_SOURCE, 10, 1, 10),
  };
}

@Injectable()
export class DiscoverySearchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Spec §6: busca os termos aprovados, um por vez. `runTerm` vem de fora
   * (IntelligenceCollectionService.runTermAndWait) para não criar dependência circular.
   */
  async runApproved(opts: { runTerm: RunTermFn; dryRun?: boolean; maxTerms?: number; env?: NodeJS.ProcessEnv }): Promise<RadarDiscoverySummary> {
    const cfg = radarDiscoveryConfig(opts.env ?? process.env);
    const dryRun = opts.dryRun === true;
    if (!dryRun && !cfg.enabled) return { skipped: 'disabled', dry_run: false, searched: 0, failed: 0, terms: [] };

    const rows = await this.prisma.discoveryTerm.findMany({
      where: { status: 'approved' },
      orderBy: [{ decidedAt: 'asc' }, { id: 'asc' }],
      take: opts.maxTerms ?? cfg.maxTerms,
    });
    const terms = rows.map((row) => ({ id: row.id, term: row.term, geo: row.geo, sources: DISCOVERY_SOURCES[row.geo] ?? [] }));
    if (dryRun) return { skipped: null, dry_run: true, searched: 0, failed: 0, terms };

    let searched = 0;
    let failed = 0;
    for (const item of terms) {
      let jobId: string | null = null;
      try {
        if (item.sources.length === 0) throw new Error(`País sem fontes configuradas: ${item.geo}`);
        const job = await opts.runTerm({
          term: item.term,
          sources: item.sources,
          limit: cfg.limitPerSource,
          geos: [item.geo],
          includeDemand: false,
          exactTerm: true,
          windowDays: 7,
        }, RADAR_DISCOVERY_CATEGORY);
        jobId = job.id;
        if (job.status === 'FAILED') throw new Error(job.errorMessage ?? 'Busca falhou');
        const stats = (job.stats ?? {}) as Record<string, unknown>;
        await this.prisma.discoveryTerm.update({
          where: { id: item.id },
          data: {
            status: 'searched',
            searchedAt: new Date(),
            searchJobId: job.id,
            newListings: Number(stats['tracked_new'] ?? 0) || 0,
            searchError: null,
          },
        });
        searched += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.prisma.discoveryTerm.update({
          where: { id: item.id },
          data: jobId ? { searchError: message.slice(0, 500), searchJobId: jobId } : { searchError: message.slice(0, 500) },
        });
        failed += 1;
      }
    }
    return { skipped: null, dry_run: false, searched, failed, terms };
  }
}
```

Observação para o teste de falha com exceção: como o `runTerm` rejeitou, `jobId` fica `null`, e o `data` do segundo `update` é `{ searchError: 'spawn python3 ENOENT' }`.

Em `radar-discovery.module.ts`, acrescente `DiscoverySearchService` em `providers` e em `exports`.

Em `run-intelligence-collection.dto.ts`, depois de `includeDemand`:

```ts
  /** Subprojeto D: busca o termo literal em todas as fontes (--exact-term). */
  @IsOptional()
  @IsBoolean()
  exactTerm?: boolean;
```

Em `intelligence-collection.service.ts`:
1. Importe `DiscoverySearchService` de `'../radar-discovery/discovery-search.service'`. Acrescente-o ao construtor **antes** de `cache`: `private readonly discovery: DiscoverySearchService,`.
2. Acrescente `'radar_discovery'` a `COLLECTION_CATEGORIES`.
3. Extraia a montagem dos argumentos de `runPython` para um método e use-o dentro de `runPython` (`const args = this.buildLiveArgs(mainFile, dto);`):

```ts
  private buildLiveArgs(mainFile: string, dto: RunIntelligenceCollectionDto): string[] {
    const args = [
      mainFile,
      '--pipeline',
      'live-intelligence',
      '--term',
      dto.term.trim(),
      '--sources',
      dto.sources.join(','),
      '--limit',
      String(dto.limit),
      '--geos',
      (dto.geos ?? ['BR']).join(','),
      '--window-days',
      String(dto.windowDays),
    ];
    if (dto.includeDemand === false) args.push('--skip-demand');
    if (dto.exactTerm === true) args.push('--exact-term');
    return args;
  }
```

4. Método público novo, logo depois de `start()`:

```ts
  /** Subprojeto D: coleta de um termo com categoria própria, esperando terminar (busca do radar). */
  async runTermAndWait(dto: RunIntelligenceCollectionDto, category: string) {
    const job = await this.prisma.collectionJob.create({
      data: {
        source: dto.sources.join(','),
        queryTerm: dto.term.trim(),
        category,
        status: CollectionStatus.QUEUED,
        requestedBy: 'radar-discovery',
        stats: this.toJson({
          sources: dto.sources,
          limit: dto.limit,
          geos: dto.geos ?? ['BR'],
          include_demand: dto.includeDemand === true,
          exact_term: dto.exactTerm === true,
          window_days: dto.windowDays,
        }),
      },
    });
    await this.execute(job.id, dto);
    return this.prisma.collectionJob.findUniqueOrThrow({ where: { id: job.id } });
  }
```

5. Em `executeWeekly`, logo depois do `update` que marca `RUNNING` e **antes** do `try` que chama `runPythonWeekly`:

```ts
    // Subprojeto D: termos aprovados do radar antes da rotação normal. Falha aqui não derruba a semanal.
    let radarDiscovery: unknown;
    try {
      radarDiscovery = await this.discovery.runApproved({
        runTerm: (request, category) =>
          this.runTermAndWait(request as unknown as RunIntelligenceCollectionDto, category),
      });
    } catch (error) {
      radarDiscovery = { error: error instanceof Error ? error.message : String(error) };
    }
```

No `update` final de sucesso de `executeWeekly`, troque `stats: this.toJson({ ...summary, analytical_snapshots: analyticalSnapshots })` por `stats: this.toJson({ ...summary, analytical_snapshots: analyticalSnapshots, radar_discovery: radarDiscovery })`.

Em `ingestion.module.ts`, acrescente `RadarDiscoveryModule` em `imports`.

`scripts/discovery-search.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { RunIntelligenceCollectionDto } from '../src/modules/ingestion/dto/run-intelligence-collection.dto';
import { IntelligenceCollectionService } from '../src/modules/ingestion/intelligence-collection.service';
import { DiscoverySearchService } from '../src/modules/radar-discovery/discovery-search.service';

/**
 * Subprojeto D: busca os termos aprovados agora (mesmo caminho da coleta semanal).
 * --dry-run lista; --apply busca (chama a Bright Data: só com o ok do usuário). --max-terms N limita.
 */
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const apply = process.argv.includes('--apply');
  if (dryRun === apply) throw new Error('Use exatamente um: --dry-run ou --apply');
  const index = process.argv.indexOf('--max-terms');
  const maxTerms = index >= 0 ? Number.parseInt(process.argv[index + 1] ?? '', 10) : undefined;
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const intelligence = app.get(IntelligenceCollectionService);
    const summary = await app.get(DiscoverySearchService).runApproved({
      dryRun,
      maxTerms: Number.isFinite(maxTerms) ? maxTerms : undefined,
      runTerm: (request, category) =>
        intelligence.runTermAndWait(request as unknown as RunIntelligenceCollectionDto, category),
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

No `package.json`:

```json
    "discovery:search": "node --env-file-if-exists=.env -r ts-node/register -r tsconfig-paths/register scripts/discovery-search.ts",
```

- [x] **Passo 4: rodar e ver passar**

Run: `cd Move-Intelligence-Back && npx jest src/modules/radar-discovery src/modules/ingestion && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

---

**Registro Tarefa 6:**
- Red: os dois specs falharam como esperado pela ausência de `DiscoverySearchService` e `runTermAndWait`.
- Green: `npx jest src/modules/radar-discovery src/modules/ingestion && npx tsc --noEmit -p tsconfig.json` → **5 suítes, 30 testes passaram**; typecheck passou. Testes usam mocks; nenhuma chamada Bright Data/LLM.
- `git diff --stat`: 5 arquivos rastreados → **120 inserções, 20 remoções** (inclui os scripts de discovery já adicionados nas tarefas 5 e 6); novos arquivos via `git diff --no-index --stat`: serviço de busca 104, spec 78, script 35, módulo 12 linhas.

### Tarefa 7: Regra dos níveis (função pura)

**Arquivos:**
- Criar: `Move-Intelligence-Back/src/modules/ingestion/tracking-tiers.ts`
- Teste: `Move-Intelligence-Back/src/modules/ingestion/tracking-tiers.spec.ts`

**Interfaces:**
- Produz:
  - `TRACK_CADENCE_DAYS: Record<1 | 2 | 3, number>`, `TierReason`, `TierListing`, `TierConfig`, `TierInput` e `TierAssignment`;
  - `trackingTierConfig(env?: NodeJS.ProcessEnv): TierConfig & { radarMinGrowth: number; discoveryWindowDays: number }`;
  - `rankCards(scores: Map<string, number | null>): string[]`;
  - `assignTiers(input: TierInput): TierAssignment[]`.

- [x] **Passo 1: teste que falha** — `tracking-tiers.spec.ts`:

```ts
import { assignTiers, rankCards, TierListing, trackingTierConfig, TRACK_CADENCE_DAYS } from './tracking-tiers';

const L = (id: string, cardId: string | null, reviews: number | null = null, extra: Partial<TierListing> = {}): TierListing => ({
  id, cardId, reviews, nativeId: id, firstSeenAt: new Date('2026-09-01T00:00:00Z'), fromDiscovery: false, ...extra,
});
const byId = (out: ReturnType<typeof assignTiers>) => Object.fromEntries(out.map((a) => [a.id, `${a.tier}:${a.reason}`]));

describe('assignTiers', () => {
  it('nível 1 em rodízio pelos top cards, com vagas; sobra do top vai para o nível 2', () => {
    const listings = [L('a1', 'A', 10), L('a2', 'A', 50), L('a3', 'A', 5), L('b1', 'B', 1), L('b2', 'B', 2), L('c1', 'C', 99)];
    const out = assignTiers({
      listings,
      cardScores: new Map([['A', 90], ['B', 80], ['C', 70]]),
      watchlist: [],
      hotCards: new Map(),
      config: { topCards: 2, tier1Slots: 3, tier2Slots: 3 },
    });
    expect(byId(out)).toEqual({
      a2: '1:top50', b2: '1:top50', a1: '1:top50',
      a3: '2:top50', b1: '2:top50',
      c1: '3:demais',
    });
  });

  it('watchlist entra primeiro no rodízio do nível 1', () => {
    const out = assignTiers({
      listings: [L('a1', 'A', 1), L('b1', 'B', 1), L('w1', 'W', 1)],
      cardScores: new Map([['A', 90], ['B', 80], ['W', 10]]),
      watchlist: ['W'],
      hotCards: new Map(),
      config: { topCards: 1, tier1Slots: 2, tier2Slots: 0 },
    });
    expect(byId(out)).toEqual({ w1: '1:watchlist', a1: '1:top50', b1: '3:demais' });
  });

  it('nível 2: descoberta (mais nova primeiro), depois radar (maior alta primeiro), depois sobra do top', () => {
    const out = assignTiers({
      listings: [
        L('a1', 'A', 5), L('a2', 'A', 1),
        L('d0', null, null, { fromDiscovery: true, firstSeenAt: new Date('2026-09-10T00:00:00Z') }),
        L('d1', null, null, { fromDiscovery: true, firstSeenAt: new Date('2026-09-20T00:00:00Z') }),
        L('g1', 'G', 1), L('h1', 'H', 2), L('h2', 'H', 1),
      ],
      cardScores: new Map([['A', 90], ['G', 10], ['H', 20]]),
      watchlist: [],
      hotCards: new Map([['H', 0.5], ['G', 0.9]]),
      config: { topCards: 1, tier1Slots: 1, tier2Slots: 4 },
    });
    expect(byId(out)).toEqual({
      a1: '1:top50',
      d1: '2:descoberta', d0: '2:descoberta', g1: '2:radar', h1: '2:radar',
      a2: '3:demais', h2: '3:demais',
    });
  });

  it('cada anúncio aparece uma vez; card sem score fica por último', () => {
    const listings = [L('x', 'X'), L('y', 'Y'), L('z', 'Z')];
    const out = assignTiers({
      listings,
      cardScores: new Map([['X', null], ['Y', 50], ['Z', 60]]),
      watchlist: [],
      hotCards: new Map([['Y', 0.3]]),
      config: { topCards: 3, tier1Slots: 2, tier2Slots: 5 },
    });
    expect(out).toHaveLength(3);
    expect(new Set(out.map((a) => a.id)).size).toBe(3);
    expect(byId(out)).toEqual({ z: '1:top50', y: '1:top50', x: '2:top50' });
    expect(rankCards(new Map([['X', null], ['Y', 50], ['Z', 60], ['A', 60]]))).toEqual(['A', 'Z', 'Y', 'X']);
  });

  it('config padrão e cadência', () => {
    expect(trackingTierConfig({} as NodeJS.ProcessEnv)).toEqual({
      topCards: 50, tier1Slots: 80, tier2Slots: 100, radarMinGrowth: 0.2, discoveryWindowDays: 30,
    });
    expect(trackingTierConfig({ TRACK_TIER1_SLOTS: '10', TRACK_RADAR_MIN_GROWTH: '0.5' } as NodeJS.ProcessEnv))
      .toEqual(expect.objectContaining({ tier1Slots: 10, radarMinGrowth: 0.5 }));
    expect(TRACK_CADENCE_DAYS).toEqual({ 1: 3.5, 2: 7, 3: 30 });
  });
});
```

- [x] **Passo 2: rodar e ver falhar**

Run: `cd Move-Intelligence-Back && npx jest src/modules/ingestion/tracking-tiers.spec.ts`
Expected: FAIL (módulo não existe).

- [x] **Passo 3: implementar** — `tracking-tiers.ts`:

```ts
/** Subprojeto D (spec §7.1): níveis de acompanhamento com vagas. Função pura. */

/** Espelho de TIER_CADENCE_DAYS em Move-Intelligence-Dados/app/pipelines/run_track_listings.py. */
export const TRACK_CADENCE_DAYS: Record<1 | 2 | 3, number> = { 1: 3.5, 2: 7, 3: 30 };

export type TierReason = 'watchlist' | 'top50' | 'descoberta' | 'radar' | 'demais';
export interface TierListing {
  id: string;
  cardId: string | null;
  reviews: number | null;
  nativeId: string;
  firstSeenAt: Date;
  fromDiscovery: boolean;
}
export interface TierConfig { topCards: number; tier1Slots: number; tier2Slots: number }
export interface TierInput {
  listings: TierListing[];
  /** Último score de cada card (nulo = sem score). */
  cardScores: Map<string, number | null>;
  watchlist: string[];
  /** Card → maior growth_12w (só os que passaram do limite). */
  hotCards: Map<string, number>;
  config: TierConfig;
}
export interface TierAssignment { id: string; tier: 1 | 2 | 3; reason: TierReason }

function intEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function trackingTierConfig(env: NodeJS.ProcessEnv = process.env) {
  const growth = Number.parseFloat(env.TRACK_RADAR_MIN_GROWTH ?? '');
  return {
    topCards: intEnv(env.TRACK_TOP_CARDS, 50),
    tier1Slots: intEnv(env.TRACK_TIER1_SLOTS, 80),
    tier2Slots: intEnv(env.TRACK_TIER2_SLOTS, 100),
    radarMinGrowth: Number.isFinite(growth) ? growth : 0.2,
    discoveryWindowDays: intEnv(env.TRACK_DISCOVERY_WINDOW_DAYS, 30),
  };
}

/** Maior score primeiro; nulo por último; empate pelo id (mesma ordem do promoteTiers antigo). */
export function rankCards(scores: Map<string, number | null>): string[] {
  return [...scores.entries()]
    .sort(([idA, a], [idB, b]) => {
      if (a === null && b === null) return idA.localeCompare(idB);
      if (a === null) return 1;
      if (b === null) return -1;
      if (b !== a) return b - a;
      return idA.localeCompare(idB);
    })
    .map(([id]) => id);
}

function groupByCard(listings: TierListing[]): Map<string, TierListing[]> {
  const groups = new Map<string, TierListing[]>();
  for (const listing of listings) {
    if (!listing.cardId) continue;
    const list = groups.get(listing.cardId) ?? [];
    list.push(listing);
    groups.set(listing.cardId, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => {
      if (a.reviews === null && b.reviews !== null) return 1;
      if (b.reviews === null && a.reviews !== null) return -1;
      if (a.reviews !== null && b.reviews !== null && b.reviews !== a.reviews) return b.reviews - a.reviews;
      return a.nativeId.localeCompare(b.nativeId);
    });
  }
  return groups;
}

/** Um anúncio de cada card por volta, na ordem dos cards, até acabar a vaga. */
function roundRobin(order: string[], groups: Map<string, TierListing[]>, taken: Set<string>, slots: number): TierListing[] {
  const queues = order.map((id) => (groups.get(id) ?? []).filter((l) => !taken.has(l.id)));
  const out: TierListing[] = [];
  let progressed = true;
  while (out.length < slots && progressed) {
    progressed = false;
    for (const queue of queues) {
      if (out.length >= slots) break;
      const next = queue.shift();
      if (!next) continue;
      out.push(next);
      taken.add(next.id);
      progressed = true;
    }
  }
  return out;
}

export function assignTiers(input: TierInput): TierAssignment[] {
  const { config } = input;
  const groups = groupByCard(input.listings);
  const watch = [...new Set(input.watchlist)];
  const watchSet = new Set(watch);
  const ranked = rankCards(input.cardScores).filter((id) => !watchSet.has(id)).slice(0, config.topCards);
  const topOrder = [...watch, ...ranked];
  const taken = new Set<string>();
  const result = new Map<string, TierAssignment>();

  for (const l of roundRobin(topOrder, groups, taken, config.tier1Slots)) {
    result.set(l.id, { id: l.id, tier: 1, reason: watchSet.has(l.cardId as string) ? 'watchlist' : 'top50' });
  }

  let room = config.tier2Slots;
  const discovery = input.listings
    .filter((l) => l.fromDiscovery && !taken.has(l.id))
    .sort((a, b) => b.firstSeenAt.getTime() - a.firstSeenAt.getTime() || a.id.localeCompare(b.id))
    .slice(0, room);
  for (const l of discovery) {
    taken.add(l.id);
    result.set(l.id, { id: l.id, tier: 2, reason: 'descoberta' });
  }
  room -= discovery.length;

  const hotOrder = [...input.hotCards.entries()].sort(([a, ga], [b, gb]) => gb - ga || a.localeCompare(b)).map(([id]) => id);
  const radar = roundRobin(hotOrder, groups, taken, room);
  for (const l of radar) result.set(l.id, { id: l.id, tier: 2, reason: 'radar' });
  room -= radar.length;

  for (const l of roundRobin(topOrder, groups, taken, room)) result.set(l.id, { id: l.id, tier: 2, reason: 'top50' });

  return input.listings.map((l) => result.get(l.id) ?? { id: l.id, tier: 3, reason: 'demais' });
}
```

- [x] **Passo 4: rodar e ver passar**

Run: `cd Move-Intelligence-Back && npx jest src/modules/ingestion/tracking-tiers.spec.ts`
Expected: PASS.

---

**Registro Tarefa 7:**
- Red: Jest falhou como previsto porque `tracking-tiers.ts` ainda não existia.
- Green: `npx jest src/modules/ingestion/tracking-tiers.spec.ts` → **1 suíte, 5 testes passaram**.
- `git diff --stat`: os dois arquivos novos não rastreados via `git diff --no-index --stat`: função pura **129 linhas**, testes **79 linhas**.

### Tarefa 8: Recálculo dos níveis (serviço) no lugar do `promoteTiers`

**Arquivos:**
- Criar: `Move-Intelligence-Back/src/modules/ingestion/tracking-tiers.service.ts` (+ `.spec.ts`)
- Modificar: `Move-Intelligence-Back/src/modules/ingestion/intelligence-collection.service.ts` (remover `promoteTiers`, `TIER_1_CUTOFF` e `TIER_2_CUTOFF`; usar o serviço)
- Modificar: `Move-Intelligence-Back/src/modules/ingestion/intelligence-collection.service.spec.ts` (remover os 2 testes de `promoteTiers`; construtor)
- Modificar: `Move-Intelligence-Back/src/modules/ingestion/ingestion.module.ts` (provider)
- Criar: `Move-Intelligence-Back/scripts/tracking-recalc.ts` e o script em `package.json`

**Interfaces:**
- Consome: `assignTiers`, `trackingTierConfig` e `TRACK_CADENCE_DAYS` (Tarefa 7); `normalizeTerm` (Tarefa 4); `COUNTED_ITEM_STATUSES` (`src/modules/catalog/catalog.constants.ts`).
- Produz:
  - `TrackingTiersService.recalculate(opts?: { dryRun?: boolean; now?: Date; env?: NodeJS.ProcessEnv }): Promise<TierRecalcSummary>`;
  - `TierRecalcSummary = { dry_run, tier1, tier2, tier3, by_reason, status_changes: { ignored, activated }, changed, estimated_weekly_calls }`;
  - construtor final do `IntelligenceCollectionService`: `(prisma, fichas, products, discovery, tiers, cache?)`.

- [x] **Passo 1: testes que falham** — `tracking-tiers.service.spec.ts`:

```ts
import { PrismaService } from '../../shared/database/prisma.service';
import { TrackingTiersService } from './tracking-tiers.service';

const now = new Date('2026-09-22T12:00:00.000Z');
const env = { TRACK_TOP_CARDS: '1', TRACK_TIER1_SLOTS: '1', TRACK_TIER2_SLOTS: '0' } as NodeJS.ProcessEnv;

function tracked(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, source: 'amazon', nativeId: id, productId: 'A', status: 'ACTIVE', tier: 2, tierReason: null,
    nextDueAt: new Date('2026-10-20T00:00:00.000Z'), lastSuccessAt: new Date('2026-09-20T00:00:00.000Z'),
    firstSeenAt: new Date('2026-08-01T00:00:00.000Z'), discoveredByTerm: null, ...extra,
  };
}

function build(rows: ReturnType<typeof tracked>[], opts: { fichas?: unknown[]; items?: unknown[] } = {}) {
  const prisma = {
    trackedListing: {
      findMany: jest.fn().mockResolvedValue(rows),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    listingFicha: { findMany: jest.fn().mockResolvedValue(opts.fichas ?? []) },
    productClusterItem: {
      findMany: jest.fn().mockResolvedValue(
        opts.items ?? rows.map((r) => ({ marketplace: r.source, externalProductId: r.nativeId, clusterId: r.productId, status: 'confirmed' })),
      ),
    },
    listingObservation: { findMany: jest.fn().mockResolvedValue([]) },
    productScore: { findMany: jest.fn().mockResolvedValue([{ productClusterId: 'A', score: 90, computedAt: now }]) },
    watchlistItem: { findMany: jest.fn().mockResolvedValue([]) },
    searchTrendSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
    productCluster: { findMany: jest.fn().mockResolvedValue([]) },
    discoveryTerm: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };
  return { prisma, service: new TrackingTiersService(prisma as unknown as PrismaService) };
}

describe('TrackingTiersService.recalculate', () => {
  it('status: fora do escopo e sem card com ficha pronta → IGNORED; candidato em card contado → ACTIVE', async () => {
    const rows = [
      tracked('t1'), tracked('t2'), tracked('t3', { status: 'CANDIDATE' }), tracked('t4'),
    ];
    const { prisma, service } = build(rows, {
      fichas: [
        { marketplace: 'amazon', externalProductId: 't1', status: 'done', inScope: false },
        { marketplace: 'amazon', externalProductId: 't2', status: 'done', inScope: true },
        { marketplace: 'amazon', externalProductId: 't4', status: 'pending', inScope: null },
      ],
      items: [
        { marketplace: 'amazon', externalProductId: 't1', clusterId: 'A', status: 'confirmed' },
        { marketplace: 'amazon', externalProductId: 't3', clusterId: 'A', status: 'auto' },
      ],
    });
    const out = await service.recalculate({ now, env });
    expect(out.status_changes).toEqual({ ignored: 2, activated: 1 });
    expect(prisma.trackedListing.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['t1', 't2'] } }, data: { status: 'IGNORED' } });
    expect(prisma.trackedListing.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['t3'] } }, data: { status: 'ACTIVE' } });
  });

  it('subiu de nível: adianta a próxima visita; desceu: mantém a data', async () => {
    const rows = [
      tracked('up', { tier: 3 }),
      tracked('down', { tier: 1, tierReason: 'top50', nextDueAt: new Date('2026-09-25T00:00:00.000Z') }),
    ];
    const { prisma, service } = build(rows);
    prisma.listingObservation.findMany.mockResolvedValue([{ listingId: 'up', reviewsCount: 10 }, { listingId: 'down', reviewsCount: 1 }]);
    await service.recalculate({ now, env });
    const calls = prisma.trackedListing.update.mock.calls.map(([a]) => a);
    const up = calls.find((c) => c.where.id === 'up');
    expect(up.data).toEqual(expect.objectContaining({ tier: 1, tierReason: 'top50', nextDueAt: new Date('2026-09-23T12:00:00.000Z') }));
    const down = calls.find((c) => c.where.id === 'down');
    expect(down.data).toEqual(expect.objectContaining({ tier: 3, tierReason: 'demais' }));
    expect(down.data).not.toHaveProperty('nextDueAt');
  });

  it('grava só o que mudou e calcula a estimativa semanal', async () => {
    const rows = [tracked('same', { tier: 1, tierReason: 'top50' }), tracked('other', { tier: 3, tierReason: 'demais' })];
    const { prisma, service } = build(rows);
    prisma.listingObservation.findMany.mockResolvedValue([{ listingId: 'same', reviewsCount: 99 }]);
    const out = await service.recalculate({ now, env });
    expect(prisma.trackedListing.update).not.toHaveBeenCalled();
    expect(out).toMatchObject({ dry_run: false, tier1: 1, tier2: 0, tier3: 1, changed: 0, by_reason: { top50: 1, demais: 1 } });
    // 7/3.5 + 7/30 = 2.23 → arredonda para 2
    expect(out.estimated_weekly_calls).toBe(2);
  });

  it('dry-run não grava nada', async () => {
    const { prisma, service } = build([tracked('t1', { tier: 3 })], {
      fichas: [{ marketplace: 'amazon', externalProductId: 'x', status: 'done', inScope: false }],
    });
    const out = await service.recalculate({ dryRun: true, now, env });
    expect(out.dry_run).toBe(true);
    expect(prisma.trackedListing.update).not.toHaveBeenCalled();
    expect(prisma.trackedListing.updateMany).not.toHaveBeenCalled();
  });

  it('descoberta recente e card em alta no radar entram no nível 2', async () => {
    const rows = [
      tracked('a1', { tier: 3 }),
      tracked('d1', { tier: 3, productId: null, discoveredByTerm: 'Nike Adjustable Dumbbells', firstSeenAt: new Date('2026-09-15T00:00:00.000Z') }),
      tracked('h1', { tier: 3, productId: 'H' }),
    ];
    const { prisma, service } = build(rows, {
      items: [
        { marketplace: 'amazon', externalProductId: 'a1', clusterId: 'A', status: 'confirmed' },
        { marketplace: 'amazon', externalProductId: 'h1', clusterId: 'H', status: 'confirmed' },
      ],
    });
    prisma.discoveryTerm.findMany.mockResolvedValue([{ termNorm: 'nike adjustable dumbbells' }]);
    prisma.productCluster.findMany.mockResolvedValue([{ id: 'H', type: { key: 'kettlebell' } }, { id: 'A', type: { key: 'spin_bike' } }]);
    prisma.searchTrendSnapshot.findMany.mockResolvedValue([
      { typeKey: 'kettlebell', geo: 'BR', growth12w: 0.1 },
      { typeKey: 'kettlebell', geo: 'US', growth12w: 0.45 },
      { typeKey: 'spin_bike', geo: 'BR', growth12w: 0.19 },
    ]);
    const out = await service.recalculate({ now, env: { ...env, TRACK_TIER2_SLOTS: '5' } });
    expect(out.by_reason).toEqual({ top50: 1, descoberta: 1, radar: 1 });
  });
});
```

No `intelligence-collection.service.spec.ts`:
1. Apague os dois testes `promoteTiers: ...`, porque a regra agora é testada em `tracking-tiers*.spec.ts`.
2. Em `buildService()`, crie `const tiers = { recalculate: jest.fn().mockResolvedValue({ tier1: 0, tier2: 0, tier3: 0 }) };` e passe `tiers as unknown as TrackingTiersService` como **5º** argumento do construtor, depois de `discovery`. Importe `TrackingTiersService` de `'./tracking-tiers.service'`.
3. Devolva `tiers` no retorno.
4. Se algum teste de `executeTrackListings` verificava `stats.tiers`, ele passa a esperar o retorno do mock.

- [x] **Passo 2: rodar e ver falhar**

Run: `cd Move-Intelligence-Back && npx jest src/modules/ingestion`
Expected: FAIL (serviço não existe).

- [x] **Passo 3: implementar** — `tracking-tiers.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import { COUNTED_ITEM_STATUSES } from '../catalog/catalog.constants';
import { normalizeTerm } from '../radar-discovery/discovery-candidates';
import { assignTiers, TierListing, TierReason, trackingTierConfig, TRACK_CADENCE_DAYS } from './tracking-tiers';

export interface TierRecalcSummary {
  dry_run: boolean;
  tier1: number;
  tier2: number;
  tier3: number;
  by_reason: Partial<Record<TierReason, number>>;
  status_changes: { ignored: number; activated: number };
  changed: number;
  estimated_weekly_calls: number;
}

const DAY_MS = 86_400_000;
const WRITE_CHUNK = 100;

@Injectable()
export class TrackingTiersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Spec §7.2/§7.3: status → níveis com vagas → grava só o que mudou. */
  async recalculate(opts: { dryRun?: boolean; now?: Date; env?: NodeJS.ProcessEnv } = {}): Promise<TierRecalcSummary> {
    const dryRun = opts.dryRun === true;
    const now = opts.now ?? new Date();
    const cfg = trackingTierConfig(opts.env ?? process.env);

    const tracked = await this.prisma.trackedListing.findMany({
      where: { status: { in: ['ACTIVE', 'CANDIDATE'] } },
      select: {
        id: true, source: true, nativeId: true, productId: true, status: true, tier: true, tierReason: true,
        nextDueAt: true, lastSuccessAt: true, firstSeenAt: true, discoveredByTerm: true,
      },
    });
    // Volume atual (~600 anúncios): carregar fichas e itens inteiros é simples e barato.
    const [fichas, items] = await Promise.all([
      this.prisma.listingFicha.findMany({ select: { marketplace: true, externalProductId: true, status: true, inScope: true } }),
      this.prisma.productClusterItem.findMany({ select: { marketplace: true, externalProductId: true, clusterId: true, status: true } }),
    ]);
    const key = (m: string, e: string) => `${m}::${e}`;
    const fichaBy = new Map(fichas.map((f) => [key(f.marketplace, f.externalProductId), f]));
    const itemBy = new Map(items.map((i) => [key(i.marketplace, i.externalProductId), i]));

    const ignoredIds: string[] = [];
    const activatedIds: string[] = [];
    const alive: Array<{ row: (typeof tracked)[number]; cardId: string | null }> = [];
    for (const row of tracked) {
      const ficha = fichaBy.get(key(row.source, row.nativeId));
      const item = itemBy.get(key(row.source, row.nativeId));
      if (ficha?.inScope === false || (!item && ficha?.status === 'done')) {
        ignoredIds.push(row.id);
        continue;
      }
      if (row.status === 'CANDIDATE' && item && (COUNTED_ITEM_STATUSES as readonly string[]).includes(item.status)) {
        activatedIds.push(row.id);
      }
      alive.push({ row, cardId: item?.clusterId ?? row.productId ?? null });
    }

    const aliveIds = alive.map((a) => a.row.id);
    const cardIds = [...new Set(alive.map((a) => a.cardId).filter((id): id is string => !!id))];
    const [observations, scoreRows, watchRows, snapshots, clusters, searchedTerms] = await Promise.all([
      this.prisma.listingObservation.findMany({
        where: { listingId: { in: aliveIds } },
        orderBy: [{ listingId: 'asc' }, { observedAt: 'desc' }],
        distinct: ['listingId'],
        select: { listingId: true, reviewsCount: true },
      }),
      this.prisma.productScore.findMany({
        select: { productClusterId: true, score: true, computedAt: true },
        orderBy: [{ computedAt: 'desc' }],
      }),
      this.prisma.watchlistItem.findMany({ select: { productClusterId: true } }),
      this.prisma.searchTrendSnapshot.findMany({
        where: { status: 'ok' },
        orderBy: { capturedAt: 'desc' },
        distinct: ['typeKey', 'geo'],
        select: { typeKey: true, geo: true, growth12w: true },
      }),
      this.prisma.productCluster.findMany({ where: { id: { in: cardIds } }, select: { id: true, type: { select: { key: true } } } }),
      this.prisma.discoveryTerm.findMany({ where: { status: 'searched' }, select: { termNorm: true } }),
    ]);

    const reviewsBy = new Map(observations.map((o) => [o.listingId, o.reviewsCount ?? null]));
    const cardScores = new Map<string, number | null>();
    for (const row of scoreRows) if (!cardScores.has(row.productClusterId)) cardScores.set(row.productClusterId, row.score);
    const growthByType = new Map<string, number>();
    for (const s of snapshots) {
      if (s.growth12w === null || s.growth12w === undefined) continue;
      growthByType.set(s.typeKey, Math.max(growthByType.get(s.typeKey) ?? -Infinity, s.growth12w));
    }
    const hotCards = new Map<string, number>();
    for (const c of clusters) {
      const growth = c.type?.key ? growthByType.get(c.type.key) : undefined;
      if (growth !== undefined && growth >= cfg.radarMinGrowth) hotCards.set(c.id, growth);
    }
    const searched = new Set(searchedTerms.map((t) => t.termNorm));
    const windowStart = now.getTime() - cfg.discoveryWindowDays * DAY_MS;

    const listings: TierListing[] = alive.map(({ row, cardId }) => ({
      id: row.id,
      cardId,
      reviews: reviewsBy.get(row.id) ?? null,
      nativeId: row.nativeId,
      firstSeenAt: row.firstSeenAt,
      fromDiscovery: !!row.discoveredByTerm && searched.has(normalizeTerm(row.discoveredByTerm)) && row.firstSeenAt.getTime() >= windowStart,
    }));
    const assignments = assignTiers({
      listings,
      cardScores,
      watchlist: watchRows.map((w) => w.productClusterId),
      hotCards,
      config: { topCards: cfg.topCards, tier1Slots: cfg.tier1Slots, tier2Slots: cfg.tier2Slots },
    });

    const rowBy = new Map(alive.map((a) => [a.row.id, a.row]));
    const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
    const byReason: Partial<Record<TierReason, number>> = {};
    let weekly = 0;
    const counts = { 1: 0, 2: 0, 3: 0 };
    for (const a of assignments) {
      counts[a.tier] += 1;
      byReason[a.reason] = (byReason[a.reason] ?? 0) + 1;
      weekly += 7 / TRACK_CADENCE_DAYS[a.tier];
      const row = rowBy.get(a.id)!;
      if (row.tier === a.tier && row.tierReason === a.reason) continue;
      const data: Record<string, unknown> = { tier: a.tier, tierReason: a.reason, tierUpdatedAt: now };
      if (a.tier < row.tier) {
        const base = (row.lastSuccessAt ?? now).getTime();
        const candidate = new Date(base + TRACK_CADENCE_DAYS[a.tier] * DAY_MS);
        data['nextDueAt'] = candidate < row.nextDueAt ? candidate : row.nextDueAt;
      }
      updates.push({ id: a.id, data });
    }

    if (!dryRun) {
      if (ignoredIds.length) await this.prisma.trackedListing.updateMany({ where: { id: { in: ignoredIds } }, data: { status: 'IGNORED' } });
      if (activatedIds.length) await this.prisma.trackedListing.updateMany({ where: { id: { in: activatedIds } }, data: { status: 'ACTIVE' } });
      for (let i = 0; i < updates.length; i += WRITE_CHUNK) {
        await this.prisma.$transaction(
          updates.slice(i, i + WRITE_CHUNK).map((u) => this.prisma.trackedListing.update({ where: { id: u.id }, data: u.data })),
        );
      }
    }

    return {
      dry_run: dryRun,
      tier1: counts[1],
      tier2: counts[2],
      tier3: counts[3],
      by_reason: byReason,
      status_changes: { ignored: ignoredIds.length, activated: activatedIds.length },
      changed: updates.length,
      estimated_weekly_calls: Math.round(weekly),
    };
  }
}
```

Observação sobre o teste "subiu de nível": `lastSuccessAt` é 2026-09-20 00:00. Com 3,5 dias, a próxima visita fica 2026-09-23 12:00, antes da data de 2026-10-20, então vale a nova.

Em `intelligence-collection.service.ts`:
1. Importe `TrackingTiersService` de `'./tracking-tiers.service'` e acrescente `private readonly tiers: TrackingTiersService,` ao construtor, depois de `discovery` e antes de `cache`.
2. Em `executeTrackListings`, troque `const tiers = await this.promoteTiers();` por `const tiers = await this.tiers.recalculate();`.
3. Apague o método `promoteTiers`, as constantes `TIER_1_CUTOFF` e `TIER_2_CUTOFF` e o comentário delas. Não mexa em `TRACK_BATCH_LIMIT`.

Em `ingestion.module.ts`, acrescente `TrackingTiersService` em `providers`.

`scripts/tracking-recalc.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { TrackingTiersService } from '../src/modules/ingestion/tracking-tiers.service';

/** Subprojeto D: recalcula status e níveis de acompanhamento. --dry-run só mostra; --apply grava. */
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const apply = process.argv.includes('--apply');
  if (dryRun === apply) throw new Error('Use exatamente um: --dry-run ou --apply');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const summary = await app.get(TrackingTiersService).recalculate({ dryRun });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

No `package.json`:

```json
    "tracking:recalc": "node --env-file-if-exists=.env -r ts-node/register -r tsconfig-paths/register scripts/tracking-recalc.ts",
```

- [x] **Passo 4: rodar e ver passar**

Run: `cd Move-Intelligence-Back && npx jest src/modules/ingestion src/modules/radar-discovery && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [x] **Passo 5: rodar na base local** (só banco, não é parada)

```bash
cd Move-Intelligence-Back && INCLUDE_SYNTHETIC_DATA=true npm run tracking:recalc -- --dry-run
cd Move-Intelligence-Back && INCLUDE_SYNTHETIC_DATA=true npm run tracking:recalc -- --apply
docker exec move-postgres psql -U move -d move_intelligence -At -c "select status, tier, tier_reason, count(*) from tracked_listings group by 1,2,3 order by 1,2,3;"
```
Expected: nível 1 = 80, nível 2 = 100 e o resto no nível 3; `estimated_weekly_calls` ≤ 400; `status_changes` coerente com os dados. Hoje nenhum anúncio está sem card, então `ignored` deve ser baixo ou 0. Registre a saída.

**Registro Tarefa 8:**
- A primeira execução do Passo 4 havia parado em erro de compilação porque `spawnPython` foi removido junto com `promoteTiers`; foi restaurado pelo usuário. Não alterei `spawnPython` nem os testes.
- Passo 4 revalidado: `npx jest src/modules/ingestion src/modules/radar-discovery` → **7 suítes, 38 testes passaram**; `npx tsc --noEmit -p tsconfig.json` → **passou**.
- Dry-run: `tier1=80`, `tier2=100`, `tier3=429`; `by_reason={demais:429, top50:87, radar:93}`; `status_changes={ignored:0, activated:0}`; `changed=609`; `estimated_weekly_calls=360`.
- Apply: mesmos totais e estimativa. Consulta SQL: `ACTIVE|1|top50|80`, `ACTIVE|2|radar|93`, `ACTIVE|2|top50|7`, `ACTIVE|3|demais|429`.
- `git diff --stat` no recorte dos quatro arquivos rastreados da integração: **4 arquivos, 120 inserções, 174 remoções** (inclui mudanças anteriores nos mesmos arquivos); arquivos novos fora do stat: `tracking-recalc.ts` 22 linhas, `tracking-tiers.service.ts` 166, `tracking-tiers.service.spec.ts` 118.

---

### Tarefa 9: Coluna "Acompanhamento" na aba Anúncios

**Arquivos:**
- Modificar: `Move-Intelligence-Back/src/modules/catalog/catalog-review.service.ts` (`listCardListings`; `CardListingView` onde estiver definido)
- Modificar: `Move-Intelligence-Back/src/modules/catalog/catalog-review.service.spec.ts`
- Modificar: `Move-Intelligence-Front/src/app/core/models/contract.models.ts` (`CardListing.tracking`)
- Modificar: `Move-Intelligence-Front/src/app/shared/components/intel/card-listings-table/card-listings-table.component.{ts,html,css,spec.ts}`

**Interfaces:**
- Consome: `TRACK_CADENCE_DAYS` (Tarefa 7) e as colunas `tier_reason` e `last_success_at`.
- Produz: `listCardListings` devolve `tracking: { status: string; tier: number; reason: string | null; cadence_days: number | null; last_success_at: string | null } | null`. No front, chega como `tracking: { status, tier, reason, cadenceDays, lastSuccessAt } | null`.

- [x] **Passo 1: testes que falham**

Backend — no mock do `prisma` em `catalog-review.service.spec.ts`, acrescente `trackedListing: { findMany: jest.fn().mockResolvedValue([]) }`, se não existir. Acrescente o teste abaixo, adaptando os nomes de `build()`/`service`/`prisma` aos do arquivo e usando os mocks de item, ficha e snapshot que o arquivo já tem:

```ts
  it('listCardListings devolve o acompanhamento de cada anúncio', async () => {
    const { service, prisma } = build();
    prisma.productClusterItem.findMany.mockResolvedValue([
      { marketplace: 'amazon_br', externalProductId: 'A1', status: 'confirmed' },
      { marketplace: 'alibaba', externalProductId: 'B1', status: 'auto' },
    ]);
    prisma.listingFicha.findMany.mockResolvedValue([]);
    prisma.productListingSnapshot.findMany.mockResolvedValue([]);
    prisma.trackedListing.findMany.mockResolvedValue([
      { source: 'amazon_br', nativeId: 'A1', status: 'ACTIVE', tier: 1, tierReason: 'top50', lastSuccessAt: new Date('2026-09-20T00:00:00.000Z') },
    ]);
    const out = await service.listCardListings('c1');
    expect(out[0].tracking).toEqual({ status: 'ACTIVE', tier: 1, reason: 'top50', cadence_days: 3.5, last_success_at: '2026-09-20T00:00:00.000Z' });
    expect(out[1].tracking).toBeNull();
  });
```

Frontend — no fim de `card-listings-table.component.spec.ts`:

```ts
  it('mostra a coluna Acompanhamento', () => {
    const base = { url: null, currency: 'BRL', rating: null, status: 'confirmed', variation: null, brand: null };
    TestBed.configureTestingModule({
      imports: [CardListingsTableComponent],
      providers: [{ provide: CatalogService, useValue: { cardListings: () => of([
        { ...base, marketplace: 'amazon_br', externalProductId: 'A', title: 'Bike A', price: 100,
          tracking: { status: 'ACTIVE', tier: 1, reason: 'top50', cadenceDays: 3.5, lastSuccessAt: '2026-09-20T12:00:00.000Z' } },
        { ...base, marketplace: 'alibaba', externalProductId: 'B', title: 'Bike B', price: 90,
          tracking: { status: 'ACTIVE', tier: 3, reason: 'demais', cadenceDays: 30, lastSuccessAt: null } },
        { ...base, marketplace: 'shopee_br', externalProductId: 'C', title: 'Bike C', price: 80,
          tracking: { status: 'IGNORED', tier: 3, reason: 'demais', cadenceDays: 30, lastSuccessAt: null } },
        { ...base, marketplace: 'mercado_livre', externalProductId: 'D', title: 'Bike D', price: 70, tracking: null },
      ]) } }],
    });
    const fixture = TestBed.createComponent(CardListingsTableComponent);
    fixture.componentRef.setInput('productClusterId', 'c1');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const text = el.textContent ?? '';
    expect(text).toContain('Acompanhamento');
    expect(text).toContain('Nível 1 · a cada 3,5 dias');
    expect(text).toContain('última: 20/09');
    expect(text).toContain('Nível 3 · mensal');
    expect(text).toContain('Fora do acompanhamento');
    expect(el.querySelector('[title="Entre os 50 cards de maior score"]')).not.toBeNull();
  });
```

- [x] **Passo 2: rodar e ver falhar**

Run: `cd Move-Intelligence-Back && npx jest src/modules/catalog/catalog-review.service.spec.ts` e o `ng test` do frontend.
Expected: FAIL (`tracking` não existe).

- [x] **Passo 3: implementar**

Backend — em `listCardListings`, junto do `Promise.all` com as fichas e os snapshots, acrescente a consulta dos anúncios acompanhados:

```ts
      this.prisma.trackedListing.findMany({
        where: { OR: items.map((i) => ({ source: i.marketplace, nativeId: i.externalProductId })) },
        select: { source: true, nativeId: true, status: true, tier: true, tierReason: true, lastSuccessAt: true },
      }),
```

Com isso, a desestruturação vira `const [fichas, snapshots, trackedRows] = await Promise.all([...])`. Monte o mapa `const trackedBy = new Map(trackedRows.map((t) => [key(t.source, t.nativeId), t]));`. No objeto de cada anúncio, acrescente:

```ts
        tracking: (() => {
          const t = trackedBy.get(key(item.marketplace, item.externalProductId));
          if (!t) return null;
          return {
            status: t.status,
            tier: t.tier,
            reason: t.tierReason ?? null,
            cadence_days: TRACK_CADENCE_DAYS[t.tier as 1 | 2 | 3] ?? null,
            last_success_at: t.lastSuccessAt ? t.lastSuccessAt.toISOString() : null,
          };
        })(),
```

Importe `TRACK_CADENCE_DAYS` de `'../ingestion/tracking-tiers'` (import de arquivo puro, sem dependência de módulo). No tipo `CardListingView`, acrescente o campo `tracking` com o formato acima.

Frontend — em `contract.models.ts`:

```ts
export interface CardListingTracking {
  status: string;
  tier: number;
  reason: string | null;
  cadenceDays: number | null;
  lastSuccessAt: string | null;
}
```

E em `CardListing`: `tracking?: CardListingTracking | null;`.

Em `card-listings-table.component.ts`, acrescente os métodos:

```ts
  private static readonly REASONS: Record<string, string> = {
    watchlist: 'Card na watchlist',
    top50: 'Entre os 50 cards de maior score',
    descoberta: 'Veio da descoberta por termo em alta',
    radar: 'Tipo com buscas em alta no radar',
    demais: 'Demais anúncios',
  };

  tracking(l: CardListing): string {
    const t = l.tracking;
    if (!t) return '—';
    if (t.status === 'IGNORED') return 'Fora do acompanhamento';
    if (t.status === 'DEAD') return 'Anúncio encerrado';
    const freq = t.tier === 1 ? 'a cada 3,5 dias' : t.tier === 2 ? 'semanal' : 'mensal';
    return `Nível ${t.tier} · ${freq}`;
  }
  trackingReason(l: CardListing): string {
    const reason = l.tracking?.reason;
    return reason ? (CardListingsTableComponent.REASONS[reason] ?? reason) : '';
  }
  lastCollected(l: CardListing): string {
    const iso = l.tracking?.lastSuccessAt;
    if (!iso) return '';
    return `última: ${new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
  }
```

No template, acrescente `<th>Acompanhamento</th>` depois de `<th>Status</th>` e, na linha, depois da célula de status:

```html
            <td class="tracking">
              <span class="tier" [attr.data-tier]="l.tracking?.tier ?? null" [attr.title]="trackingReason(l) || null">{{ tracking(l) }}</span>
              @if (lastCollected(l)) { <small>{{ lastCollected(l) }}</small> }
            </td>
```

No CSS:

```css
.tracking { white-space: nowrap; }
.tracking small { display: block; color: var(--text-muted, #6b7280); font-size: 11px; }
.tier[data-tier="1"] { color: var(--success, #2f855a); font-weight: 600; }
```

- [x] **Passo 4: rodar e ver passar**

Run: backend `npx jest src/modules/catalog` + `npx tsc --noEmit -p tsconfig.json`; frontend `ng test`.
Expected: PASS.

**Registro Tarefa 9:**
- Red previsto: backend acusou `tracking` ausente em `CardListingView`; frontend acusou a ausência da coluna; os outros **53 testes frontend passaram**.
- Green backend: `npx jest src/modules/catalog` → **13 suítes, 109 testes passaram**; `npx tsc --noEmit -p tsconfig.json` → **passou**.
- Green frontend: `NODE_OPTIONS=--localstorage-file=/private/tmp/move-front-vitest-localstorage npx ng test --watch=false` → **14 arquivos, 54 testes passaram**.
- `git diff --stat` no recorte dos 7 arquivos: **188 inserções, 6 remoções**. O total Angular inclui alterações anteriores de modelos/filtro de marketplace, mantidas intactas.

---

### Tarefa 10: Aba "Termos em alta" na Revisão

**Arquivos:**
- Modificar: `Move-Intelligence-Front/src/app/core/models/contract.models.ts`
- Criar: `Move-Intelligence-Front/src/app/core/services/discovery-terms.service.ts`
- Criar: `Move-Intelligence-Front/src/app/features/revisao/discovery-terms/discovery-terms.component.{ts,html,css,spec.ts}`
- Modificar: `Move-Intelligence-Front/src/app/features/revisao/revisao.component.{ts,html}` e `revisao.component.spec.ts`

**Interfaces:**
- Consome: a API da Tarefa 5 (`/discovery/terms`, `/discovery/terms/counts` e `/discovery/terms/:id/{approve,ignore,restore}`).
- Produz: o componente `<app-discovery-terms />`, com os tipos `DiscoveryTerm` e `DiscoveryTermCounts`.

- [x] **Passo 1: teste que falha** — `discovery-terms.component.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { CatalogService } from '../../../core/services/catalog.service';
import { DiscoveryTermsService } from '../../../core/services/discovery-terms.service';
import { DiscoveryTermsComponent } from './discovery-terms.component';

const term = (over: Record<string, unknown> = {}) => ({
  id: 't1', term: 'adjustable aerobic step', geo: 'US', typeKey: 'aerobic_step', typeName: 'Step aeróbico',
  familyKey: 'accessories', risingLabel: '+500%', breakout: false,
  firstSeenAt: new Date(Date.now() - 10 * 86_400_000).toISOString(), lastSeenAt: new Date().toISOString(),
  status: 'new', searchedAt: null, newListings: null, searchError: null, ...over,
});

function setup(items: unknown[], overrides: Record<string, unknown> = {}) {
  const api = {
    counts: vi.fn().mockReturnValue(of({ new: 1, approved: 1, searched: 2, ignored: 4 })),
    list: vi.fn().mockReturnValue(of(items)),
    approve: vi.fn().mockReturnValue(of({ id: 't1', status: 'approved' })),
    ignore: vi.fn().mockReturnValue(of({ id: 't1', status: 'ignored' })),
    restore: vi.fn().mockReturnValue(of({ id: 't1', status: 'new' })),
    ...overrides,
  };
  TestBed.configureTestingModule({
    imports: [DiscoveryTermsComponent],
    providers: [
      { provide: DiscoveryTermsService, useValue: api },
      { provide: CatalogService, useValue: { families: () => of([{ key: 'accessories', namePt: 'Acessórios' }]) } },
    ],
  });
  const fixture = TestBed.createComponent(DiscoveryTermsComponent);
  fixture.detectChanges();
  return { api, fixture, el: fixture.nativeElement as HTMLElement };
}

describe('DiscoveryTermsComponent', () => {
  it('mostra chips com contagem e os termos novos', () => {
    const { el, api } = setup([term()]);
    expect(api.list).toHaveBeenCalledWith({ status: 'new', geo: undefined, family: undefined });
    const text = el.textContent ?? '';
    expect(text).toContain('Novos (1)');
    expect(text).toContain('Aprovados (3)');
    expect(text).toContain('Ignorados (4)');
    expect(text).toContain('adjustable aerobic step');
    expect(text).toContain('Step aeróbico');
    expect(text).toContain('+500%');
    expect(text).toContain('há 1 semana');
  });

  it('Buscar produtos aprova; Ignorar ignora; recarrega depois', () => {
    const { el, api } = setup([term()]);
    (el.querySelector('[data-action="approve"]') as HTMLButtonElement).click();
    expect(api.approve).toHaveBeenCalledWith('t1');
    (el.querySelector('[data-action="ignore"]') as HTMLButtonElement).click();
    expect(api.ignore).toHaveBeenCalledWith('t1');
    expect(api.list).toHaveBeenCalledTimes(3);
  });

  it('aba Aprovados pede approved+searched e mostra a situação', () => {
    const { el, api, fixture } = setup([
      term({ id: 'a', status: 'approved' }),
      term({ id: 'b', status: 'searched', searchedAt: '2026-09-15T12:00:00.000Z', newListings: 14 }),
      term({ id: 'c', status: 'approved', searchError: 'Bright Data fora do ar' }),
    ]);
    (el.querySelector('[data-chip="approved"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(api.list).toHaveBeenLastCalledWith({ status: 'approved,searched', geo: undefined, family: undefined });
    const text = el.textContent ?? '';
    expect(text).toContain('Na fila: entra na próxima coleta');
    expect(text).toContain('Buscado em 15/09: 14 anúncios novos');
    expect(text).toContain('Erro na última busca: Bright Data fora do ar');
  });

  it('aba Ignorados tem Restaurar', () => {
    const { el, api, fixture } = setup([term({ status: 'ignored' })]);
    (el.querySelector('[data-chip="ignored"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el.querySelector('[data-action="restore"]') as HTMLButtonElement).click();
    expect(api.restore).toHaveBeenCalledWith('t1');
  });
});
```

Em `revisao.component.spec.ts`, acrescente:

```ts
  it('tem a aba Termos em alta', () => {
    const catalog = createCatalog();
    TestBed.configureTestingModule({
      imports: [RevisaoComponent],
      providers: [
        { provide: CatalogService, useValue: catalog },
        { provide: DiscoveryTermsService, useValue: {
          counts: () => of({ new: 0, approved: 0, searched: 0, ignored: 0 }), list: () => of([]),
        } },
      ],
    });
    const fixture = TestBed.createComponent(RevisaoComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const tab = [...el.querySelectorAll('.review-tabs button')].find((b) => b.textContent?.includes('Termos em alta')) as HTMLButtonElement;
    expect(tab).toBeTruthy();
    tab.click();
    fixture.detectChanges();
    expect(el.querySelector('app-discovery-terms')).not.toBeNull();
  });
```

Importe `DiscoveryTermsService` de `'../../core/services/discovery-terms.service'` no topo do spec.

- [x] **Passo 2: rodar e ver falhar**

Run: `cd Move-Intelligence-Front && NODE_OPTIONS=--localstorage-file=/private/tmp/move-front-vitest-localstorage npx ng test --watch=false`
Expected: FAIL.

- [x] **Passo 3: implementar**

`contract.models.ts`:

```ts
export interface DiscoveryTerm {
  id: string;
  term: string;
  geo: 'BR' | 'US';
  typeKey: string;
  typeName: string | null;
  familyKey: string | null;
  risingLabel: string;
  breakout: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  status: 'new' | 'approved' | 'searched' | 'ignored';
  searchedAt: string | null;
  newListings: number | null;
  searchError: string | null;
}
export interface DiscoveryTermCounts { new: number; approved: number; searched: number; ignored: number }
```

`core/services/discovery-terms.service.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { DiscoveryTerm, DiscoveryTermCounts } from '../models/contract.models';

@Injectable({ providedIn: 'root' })
export class DiscoveryTermsService {
  private readonly api = inject(ApiClient);

  list(filters: { status: string; geo?: string; family?: string }): Observable<DiscoveryTerm[]> {
    const params: Record<string, string> = { status: filters.status };
    if (filters.geo) params['geo'] = filters.geo;
    if (filters.family) params['family'] = filters.family;
    return this.api.get<DiscoveryTerm[]>('/discovery/terms', params);
  }
  counts(): Observable<DiscoveryTermCounts> {
    return this.api.get<DiscoveryTermCounts>('/discovery/terms/counts');
  }
  approve(id: string) { return this.api.post<{ id: string; status: string }>(`/discovery/terms/${id}/approve`, {}); }
  ignore(id: string) { return this.api.post<{ id: string; status: string }>(`/discovery/terms/${id}/ignore`, {}); }
  restore(id: string) { return this.api.post<{ id: string; status: string }>(`/discovery/terms/${id}/restore`, {}); }
}
```

Confira a assinatura de `ApiClient.get` (o `CatalogService` passa `{ kind, page, page_size }` como 2º argumento). Se o tipo de `params` for outro, ajuste só a tipagem.

`discovery-terms.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CatalogService } from '../../../core/services/catalog.service';
import { DiscoveryTermsService } from '../../../core/services/discovery-terms.service';
import { CatalogFamily, DiscoveryTerm, DiscoveryTermCounts } from '../../../core/models/contract.models';

type Chip = 'new' | 'approved' | 'ignored';

@Component({
  selector: 'app-discovery-terms',
  standalone: true,
  templateUrl: './discovery-terms.component.html',
  styleUrl: './discovery-terms.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscoveryTermsComponent {
  private readonly api = inject(DiscoveryTermsService);
  private readonly catalog = inject(CatalogService);

  readonly chip = signal<Chip>('new');
  readonly geo = signal<'' | 'BR' | 'US'>('');
  readonly family = signal('');
  readonly counts = signal<DiscoveryTermCounts>({ new: 0, approved: 0, searched: 0, ignored: 0 });
  readonly items = signal<DiscoveryTerm[]>([]);
  readonly families = signal<CatalogFamily[]>([]);
  readonly error = signal<string | null>(null);

  constructor() {
    this.catalog.families().subscribe((f) => this.families.set(f));
    this.reload();
  }

  setChip(chip: Chip): void { this.chip.set(chip); this.reload(); }
  setGeo(value: string): void { this.geo.set(value === 'BR' || value === 'US' ? value : ''); this.reload(); }
  setFamily(value: string): void { this.family.set(value); this.reload(); }

  reload(): void {
    this.error.set(null);
    this.api.counts().subscribe({ next: (c) => this.counts.set(c), error: () => this.error.set('Não foi possível carregar os termos.') });
    const status = this.chip() === 'approved' ? 'approved,searched' : this.chip();
    this.api.list({ status, geo: this.geo() || undefined, family: this.family() || undefined }).subscribe({
      next: (items) => this.items.set(items),
      error: () => this.error.set('Não foi possível carregar os termos.'),
    });
  }

  approve(t: DiscoveryTerm): void { this.act(this.api.approve(t.id), 'Não foi possível aprovar o termo.'); }
  ignore(t: DiscoveryTerm): void { this.act(this.api.ignore(t.id), 'Não foi possível ignorar o termo.'); }
  restore(t: DiscoveryTerm): void { this.act(this.api.restore(t.id), 'Não foi possível restaurar o termo.'); }

  situation(t: DiscoveryTerm): string {
    if (t.status === 'searched') return `Buscado em ${this.day(t.searchedAt)}: ${t.newListings ?? 0} anúncios novos`;
    if (t.searchError) return `Erro na última busca: ${t.searchError}`;
    return 'Na fila: entra na próxima coleta';
  }

  seen(t: DiscoveryTerm): string {
    const days = Math.floor((Date.now() - Date.parse(t.firstSeenAt)) / 86_400_000);
    if (days < 7) return 'esta semana';
    const weeks = Math.floor(days / 7);
    return `há ${weeks} semana${weeks > 1 ? 's' : ''}`;
  }

  private day(iso: string | null): string {
    return iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '—';
  }

  private act(request: ReturnType<DiscoveryTermsService['approve']>, message: string): void {
    request.subscribe({ next: () => this.reload(), error: () => this.error.set(message) });
  }
}
```

`discovery-terms.component.html`:

```html
<div class="terms-toolbar">
  <div class="chips" role="group" aria-label="Situação dos termos">
    <button type="button" data-chip="new" [class.active]="chip() === 'new'" (click)="setChip('new')">Novos ({{ counts().new }})</button>
    <button type="button" data-chip="approved" [class.active]="chip() === 'approved'" (click)="setChip('approved')">Aprovados ({{ counts().approved + counts().searched }})</button>
    <button type="button" data-chip="ignored" [class.active]="chip() === 'ignored'" (click)="setChip('ignored')">Ignorados ({{ counts().ignored }})</button>
  </div>
  <select aria-label="País" [value]="geo()" (change)="setGeo($any($event.target).value)">
    <option value="">BR e US</option>
    <option value="BR">BR</option>
    <option value="US">US</option>
  </select>
  <select aria-label="Família" [value]="family()" (change)="setFamily($any($event.target).value)">
    <option value="">Todas as famílias</option>
    @for (f of families(); track f.key) { <option [value]="f.key">{{ f.namePt }}</option> }
  </select>
</div>

@if (error()) { <div class="queue-error" role="alert">{{ error() }}</div> }

@if (items().length === 0) {
  <p class="empty">Nenhum termo aqui.</p>
} @else {
  <table class="terms-table">
    <thead>
      <tr>
        <th>Tipo</th><th>País</th><th>Termo em alta</th><th>Alta</th>
        @if (chip() === 'approved') { <th>Situação</th> } @else { <th>Visto</th><th></th> }
      </tr>
    </thead>
    <tbody>
      @for (t of items(); track t.id) {
        <tr>
          <td>{{ t.typeName ?? t.typeKey }}</td>
          <td>{{ t.geo }}</td>
          <td>{{ t.term }}</td>
          <td class="rise" [class.breakout]="t.breakout">{{ t.risingLabel }}</td>
          @if (chip() === 'approved') {
            <td>{{ situation(t) }}</td>
          } @else {
            <td>{{ seen(t) }}</td>
            <td class="actions">
              @if (chip() === 'new') {
                <button type="button" data-action="approve" (click)="approve(t)">Buscar produtos</button>
                <button type="button" data-action="ignore" class="secondary" (click)="ignore(t)">Ignorar</button>
              } @else {
                <button type="button" data-action="restore" class="secondary" (click)="restore(t)">Restaurar</button>
              }
            </td>
          }
        </tr>
      }
    </tbody>
  </table>
}
```

`discovery-terms.component.css`, com as variáveis de tema já usadas em `revisao.component.css` (confira os nomes lá e use os mesmos):

```css
.terms-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chips button { border: 1px solid var(--border, #d1d5db); border-radius: 999px; padding: 2px 10px; background: transparent; cursor: pointer; }
.chips button.active { border-color: var(--success, #2f855a); font-weight: 600; }
.terms-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.terms-table th, .terms-table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border, #e5e7eb); }
.rise { color: var(--success, #2f855a); white-space: nowrap; }
.rise.breakout { font-weight: 700; }
.actions { white-space: nowrap; display: flex; gap: 6px; }
.empty { color: var(--text-muted, #6b7280); }
```

Em `revisao.component.ts`:
1. Troque `type Tab = 'provisional_listing' | 'suggested_type';` por `type Tab = 'provisional_listing' | 'suggested_type' | 'discovery_terms';`.
2. Acrescente `DiscoveryTermsComponent` em `imports` (de `'./discovery-terms/discovery-terms.component'`).
3. Em `reload()`, depois do `reviewCounts`, acrescente `if (this.tab() === 'discovery_terms') return;` **antes** do `if (this.tab() === 'provisional_listing')`. A aba carrega os próprios dados.

Em `revisao.component.html`:
1. Acrescente o terceiro botão em `.review-tabs`, depois de "Tipos novos sugeridos":

```html
  <button type="button" [class.active]="tab() === 'discovery_terms'" (click)="setTab('discovery_terms')">Termos em alta</button>
```

2. Onde o template decide entre `provisional_listing` e o conteúdo de tipos sugeridos, faça o conteúdo de tipos sugeridos só aparecer com `tab() === 'suggested_type'` (troque um `@else` genérico por `@else if (tab() === 'suggested_type')`). Acrescente o novo ramo:

```html
@if (tab() === 'discovery_terms') {
  <app-discovery-terms />
}
```

- [x] **Passo 4: rodar e ver passar**

Run: `cd Move-Intelligence-Front && NODE_OPTIONS=--localstorage-file=/private/tmp/move-front-vitest-localstorage npx ng test --watch=false && npx ng build`
Expected: PASS e build ok.

**Registro Tarefa 10 — histórico de retomada:**
- Red previsto antes da implementação: o build não resolvia os imports ainda inexistentes de `DiscoveryTermsService` e `DiscoveryTermsComponent`.
- Passo 4 executado: `NODE_OPTIONS=--localstorage-file=/private/tmp/move-front-vitest-localstorage npx ng test --watch=false` falhou em `src/app/core/auth/auth.interceptor.spec.ts`, teste `em 401, faz um único refresh (single-flight) e refaz as requisições`: esperava `refresh` 1 vez, recebeu 0. O runner também relatou `NG04002` para a rota `/login` e respostas 401 não tratadas em `/api/ranking-a` e `/api/ranking-b`.
- Resultado global: **14 arquivos passaram, 1 falhou; 58 testes passaram, 1 falhou; 3 erros não tratados**. Falha fora da mudança da T10 e não prevista no plano; conforme instrução, parei sem alterar/repetir testes. Como o comando usa `&&`, `npx ng build` não foi executado. T10 não concluída; T11 não iniciada.
- Retomada solicitada: 1ª execução falhou em 2 testes de `auth.interceptor.spec.ts` (`Authorization` esperado e ausente): **14 arquivos passaram, 1 falhou; 57/59 testes passaram**. A repetição falhou novamente no teste single-flight (esperava `/api/ranking-a`, recebeu apenas `/api/ranking-b`) e deixou essa requisição aberta: **14 arquivos passaram, 1 falhou; 58/59 testes passaram; 2 erros não tratados**, incluindo navegação para `/login` e 401 de `/api/ranking-a`. Os testes do Subprojeto D passaram nas duas execuções. Duas falhas consecutivas atingiram o limite definido pelo usuário; parei sem alterar o teste. `npx ng build` e T11 continuam pendentes.
- Nova validação pelo isolamento do localStorage: suíte completa → **14 arquivos passaram, 1 falhou (`auth.interceptor.spec.ts`), 58/59 testes passaram**; execução isolada do interceptor → **1 arquivo, 3 testes passaram**. Nenhum teste do Subprojeto D falhou; o teste/configuração de auth permaneceram intocados.
- `npx ng build` separado foi repetido no Node 25 e no Node 24, inclusive em modo verbose e com relatório fatal; todas as tentativas abortaram com **código 134** logo após `Building...`, sem relatório/diagnóstico. Naquele ponto, deixei o Passo 4 desmarcado; a continuação da Tarefa 11 foi autorizada pelo usuário apesar do bloqueio local de build.
- Retomada em 22/09: suíte completa executada novamente e aprovada (**15 arquivos, 59 testes**). `npx ng build` separado continuou abortando no Node 25.9 com código 134 e sem diagnóstico. Na Tarefa 11, o mesmo frontend compilou com sucesso no build Docker Node 20; passo marcado concluído com essa ressalva de ambiente local.
- `git diff --stat` no recorte rastreado da Revisão/modelos: **4 arquivos, 80 inserções, 3 remoções**; os arquivos novos `discovery-terms.service.ts` e `discovery-terms/` não aparecem no stat enquanto não rastreados.

---

### Tarefa 11: Variáveis, suítes completas e conferência local

**Arquivos:**
- Modificar: `Move-Intelligence-Back/.env.example`

- [x] **Passo 1: `.env.example`** — acrescente no fim:

```bash
# Subprojeto D — descoberta pelos termos em alta (busca só com FICHA_ENABLED=true também)
RADAR_DISCOVERY_ENABLED=false
RADAR_DISCOVERY_MAX_TERMS=5
RADAR_DISCOVERY_LIMIT_PER_SOURCE=10
DISCOVERY_TERMS_CRON=0 6 * * *
# Subprojeto D — níveis de acompanhamento (vagas)
TRACK_TOP_CARDS=50
TRACK_TIER1_SLOTS=80
TRACK_TIER2_SLOTS=100
TRACK_RADAR_MIN_GROWTH=0.20
TRACK_DISCOVERY_WINDOW_DAYS=30
```

- [x] **Passo 2: suítes completas**

```bash
cd Move-Intelligence-Back && npm test && npx tsc --noEmit -p tsconfig.json
cd Move-Intelligence-Dados && <python> -m pytest tests -q
cd Move-Intelligence-Front && NODE_OPTIONS=--localstorage-file=/private/tmp/move-front-vitest-localstorage npx ng test --watch=false && npx ng build
git diff --check
```
Expected: tudo verde. Registre as contagens (backend suítes/testes, Python, frontend).

- [x] **Passo 3: reconstruir e conferir no navegador**

```bash
docker compose up -d --build backend frontend
```

Com um usuário ADMIN:
- abra `/revisao` → aba **Termos em alta**. Deve haver cerca de 200 termos US e 36 BR em Novos, sem "coffee grinder";
- aprove **um** termo de teste (anote qual) e confira que ele aparece em Aprovados com "Na fila: entra na próxima coleta";
- abra um produto → aba **Anúncios** e confira a coluna "Acompanhamento" (Nível 1/2/3 e a dica do motivo).

Tire prints para o relatório.

- [x] **Passo 4: dry-run da busca** (não chama nada externo)

```bash
cd Move-Intelligence-Back && INCLUDE_SYNTHETIC_DATA=true npm run discovery:search -- --dry-run --max-terms 1
```
Expected: lista o termo aprovado com as fontes do país. Nenhuma chamada à Bright Data.

- [x] **Passo 5:** `docker ps` mostra `move-backend` e `move-frontend` rodando. Mostre a contagem de `ai_call_logs`, que deve ser igual à do início.

**Registro Tarefa 11:**
- `.env.example`: variáveis do Subprojeto D acrescentadas; `git diff --stat` do arquivo → **1 arquivo, 12 inserções**.
- Backend: `npm test` → **61 suítes / 480 testes passaram**; `npx tsc --noEmit -p tsconfig.json` passou.
- Python: `python -m pytest tests -q` → **115 passaram, 3 ignorados**.
- Frontend T11: suíte completa → **14 arquivos passaram, 1 falhou; 58/59 testes passaram**, única falha em `auth.interceptor.spec.ts`; arquivo isolado → **1 arquivo / 3 testes passaram**. Conforme a regra do usuário, prossegui; nenhum teste do Subprojeto D falhou. Na execução T10, a suíte completa passou **15 arquivos / 59 testes**.
- `npx ng build` separado no Node 25.9 do host abortou com código **134** e sem diagnóstico. O build de produção do frontend no Docker (`node:20-bookworm-slim`, `npm run build`) passou; `prisma generate` e `npm run build` do backend também passaram durante o build das imagens. `git diff --check` passou.
- Compose: imagens backend/frontend reconstruídas e ambos os serviços ficaram ativos; `/api/health` retornou `status=ok`, DB e Redis `true`; frontend respondeu HTTP 200. Como o Compose versionado tinha `RUN_DB_PUSH_ON_BOOT=true`, usei override temporário em `/private/tmp/move-all-task11-override.yaml` com `RUN_DB_PUSH_ON_BOOT=false`, sem editar `docker-compose*.yml` nem executar `prisma db push`. Para impedir raspagens automáticas antes da autorização da Tarefa 12, deixei `TRACK_LISTINGS_CRON_ENABLED`, `FICHA_ENABLED`, `RADAR_DISCOVERY_ENABLED` e `WEEKLY_COLLECTION_CRON_ENABLED` em `false` nesse override.
- Navegador: aba Termos em alta mostrou **238 novos antes da aprovação** (US **201**, BR **37**); `coffee grinder` não apareceu e a consulta final confirmou **0** termos novos correspondentes. Aprovei somente `adjustable aerobic step` (US, Step aeróbico, +500%); ficou em Aprovados com “Na fila: entra na próxima coleta”. Depois: US novos **200**, BR novos **37**, 1 aprovado. Prints da aba e da coluna Acompanhamento foram capturados no Chrome.
- Coluna Acompanhamento no dossiê “Remo seco a água”: **6 anúncios** mostraram “Nível 1 · a cada 3,5 dias” e última coleta 14/09.
- `discovery:search --dry-run --max-terms 1` listou `adjustable aerobic step` (US), fontes `amazon`, `alibaba`, `aliexpress`, `1688`; `searched=0`, `failed=0`. A primeira tentativa local recebeu P1001 por bloqueio de acesso do sandbox a `localhost:5432`; o mesmo dry-run passou com acesso local autorizado. Não houve chamada real à Bright Data nem LLM.
- `ai_call_logs`: **367 antes / 367 depois**. `move-backend` e `move-frontend` ficaram Up.
- Tracking: o apply registrado na Tarefa 8 continua sendo `tier1=80`, `tier2=100`, `tier3=429`; `by_reason={demais:429, radar:93, top50:87}`; `status_changes={ignored:0, activated:0}`; `estimated_weekly_calls=360`. Um dry-run somente leitura em T11 ainda prevê essa distribuição, `changed=512` e os mesmos status/estimativa. A consulta atual ao banco, porém, mostrou `ACTIVE`: tier 1 **237** (demais 147, radar 22, top50 68), tier 2 **361** (demais 277, radar 65, top50 19), tier 3 **11** (demais 5, radar 6). Não apliquei esse dry-run; a origem dessa divergência com o apply anterior não foi isolada.
- **Adendo T11 — reversão do job acidental, 22/09/2026:** a origem da divergência foi identificada como o cron do backend antigo (`requested_by='scheduler-track'`, job `9893411f-8f09-4c2b-961b-762d4272f1de`, 19:56 UTC). A consulta prévia retornou exatamente **50** observações `not_found`, `is_synthetic=false`, todas com `parser_version` terminado em `@pending`, e 50 `listing_id` distintos. Em uma transação local, excluí essas observações e zerei `consecutive_failures` dos anúncios correspondentes: `DELETE 50`, `UPDATE 50`, **0** observações restantes e **50** anúncios zerados; transação confirmada.
- Após a reversão, `INCLUDE_SYNTHETIC_DATA=true npm run tracking:recalc -- --apply` → `dry_run=false`, `tier1=80`, `tier2=100`, `tier3=429`, `by_reason={demais:429, top50:87, radar:93}`, `status_changes={ignored:0, activated:0}`, `changed=478`, `estimated_weekly_calls=360`. Consulta posterior: `ACTIVE|1|top50|80`, `ACTIVE|2|radar|93`, `ACTIVE|2|top50|7`, `ACTIVE|3|demais|429`; **0** anúncios ativos sem `tier_reason`. Sem chamadas externas. Nenhuma alteração de código nesta reversão/recálculo; `git diff --stat` de código adicional: **0 arquivos**.
- O override temporário que mantém os crons desligados continua em `/private/tmp/move-all-task11-override.yaml`; não alterei nenhum `docker-compose*.yml`. Manter o override até concluir a Tarefa 12.

---

### Tarefa 12: Paradas de segurança — LLM de fichas e primeira busca real

> **PARE aqui e peça o "ok" do usuário antes de cada passo desta tarefa.** Mostre o que vai rodar, quantas chamadas usa e o que muda.

- [x] **Passo 1 (precisa de ok): validar a LLM de fichas** — cerca de 7 chamadas do modelo gratuito:

```bash
cd Move-Intelligence-Back && npm run catalog:eval
```
Passa se "Sem resposta" ≤ 10% dos itens **e** "Tipo — casos claros" ≥ 85%. Registre a saída inteira e o modelo.

> **Registro de tentativa, 22/09/2026:** a primeira tentativa foi autorizada pelo usuário, mas o auto-review bloqueou `exec_command` antes de iniciar o processo porque a autorização não delimitava claramente o destino e o payload transmitido. Não houve execução nem chamadas; `ai_call_logs` permaneceu em **367**. Inspeção estática confirmou destino `https://openrouter.ai/api/v1/chat/completions`, modelo `inclusionai/ling-3.0-flash-fin:free`, lote 20 (**7 requisições planejadas**) e payload composto pelos títulos dos **140 itens do fixture de avaliação** (EN/PT/ZH), pelo prompt de classificação e pela taxonomia cadastrada. O script não persiste fichas de resultado. Após autorização específica posterior, o comando foi executado e validado abaixo.

**Registro de execução após autorização específica:**
- Comando: `cd Move-Intelligence-Back && npm run catalog:eval`.
- Modelo: `inclusionai/ling-3.0-flash-fin:free`; prompt `ficha-v1`.
- Requisições: **7** (7 lotes de 20 itens; 7 registros `SUCCESS` no endpoint `catalog-eval`; sem retry reportado). `ai_call_logs`: **367 antes / 374 depois**.
- Saída integral:

```text
lote 1: 20/20 respostas
lote 2: 20/20 respostas
lote 3: 20/20 respostas
lote 4: 20/20 respostas
lote 5: 20/20 respostas
lote 6: 20/20 respostas
lote 7: 20/20 respostas

catalog:eval (ficha-v1, modelo inclusionai/ling-3.0-flash-fin:free)
Tipo — casos claros: 83/84 · ambíguos: 29/37
Por idioma (claros): pt 35/36 · zh 12/12 · en 36/36
Fora do escopo detectado: 15/15
Acessório detectado: 4/7 (falsos positivos: 0)
Sem resposta: 0
```
- Critérios: **passou**. Sem resposta = **0/140 (0%)**, ≤ 10%; tipo nos casos claros = **83/84 (98,81%)**, ≥ 85%.
- `git diff --stat` do código: **sem alterações nesta etapa**; foi atualizado somente este plano, que já é não rastreado.

- [x] **Passo 2 — não aplicável:** o Passo 1 passou pelos dois critérios. Não executar `FICHA_BATCH_SIZE=5`.

- [x] **Passo 3 (autorizado): busca real do único termo** — a primeira tentativa local falhou antes do Python por causa do caminho vazio; a reexecução com caminho explícito foi concluída (ver adendo).

```bash
cd Move-Intelligence-Back && MOVE_INTELLIGENCE_DATA_DIR=/Users/raul/Desktop/Move-All/Move-Intelligence-Dados RADAR_DISCOVERY_ENABLED=true FICHA_ENABLED=true FICHA_CRON='0 0 1 1 *' INCLUDE_SYNTHETIC_DATA=true PYTHON_BIN=/usr/local/bin/python3 npm run discovery:search -- --apply --max-terms 1
docker exec move-postgres psql -U move -d move_intelligence -At -c "select term, status, new_listings, search_error from discovery_terms where status in ('approved','searched') order by decided_at;" -c "select count(*) from tracked_listings where discovered_by_term is not null and first_seen_at > now() - interval '1 hour';" -c "select status, count(*) from listing_fichas where created_at > now() - interval '1 hour' group by 1;"
```
Registre: status do termo, `new_listings`, anúncios novos em `tracked_listings`, fichas criadas, job e contagem de `ai_call_logs`. Fichas ficam `pending` até a rotina de fichas rodar com `FICHA_ENABLED=true` no backend. **Não** ligue a rotina de fichas no container sem pedir.

- [x] **Passo 4:** contagem final de `ai_call_logs` e `git status` resumido registrados abaixo. **Sem commit.**

**Registro Tarefa 12:**
- Passo 1: `catalog:eval` usou o modelo `inclusionai/ling-3.0-flash-fin:free`, fez 7 requisições, teve 0/140 “Sem resposta” e 83/84 acertos nos casos claros (**98,81%**); passou nos dois critérios. `ai_call_logs`: 367 antes / 374 depois.
- Passo 2: **não aplicável — eval passou**; `FICHA_BATCH_SIZE=5` não foi executado.
- Preflight do Passo 3: `discovery:search --dry-run --max-terms 1` listou somente `adjustable aerobic step` (US), fontes `amazon`, `alibaba`, `aliexpress`, `1688`; `searched=0`, `failed=0`.
- Primeira tentativa autorizada: `MOVE_INTELLIGENCE_DATA_DIR` vazio resolveu para o diretório do backend e falhou antes de iniciar o Python; a saída e os efeitos nulos estão preservados abaixo como histórico.
- Saída integral da primeira tentativa (sem chamada externa):

```text
> move-intelligence-back@0.1.0 discovery:search
> node --env-file-if-exists=.env -r ts-node/register -r tsconfig-paths/register scripts/discovery-search.ts --apply --max-terms 1

{
  "skipped": null,
  "dry_run": false,
  "searched": 0,
  "failed": 1,
  "terms": [
    {
      "id": "e83a33e0-0395-46f4-a019-cd0acd724526",
      "term": "adjustable aerobic step",
      "geo": "US",
      "sources": [
        "amazon",
        "alibaba",
        "aliexpress",
        "1688"
      ]
    }
  ]
}
```

- A tentativa falhou antes de iniciar o Python: `Move-Intelligence-Dados não encontrado em /Users/raul/Desktop/Move-All/Move-Intelligence-Back`. `main.py` não foi executado, portanto `BrightDataClient` não foi chamado: **0 requisições Bright Data** (limite autorizado: 44). Não houve `scrape_as_markdown`, chamada à LLM, nem reexecução.
- Consultas pós-tentativa: termo `adjustable aerobic step` (US) continua `approved`; `new_listings=NULL`; `search_error` contém o caminho incorreto acima; `search_job_id=c3947df7-83ba-4f0b-9be8-2310cef8a143`. `tracked_listings` novos em uma hora: **0**. `listing_fichas` criadas em uma hora: **0**.
- `collection_jobs`: id `c3947df7-83ba-4f0b-9be8-2310cef8a143`, `requested_by=radar-discovery`, categoria `radar_discovery`, status `FAILED`, duração **0 s**; parâmetros registrados: geo US, limite 10 por fonte, quatro fontes, `exact_term=true`, `include_demand=false`.
- `ai_call_logs`: **375 antes / 375 depois** da tentativa. A contagem já estava em 375 antes da busca (esperado após o eval: 374); o registro adicional mais recente era `recommendations_executive`, modelo `inclusionai/ling-3.0-flash-fin:free`, `SUCCESS`, em `2026-09-22 22:56:00.757`, anterior à tentativa. A execução `discovery:search` não acrescentou registro de IA.
- Passo 4: contagem final `ai_call_logs=375`. `git status --short`: **48 modificados, 7 removidos e 44 não rastreados**; `docker-compose.yml` e `docker-compose.production.yml` aparecem modificados no status, como já apareciam antes desta tarefa, e não foram editados nela. `git diff --stat`: **55 arquivos, 1.158 inserções e 2.427 remoções** no worktree rastreado (inclui trabalho pré-existente; o plano não rastreado não entra no diff). Nenhum commit/push; fichas não processadas; `FICHA_ENABLED` não foi ligado no container.
- A pendência da primeira tentativa foi resolvida passando `MOVE_INTELLIGENCE_DATA_DIR` no comando, sem alterar código ou `.env`; veja o adendo. A observação de código sobre `??` e string vazia fica pendente para depois do Subprojeto D.

**Adendo Passo 3 — reexecução autorizada, 22/09/2026:**
- Preflight repetido: dry-run listou somente `adjustable aerobic step` (US), fontes `amazon`, `alibaba`, `aliexpress`, `1688`; `searched=0`, `failed=0`.
- `ai_call_logs` imediatamente antes: **375**.
- Comando executado uma vez, com o diretório de dados passado no ambiente do processo: `MOVE_INTELLIGENCE_DATA_DIR=/Users/raul/Desktop/Move-All/Move-Intelligence-Dados RADAR_DISCOVERY_ENABLED=true FICHA_ENABLED=true FICHA_CRON='0 0 1 1 *' INCLUDE_SYNTHETIC_DATA=true PYTHON_BIN=/usr/local/bin/python3 npm run discovery:search -- --apply --max-terms 1`.
- Saída estruturada: `dry_run=false`, `searched=1`, `failed=0`; termo `adjustable aerobic step`, geo US, fontes `amazon`, `alibaba`, `aliexpress`, `1688`.
- Destino efetivo: `BRIGHTDATA_PROVIDER=mcp`; `BRIGHTDATA_MCP_URL` estava vazio no `.env` de Dados, então o `BrightDataClient` usou o MCP Bright Data local já configurado como fallback. Não alterei o `.env`. Os metadados das quatro fontes registraram `provider=mcp`.
- Uso externo: `discovery_calls=24` (4 buscas e 20 páginas de detalhe; abaixo do teto autorizado de 44). Amazon: 10 registros; Alibaba: 10; AliExpress: 0; 1688: 0; sem erros por fonte. `products=6`, com `products_by_source={amazon:4, alibaba:2}`.
- Banco: termo `searched`, `new_listings=4`, `search_error=NULL`; `search_job_id=8fcc13a7-9c78-4ebf-b7b3-b295d73ebf28`. Anúncios novos em `tracked_listings` na última hora: **4**. Fichas criadas: **6 `pending`**; não foram processadas.
- `collection_jobs`: id `8fcc13a7-9c78-4ebf-b7b3-b295d73ebf28`, `requested_by=radar-discovery`, status `SUCCESS`, início `2026-09-22 23:08:51.139`, fim `2026-09-22 23:09:32.089`, duração **41 s**; `tracked_new=4`, `discovery_calls=24`.
- `ai_call_logs`: **375 antes / 375 depois**. A execução não gerou chamadas à LLM.
- O processo emitiu 8 avisos não fatais de `ProductsService` ao tentar a simulação Monte Carlo: `exchangeRate.findMany()` falhou com `Response from the Engine was empty` / `Engine is not yet connected`. Apesar dos avisos, o job de coleta ficou `SUCCESS` e a busca retornou `failed=0`; não investiguei nem alterei esse caminho.
- Nenhuma ficha foi processada; `FICHA_ENABLED` do container não foi alterado; nenhum código, `.env` ou Compose foi editado; sem commit.

**Pendência para depois do Subprojeto D (não corrigida agora):** em `Move-Intelligence-Back/src/modules/ingestion/intelligence-collection.service.ts`, `MOVE_INTELLIGENCE_DATA_DIR ?? resolve(...)` não usa o padrão quando a variável existe como string vazia. Alterar para `||` em uma tarefa posterior.

---

## Critérios de aceite (da especificação §12)

- Lista de termos gerada com o filtro do §5.2 (exemplos cobertos por testes); ignorado não volta; API só para ADMIN; transições 409.
- Busca dos aprovados: desligada por padrão; um termo por vez com as fontes do país e o termo literal; falha não derruba a coleta semanal.
- Níveis: vagas 80/100/resto, rodízio, ordem do nível 2, próxima visita adiantada só quando sobe, `IGNORED`/`ACTIVE` pelo §7.3, estimativa ≤ 400 raspagens por semana na base local.
- Acentos consertados e novas coletas em UTF-8.
- Aba "Termos em alta" e coluna "Acompanhamento" funcionando no navegador.
- Suítes verdes; nenhuma chamada externa fora da Tarefa 12; nenhum commit.
