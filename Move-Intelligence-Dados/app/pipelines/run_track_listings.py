"""Loop de acompanhamento de anúncios (F1.3): `--pipeline track-listings`.

Seleciona `tracked_listings` com `status IN ('ACTIVE','CANDIDATE')` e
`next_due_at <= agora`, ordenado por tier e `next_due_at`, respeitando o
orçamento de chamadas (D1 pendente: `max_calls` ou `TRACK_LISTINGS_MAX_CALLS`,
default 50). Para cada anúncio, `scrape_as_markdown` DIRETO na
`canonical_url` (sem `search_engine`) → parser da fonte → insere
`ListingObservation` (append-only).

Falhas: `not_found` 3x seguidas → `DEAD`. `blocked` (403/captcha) → backoff
exponencial (2^n horas a partir da sequência de bloqueios, teto 48h) SEM
incrementar a contagem que leva a `DEAD`. Preço fora de ±60% da mediana das
últimas 4 observações `ok` do anúncio → `scrape_status='partial'`.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from statistics import median
from typing import Any, Optional

from app.etl.extract.marketplace import parsers
from app.etl.extract.marketplace.common import BrightDataClient, BrightDataMcpError
from app.etl.load.database import ListingObservationModel, TrackedListingModel, get_session

LOGGER = logging.getLogger(__name__)

DUE_STATUSES = ("ACTIVE", "CANDIDATE")
NOT_FOUND_AFTER_FAILURES = 3
PRICE_DEVIATION = 0.60
PRIOR_OK_WINDOW = 4
MAX_BACKOFF_HOURS = 48

# Cadência por tier (sugestão D2: tier 1 2x/semana, tier 2 semanal,
# tier 3 quinzenal). D2 pendente: ajuste aqui quando o usuário decidir.
# Cadência por nível (Subprojeto D): 1 = 2x/semana, 2 = semanal, 3 = mensal.
# Espelho de TRACK_CADENCE_DAYS em Move-Intelligence-Back/src/modules/ingestion/tracking-tiers.ts.
TIER_CADENCE_DAYS = {1: 3.5, 2: 7.0, 3: 30.0}

SOURCE_COUNTRY = {
    "amazon_br": "br",
    "mercado_livre": "br",
    "shopee_br": "br",
    "tiktok_shop": "br",
    "amazon": "us",
    "alibaba": "cn",
    "aliexpress": "us",
    "1688": "cn",
    "taobao": "cn",
}


def _naive_utc(value: datetime) -> datetime:
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _resolve_budget(max_calls: Optional[int]) -> int:
    if max_calls is not None:
        return max(0, int(max_calls))
    try:
        return max(0, int(os.getenv("TRACK_LISTINGS_MAX_CALLS", "50")))
    except ValueError:
        return 50


_MCP_NOT_PAGE_ERRORS = (
    "no codex",
    "não encontrado no codex",
    "nao encontrado no codex",
    "not found in codex",
    "não configurada",
    "nao configurada",
    "descoberta pelo codex",
    "falha de conexão",
    "falha de conexao",
    "sessão",
    "sessao",
    "inicializa",
    "excedeu o tempo",
    "retornou http 5",
)


def _classify_error(error: Exception) -> str:
    """'not_found' | 'blocked' | 'error'.

    `blocked` (403/captcha) nunca conta para DEAD; erro genérico tem o mesmo
    tratamento conservador do bloqueio (backoff, sem contar para DEAD).
    """
    status = getattr(error, "status", None)
    try:
        status_code = int(status) if status is not None else None
    except (TypeError, ValueError):
        status_code = None
    message = str(error or "").casefold()
    if isinstance(error, BrightDataMcpError) and any(marker in message for marker in _MCP_NOT_PAGE_ERRORS):
        return "error"
    if status_code == 404 or "not found" in message or "não encontrad" in message:
        return "not_found"
    if status_code == 403 or "captcha" in message or "blocked" in message or "bloque" in message:
        return "blocked"
    return "error"


def _prior_ok_prices(db, listing_id: str) -> list[float]:
    rows = (
        db.query(ListingObservationModel)
        .filter(
            ListingObservationModel.listing_id == listing_id,
            ListingObservationModel.scrape_status == "ok",
        )
        .order_by(ListingObservationModel.observed_at.desc())
        .limit(PRIOR_OK_WINDOW)
        .all()
    )
    prices = [float(row.price) for row in rows if row.price is not None]
    return [price for price in prices if price > 0]


def _trailing_blocked_count(db, listing_id: str) -> int:
    """Bloqueios consecutivos desde o último sucesso (para o backoff)."""
    rows = (
        db.query(ListingObservationModel)
        .filter(ListingObservationModel.listing_id == listing_id)
        .order_by(ListingObservationModel.observed_at.desc())
        .limit(24)
        .all()
    )
    count = 0
    for row in rows:
        if row.scrape_status in ("blocked", "error"):
            count += 1
        else:
            break
    return count


def run(
    *,
    database_url: Optional[str] = None,
    client: Optional[BrightDataClient] = None,
    max_calls: Optional[int] = None,
    dry_run: bool = False,
    now: Optional[datetime] = None,
) -> dict[str, Any]:
    moment = _naive_utc(now or datetime.now(timezone.utc))
    budget = _resolve_budget(max_calls)
    active_client = client or BrightDataClient()
    if client is None and not active_client.is_configured():
        LOGGER.error("Bright Data não configurada (BRIGHTDATA_MCP_URL/API key): acompanhamento não executado.")
        return {
            "status": "not_configured",
            "dry_run": dry_run,
            "due_selected": 0,
            "processed": 0,
            "failures": 0,
            "observation_ids": [],
        }

    db = get_session(database_url)
    try:
        due = (
            db.query(TrackedListingModel)
            .filter(
                TrackedListingModel.status.in_(DUE_STATUSES),
                TrackedListingModel.next_due_at <= moment,
            )
            .order_by(TrackedListingModel.tier.asc(), TrackedListingModel.next_due_at.asc())
            .limit(budget)
            .all()
        )

        observation_ids: list[str] = []
        processed = 0
        failures = 0

        for listing in due:
            processed += 1
            country = SOURCE_COUNTRY.get(listing.source, "br")
            try:
                markdown = active_client.scrape(listing.canonical_url, country)
            except Exception as error:  # falha de coleta: backoff, sem observação de preço
                outcome = _classify_error(error)
                status = "not_found" if outcome == "not_found" else "blocked"
                failures += 1
                if not dry_run:
                    _record_outcome(db, listing, moment, status, None, None)
                    observation_ids.append(_insert_observation(
                        db, listing, moment, None, status, parser_version=f"{listing.source}@pending",
                    ))
                    db.commit()
                else:
                    observation_ids.append(f"dry-run:{listing.id}")
                if status == "not_found":
                    LOGGER.warning("Anúncio %s não encontrado (%s falhas)", listing.id, listing.consecutive_failures)
                else:
                    LOGGER.warning("Anúncio %s bloqueado; backoff sem contar para DEAD", listing.id)
                continue

            try:
                parsed = parsers.parse(listing.source, markdown)
                parser_version = parsed.parser_version
            except ValueError:
                # Fonte sem parser de acompanhamento: parcial explícito.
                parsed = None
                parser_version = f"{listing.source}@pending"

            scrape_status = parsed.scrape_status if parsed else "partial"
            price = parsed.price if parsed else None
            if price is not None and scrape_status == "ok":
                priors = _prior_ok_prices(db, listing.id) if not dry_run else []
                if priors:
                    reference = median(priors)
                    if reference > 0 and abs(price - reference) / reference > PRICE_DEVIATION:
                        # Preço anômalo: partial, excluído das análises.
                        scrape_status = "partial"
                        LOGGER.warning(
                            "Preço anômalo em %s (%.2f vs mediana %.2f): partial",
                            listing.id, price, reference,
                        )

            if not dry_run:
                _record_outcome(db, listing, moment, "success", markdown, parsed)
                observation_ids.append(_insert_observation(
                    db, listing, moment, parsed, scrape_status, parser_version=parser_version,
                ))
                # A3.7: CANDIDATE vira ACTIVE na primeira observação ok do
                # acompanhamento (parcial/bloqueio não promove).
                if listing.status == "CANDIDATE" and scrape_status == "ok":
                    listing.status = "ACTIVE"
                # A5: avalia se passou da hora de reamostrar os textos de
                # avaliação (só loga por enquanto — a raspagem das páginas de
                # reviews e o parser de amostras entram com fixtures de
                # reviews, hoje um gap do A1).
                if scrape_status == "ok" and parsed and parsed.reviews_count:
                    from app.pipelines.review_sampling import should_collect_samples

                    try:
                        due = should_collect_samples(
                            reviews_count=parsed.reviews_count,
                            reviews_count_at_sample=listing.reviews_count_at_sample,
                        )
                    except Exception:
                        due = False
                    if due:
                        LOGGER.info(
                            "Amostra de reviews devida em %s (%s reviews; última base %s) — parser pendente",
                            listing.id, parsed.reviews_count, listing.reviews_count_at_sample,
                        )
                db.commit()
            else:
                observation_ids.append(f"dry-run:{listing.id}")

        return {
            "status": "success",
            "due_selected": len(due),
            "processed": processed,
            "failures": failures,
            "observation_ids": observation_ids,
            "dry_run": dry_run,
        }
    finally:
        db.close()


def _record_outcome(db, listing: TrackedListingModel, moment: datetime, outcome: str, markdown: Any, parsed: Any) -> None:
    listing.last_seen_at = moment
    if outcome == "success":
        listing.last_success_at = moment
        listing.consecutive_failures = 0
        cadence = TIER_CADENCE_DAYS.get(listing.tier or 3, 30.0)
        listing.next_due_at = moment + timedelta(days=cadence)
    elif outcome == "not_found":
        listing.consecutive_failures = (listing.consecutive_failures or 0) + 1
        if listing.consecutive_failures >= NOT_FOUND_AFTER_FAILURES:
            listing.status = "DEAD"
        cadence = TIER_CADENCE_DAYS.get(listing.tier or 3, 30.0)
        listing.next_due_at = moment + timedelta(days=cadence)
    else:  # blocked / error: backoff exponencial, sem contar para DEAD
        streak = _trailing_blocked_count(db, listing.id) + 1
        delay_hours = min(2**streak, MAX_BACKOFF_HOURS)
        listing.next_due_at = moment + timedelta(hours=delay_hours)


def _insert_observation(db, listing: TrackedListingModel, moment: datetime, parsed: Any, scrape_status: str, *, parser_version: str) -> str:
    distribution = getattr(parsed, "rating_distribution", None) if parsed else None
    observation = ListingObservationModel(
        id=str(uuid.uuid4()),
        listing_id=listing.id,
        observed_at=moment,
        price=parsed.price if parsed and parsed.price is not None else None,
        currency=parsed.currency if parsed else None,
        rating=parsed.rating if parsed else None,
        reviews_count=parsed.reviews_count if parsed else None,
        sold_count_raw=parsed.sold_count_raw if parsed else None,
        sold_count_lower=parsed.sold_count_lower if parsed else None,
        best_seller_rank=parsed.best_seller_rank if parsed else None,
        in_stock=parsed.in_stock if parsed else None,
        # Distribuição de estrelas 1–5 (A5); observações sem título/vendedor
        # dedicados: a tabela não tem essas colunas (título real chega ao
        # matching pela linha de IntelligenceProduct, A3.2).
        rating_distribution=dict(distribution) if distribution else None,
        scrape_status=scrape_status,
        parser_version=parser_version,
        is_synthetic=False,
    )
    db.add(observation)
    db.flush()
    return observation.id


__all__ = ["DUE_STATUSES", "TIER_CADENCE_DAYS", "run"]
