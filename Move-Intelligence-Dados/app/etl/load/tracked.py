"""Deduplicação e registro da descoberta em `tracked_listings` (F1.4).

- Antes de raspar um candidato, a descoberta consulta `tracked_listings`
  por `(source, native_id)`; se já existir, NÃO raspa.
- Candidato novo aprovado (filtro fitness + preço válido + ID nativo
  confiável, isto é, não hash) vira `TrackedListing` com `status='CANDIDATE'`
  e `tier=3`, mais a primeira `ListingObservation` (da raspagem de
  descoberta, `parser_version='discovery@1'`).
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping, Optional

from app.etl.load.database import ListingObservationModel, TrackedListingModel

_HASH_ID_RE = re.compile(r"^[0-9a-f]{32}$")


def is_trusted_native_id(record_id: Any) -> bool:
    """ID nativo confiável = qualquer coisa que não seja o hash de fallback.

    Sem padrão de URL casado, os extractors geram sha1 de 32 hex como
    `record_id`; esse ID não é estável nem raspável de novo, então o
    candidato não entra no acompanhamento.
    """
    text = str(record_id or "").strip()
    if not text:
        return False
    return _HASH_ID_RE.match(text.casefold()) is None


def candidate_url(candidate: Mapping[str, Any]) -> Optional[str]:
    url = candidate.get("url")
    return str(url).strip() if url else None


def load_tracked_keys(db, sources: Iterable[str]) -> set[tuple[str, str]]:
    """Conjunto `(source, native_id)` já acompanhados (para pular na raspagem)."""
    rows = (
        db.query(TrackedListingModel.source, TrackedListingModel.native_id)
        .filter(TrackedListingModel.source.in_(list(sources)))
        .all()
    )
    return {(str(source), str(native_id)) for source, native_id in rows}


def register_new_listings(
    db,
    products: Iterable[Mapping[str, Any]],
    *,
    term: str,
    now: Optional[datetime] = None,
) -> dict[str, Any]:
    """Registra candidatos aprovados como CANDIDATE/tier 3 + 1ª observação.

    Opera na sessão recebida (sem commit próprio): o chamador commita junto
    da transação de load. Só registra com URL canônica conhecida, preço
    válido e ID nativo confiável.
    """
    moment = now or datetime.now(timezone.utc).replace(tzinfo=None)
    if getattr(moment, "tzinfo", None) is not None:
        moment = moment.astimezone(timezone.utc).replace(tzinfo=None)

    registered = 0
    observation_ids: list[str] = []
    for product in products:
        source = str(product.get("source") or "")
        record_id = str(product.get("record_id") or "")
        if not source or not is_trusted_native_id(record_id):
            continue
        try:
            price = float(product.get("price_value"))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        if price <= 0:
            continue
        specific = product.get("source_specific") or {}
        raw_fields = specific.get("_raw_record_fields") or {} if isinstance(specific, Mapping) else {}
        url = (specific.get("source_page_url") if isinstance(specific, Mapping) else None) or raw_fields.get("url")
        if not url:
            continue
        # A3.4: a primeira observação passa pelo parser da fonte (carimbado em
        # parse_detail). Se o parser saiu partial, a observação é partial —
        # nunca "ok" com o preço do extrator genérico. Sem parser para a fonte
        # ("unknown"), mantém "ok" (comportamento anterior).
        parser_status = specific.get("parser_scrape_status") if isinstance(specific, Mapping) else None
        parser_version = specific.get("parser_version") if isinstance(specific, Mapping) else None
        first_status = "partial" if parser_status == "partial" else "ok"
        exists = (
            db.query(TrackedListingModel.id)
            .filter_by(source=source, native_id=record_id)
            .first()
        )
        if exists:
            continue
        listing_id = str(uuid.uuid4())
        db.add(
            TrackedListingModel(
                id=listing_id,
                source=source,
                native_id=record_id,
                canonical_url=str(url),
                status="CANDIDATE",
                tier=3,
                discovered_by_term=term,
                first_seen_at=moment,
                next_due_at=moment,
            )
        )
        # Sem relationship() entre os modelos, o flush ordena a FK.
        db.flush()
        observation_id = str(uuid.uuid4())
        db.add(
            ListingObservationModel(
                id=observation_id,
                listing_id=listing_id,
                observed_at=moment,
                price=price,
                currency=product.get("price_currency"),
                rating=product.get("rating"),
                reviews_count=product.get("reviews_count"),
                scrape_status=first_status,
                parser_version=str(parser_version or "discovery@1"),
                is_synthetic=False,
            )
        )
        registered += 1
        observation_ids.append(observation_id)

    return {"tracked_new": registered, "tracked_observation_ids": observation_ids}


__all__ = [
    "candidate_url",
    "is_trusted_native_id",
    "load_tracked_keys",
    "register_new_listings",
]
