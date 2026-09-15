"""Testes da demanda sem reescrita histórica (F1.6).

- Semana já observada com dado completo nunca é sobrescrita.
- Semana com dado nulo é preenchida.
- TikTok guarda a contagem bruta (sem min-max de um ponto).
- Contexto da observação (request_id/timeframe/anchor_keyword) é persistido.
"""

from __future__ import annotations

import uuid
from datetime import date

from app.etl.load.database import DemandSignalModel, get_session
from app.etl.load.demand_snapshots import upsert_demand_signals
from app.etl.transform.normalize_demand import normalize_demand_records


def _record(**overrides):
    base = {
        "id": str(uuid.uuid4()),
        "keyword": "haltere ajustável",
        "geo": "BR",
        "source": "google_trends",
        "week_start": date(2026, 8, 3),
        "trend_index": 40.0,
        "raw_value": 40.0,
        "captured_at": date(2026, 8, 10),
        "request_id": "req-1",
        "timeframe": "today 12-m",
        "anchor_keyword": "dumbbells",
    }
    base.update(overrides)
    return base


def test_semana_completa_nao_e_sobrescrita(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'demand.db'}"
    db = get_session(database_url)
    try:
        upsert_demand_signals([_record()], session=db)
        db.commit()
        upsert_demand_signals(
            [_record(trend_index=90.0, raw_value=90.0, request_id="req-2")],
            session=db,
        )
        db.commit()
        row = db.query(DemandSignalModel).one()
        assert float(row.trend_index) == 40.0
        assert float(row.raw_value) == 40.0
        assert row.request_id == "req-1"
    finally:
        db.close()


def test_semana_nula_e_preenchida(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'demand.db'}"
    db = get_session(database_url)
    try:
        db.add(
            DemandSignalModel(
                id=str(uuid.uuid4()),
                keyword="haltere ajustável",
                geo="BR",
                source="google_trends",
                week_start=date(2026, 8, 3),
                trend_index=40.0,
                raw_value=None,
                captured_at=date(2026, 8, 10),
            )
        )
        db.commit()
        upsert_demand_signals([_record()], session=db)
        db.commit()
        row = db.query(DemandSignalModel).one()
        assert float(row.raw_value) == 40.0
        assert row.anchor_keyword == "dumbbells"
    finally:
        db.close()


def test_tiktok_guarda_contagem_bruta():
    [signal] = normalize_demand_records(
        [
            {
                "keyword": "haltere",
                "geo": "BR",
                "source": "tiktok_search",
                "week_start": "2026-09-14",
                "video_count": 1200000,
            }
        ]
    )
    assert signal["raw_value"] == 1200000.0
    assert signal["trend_index"] == 1200000.0
