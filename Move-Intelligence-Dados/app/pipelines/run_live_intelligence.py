"""Coleta Bright Data em tempo real, normaliza e persiste no PostgreSQL.

Esta é a orquestração operacional do ETL v2. Ela conserva saídas parciais:
uma falha em uma fonte ou sinal não descarta os produtos observados nas demais.
"""

from __future__ import annotations

import importlib
import json
import logging
import os
import time
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Mapping, Optional

from sqlalchemy.exc import OperationalError

from app.etl.extract.demand_signal.google_trends import GoogleTrendsExtractor
from app.etl.extract.demand_signal.tiktok_search import TikTokSearchExtractor
from app.etl.extract.marketplace.alibaba import AlibabaExtractor
from app.etl.extract.marketplace.aliexpress import AliExpressExtractor
from app.etl.extract.marketplace.amazon import AmazonExtractor
from app.etl.extract.marketplace.amazon_br import AmazonBRExtractor
from app.etl.extract.marketplace.common import BrightDataClient, extract_native_id
from app.etl.extract.marketplace.mercado_livre import MercadoLivreExtractor
from app.etl.extract.marketplace.shopee_br import ShopeeBRExtractor
from app.etl.extract.marketplace.taobao import TaobaoExtractor
from app.etl.extract.marketplace.tiktok_shop import TikTokShopExtractor
from app.etl.load.database import get_session
from app.etl.load.demand_snapshots import upsert_demand_signals
from app.etl.load.product_demand_link import upsert_product_demand_links
from app.etl.load.products import upsert_products
from app.etl.load.tracked import candidate_url, load_tracked_keys, register_new_listings
from app.etl.transform.correlate import build_product_demand_links, load_keyword_map
from app.etl.transform.normalize_demand import normalize_demand_records
from app.etl.transform.normalize_product import canonical_cluster, normalize_products


LOGGER = logging.getLogger(__name__)
DEFAULT_SOURCES = ("amazon_br", "mercado_livre", "shopee_br")
SUPPORTED_SOURCES = (
    "alibaba",
    # A4: fonte de sourcing/custo (nunca preço de venda BR).
    "aliexpress",
    "amazon",
    "amazon_br",
    "mercado_livre",
    "shopee_br",
    "tiktok_shop",
    "taobao",
    "1688",
)
BR_SOURCES = {"amazon_br", "mercado_livre", "shopee_br"}

# Teto de chamadas na descoberta (A3.5, configurável): por execução, contando
# busca (1 por fonte) + raspagens (até o limite por fonte). Default 300.
DISCOVERY_MAX_CALLS_DEFAULT = 300


def resolve_discovery_budget(max_calls: Optional[int] = None) -> int:
    """Orçamento de chamadas da execução (`DISCOVERY_MAX_CALLS`, default 300)."""
    if max_calls is not None:
        try:
            return max(1, int(max_calls))
        except (TypeError, ValueError):
            pass
    try:
        return max(1, int(os.getenv("DISCOVERY_MAX_CALLS", str(DISCOVERY_MAX_CALLS_DEFAULT))))
    except ValueError:
        return DISCOVERY_MAX_CALLS_DEFAULT


def _extractor_registry() -> dict[str, type]:
    supplier_1688 = importlib.import_module(
        "app.etl.extract.marketplace.1688"
    ).Supplier1688Extractor
    return {
        "alibaba": AlibabaExtractor,
        "aliexpress": AliExpressExtractor,
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
    max_calls: Optional[int] = None,
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
    # A3.5: o teto vale para a execução inteira (buscas + raspagens). Com o
    # default de 300, o comportamento típico (8 fontes × 10) não muda.
    discovery_budget = resolve_discovery_budget(max_calls)
    per_source_scrapes = max(1, (discovery_budget - len(source_list)) // max(1, len(source_list)))
    bounded_limit = min(bounded_limit, per_source_scrapes)
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

    # Dedup da descoberta (F1.4): URLs cujo (source, native_id) já está em
    # tracked_listings não são raspadas. Só consulta o banco fora de dry_run.
    tracked_keys: set[tuple[str, str]] = set()
    if not dry_run:
        key_session = get_session(database_url)
        try:
            tracked_keys = load_tracked_keys(key_session, source_list)
        finally:
            key_session.close()

    def _keep_candidate(source: str, candidate: Mapping[str, Any]) -> bool:
        url = candidate_url(candidate)
        if not url:
            return True
        return (source, extract_native_id(url, source)) not in tracked_keys

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
                candidate_filter=(lambda candidate, _source=source: _keep_candidate(_source, candidate)),
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
        # F1.6: o Google Trends é relativo a cada requisição; o request_id e o
        # timeframe gravados em cada linha identificam a coleta. A âncora é
        # opcional para manter compatibilidade quando explicitamente definida.
        # O TikTok guarda a contagem bruta (snapshot semanal).
        demand_timeframe = "today 12-m"
        demand_request_id = uuid.uuid4().hex
        # Subprojeto C: a âncora "academia" zerava termos pequenos.
        demand_anchor = os.getenv("TRENDS_ANCHOR_KEYWORD", "").strip() or None
        demand_cutoff = window_end - timedelta(days=370)
        trends = GoogleTrendsExtractor(
            client=active_client,
            timeframe=demand_timeframe,
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
                        for record in trends.extract([keyword], [geo], anchor_keyword=demand_anchor)
                        if _in_window(record, demand_cutoff, window_end)
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
    if include_demand:
        for record in demand:
            record.setdefault("request_id", demand_request_id)
            record.setdefault("timeframe", demand_timeframe)
            record.setdefault("anchor_keyword", cluster)
    correlation_map = _dynamic_keyword_map(
        base_keyword_map, cluster, used_keywords
    )
    links = build_product_demand_links(products, demand, correlation_map)
    tracked_skipped = sum(int(stats.get("tracked_skipped", 0) or 0) for stats in source_stats)
    # Chamadas pagas reais da execução: 1 busca por fonte + 1 raspagem por
    # registro/erro de detalhe (A3.5).
    discovery_calls = len(source_list) + sum(
        int(stats.get("records_count", 0) or 0) + int(stats.get("errors_count", 0) or 0)
        for stats in source_stats
    )

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
        "tracked_skipped": tracked_skipped,
        "tracked_new": 0,
        "dry_run": dry_run,
        "discovery_max_calls": discovery_budget,
        "discovery_calls": discovery_calls,
    }

    if not products and not demand:
        if tracked_skipped > 0:
            # Tudo já estava em tracked_listings: sucesso vazio, sem falha.
            LOGGER.info("Descoberta sem novidades: %d candidatos já acompanhados", tracked_skipped)
            return summary
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
            # Descoberta (F1.4): candidatos novos aprovados viram CANDIDATE/tier 3.
            tracked = register_new_listings(session, products, term=requested_term)
            session.commit()
            summary["tracked_new"] = tracked["tracked_new"]
            summary["tracked_observation_ids"] = tracked["tracked_observation_ids"]
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
