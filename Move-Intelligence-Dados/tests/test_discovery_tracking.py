"""Testes da descoberta com orçamento (F1.4).

- Dedup: candidato cujo `(source, native_id)` já está em `tracked_listings`
  NÃO é raspado; candidato novo aprovado vira CANDIDATE/tier 3 + 1ª observação.
- ID nativo não confiável (hash) e preço inválido não entram no acompanhamento.
- Rotação: primeira execução processa tudo; seguintes, só o terço mais antigo.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from app.etl.load.database import TrackedListingModel, get_session
from app.etl.load.database import ListingObservationModel
from app.etl.load.tracked import (
    is_trusted_native_id,
    register_new_listings,
)
from app.pipelines.run_live_intelligence import resolve_discovery_budget
from app.pipelines.run_live_intelligence import run as run_live_intelligence
from app.pipelines.run_weekly_intelligence import _load_rotation_state, _select_due_terms

TRACKED_URL = "https://www.amazon.com.br/dp/B000000001"
NEW_URL = "https://www.amazon.com.br/dp/B000000002"


class FakeDiscovery:
    def __init__(self):
        self.scraped: list[str] = []

    def search(self, query, country):
        return {
            "organic": [
                {"title": "Halter A", "description": "R$ 100,00", "link": TRACKED_URL},
                {"title": "Halter B", "description": "R$ 200,00", "link": NEW_URL},
            ]
        }

    def scrape(self, url, country):
        self.scraped.append(url)
        price = "100,00" if "B000000001" in url else "200,00"
        return f"# Halter\nPreço R$ {price}\n" + ("produto fitness " * 100)


def _seed_tracked(db, native_id: str = "B000000001"):
    db.add(
        TrackedListingModel(
            id=str(uuid.uuid4()),
            source="amazon_br",
            native_id=native_id,
            canonical_url=TRACKED_URL,
            status="ACTIVE",
            tier=1,
            next_due_at=datetime(2020, 1, 1),
        )
    )
    db.commit()


def test_descoberta_pula_raspagem_de_anuncio_ja_acompanhado(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'discovery.db'}"
    db = get_session(database_url)
    try:
        _seed_tracked(db)
    finally:
        db.close()

    client = FakeDiscovery()
    result = run_live_intelligence(
        term="haltere ajustável",
        sources=["amazon_br"],
        limit=2,
        geos=["BR"],
        include_demand=False,
        database_url=database_url,
        client=client,
    )

    # O anúncio acompanhado não foi raspado de novo; só o novo.
    assert client.scraped == [NEW_URL]
    assert result["products"] == 1
    assert result["tracked_skipped"] == 1
    assert result["tracked_new"] == 1

    db = get_session(database_url)
    try:
        created = (
            db.query(TrackedListingModel)
            .filter_by(source="amazon_br", native_id="B000000002")
            .one()
        )
        assert created.status == "CANDIDATE"
        assert created.tier == 3
    finally:
        db.close()


def test_registro_exige_id_confiavel_preco_e_url(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'register.db'}"
    db = get_session(database_url)
    try:
        outcome = register_new_listings(
            db,
            [
                # Válido.
                {
                    "source": "amazon_br",
                    "record_id": "B000000002",
                    "price_value": 200.0,
                    "price_currency": "BRL",
                    "source_specific": {"source_page_url": NEW_URL},
                },
                # Hash de fallback: fora.
                {
                    "source": "amazon_br",
                    "record_id": "a" * 32,
                    "price_value": 50.0,
                    "source_specific": {"source_page_url": NEW_URL},
                },
                # Sem preço: fora.
                {
                    "source": "amazon_br",
                    "record_id": "B000000003",
                    "price_value": None,
                    "source_specific": {"source_page_url": NEW_URL},
                },
                # Sem URL: fora.
                {
                    "source": "amazon_br",
                    "record_id": "B000000004",
                    "price_value": 10.0,
                    "source_specific": {},
                },
            ],
            term="haltere ajustável",
        )
        db.commit()
        assert outcome["tracked_new"] == 1
        assert db.query(TrackedListingModel).count() == 1
    finally:
        db.close()


def test_id_hash_nao_e_confiavel():
    assert is_trusted_native_id("B000000002")
    assert is_trusted_native_id("MLB123456")
    assert not is_trusted_native_id("a" * 32)
    assert not is_trusted_native_id("")
    assert not is_trusted_native_id(None)


def test_rotacao_primeira_execucao_processa_tudo():
    jobs = [("c1", 0, "t1"), ("c1", 1, "t2"), ("c2", 0, "t3")]
    selected, _ = _select_due_terms(jobs, {})
    assert selected == jobs


def test_rotacao_seguinte_pega_so_o_terco_mais_antigo():
    jobs = [("c1", 0, "t1"), ("c1", 1, "t2"), ("c2", 0, "t3")]
    state = {"c1#0": "2026-09-01", "c1#1": "2026-09-08", "c2#0": "2026-09-15"}
    selected, _ = _select_due_terms(jobs, state)
    assert selected == [("c1", 0, "t1")]


def test_unwrap_search_link():
    """A1/A3-extra: links /goto?url= e /url?q= viram URL direta."""
    from app.etl.extract.marketplace.common import unwrap_search_link

    assert unwrap_search_link("https://www.amazon.com.br/dp/B000000001") == (
        "https://www.amazon.com.br/dp/B000000001"
    )
    assert unwrap_search_link("/url?q=https://www.amazon.com.br/dp/B1&sa=U") == (
        "https://www.amazon.com.br/dp/B1"
    )
    assert unwrap_search_link("") is None


def test_discover_desembrulha_goto_antes_do_filtro(monkeypatch):
    """Sem desembrulhar, nenhum candidato do SERP passa no accepted_url."""
    from app.etl.extract.marketplace.amazon_br import AmazonBRExtractor
    from app.etl.extract.marketplace.common import unwrap_search_link
    import app.etl.extract.marketplace.common as common_module

    class FakeRedirect:
        status_code = 302
        headers = {"Location": "https://www.amazon.com.br/Halter/dp/B000000001"}

    monkeypatch.setattr(
        common_module.requests, "get", lambda *args, **kwargs: FakeRedirect()
    )

    extractor = AmazonBRExtractor()
    assert (
        unwrap_search_link("/goto?url=TOKEN123")
        == "https://www.amazon.com.br/Halter/dp/B000000001"
    )
    candidates = extractor.discover_candidates(
        {"organic": [{"title": "Halter", "link": "/goto?url=TOKEN123"}]},
        "haltere",
    )

    assert [item["url"] for item in candidates] == [
        "https://www.amazon.com.br/Halter/dp/B000000001"
    ]


def test_goto_irresoluvel_nao_quebra_a_descoberta(monkeypatch):
    from app.etl.extract.marketplace.amazon_br import AmazonBRExtractor
    import app.etl.extract.marketplace.common as common_module

    def boom(*args, **kwargs):
        raise OSError("rede bloqueada")

    monkeypatch.setattr(common_module.requests, "get", boom)

    candidates = AmazonBRExtractor().discover_candidates(
        {
            "organic": [
                {"title": "A", "link": "/goto?url=RUIM"},
                {"title": "B", "link": "https://www.amazon.com.br/dp/B000000002"},
            ]
        },
        "haltere",
    )

    assert [item["url"] for item in candidates] == [
        "https://www.amazon.com.br/dp/B000000002"
    ]


JSON_LD_OK = """\
# Halter B

