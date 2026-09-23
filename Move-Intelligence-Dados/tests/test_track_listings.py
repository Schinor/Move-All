"""Testes do loop de acompanhamento (F1.3) com Bright Data fake.

Padrão já usado em `tests/test_intelligence_etl.py`: cliente fake + SQLite
temporário. Cobrem sucesso, 404 ×3 → DEAD, bloqueio → backoff e preço
anômalo → partial.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone


def _utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)

from app.etl.extract.marketplace.common import BrightDataRequestError
from app.etl.load.database import (
    ListingObservationModel,
    TrackedListingModel,
    get_session,
)
from app.pipelines.run_track_listings import run

JSON_LD_199 = """\
# Haltere Ajustável

```json
{"@context": "https://schema.org", "@type": "Product", "name": "Haltere",
 "offers": {"@type": "Offer", "price": "199.90", "priceCurrency": "BRL"}}
```
"""

JSON_LD_500 = """\
```json
{"@type": "Product", "name": "Haltere",
 "offers": {"@type": "Offer", "price": "500.00", "priceCurrency": "BRL"}}
```
"""

JSON_LD_100 = """\
```json
{"@type": "Product", "name": "Haltere",
 "offers": {"@type": "Offer", "price": "100.00", "priceCurrency": "BRL"}}
```
"""


class FakeScrape:
    def __init__(self, markdown: str = JSON_LD_199):
        self.markdown = markdown
        self.calls: list[str] = []

    def scrape(self, url: str, country: str) -> str:
        self.calls.append(url)
        return self.markdown


class FakeError:
    def __init__(self, status: int):
        self.status = status
        self.calls: list[str] = []

    def scrape(self, url: str, country: str) -> str:
        self.calls.append(url)
        raise BrightDataRequestError(self.status, "erro fake")


def _seed_listing(db, **overrides):
    fields = dict(
        id=str(uuid.uuid4()),
        source="amazon_br",
        native_id=f"B0{uuid.uuid4().hex[:8].upper()}",
        canonical_url="https://www.amazon.com.br/dp/B000000001",
        status="ACTIVE",
        tier=2,
        consecutive_failures=0,
        next_due_at=datetime(2020, 1, 1),
    )
    fields.update(overrides)
    listing = TrackedListingModel(**fields)
    db.add(listing)
    db.commit()
    return listing


def _seed_ok_observation(db, listing_id: str, price: str, days_ago: int = 7):
    db.add(
        ListingObservationModel(
            id=str(uuid.uuid4()),
            listing_id=listing_id,
            observed_at=datetime.now() - timedelta(days=days_ago),
            price=price,
            currency="BRL",
            scrape_status="ok",
            parser_version="amazon@1",
            is_synthetic=False,
        )
    )
    db.commit()


def test_sucesso_insere_observacao_ok_e_reagenda(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'track.db'}"
    db = get_session(database_url)
    try:
        listing = _seed_listing(db)
        listing_id = listing.id
    finally:
        db.close()

    result = run(database_url=database_url, client=FakeScrape(), max_calls=10)

    assert result["status"] == "success"
    assert result["processed"] == 1
    assert len(result["observation_ids"]) == 1

    db = get_session(database_url)
    try:
        observation = db.query(ListingObservationModel).one()
        assert observation.scrape_status == "ok"
        assert float(observation.price) == 199.90
        updated = db.get(TrackedListingModel, listing_id)
        assert updated.last_success_at is not None
        assert updated.consecutive_failures == 0
        # Tier 2 = semanal: próxima coleta ~7 dias depois.
        assert updated.next_due_at > datetime.now() + timedelta(days=6)
    finally:
        db.close()


def test_nao_encontrado_3x_vira_dead(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'track.db'}"
    db = get_session(database_url)
    try:
        listing = _seed_listing(db, consecutive_failures=2)
        listing_id = listing.id
    finally:
        db.close()

    run(database_url=database_url, client=FakeError(404), max_calls=10)

    db = get_session(database_url)
    try:
        updated = db.get(TrackedListingModel, listing_id)
        assert updated.status == "DEAD"
        assert updated.consecutive_failures == 3
        observation = db.query(ListingObservationModel).one()
        assert observation.scrape_status == "not_found"
    finally:
        db.close()


def test_bloqueio_tem_backoff_sem_contar_para_dead(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'track.db'}"
    db = get_session(database_url)
    try:
        listing = _seed_listing(db)
        listing_id = listing.id
    finally:
        db.close()

    before = _utcnow_naive()
    run(database_url=database_url, client=FakeError(403), max_calls=10)

    db = get_session(database_url)
    try:
        updated = db.get(TrackedListingModel, listing_id)
        assert updated.status == "ACTIVE"
        assert updated.consecutive_failures == 0
        # Backoff exponencial: primeira sequência ≈ 2h, sem reagendar por dias.
        assert before + timedelta(hours=1) < updated.next_due_at < before + timedelta(hours=3)
        observation = db.query(ListingObservationModel).one()
        assert observation.scrape_status == "blocked"
    finally:
        db.close()


def test_preco_anomalo_vira_partial(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'track.db'}"
    db = get_session(database_url)
    try:
        listing = _seed_listing(db)
        listing_id = listing.id
        _seed_ok_observation(db, listing_id, "100.00", days_ago=14)
        _seed_ok_observation(db, listing_id, "100.00", days_ago=7)
    finally:
        db.close()

    run(database_url=database_url, client=FakeScrape(JSON_LD_500), max_calls=10)

    db = get_session(database_url)
    try:
        latest = (
            db.query(ListingObservationModel)
            .filter_by(listing_id=listing_id)
            .order_by(ListingObservationModel.observed_at.desc())
            .first()
        )
        assert float(latest.price) == 500.00
        assert latest.scrape_status == "partial"
    finally:
        db.close()


def test_candidate_vira_active_na_primeira_observacao_ok(tmp_path):
    """A3.7: CANDIDATE → ACTIVE na primeira observação ok do acompanhamento."""
    database_url = f"sqlite:///{tmp_path / 'track.db'}"
    db = get_session(database_url)
    try:
        listing = _seed_listing(db, status="CANDIDATE")
        listing_id = listing.id
    finally:
        db.close()

    run(database_url=database_url, client=FakeScrape(), max_calls=10)

    db = get_session(database_url)
    try:
        updated = db.get(TrackedListingModel, listing_id)
        assert updated.status == "ACTIVE"
        observation = db.query(ListingObservationModel).one()
        assert observation.scrape_status == "ok"
    finally:
        db.close()


def test_candidate_nao_promove_com_partial_ou_bloqueio(tmp_path):
    """A3.7: parcial/bloqueio não promove CANDIDATE a ACTIVE."""
    database_url = f"sqlite:///{tmp_path / 'track-partial.db'}"
    db = get_session(database_url)
    try:
        listing = _seed_listing(db, status="CANDIDATE")
        listing_id = listing.id
        _seed_ok_observation(db, listing_id, "100.00", days_ago=14)
        _seed_ok_observation(db, listing_id, "100.00", days_ago=7)
    finally:
        db.close()

    # Preço 500 contra mediana 100 (±60%) → partial, sem promoção.
    run(database_url=database_url, client=FakeScrape(JSON_LD_500), max_calls=10)

    db = get_session(database_url)
    try:
        updated = db.get(TrackedListingModel, listing_id)
        assert updated.status == "CANDIDATE"
        latest = (
            db.query(ListingObservationModel)
            .filter_by(listing_id=listing_id)
            .order_by(ListingObservationModel.observed_at.desc())
            .first()
        )
        assert latest.scrape_status == "partial"
    finally:
        db.close()

    database_url = f"sqlite:///{tmp_path / 'track-blocked.db'}"
    db = get_session(database_url)
    try:
        listing = _seed_listing(db, status="CANDIDATE")
        listing_id = listing.id
    finally:
        db.close()

    run(database_url=database_url, client=FakeError(403), max_calls=10)

    db = get_session(database_url)
    try:
        updated = db.get(TrackedListingModel, listing_id)
        assert updated.status == "CANDIDATE"
    finally:
        db.close()


def test_cadencia_nivel_3_mensal():
    from app.pipelines.run_track_listings import TIER_CADENCE_DAYS

    assert TIER_CADENCE_DAYS == {1: 3.5, 2: 7.0, 3: 30.0}


def test_erro_de_configuracao_do_mcp_nao_vira_not_found():
    from app.etl.extract.marketplace.common import BrightDataMcpError, BrightDataRequestError
    from app.pipelines.run_track_listings import _classify_error

    config = BrightDataMcpError(
        "MCP Bright Data 'bright_data' não encontrado no Codex; configure-o localmente ou defina BRIGHTDATA_MCP_URL no servidor"
    )
    assert _classify_error(config) == "error"
    assert _classify_error(BrightDataMcpError("BRIGHTDATA_MCP_URL não configurada e descoberta pelo Codex desativada")) == "error"
    assert _classify_error(BrightDataMcpError("Falha de conexão com o MCP Bright Data")) == "error"
    assert _classify_error(BrightDataRequestError(404, "Not Found")) == "not_found"
    assert _classify_error(BrightDataMcpError("MCP Bright Data rejeitou a solicitação: 404 Not Found")) == "not_found"


def test_sem_bright_data_configurada_nao_toca_nos_anuncios(tmp_path, monkeypatch):
    database_url = f"sqlite:///{tmp_path / 'track.db'}"
    db = get_session(database_url)
    try:
        listing = _seed_listing(db)
        listing_id = listing.id
    finally:
        db.close()

    monkeypatch.setattr(
        "app.pipelines.run_track_listings.BrightDataClient.is_configured", lambda self: False
    )
    summary = run(database_url=database_url, max_calls=10)
    assert summary["status"] == "not_configured"
    assert summary["processed"] == 0

    db = get_session(database_url)
    try:
        row = db.get(TrackedListingModel, listing_id)
        assert row.consecutive_failures == 0
        assert db.query(ListingObservationModel).filter_by(listing_id=listing_id).count() == 0
    finally:
        db.close()
