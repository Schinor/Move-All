"""Varredura semanal do catálogo completo de inteligência.

Cada cluster e variante configurada é processado como uma unidade pequena e
persistido imediatamente. Assim, uma falha posterior não descarta produtos já
observados e o comando pode ser repetido com segurança na mesma semana.
"""

from __future__ import annotations

import json
import logging
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional

from app.etl.extract.marketplace.common import BrightDataClient
from app.etl.transform.correlate import load_keyword_map
from app.pipelines import run_live_intelligence


LOGGER = logging.getLogger(__name__)
DEFAULT_WINDOW_DAYS = 7
DEFAULT_LIMIT = 10


def _selected_clusters(
    keyword_map: dict[str, dict[str, list[str]]],
    clusters: Optional[Iterable[str]],
) -> list[str]:
    if clusters is None:
        return sorted(keyword_map)
    requested = list(dict.fromkeys(value.strip() for value in clusters if value.strip()))
    missing = sorted(set(requested) - set(keyword_map))
    if missing:
        raise ValueError(f"Clusters não configurados: {', '.join(missing)}")
    return requested


def _variant_count(config: dict[str, list[str]], keyword_depth: str) -> int:
    if keyword_depth == "canonical":
        return 1
    return max((len(keywords) for keywords in config.values()), default=1)


def _display_term(config: dict[str, list[str]], variant: int, fallback: str) -> str:
    for geo in ("BR", "US", "GLOBAL"):
        keywords = config.get(geo) or []
        if keywords:
            return keywords[min(variant, len(keywords) - 1)]
    return fallback


def run(
    *,
    sources: Iterable[str] = run_live_intelligence.SUPPORTED_SOURCES,
    limit: int = DEFAULT_LIMIT,
    geos: Iterable[str] = ("BR", "US"),
    include_demand: bool = True,
    database_url: Optional[str] = None,
    keyword_map_path: Optional[str] = None,
    clusters: Optional[Iterable[str]] = None,
    keyword_depth: str = "all",
    window_days: int = DEFAULT_WINDOW_DAYS,
    max_terms: Optional[int] = None,
    client: Optional[BrightDataClient] = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    if keyword_depth not in {"canonical", "all"}:
        raise ValueError("keyword_depth deve ser 'canonical' ou 'all'")

    keyword_map = load_keyword_map(keyword_map_path)
    cluster_list = _selected_clusters(keyword_map, clusters)
    source_list = tuple(sources)
    geo_list = tuple(geos)
    bounded_window = max(1, min(int(window_days), 30))
    window_end = datetime.now(timezone.utc).date()
    window_start = window_end - timedelta(days=bounded_window - 1)

    term_jobs: list[tuple[str, int, str]] = []
    for cluster in cluster_list:
        config = keyword_map[cluster]
        for variant in range(_variant_count(config, keyword_depth)):
            term_jobs.append((cluster, variant, _display_term(config, variant, cluster)))
    if max_terms is not None:
        term_jobs = term_jobs[: max(0, int(max_terms))]

    results: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    product_ids: set[str] = set()
    demand_ids: set[str] = set()
    products_by_source: Counter[str] = Counter()
    demand_by_source: Counter[str] = Counter()
    shared_client = client or BrightDataClient(timeout=30)

    def collect_term(job: tuple[str, int, str]) -> tuple[Optional[dict[str, Any]], Optional[dict[str, str]]]:
        cluster, variant, term = job
        LOGGER.info(
            "Coleta semanal: cluster=%s variante=%s termo=%r",
            cluster,
            variant,
            term,
        )
        try:
            result = run_live_intelligence.run(
                term=term,
                sources=source_list,
                limit=limit,
                geos=geo_list,
                include_demand=include_demand,
                database_url=database_url,
                keyword_map_path=keyword_map_path,
                client=shared_client,
                dry_run=dry_run,
                window_days=bounded_window,
                keyword_variant=variant,
            )
            return result, None
        except Exception as error:  # o restante do catálogo continua
            return None, {
                "scope": "weekly_term",
                "source": cluster,
                "message": f"variante {variant} ({term}): {error}",
            }

    term_workers = 1 if client is not None else min(2, len(term_jobs) or 1)
    with ThreadPoolExecutor(max_workers=term_workers) as executor:
        futures = [executor.submit(collect_term, job) for job in term_jobs]
        for position, future in enumerate(as_completed(futures), start=1):
            result, term_failure = future.result()
            if result is not None:
                results.append(result)
                product_ids.update(result.get("product_ids", []))
                demand_ids.update(result.get("demand_signal_ids", []))
                products_by_source.update(result.get("products_by_source", {}))
                demand_by_source.update(result.get("demand_by_source", {}))
                failures.extend(result.get("failures", []))
            if term_failure is not None:
                failures.append(term_failure)
            print(
                "MOVE_ETL_PROGRESS="
                + json.dumps(
                    {
                        "mode": "weekly",
                        "window_days": bounded_window,
                        "window_start": window_start.isoformat(),
                        "window_end": window_end.isoformat(),
                        "clusters_requested": len(cluster_list),
                        "terms_requested": len(term_jobs),
                        "terms_completed": position,
                        "unique_products": len(product_ids),
                        "demand_signals": len(demand_ids),
                        "failures": len(failures),
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )

    summary: dict[str, Any] = {
        "term": "weekly_catalog",
        "cluster": "all",
        "collection_provider": getattr(shared_client, "provider", "mcp"),
        "window_days": bounded_window,
        "window_start": window_start.isoformat(),
        "window_end": window_end.isoformat(),
        "clusters_requested": len(cluster_list),
        "terms_requested": len(term_jobs),
        "terms_completed": len(term_jobs),
        "terms_succeeded": len(results),
        "products": sum(result.get("products", 0) for result in results),
        "unique_products": len(product_ids),
        "products_by_source": dict(sorted(products_by_source.items())),
        "demand_signals": len(demand_ids),
        "demand_by_source": dict(sorted(demand_by_source.items())),
        "product_demand_links": sum(
            result.get("product_demand_links", 0) for result in results
        ),
        "product_ids": sorted(product_ids),
        "demand_signal_ids": sorted(demand_ids),
        "failures": failures,
        "dry_run": dry_run,
    }
    if not product_ids and not demand_ids:
        messages = "; ".join(item["message"] for item in failures[:3])
        raise RuntimeError(f"A coleta semanal não retornou dados. {messages}".strip())

    LOGGER.info("Coleta semanal concluída: %s", json.dumps(summary, ensure_ascii=False))
    return summary


__all__ = ["DEFAULT_LIMIT", "DEFAULT_WINDOW_DAYS", "run"]
