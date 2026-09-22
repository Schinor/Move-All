#!/usr/bin/env python3
"""Subprojeto D: conserta acentos quebrados em search_trend_snapshots.

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