Preço à vista R$ 200,00

```json
{"@context": "https://schema.org", "@type": "Product", "name": "Halter B",
 "offers": {"@type": "Offer", "price": "200.00", "priceCurrency": "BRL"}}
```
produto fitness
"""


class FakeJsonLd:
    """Um anúncio com JSON-LD inequívoco (parser ok) e um só com parcela."""

    def __init__(self):
        self.scraped: list[str] = []

    def search(self, query, country):
        return {
            "organic": [
                {"title": "Halter A", "description": "R$ 100,00", "link": TRACKED_URL},
                {"title": "Halter B", "description": "R$ 200,00", "link": NEW_URL},
            ]
        }

    def scrape(self, url, country):
        self.scraped.append(url)
        if "B000000002" in url:
            return JSON_LD_OK
        # Só parcela: o extrator genérico acha R$50, mas o parser nega "ok".
        return "# Halter A\nEm 12x de R$ 50,00 sem juros\n" + ("produto fitness " * 100)


def test_primeira_observacao_reflete_o_parser_da_fonte(tmp_path):
    """A3.4: parser ok → observação ok; sem JSON-LD → partial, nunca ok."""
    database_url = f"sqlite:///{tmp_path / 'parser-status.db'}"

    result = run_live_intelligence(
        term="haltere ajustável",
        sources=["amazon_br"],
        limit=2,
        geos=["BR"],
        include_demand=False,
        database_url=database_url,
        client=FakeJsonLd(),
    )

    assert result["tracked_new"] == 2
    db = get_session(database_url)
    try:
        observations = {
            observation.listing_id: observation
            for observation in db.query(ListingObservationModel).all()
        }
        assert len(observations) == 2
        listings = {listing.id: listing for listing in db.query(TrackedListingModel).all()}
        by_native = {listing.native_id: observations[listing.id] for listing in listings.values()}
        assert by_native["B000000002"].scrape_status == "ok"
        assert by_native["B000000002"].parser_version == "amazon@2"
        # Sem JSON-LD inequívoco: partial com o preço genérico, nunca "ok".
        assert by_native["B000000001"].scrape_status == "partial"
        assert by_native["B000000001"].parser_version == "amazon@2"
    finally:
        db.close()


def test_teto_de_chamadas_na_descoberta(tmp_path):
    """A3.5: DISCOVERY_MAX_CALLS (default 300) limita busca + raspagens."""
    assert resolve_discovery_budget(None) == 300
    assert resolve_discovery_budget(50) == 50

    import os

    previous = os.environ.get("DISCOVERY_MAX_CALLS")
    os.environ["DISCOVERY_MAX_CALLS"] = "7"
    try:
        assert resolve_discovery_budget(None) == 7
    finally:
        if previous is None:
            del os.environ["DISCOVERY_MAX_CALLS"]
        else:
            os.environ["DISCOVERY_MAX_CALLS"] = previous

    database_url = f"sqlite:///{tmp_path / 'budget.db'}"
    result = run_live_intelligence(
        term="haltere ajustável",
        sources=["amazon_br"],
        limit=10,
        geos=["BR"],
        include_demand=False,
        database_url=database_url,
        client=FakeDiscovery(),
        max_calls=3,
    )

    # Orçamento 3: 1 busca + até 2 raspagens (antes seriam 10).
    assert result["discovery_max_calls"] == 3
    assert result["discovery_calls"] <= 3


def _create_rotation_table(database_url):
    from sqlalchemy import text

    db = get_session(database_url)
    try:
        db.execute(
            text(
                "CREATE TABLE IF NOT EXISTS business_rule_configs ("
                "id VARCHAR(36) PRIMARY KEY, key VARCHAR(255), scope VARCHAR(255), "
                "value TEXT, active BOOLEAN, valid_from TIMESTAMP, "
                "valid_to TIMESTAMP, updated_at TIMESTAMP)"
            )
        )
        db.commit()
    finally:
        db.close()


def test_rotacao_so_carimba_termo_concluido(tmp_path):
    """A3.6: last_discovery_at só depois do sucesso; falha tenta de novo."""
    from app.pipelines import run_weekly_intelligence

    keyword_map = tmp_path / "keywords.yaml"
    keyword_map.write_text(
        """clusters:
  c_ok:
    keywords:
      BR: ["termo ok"]
  c_falha:
    keywords:
      BR: ["termo falha"]
