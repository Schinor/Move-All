"""Coleta Bright Data em tempo real, normaliza e persiste no PostgreSQL.

Esta é a orquestração operacional do ETL v2. Ela conserva saídas parciais:
uma falha em uma fonte ou sinal não descarta os produtos observados nas demais.
"""

from __future__ import annotations

import importlib
import json
import logging
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Mapping, Optional

from sqlalchemy.exc import OperationalError

from app.etl.extract.demand_signal.google_trends import GoogleTrendsExtractor
from app.etl.extract.demand_signal.tiktok_search import TikTokSearchExtractor
from app.etl.extract.marketplace.alibaba import AlibabaExtractor
from app.etl.extract.marketplace.amazon import AmazonExtractor
from app.etl.extract.marketplace.amazon_br import AmazonBRExtractor
from app.etl.extract.marketplace.common import BrightDataClient
from app.etl.extract.marketplace.mercado_livre import MercadoLivreExtractor
from app.etl.extract.marketplace.shopee_br import ShopeeBRExtractor
from app.etl.extract.marketplace.taobao import TaobaoExtractor
from app.etl.extract.marketplace.tiktok_shop import TikTokShopExtractor
from app.etl.load.database import get_session
from app.etl.load.demand_snapshots import upsert_demand_signals
from app.etl.load.product_demand_link import upsert_product_demand_links
from app.etl.load.products import upsert_products
from app.etl.transform.correlate import build_product_demand_links, load_keyword_map
from app.etl.transform.normalize_demand import normalize_demand_records
from app.etl.transform.normalize_product import canonical_cluster, normalize_products


LOGGER = logging.getLogger(__name__)
DEFAULT_SOURCES = ("amazon_br", "mercado_livre", "shopee_br")
SUPPORTED_SOURCES = (
    "alibaba",
    "amazon",
    "amazon_br",
    "mercado_livre",
    "shopee_br",
    "tiktok_shop",
    "taobao",
    "1688",
)
BR_SOURCES = {"amazon_br", "mercado_livre", "shopee_br"}


def _extractor_registry() -> dict[str, type]:
    supplier_1688 = importlib.import_module(
        "app.etl.extract.marketplace.1688"
    ).Supplier1688Extractor
    return {
        "alibaba": AlibabaExtractor,
        "amazon": AmazonExtractor,
        "amazon_br": AmazonBRExtractor,
        "mercado_livre": MercadoLivreExtractor,
        "shopee_br": ShopeeBRExtractor,
        "tiktok_shop": TikTokShopExtractor,
        "taobao": TaobaoExtractor,
        "1688": supplier_1688,
    }


def _canonical_text(value: str) -> str:
    return " ".join(value.casefold().split())


def _resolve_cluster(
    term: str, keyword_map: Mapping[str, Mapping[str, list[str]]]
) -> str:
    requested = _canonical_text(term)
    for cluster, config in keyword_map.items():
        geo_keywords = config.get("keywords", config)
        for keywords in geo_keywords.values():
            if any(_canonical_text(keyword) == requested for keyword in keywords):
                return cluster
    return canonical_cluster(term) or "home_fitness_equipment"


def _keyword_for_geo(
    term: str,
    cluster: str,
    geo: str,
    keyword_map: Mapping[str, Mapping[str, list[str]]],
    variant: int = 0,
) -> str:
    config = keyword_map.get(cluster, {})
    geo_keywords = config.get("keywords", config)
    candidates = geo_keywords.get(geo.upper()) or geo_keywords.get("GLOBAL") or []
    return str(candidates[min(max(variant, 0), len(candidates) - 1)]) if candidates else term


def _keyword_variant(
    term: str,
    cluster: str,
    keyword_map: Mapping[str, Mapping[str, list[str]]],
) -> int:
    requested = _canonical_text(term)
    config = keyword_map.get(cluster, {})
    geo_keywords = config.get("keywords", config)
    for keywords in geo_keywords.values():
        for index, keyword in enumerate(keywords):
            if _canonical_text(keyword) == requested:
                return index
    return 0


