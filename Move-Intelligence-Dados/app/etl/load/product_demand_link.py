"""Loader idempotente da correlação N:N."""

from __future__ import annotations

from typing import Any, Iterable, Optional

from sqlalchemy.orm import Session

from .database import ProductDemandLinkModel, get_session


def upsert_product_demand_links(
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
                "product_id": record["product_id"],
                "demand_signal_id": record["demand_signal_id"],
                "keyword": record["keyword"],
            }
            row = (
                db.query(ProductDemandLinkModel)
                .filter_by(**natural_key)
                .one_or_none()
            )
            values = {
                "id": record["id"],
                **natural_key,
                "match_method": record.get("match_method") or "cluster_map",
            }
            if row is None:
                row = ProductDemandLinkModel(**values)
                db.add(row)
            else:
                row.match_method = values["match_method"]
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


__all__ = ["upsert_product_demand_links"]