""",
        encoding="utf-8",
    )

    class FakeHalfFail:
        def search(self, query, country):
            if "falha" in query:
                raise RuntimeError("SERP indisponível")
            return {
                "organic": [
                    {"title": "Halter", "description": "R$ 100,00", "link": TRACKED_URL},
                ]
            }

        def scrape(self, url, country):
            return "# Halter\nPreço R$ 100,00\n" + ("produto fitness " * 100)

    database_url = f"sqlite:///{tmp_path / 'rotation.db'}"
    _create_rotation_table(database_url)
    result = run_weekly_intelligence.run(
        sources=["amazon_br"],
        limit=1,
        geos=["BR"],
        include_demand=False,
        database_url=database_url,
        keyword_map_path=keyword_map,
        clusters=["c_ok", "c_falha"],
        keyword_depth="canonical",
        client=FakeHalfFail(),
    )

    assert result["terms_requested"] == 2
    assert result["terms_succeeded"] == 1
    db = get_session(database_url)
    try:
        state = _load_rotation_state(db)
    finally:
        db.close()
    assert "c_ok#0" in state
    assert "c_falha#0" not in state


def test_primeira_execucao_tambem_respeita_o_teto(tmp_path):
    """A3.5: sem estado de rodízio, a primeira execução respeita o teto."""
    from app.pipelines import run_weekly_intelligence

    keyword_map = tmp_path / "keywords.yaml"
    keyword_map.write_text(
        """clusters:
  c1:
    keywords:
      BR: ["termo um"]
  c2:
    keywords:
      BR: ["termo dois"]