def _source_term(
    term: str,
    source: str,
    cluster: str,
    keyword_map: Mapping[str, Mapping[str, list[str]]],
    variant: int = 0,
) -> str:
    if source in BR_SOURCES:
        return _keyword_for_geo(term, cluster, "BR", keyword_map, variant)
    return _keyword_for_geo(term, cluster, "US", keyword_map, variant)


def _in_window(record: Mapping[str, Any], start: date, end: date) -> bool:
    value = record.get("week_start") or record.get("date") or record.get("captured_at")
    if isinstance(value, datetime):
        observed = value.date()
    elif isinstance(value, date):
        observed = value
    else:
        try:
            observed = date.fromisoformat(str(value or "")[:10])
        except ValueError:
            return False
    return start <= observed <= end


def _dynamic_keyword_map(
    base: Mapping[str, Mapping[str, list[str]]],
    cluster: str,
    used_keywords: Mapping[str, str],
) -> dict[str, Any]:
    mapping = json.loads(json.dumps(base))
    cluster_config = mapping.setdefault(cluster, {})
    configured_keywords = cluster_config.get("keywords")
    geo_keywords = (
        configured_keywords
        if isinstance(configured_keywords, dict)
        else cluster_config
    )
    for geo, keyword in used_keywords.items():
        values = geo_keywords.setdefault(geo, [])
        if keyword not in values:
            values.append(keyword)
    return mapping


def _error(scope: str, source: str, error: Exception) -> dict[str, str]:
    return {"scope": scope, "source": source, "message": str(error)}


