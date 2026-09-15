"""Loader idempotente da tabela ``demand_signals``."""

from __future__ import annotations

from typing import Any, Iterable, Optional

from sqlalchemy.orm import Session

from .database import DemandSignalModel, get_session


def upsert_demand_signals(
    records: Iterable[dict[str, Any]],
    session: Optional[Session] = None,
    database_url: Optional[str] = None,
) -> list[str]:
    owns_session = session is None
    db = session or get_session(database_url)
    ids: list[str] = []
    try:
        for record in records:
            natural_key = {
                "keyword": record["keyword"],
                "geo": record["geo"],
                "source": record["source"],
                "week_start": record["week_start"],
            }
            row = (
                db.query(DemandSignalModel)
                .filter_by(**natural_key)
                .one_or_none()
            )
            values = {
                "id": record["id"],
                **natural_key,
                "trend_index": record["trend_index"],
                "raw_value": record.get("raw_value"),
                "captured_at": record["captured_at"],
                "request_id": record.get("request_id"),
                "timeframe": record.get("timeframe"),
                "anchor_keyword": record.get("anchor_keyword"),
            }
            if row is None:
                row = DemandSignalModel(**values)
                db.add(row)
            elif row.trend_index is None or row.raw_value is None:
                # Semana ainda sem dado completo: só preenche o que estava nulo.
                for field, value in values.items():
                    if field != "id":
                        setattr(row, field, value)
            # Semana já observada com dado completo: nunca sobrescreve (F1.6).
            ids.append(str(row.id or record["id"]))

        if owns_session:
            db.commit()
        return ids
    except Exception:
        if owns_session:
            db.rollback()
        raise
    finally:
        if owns_session:
            db.close()


__all__ = ["upsert_demand_signals"]
