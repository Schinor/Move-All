"""Preenche identidade canônica de produtos coletados antes desta migração."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.etl.load.database import ProductSnapshotModel, get_session
from app.etl.transform.extract_identifiers import extract_identifiers


def run(batch_size: int = 200) -> dict[str, int]:
    session = get_session()
    updated = 0
    scanned = 0
    try:
        offset = 0
        while True:
            products = (
                session.query(ProductSnapshotModel)
                .order_by(ProductSnapshotModel.id.asc())
                .offset(offset)
                .limit(batch_size)
                .all()
            )
            if not products:
                break
            for product in products:
                scanned += 1
                identity = extract_identifiers(
                    {"title": product.title}, product.source_specific or {}
                )
                product.canonical_title = identity["canonical_title"]
                product.gtin = identity["gtin"]
                product.brand = identity["brand"]
                product.attrs = identity["attrs"]
                updated += 1
            session.commit()
            offset += len(products)
        return {"scanned": scanned, "updated": updated}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=200)
    args = parser.parse_args()
    print(run(max(1, min(args.batch_size, 1000))))
