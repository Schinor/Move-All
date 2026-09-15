"""Fontes canônicas de marketplace (F1.8).

Espelho de `Move-Intelligence-Back/src/shared/types/canonical-sources.ts`:
um único enum, sem variantes `mercadolivre` / `tiktok-shop` /
`google-shopping` fora dos aliases de normalização.
"""

from __future__ import annotations

CANONICAL_SOURCES = (
    "amazon",
    "amazon_br",
    "mercado_livre",
    "shopee_br",
    "tiktok_shop",
    "google_shopping",
    "shein",
    "alibaba",
    "1688",
    "taobao",
    # A4: fonte de sourcing/custo (nunca preço de venda BR).
    "aliexpress",
)

SOURCE_ALIASES = {
    "mercadolivre": "mercado_livre",
    "mercado livre": "mercado_livre",
    "tiktok-shop": "tiktok_shop",
    "tiktokshop": "tiktok_shop",
    "google-shopping": "google_shopping",
    "googleshopping": "google_shopping",
    "google shopping": "google_shopping",
    "shopee": "shopee_br",
    "amazonbr": "amazon_br",
    "amazon br": "amazon_br",
}

BR_SOURCES = frozenset({"amazon_br", "mercado_livre", "shopee_br"})


def normalize_source(value: object) -> str:
    """Normaliza qualquer escrita de fonte para a canônica."""
    lowered = str(value or "").lower().strip()
    if not lowered:
        return lowered
    if lowered in SOURCE_ALIASES:
        return SOURCE_ALIASES[lowered]
    if "1688" in lowered:
        return "1688"
    return lowered


def is_canonical_source(value: object) -> bool:
    """Verdadeiro quando a fonte já está na forma canônica (sem alias)."""
    return str(value or "").lower().strip() in CANONICAL_SOURCES


__all__ = [
    "BR_SOURCES",
    "CANONICAL_SOURCES",
    "SOURCE_ALIASES",
    "is_canonical_source",
    "normalize_source",
]
