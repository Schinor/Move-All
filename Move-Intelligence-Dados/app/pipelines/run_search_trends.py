"""Subprojeto C: coleta semanal do Google Trends por tipo (1 termo por requisição, sem âncora).

Uso:
  python -m app.pipelines.run_search_trends --dry-run
  python -m app.pipelines.run_search_trends
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import time
import uuid
from typing import Any, Callable, Optional, Sequence

import requests
from sqlalchemy import text

from app.etl.extract.demand_signal.google_trends import (
    GoogleTrendsExtractor,
    trend_growth,
    trends_timeout_seconds,
)
from app.etl.extract.marketplace.common import BrightDataMcpError, BrightDataRequestError
from app.etl.load.database import SearchTrendSnapshotModel, get_session


LOGGER = logging.getLogger(__name__)
TIMEFRAME = "today 12-m"
GEO_BY_LANGUAGE = {"pt": "BR", "en": "US"}
RETRY_DELAYS_SECONDS = (15, 45)
REQUEST_PAUSE_SECONDS = 5
CIRCUIT_BREAKER_ERROR_STREAK = 5
CIRCUIT_BREAKER_PAUSE_SECONDS = 10 * 60
CIRCUIT_BREAKER_MAX_PAUSES = 3


def is_retryable_trends_error(error: BaseException) -> bool:
    """Retry apenas transporte, timeout e HTTP 5xx do Bright Data MCP."""
    if isinstance(error, ValueError):
        return False
    if isinstance(
        error,
        (TimeoutError, ConnectionError, requests.exceptions.Timeout, requests.exceptions.ConnectionError),
    ):
        return True
    if isinstance(error, BrightDataRequestError):
        return 500 <= error.status < 600
    if isinstance(error, BrightDataMcpError):
        message = str(error).casefold()
        return bool(
            re.search(r"\b(?:http\s+)?5\d{2}\b", message)
            or any(
                marker in message
                for marker in (
                    "conexão",
                    "connection",
                    "timeout",
                    "timed out",
                    "tempo total",
                    "excedeu o tempo",
                    "falha ao iniciar sessão",
                    "recusou a inicialização",
                    "resposta de inicialização inválida",
                )
            )
        )
    response = getattr(error, "response", None)
    status = getattr(response, "status_code", None)
    return isinstance(status, int) and 500 <= status < 600


def fetch_with_retries(
    extractor: GoogleTrendsExtractor,
    term: str,
    geo: str,
    *,
    sleep_fn: Callable[[float], None] = time.sleep,
):
    for attempt in range(len(RETRY_DELAYS_SECONDS) + 1):
        try:
            return extractor.fetch_payload(term, geo)
        except Exception as error:  # noqa: BLE001 — classificação abaixo decide o retry
            if not is_retryable_trends_error(error) or attempt >= len(RETRY_DELAYS_SECONDS):
                raise
            delay = RETRY_DELAYS_SECONDS[attempt]
            LOGGER.warning(
                "Trends falhou para %s/%s (tentativa %d/%d): %s; nova tentativa em %ss",
                term,
                geo,
                attempt + 1,
                len(RETRY_DELAYS_SECONDS) + 1,
                error,
                delay,
            )
            sleep_fn(delay)


def load_active_terms(session) -> list[tuple[str, str, str]]:
    rows = session.execute(
        text(
            "SELECT category, term, language "
            "FROM keyword_terms "
            "WHERE active = true AND category IS NOT NULL "
            "ORDER BY category, language"
        )
    ).fetchall()
    return [(row[0], row[1], GEO_BY_LANGUAGE[row[2]]) for row in rows if row[2] in GEO_BY_LANGUAGE]


def load_recent_successes(session) -> set[tuple[str, str, str]]:
    rows = session.execute(
        text(
            "SELECT type_key, term, geo "
            "FROM search_trend_snapshots "
            "WHERE status IN ('ok', 'sem_volume') "
            "AND captured_at >= CURRENT_TIMESTAMP - INTERVAL '6 days'"
        )
    ).fetchall()
    return {(str(row[0]), str(row[1]), str(row[2])) for row in rows}


def run(
    *,
    terms: Optional[Sequence[tuple[str, str, str]]] = None,
    client: Any = None,
    session: Any = None,
    dry_run: bool = False,
    max_requests: Optional[int] = None,
    database_url: Optional[str] = None,
    force: bool = False,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> dict[str, int]:
    owns_session = session is None
    db = session or get_session(database_url)
    try:
        jobs = list(terms) if terms is not None else load_active_terms(db)
        budget = max_requests if max_requests is not None else int(os.getenv("TRENDS_MAX_REQUESTS_PER_RUN", "200"))
        summary = {
            "planned": len(jobs),
            "requested": 0,
            "ok": 0,
            "sem_volume": 0,
            "erro": 0,
            "skipped_by_budget": 0,
            "skipped_recent": 0,
            "circuit_breaker_pauses": 0,
            "stopped_by_circuit_breaker": 0,
        }
        recent = set() if force else load_recent_successes(db)
        pending_jobs = []
        for job in jobs:
            if not force and tuple(job) in recent:
                summary["skipped_recent"] += 1
                LOGGER.info("[radar] pulado por coleta recente · %s · %s · %s", job[0], job[2], job[1])
                continue
            pending_jobs.append(job)
        if dry_run:
            for type_key, term, geo in pending_jobs:
                LOGGER.info("[dry-run] %s · %s · %s", type_key, geo, term)
            summary["skipped_by_budget"] = max(0, len(pending_jobs) - budget)
            return summary

        extractor = GoogleTrendsExtractor(
            client=client,
            timeframe=TIMEFRAME,
            timeout=trends_timeout_seconds(),
        )
        error_streak = 0
        for type_key, term, geo in pending_jobs:
            if summary["requested"] >= budget:
                summary["skipped_by_budget"] += 1
                continue
            if summary["requested"]:
                sleep_fn(REQUEST_PAUSE_SECONDS)
            summary["requested"] += 1
            row = SearchTrendSnapshotModel(
                id=str(uuid.uuid4()),
                type_key=type_key,
                term=term,
                geo=geo,
                timeframe=TIMEFRAME,
            )
            try:
                payload = fetch_with_retries(extractor, term, geo, sleep_fn=sleep_fn)
                growth = trend_growth(payload.points)
                row.status = growth["status"]
                row.points = payload.points
                row.last_value = growth["last_value"]
                row.growth_4w = growth["growth_4w"]
                row.growth_12w = growth["growth_12w"]
                row.related_top = payload.related_top
                row.related_rising = payload.related_rising
            except Exception as error:  # noqa: BLE001 — falha de um termo não para a coleta
                row.status = "erro"
                row.error = str(error)[:500]
                row.points, row.related_top, row.related_rising = [], [], []
                LOGGER.warning("Trends falhou para %s/%s: %s", term, geo, error)
            summary[row.status] += 1
            db.add(row)
            db.commit()
            if row.status == "erro":
                error_streak += 1
            else:
                error_streak = 0
            if error_streak >= CIRCUIT_BREAKER_ERROR_STREAK:
                error_streak = 0
                summary["circuit_breaker_pauses"] += 1
                LOGGER.warning(
                    "[radar] disjuntor: %d erros consecutivos; pausando por %ds",
                    CIRCUIT_BREAKER_ERROR_STREAK,
                    CIRCUIT_BREAKER_PAUSE_SECONDS,
                )
                sleep_fn(CIRCUIT_BREAKER_PAUSE_SECONDS)
                if summary["circuit_breaker_pauses"] >= CIRCUIT_BREAKER_MAX_PAUSES:
                    summary["stopped_by_circuit_breaker"] = 1
                    LOGGER.error(
                        "[radar] disjuntor acionado após %d pausas; resumo: %s",
                        CIRCUIT_BREAKER_MAX_PAUSES,
                        summary,
                    )
                    break
        return summary
    finally:
        if owns_session:
            db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Radar de demanda (Google Trends por tipo)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-requests", type=int, default=None)
    parser.add_argument("--force", action="store_true", help="ignora snapshots ok/sem_volume dos últimos 6 dias")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    print(run(dry_run=args.dry_run, max_requests=args.max_requests, force=args.force))


if __name__ == "__main__":
    main()
