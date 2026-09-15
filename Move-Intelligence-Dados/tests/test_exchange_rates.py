"""Testes do job diário de câmbio (F1.7) com PTAX fake + SQLite."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from unittest.mock import patch

from app.etl.load.database import ExchangeRateModel, get_session
from app.pipelines.run_exchange_rates import fetch_rate_with_lookback, run


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def _fake_get(url, timeout=30):
    if "'USD'" in url:
        return _FakeResponse({"value": [{"cotacaoVenda": 5.41}]})
    if "'CNY'" in url:
        return _FakeResponse({"value": [{"cotacaoVenda": 0.75}]})
    raise AssertionError(f"moeda inesperada em {url}")


def test_busca_usd_e_cny_e_grava_idempotente(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'fx.db'}"
    with patch("app.pipelines.run_exchange_rates.requests.get", side_effect=_fake_get):
        first = run(database_url=database_url, ref_date=date(2026, 9, 14))
        second = run(database_url=database_url, ref_date=date(2026, 9, 14))

    assert first["status"] == "success"
    assert first["stored"] == 2
    assert second["stored"] == 0  # idempotente: nada duplicado
    by_base = {item["base"]: item["rate"] for item in first["rates"]}
    assert by_base == {"USD": 5.41, "CNY": 0.75}

    db = get_session(database_url)
    try:
        assert db.query(ExchangeRateModel).count() == 2
    finally:
        db.close()


def test_retrocede_sem_pregao():
    calls: list[str] = []

    def fake_get(url, timeout=30):
        calls.append(url)
        if "09-14-2026" in url:
            return _FakeResponse({"value": []})
        return _FakeResponse({"value": [{"cotacaoVenda": 5.4}]})

    with patch("app.pipelines.run_exchange_rates.requests.get", side_effect=fake_get):
        rate, day = fetch_rate_with_lookback("USD", date(2026, 9, 14))

    assert rate == Decimal("5.4")
    assert day == date(2026, 9, 13)
    assert len(calls) == 2
