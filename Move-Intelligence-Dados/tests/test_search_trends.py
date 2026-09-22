from pathlib import Path

import pytest

from app.etl.extract.demand_signal.google_trends import (
    GoogleTrendsExtractor,
    parse_trends_payload,
    trends_timeout_seconds,
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
    assert payload.related_rising[1] == {
        "query": "bike spinning magnetica",
        "value": 60,
        "label": "+60%",
        "breakout": False,
    }


def test_parse_marca_breakout():
    text = '{"widgets":[{"id":"TIMESERIES","data":{"default":{"timelineData":[{"time":"1789257600","value":[5]}]}}},' \
        '{"id":"RELATED_QUERIES","data":{"default":{"rankedList":[{"rankedKeyword":[]},' \
        '{"rankedKeyword":[{"query":"reformer dobravel","value":5000,"formattedValue":"Breakout"}]}]}}}]}'
    payload = parse_trends_payload(text)
    assert payload.related_rising == [{
        "query": "reformer dobravel",
        "value": 5000,
        "label": "Breakout",
        "breakout": True,
    }]


def test_parse_sem_timeseries_da_erro_claro():
    with pytest.raises(ValueError, match="TIMESERIES"):
        parse_trends_payload('{"widgets":[]}')


def _weeks(values, partial_last=False):
    points = [{"week_start": f"2026-01-{i + 1:02d}", "value": value, "partial": False} for i, value in enumerate(values)]
    if partial_last:
        points[-1]["partial"] = True
    return points


def test_growth_4_e_12_semanas_ignorando_parcial():
    values = [10] * 12 + [20] * 8 + [40] * 4 + [999]
    out = trend_growth(_weeks(values, partial_last=True))
    assert out["status"] == "ok"
    assert out["last_value"] == 40
    assert out["growth_4w"] == pytest.approx(1.0)
    assert out["growth_12w"] == pytest.approx(80 / 30 - 1)


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


from app.pipelines import run_search_trends
from app.etl.extract.marketplace.common import BrightDataMcpError


def _no_sleep(_seconds):
    pass


class _FakeClient:
    def __init__(self, fail_terms=()):
        self.urls = []
        self.fail_terms = set(fail_terms)

    def google_trends(self, url):
        self.urls.append(url)
        if any(term.replace(" ", "%20") in url for term in self.fail_terms):
            raise RuntimeError("bloqueado")
        return FIXTURE.read_text(encoding="utf-8")


class _FakeSession:
    class _Result:
        def __init__(self, rows):
            self.rows = rows

        def fetchall(self):
            return self.rows

    def __init__(self, recent_rows=()):
        self.added = []
        self.commits = 0
        self.recent_rows = list(recent_rows)

    def execute(self, _query):
        return self._Result(self.recent_rows)

    def add(self, row):
        self.added.append(row)

    def commit(self):
        self.commits += 1

    def rollback(self):
        pass

    def close(self):
        pass


TERMS = [
    ("spin_bike", "bike spinning", "BR"),
    ("spin_bike", "spin bike", "US"),
    ("yoga_mat", "yoga mat", "US"),
]


def test_dry_run_nao_chama_cliente_nem_grava():
    client, session = _FakeClient(), _FakeSession()
    out = run_search_trends.run(terms=TERMS, client=client, session=session, dry_run=True)
    assert out["planned"] == 3 and out["requested"] == 0
    assert client.urls == [] and session.added == []


def test_grava_uma_linha_por_termo_e_segue_apos_erro():
    client, session = _FakeClient(fail_terms=["spin bike"]), _FakeSession()
    out = run_search_trends.run(terms=TERMS, client=client, session=session, sleep_fn=_no_sleep)
    assert out["requested"] == 3 and out["ok"] == 2 and out["erro"] == 1
    assert len(session.added) == 3
    erro = next(row for row in session.added if row.status == "erro")
    assert erro.term == "spin bike" and "bloqueado" in erro.error
    ok = next(row for row in session.added if row.term == "bike spinning")
    assert ok.type_key == "spin_bike" and ok.geo == "BR" and len(ok.points) == 53 and len(ok.related_rising) == 3


def test_limite_de_requisicoes():
    client, session = _FakeClient(), _FakeSession()
    out = run_search_trends.run(
        terms=TERMS,
        client=client,
        session=session,
        max_requests=2,
        sleep_fn=_no_sleep,
    )
    assert out["requested"] == 2 and out["skipped_by_budget"] == 1 and len(client.urls) == 2


def test_timeout_tenta_novamente_e_grava_ok():
    class TimeoutThenSuccess:
        def __init__(self):
            self.calls = 0

        def google_trends(self, _url):
            self.calls += 1
            if self.calls == 1:
                raise TimeoutError("tempo esgotado")
            return FIXTURE.read_text(encoding="utf-8")

    client = TimeoutThenSuccess()
    sleeps = []
    out = run_search_trends.run(
        terms=[TERMS[0]],
        client=client,
        session=_FakeSession(),
        sleep_fn=sleeps.append,
    )
    assert out["ok"] == 1 and out["erro"] == 0
    assert client.calls == 2 and sleeps == [15]


def test_value_error_nao_tenta_novamente():
    class InvalidPayload:
        def __init__(self):
            self.calls = 0

        def google_trends(self, _url):
            self.calls += 1
            raise ValueError("formato inválido")

    client = InvalidPayload()
    sleeps = []
    out = run_search_trends.run(
        terms=[TERMS[0]],
        client=client,
        session=_FakeSession(),
        sleep_fn=sleeps.append,
    )
    assert out["erro"] == 1 and out["ok"] == 0
    assert client.calls == 1 and sleeps == []


def test_tres_falhas_de_conexao_gravam_erro():
    class AlwaysTimeout:
        def __init__(self):
            self.calls = 0

        def google_trends(self, _url):
            self.calls += 1
            raise TimeoutError("tempo esgotado")

    client = AlwaysTimeout()
    sleeps = []
    out = run_search_trends.run(
        terms=[TERMS[0]],
        client=client,
        session=_FakeSession(),
        sleep_fn=sleeps.append,
    )
    assert out["erro"] == 1 and client.calls == 3 and sleeps == [15, 45]


def test_http_5xx_do_mcp_tenta_novamente():
    class GatewayThenSuccess:
        def __init__(self):
            self.calls = 0

        def google_trends(self, _url):
            self.calls += 1
            if self.calls == 1:
                raise BrightDataMcpError("Ferramenta MCP falhou: 504 Gateway Time-out")
            return FIXTURE.read_text(encoding="utf-8")

    client = GatewayThenSuccess()
    sleeps = []
    out = run_search_trends.run(
        terms=[TERMS[0]],
        client=client,
        session=_FakeSession(),
        sleep_fn=sleeps.append,
    )
    assert out["ok"] == 1 and client.calls == 2 and sleeps == [15]


@pytest.mark.parametrize(
    "message",
    [
        "Falha ao iniciar sessão com o MCP Bright Data",
        "MCP Bright Data recusou a inicialização com HTTP 504",
        "Resposta de inicialização inválida do MCP Bright Data",
    ],
)
def test_erros_de_inicializacao_sao_retryaveis(message):
    assert run_search_trends.is_retryable_trends_error(BrightDataMcpError(message))


def test_pausa_de_cinco_segundos_entre_requisicoes():
    sleeps = []
    out = run_search_trends.run(
        terms=TERMS,
        client=_FakeClient(),
        session=_FakeSession(),
        sleep_fn=sleeps.append,
    )
    assert out["requested"] == 3 and out["erro"] == 0
    assert sleeps == [5, 5]


def test_disjuntor_pausa_e_para_apos_tres_pausas():
    class AlwaysError:
        def google_trends(self, _url):
            raise RuntimeError("falha permanente")

    terms = [("term", f"termo {index}", "BR") for index in range(20)]
    sleeps = []
    session = _FakeSession()
    out = run_search_trends.run(
        terms=terms,
        client=AlwaysError(),
        session=session,
        sleep_fn=sleeps.append,
    )
    assert out["requested"] == 15 and out["erro"] == 15
    assert out["circuit_breaker_pauses"] == 3
    assert out["stopped_by_circuit_breaker"] == 1
    assert len(session.added) == 15
    assert sleeps.count(5) == 14 and sleeps.count(600) == 3


def test_termo_com_coleta_recente_eh_pulado():
    recent = [("spin_bike", "bike spinning", "BR")]
    client, session = _FakeClient(), _FakeSession(recent_rows=recent)
    out = run_search_trends.run(terms=TERMS, client=client, session=session, sleep_fn=_no_sleep)
    assert out["skipped_recent"] == 1 and out["requested"] == 2
    assert not any("bike%20spinning" in url for url in client.urls)


def test_force_ignora_coleta_recente():
    client, session = _FakeClient(), _FakeSession(
        recent_rows=[("spin_bike", "bike spinning", "BR")],
    )
    out = run_search_trends.run(
        terms=[TERMS[0]],
        client=client,
        session=session,
        force=True,
        sleep_fn=_no_sleep,
    )
    assert out["skipped_recent"] == 0 and out["requested"] == 1
    assert len(client.urls) == 1


def test_timeout_de_trends_vem_do_env(monkeypatch):
    monkeypatch.setenv("BRIGHTDATA_TRENDS_TIMEOUT", "240")
    assert trends_timeout_seconds() == 240
    assert GoogleTrendsExtractor().timeout == 240