""",
        encoding="utf-8",
    )
    database_url = f"sqlite:///{tmp_path / 'budget-weekly.db'}"
    result = run_weekly_intelligence.run(
        sources=["amazon_br"],
        limit=1,
        geos=["BR"],
        include_demand=False,
        database_url=database_url,
        keyword_map_path=keyword_map,
        clusters=["c1", "c2"],
        keyword_depth="canonical",
        max_calls=3,
        client=FakeDiscovery(),
    )

    # Custo por termo: 1 busca + 1 raspagem = 2; teto 3 → 1 termo.
    assert result["budget_capped"] is True
    assert result["terms_requested"] == 1


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


def test_exact_term_nao_raspa_resultado_sem_relacao(monkeypatch):
    from app.pipelines import run_live_intelligence as live

    captured = {}

    class FakeExtractor:
        def __init__(self, client=None):
            pass

        def extract(self, query, limit, concurrency, candidate_filter):
            candidates = [
                {"url": "https://www.amazon.com/dp/B0AAAAAAA1", "title": "Adjustable Dumbbell & Weight Bench"},
                {"url": "https://www.amazon.com/dp/B0AAAAAAA2", "title": "Adjustable Aerobic Step Platform"},
            ]
            kept = [candidate for candidate in candidates if candidate_filter(candidate)]
            captured["kept"] = [candidate["title"] for candidate in kept]
            return {
                "records": [],
                "errors": [],
                "metadata": {"source": "amazon", "records_count": 0, "relevance_skipped": len(candidates) - len(kept)},
            }

    monkeypatch.setattr(live, "_extractor_registry", lambda: {"amazon": FakeExtractor})
    monkeypatch.setattr(live, "normalize_products", lambda records: [{"id": "p1", "source": "amazon", "cluster": "strength_training"}])
    summary = live.run(term="adjustable aerobic step", sources=["amazon"], include_demand=False, dry_run=True, exact_term=True)
    assert captured["kept"] == ["Adjustable Aerobic Step Platform"]
    assert summary["sources"][0]["relevance_skipped"] == 1