def run(
    *,
    term: str,
    sources: Iterable[str] = DEFAULT_SOURCES,
    limit: int = 2,
    geos: Iterable[str] = ("BR",),
    include_demand: bool = True,
    database_url: Optional[str] = None,
    keyword_map_path: Optional[str] = None,
    client: Optional[BrightDataClient] = None,
    dry_run: bool = False,
    window_days: int = 7,
    keyword_variant: Optional[int] = None,
) -> dict[str, Any]:
    requested_term = term.strip()
    if not requested_term:
        raise ValueError("term é obrigatório")

    source_list = list(dict.fromkeys(source.strip().casefold() for source in sources))
    unsupported = sorted(set(source_list) - set(SUPPORTED_SOURCES))
    if unsupported:
        raise ValueError(f"Fontes não suportadas: {', '.join(unsupported)}")
    if not source_list:
        raise ValueError("Selecione ao menos uma fonte de marketplace")

    geo_list = list(dict.fromkeys(geo.strip().upper() for geo in geos if geo.strip()))
    if not geo_list:
        geo_list = ["BR"]

    bounded_limit = max(1, min(int(limit), 10))
    active_client = client or BrightDataClient()
    base_keyword_map = load_keyword_map(keyword_map_path)
    cluster = _resolve_cluster(requested_term, base_keyword_map)
    variant = (
        _keyword_variant(requested_term, cluster, base_keyword_map)
        if keyword_variant is None
        else max(0, int(keyword_variant))
    )
    bounded_window_days = max(1, min(int(window_days), 30))
    window_end = datetime.now(timezone.utc).date()
    window_start = window_end - timedelta(days=bounded_window_days - 1)
    registry = _extractor_registry()

    raw_products: list[dict[str, Any]] = []
    raw_demand: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    source_stats: list[dict[str, Any]] = []

    def collect_source(source: str) -> tuple[list[dict[str, Any]], list[dict[str, str]], dict[str, Any]]:
        query = _source_term(requested_term, source, cluster, base_keyword_map, variant)
        try:
            result = registry[source](client=active_client).extract(
                query,
                limit=bounded_limit,
                concurrency=min(5, bounded_limit),
            )
            records = result["records"]
            for record in records:
                record["cluster"] = cluster
                record.setdefault("source_specific", {}).update(
                    {
                        "requested_term": requested_term,
                        "collection_query": query,
                        "collection_window_start": window_start.isoformat(),
                        "collection_window_end": window_end.isoformat(),
                        "keyword_variant": variant,
                    }
                )
            detail_failures = [
                {
                    "scope": "marketplace_detail",
                    "source": source,
                    "message": item["error"],
                }
                for item in result.get("errors", [])
            ]
            return records, detail_failures, result["metadata"]
        except Exception as error:
            return (
                [],
                [_error("marketplace_search", source, error)],
                {"source": source, "records_count": 0, "errors_count": 1},
            )

    with ThreadPoolExecutor(max_workers=min(4, len(source_list))) as executor:
        futures = {
            executor.submit(collect_source, source): source for source in source_list
        }
        by_source: dict[str, tuple[list[dict[str, Any]], list[dict[str, str]], dict[str, Any]]] = {}
        for future in as_completed(futures):
            by_source[futures[future]] = future.result()

    for source in source_list:
        records, source_failures, metadata = by_source[source]
        raw_products.extend(records)
        failures.extend(source_failures)
        source_stats.append(metadata)

    used_keywords: dict[str, str] = {}
    if include_demand:
        trends = GoogleTrendsExtractor(
            client=active_client,
            timeframe=f"now {bounded_window_days}-d",
        )
        tiktok = TikTokSearchExtractor(client=active_client)
        demand_jobs: list[tuple[str, str, str]] = []
        for geo in geo_list:
            keyword = _keyword_for_geo(
                requested_term, cluster, geo, base_keyword_map, variant
            )
            used_keywords[geo] = keyword
            demand_jobs.extend(
                [("google_trends", geo, keyword), ("tiktok_search", geo, keyword)]
            )

        def collect_demand(job: tuple[str, str, str]) -> tuple[list[dict[str, Any]], Optional[dict[str, str]]]:
            source, geo, keyword = job
            try:
                if source == "google_trends":
                    records = [
                        record
                        for record in trends.extract([keyword], [geo])
                        if _in_window(record, window_start, window_end)
                    ]
                else:
                    records = tiktok.extract_snapshot([keyword], [geo])
                return records, None
            except Exception as error:
                return [], _error("demand", f"{source}:{geo}", error)

        with ThreadPoolExecutor(max_workers=min(4, len(demand_jobs))) as executor:
            demand_futures = [executor.submit(collect_demand, job) for job in demand_jobs]
            for future in as_completed(demand_futures):
                records, failure = future.result()
                raw_demand.extend(records)
                if failure:
                    failures.append(failure)

    products = normalize_products(raw_products)
    demand = normalize_demand_records(raw_demand) if raw_demand else []
    correlation_map = _dynamic_keyword_map(
        base_keyword_map, cluster, used_keywords
    )
    links = build_product_demand_links(products, demand, correlation_map)

    summary: dict[str, Any] = {
        "term": requested_term,
        "cluster": cluster,
        "keyword_variant": variant,
        "window_days": bounded_window_days,
        "window_start": window_start.isoformat(),
        "window_end": window_end.isoformat(),
        "collection_provider": getattr(active_client, "provider", "test_or_custom"),
        "products": len(products),
        "products_by_source": dict(
            sorted(Counter(item["source"] for item in products).items())
        ),
        "demand_signals": len(demand),
        "demand_by_source": dict(
            sorted(Counter(item["source"] for item in demand).items())
        ),
        "product_demand_links": len(links),
        "product_ids": [item["id"] for item in products],
        "demand_signal_ids": [item["id"] for item in demand],
        "sources": source_stats,
        "failures": failures,
        "dry_run": dry_run,
    }

    if not products and not demand:
        messages = "; ".join(item["message"] for item in failures[:3])
        raise RuntimeError(f"A coleta não retornou dados. {messages}".strip())

    if dry_run:
        LOGGER.info("Coleta ao vivo (dry-run): %s", json.dumps(summary, ensure_ascii=False))
        return summary

    for attempt, delay in enumerate((2, 4, 8), start=1):
        session = get_session(database_url)
        try:
            upsert_products(products, session=session)
            upsert_demand_signals(demand, session=session)
            session.flush()
            upsert_product_demand_links(links, session=session)
            session.commit()
            break
        except OperationalError:
            session.rollback()
            if attempt == 3:
                raise
            LOGGER.warning(
                "PostgreSQL indisponível durante o load; nova tentativa %s/3 em %ss",
                attempt + 1,
                delay,
            )
            time.sleep(delay)
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    LOGGER.info("Coleta ao vivo carregada: %s", json.dumps(summary, ensure_ascii=False))
    return summary


__all__ = ["DEFAULT_SOURCES", "SUPPORTED_SOURCES", "run"]
