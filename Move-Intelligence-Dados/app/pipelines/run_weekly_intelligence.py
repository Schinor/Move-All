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
from typing import Any, Iterable, Mapping, Optional

from app.etl.extract.marketplace.common import BrightDataClient
from app.etl.load.database import get_session
from app.etl.transform.correlate import load_keyword_map
from app.pipelines import run_live_intelligence


LOGGER = logging.getLogger(__name__)
DEFAULT_WINDOW_DAYS = 7
DEFAULT_LIMIT = 10

# Rotação da descoberta (F1.4): cada execução processa só a fração de termos
# com `last_discovery_at` mais antigo (≈⅓ por semana). Estado em
# `business_rule_configs` (key discovery_rotation / scope weekly). Na primeira
# execução (sem estado), processa tudo (backfill inicial).
ROTATION_KEY = "discovery_rotation"
ROTATION_SCOPE = "weekly"
ROTATION_FRACTION = 3


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


def _term_key(cluster: str, variant: int) -> str:
    return f"{cluster}#{variant}"


def _load_rotation_state(db) -> dict[str, str]:
    """`{term_key: last_discovery_at_iso}`; vazio quando a tabela não existe."""
    from sqlalchemy import text

    try:
        rows = db.execute(
            text(
                "SELECT value FROM business_rule_configs "
                "WHERE key = :key AND scope = :scope "
                "ORDER BY updated_at DESC LIMIT 1"
            ),
            {"key": ROTATION_KEY, "scope": ROTATION_SCOPE},
        ).fetchall()
    except Exception:
        db.rollback()
        LOGGER.warning("Rotação da descoberta indisponível (sem business_rule_configs); processando tudo")
        return {}
    if not rows:
        return {}
    value = rows[0][0]
    if isinstance(value, dict):
        return {str(k): str(v) for k, v in value.items()}
    try:
        loaded = json.loads(value) if isinstance(value, str) else {}
    except ValueError:
        return {}
    return {str(k): str(v) for k, v in loaded.items()} if isinstance(loaded, dict) else {}


def _save_rotation_state(db, state: Mapping[str, str]) -> None:
    """Persiste o estado; ignora quando a tabela não existe (ex.: SQLite de teste)."""
    import uuid as uuid_module

    from sqlalchemy import text

    payload = json.dumps(dict(state), ensure_ascii=False)
    try:
        # CURRENT_TIMESTAMP vale em PostgreSQL e SQLite (NOW() é só PG).
        updated = db.execute(
            text(
                "UPDATE business_rule_configs SET value = :value, updated_at = CURRENT_TIMESTAMP "
                "WHERE key = :key AND scope = :scope"
            ),
            {"value": payload, "key": ROTATION_KEY, "scope": ROTATION_SCOPE},
        ).rowcount
        if not updated:
            db.execute(
                text(
                    "INSERT INTO business_rule_configs "
                    "(id, key, scope, value, active, valid_from, updated_at) "
                    "VALUES (:id, :key, :scope, :value, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                ),
                {
                    "id": str(uuid_module.uuid4()),
                    "value": payload,
                    "key": ROTATION_KEY,
                    "scope": ROTATION_SCOPE,
                },
            )
        db.commit()
    except Exception:
        db.rollback()
        LOGGER.warning("Rotação da descoberta não persistida (sem business_rule_configs)")


def _select_due_terms(
    term_jobs: list[tuple[str, int, str]],
    state: Mapping[str, str],
) -> tuple[list[tuple[str, int, str]], dict[str, str]]:
    """Fatia de termos da execução + estado atualizado (função pura, testável)."""
    if not state:
        return list(term_jobs), {}
    ordered = sorted(term_jobs, key=lambda job: state.get(_term_key(job[0], job[1]), ""))
    take = max(1, -(-len(ordered) // ROTATION_FRACTION))  # teto de n/3
    return ordered[:take], {}


def _stamp_terms(selected: list[tuple[str, int, str]], state: Mapping[str, str], now_iso: str) -> dict[str, str]:
    stamped = dict(state)
    for cluster, variant, _term in selected:
        stamped[_term_key(cluster, variant)] = now_iso
    return stamped


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
    max_calls: Optional[int] = None,
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

    # Rotação (F1.4): fora de dry_run, processa só a fatia com
    # last_discovery_at mais antigo. A3.6: o carimbo só é gravado DEPOIS, e
    # só para os termos processados com sucesso (falha tenta de novo na
    # próxima execução). A3.5: a primeira execução (sem estado de rodízio)
    # também respeita o teto DISCOVERY_MAX_CALLS, estimado por termo.
    discovery_budget = run_live_intelligence.resolve_discovery_budget(max_calls)
    rotation_state: dict[str, str] = {}
    had_rotation_state = False
    if not dry_run:
        rotation_session = get_session(database_url)
        try:
            rotation_state = _load_rotation_state(rotation_session)
            had_rotation_state = bool(rotation_state)
            selected, _ = _select_due_terms(term_jobs, rotation_state)
            term_jobs = selected
        finally:
            rotation_session.close()

    if max_terms is not None:
        term_jobs = term_jobs[: max(0, int(max_terms))]

    budget_capped = False
    if not dry_run and not had_rotation_state and term_jobs:
        per_term_calls = len(source_list) * (1 + max(1, min(int(limit), 10)))
        if include_demand:
            per_term_calls += 2 * len(geo_list)
        allowed_terms = max(1, discovery_budget // max(1, per_term_calls))
        if len(term_jobs) > allowed_terms:
            term_jobs = term_jobs[:allowed_terms]
            budget_capped = True
            LOGGER.info(
                "Primeira execução limitada pelo teto: %d termos (orçamento %d)",
                allowed_terms, discovery_budget,
            )

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
    succeeded_jobs: list[tuple[str, int, str]] = []
    with ThreadPoolExecutor(max_workers=term_workers) as executor:
        futures = {executor.submit(collect_term, job): job for job in term_jobs}
        for position, future in enumerate(as_completed(futures), start=1):
            job = futures[future]
            result, term_failure = future.result()
            if result is not None:
                results.append(result)
                succeeded_jobs.append(job)
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

    # A3.6: carimba last_discovery_at só para os termos concluídos com
    # sucesso — depois do processamento, nunca antes da coleta.
    if not dry_run and succeeded_jobs:
        stamp_session = get_session(database_url)
        try:
            fresh_state = _load_rotation_state(stamp_session)
            base_state = fresh_state or rotation_state
            _save_rotation_state(
                stamp_session,
                _stamp_terms(succeeded_jobs, base_state, datetime.now(timezone.utc).isoformat()),
            )
        finally:
            stamp_session.close()

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
        "rotation_applied": bool(rotation_state),
        "discovery_max_calls": discovery_budget,
        "budget_capped": budget_capped,
        "dry_run": dry_run,
    }
    if not product_ids and not demand_ids:
        messages = "; ".join(item["message"] for item in failures[:3])
        raise RuntimeError(f"A coleta semanal não retornou dados. {messages}".strip())

    LOGGER.info("Coleta semanal concluída: %s", json.dumps(summary, ensure_ascii=False))
    return summary


__all__ = ["DEFAULT_LIMIT", "DEFAULT_WINDOW_DAYS", "run"]
