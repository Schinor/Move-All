"""Loader idempotente da tabela ``products``."""

from __future__ import annotations

from typing import Any, Iterable, Optional

from sqlalchemy.orm import Session

from .database import ProductSnapshotModel, get_session


def upsert_products(
    records: Iterable[dict[str, Any]],
    session: Optional[Session] = None,
    database_url: Optional[str] = None,
) -> list[str]:
    """Insere ou atualiza snapshots pela chave natural do contrato."""

    owns_session = session is None
    db = session or get_session(database_url)
    ids: list[str] = []
    try:
        for record in records:
            natural_key = {
                "source": record["source"],
                "record_id": record["record_id"],
                "captured_at": record["captured_at"],
            }
            row = (
                db.query(ProductSnapshotModel)
                .filter_by(**natural_key)
                .one_or_none()
            )
            values = {
                "id": record["id"],
                "source": record["source"],
                "record_id": record["record_id"],
                "captured_at": record["captured_at"],
                "title": record["title"],
                "canonical_title": record.get("canonical_title"),
                "gtin": record.get("gtin"),
                "brand": record.get("brand"),
                "attrs": record.get("attrs") or {},
                "cluster": record.get("cluster"),
                "price_value": record.get("price_value"),
                "price_currency": record.get("price_currency"),
                "rating": record.get("rating"),
                "reviews_count": record.get("reviews_count"),
                "monthly_sales": record.get("monthly_sales"),
                "moq": record.get("moq"),
                "supplier": record.get("supplier"),
                "data_quality": record.get("data_quality") or "catalog_listing",
                "source_specific": record.get("source_specific") or {},
                # Default False: dados coletados de verdade nunca são sintéticos.
                # Só run_historical_collection.py (gerador de demonstração) passa True.
                "is_synthetic": record.get("is_synthetic", False),
            }
            if row is None:
                row = ProductSnapshotModel(**values)
                db.add(row)
            else:
                for field, value in values.items():
                    if field != "id":
                        setattr(row, field, value)
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


__all__ = ["upsert_products"]
