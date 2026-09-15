"""Fornecedor de alto volume por cluster (A6, decisão 8).

"Alto volume" (configurável): fornecedor com a MAIOR soma de
vendidos/transações entre os anúncios do cluster, OU presente em ≥ N
anúncios do mesmo cluster (default N = 2). Foco em fontes B2B (Alibaba,
1688, AliExpress), onde dá para negociar direto com o fabricante.
"""

from __future__ import annotations

import os
from collections import defaultdict
from typing import Iterable, Mapping, Optional


def min_listings_for_volume() -> int:
    """N mínimo de anúncios do mesmo cluster (default 2)."""
    try:
        return max(1, int(os.getenv("SUPPLIER_HIGH_VOLUME_MIN_LISTINGS", "2")))
    except ValueError:
        return 2


def select_top_supplier(
    rows: Iterable[Mapping[str, object]],
    *,
    min_listings: Optional[int] = None,
) -> Optional[dict[str, object]]:
    """Devolve `{"source", "native_supplier_id", "reason"}` ou None.

    Cada linha: `{"source", "native_supplier_id", "sold"}` (`sold` = soma de
    vendidos/transações do anúncio; None conta como 0, mas mantém presença).
    Sem linhas com fornecedor identificado: None (nunca inventar).
    """
    threshold = min_listings if min_listings is not None else min_listings_for_volume()
    totals: dict[tuple[str, str], float] = defaultdict(float)
    presence: dict[tuple[str, str], int] = defaultdict(int)
    for row in rows:
        source = str(row.get("source") or "").strip()
        native_id = str(row.get("native_supplier_id") or "").strip()
        if not source or not native_id:
            continue
        key = (source, native_id)
        sold = row.get("sold")
        totals[key] += float(sold) if isinstance(sold, (int, float)) and sold > 0 else 0.0
        presence[key] += 1
    if not totals:
        return None

    def rank(key: tuple[str, str]) -> tuple[int, float, int, str, str]:
        # Presença em ≥ N anúncios do cluster primeiro (evidência mais forte
        # de abastecimento deste produto); volume desempatada e decide o resto.
        return (
            1 if presence[key] >= threshold else 0,
            totals[key],
            presence[key],
            key[0],
            key[1],
        )

    best = max(totals, key=rank)
    if presence[best] >= threshold:
        reason = f"presente em {presence[best]} anúncios do cluster"
    elif totals[best] > 0:
        reason = f"maior volume somado ({totals[best]:g} vendidos/transações)"
    else:
        return None
    return {"source": best[0], "native_supplier_id": best[1], "reason": reason}


def detected_sources(rows: Iterable[Mapping[str, object]]) -> list[str]:
    """Fontes onde o produto do cluster foi observado (A6, 'detectado em')."""
    return sorted({str(row.get("source") or "").strip() for row in rows if str(row.get("source") or "").strip()})


__all__ = ["detected_sources", "min_listings_for_volume", "select_top_supplier"]
