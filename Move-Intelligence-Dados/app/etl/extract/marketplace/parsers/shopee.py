"""Parser de acompanhamento da Shopee (shopee_br) — v2 (A2).

Ordem: JSON-LD (oferta única) → blocos do markdown validados na fixture
→ partial sem inventar.

Fixture (14/09/2026): `shopee_br/product-01.md` (Halter 24kg,
i.531460825.22498340866, 4,7K chars). Título + " | Shopee Brasil";
preços "R$1.161,80" (2×) e "R$1.290,00" (âncora "de"); "Nenhuma avaliação
ainda" (reviews 0, rating None — honesto, não inventa 4.8); sem "X
vendidos" na página (sold None); sem nome de vendedor (só o link
institucional "Central do Vendedor" — seller None, nunca inventado).
"""

from __future__ import annotations

import re
from typing import Optional

from .base import (
    ParsedListing,
    extract_json_ld_products,
    extract_title,
    fix_mojibake,
    main_price,
    parse_in_stock,
    parse_sold_count,
    product_price,
    product_rating,
    symbol_to_currency,
)

PARSER_VERSION = "shopee@2"

_NO_REVIEWS_RE = re.compile(r"Nenhuma avalia", re.IGNORECASE)
_REVIEWS_RE = re.compile(r"(?P<count>[\d\.]+)\s*avalia", re.IGNORECASE)
_RATING_RE = re.compile(
    r"(?P<rating>\d[,\.]\d)\s*(?:de 5|out of 5|/ ?5)?\s*(?:estrelas?|stars?)",
    re.IGNORECASE,
)


def _rating_reviews(text: str) -> tuple[Optional[float], Optional[int]]:
    if _NO_REVIEWS_RE.search(text):
        return None, 0
    rating: Optional[float] = None
    match = _RATING_RE.search(text)
    if match:
        try:
            rating = float(match.group("rating").replace(",", "."))
        except ValueError:
            rating = None
    reviews: Optional[int] = None
    match = _REVIEWS_RE.search(text)
    if match:
        try:
            reviews = int(match.group("count").replace(".", ""))
        except ValueError:
            reviews = None
    return rating, reviews


def parse(markdown: str) -> ParsedListing:
    text = fix_mojibake(markdown)
    title = extract_title(text)
    sold_raw, sold_lower = parse_sold_count(text)
    in_stock = parse_in_stock(text)

    products = extract_json_ld_products(text)
    if len(products) == 1:
        product = products[0]
        price, currency, ambiguous = product_price(product)
        rating, reviews_count = product_rating(product)
        if not ambiguous and price is not None:
            md_rating, md_reviews = _rating_reviews(text)
            return ParsedListing(
                price=price,
                currency=currency or "BRL",
                rating=rating if rating is not None else md_rating,
                reviews_count=reviews_count if reviews_count is not None else md_reviews,
                sold_count_raw=sold_raw,
                sold_count_lower=sold_lower,
                best_seller_rank=None,
                in_stock=in_stock,
                scrape_status="ok",
                parser_version=PARSER_VERSION,
                title=title,
            )

    main = main_price(text)
    md_rating, md_reviews = _rating_reviews(text)
    if main is not None and title is not None:
        value, symbol = main
        return ParsedListing(
            price=value,
            currency=symbol_to_currency(symbol, "BRL"),
            rating=md_rating,
            reviews_count=md_reviews,
            sold_count_raw=sold_raw,
            sold_count_lower=sold_lower,
            best_seller_rank=None,
            in_stock=in_stock,
            scrape_status="ok",
            parser_version=PARSER_VERSION,
            title=title,
        )

    return ParsedListing(
        price=None,
        currency=None,
        rating=md_rating,
        reviews_count=md_reviews,
        sold_count_raw=sold_raw,
        sold_count_lower=sold_lower,
        best_seller_rank=None,
        in_stock=in_stock,
        scrape_status="partial",
        parser_version=PARSER_VERSION,
        title=title,
    )


__all__ = ["PARSER_VERSION", "parse"]
