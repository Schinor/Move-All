"""Orquestração do ETL v2 sem misturar extractors e loaders."""

from __future__ import annotations

import json
import logging
from collections import Counter
from pathlib import Path
from typing import Any, Optional

from app.etl.load.database import get_session
from app.etl.load.demand_snapshots import upsert_demand_signals
from app.etl.load.product_demand_link import upsert_product_demand_links
from app.etl.load.products import upsert_products
from app.etl.transform.correlate import build_product_demand_links, load_keyword_map
from app.etl.transform.normalize_demand import normalize_demand_records
from app.etl.transform.normalize_product import normalize_products


LOGGER = logging.getLogger(__name__)
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PRODUCTS_INPUT = REPOSITORY_ROOT / "data" / "brightdata_fitness_products_v2.json"


def _read_records(path: str | Path, collection_keys: tuple[str, ...]) -> list[dict[str, Any]]:
    input_path = Path(path)
    if not input_path.exists():
        raise FileNotFoundError(f"Arquivo de entrada não encontrado: {input_path}")
    with input_path.open("r", encoding="utf-8") as input_file:
        payload = json.load(input_file)

    if isinstance(payload, list):
        records = payload
    elif isinstance(payload, dict):
        records = []
        for key in collection_keys:
            if isinstance(payload.get(key), list):
                records = payload[key]
                break
    else:
        records = []

    if not all(isinstance(record, dict) for record in records):
        raise ValueError(f"{input_path} precisa conter uma lista de objetos")
    return records


def _summary(products: list[dict[str, Any]], demand: list[dict[str, Any]], links: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "products": len(products),
        "products_by_source": dict(sorted(Counter(item["source"] for item in products).items())),
        "products_by_cluster": dict(sorted(Counter(item["cluster"] or "unknown" for item in products).items())),
        "demand_signals": len(demand),
        "demand_by_source": dict(sorted(Counter(item["source"] for item in demand).items())),
        "demand_by_geo": dict(sorted(Counter(item["geo"] for item in demand).items())),
        "product_demand_links": len(links),
    }


def run(
    input_path: str | Path = DEFAULT_PRODUCTS_INPUT,
    demand_input_path: Optional[str | Path] = None,
    keyword_map_path: Optional[str | Path] = None,
    database_url: Optional[str] = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Normaliza e carrega o seed e, opcionalmente, sinais de demanda."""

    raw_products = _read_records(input_path, ("records", "products"))
    products = normalize_products(raw_products)

    demand: list[dict[str, Any]] = []
    if demand_input_path:
        raw_demand = _read_records(demand_input_path, ("records", "signals", "demand_signals"))
        demand = normalize_demand_records(raw_demand)

    keyword_map = load_keyword_map(keyword_map_path)
    links = build_product_demand_links(products, demand, keyword_map)
    summary = _summary(products, demand, links)

    if dry_run:
        LOGGER.info("Dry-run ETL v2: %s", json.dumps(summary, ensure_ascii=False))
        return {**summary, "dry_run": True}

    session = get_session(database_url)
    try:
        upsert_products(products, session=session)
        upsert_demand_signals(demand, session=session)
        session.flush()
        upsert_product_demand_links(links, session=session)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    LOGGER.info("ETL v2 carregado: %s", json.dumps(summary, ensure_ascii=False))
    return {**summary, "dry_run": False}


__all__ = ["DEFAULT_PRODUCTS_INPUT", "run"]
