"""Parser de acompanhamento da Amazon (amazon / amazon_br) — v2 (A2).

Ordem: JSON-LD (schema.org Product, oferta única) → blocos do markdown
validados nas fixtures → partial sem inventar.

Fixtures (14/09/2026, ~38 reqs Bright Data, conta nova):
- `amazon_br/product-01.md`: Halter MKFIT 24kg (B0GW1D1V58). SEM JSON-LD.
  Preço principal "R$ 559,55" perto de "Em estoque"; lista "R$ 639,00"
  após "Preço sem oferta" (aparece MAIS vezes que o principal — frequência
  sozinha erraria); parcelas "Em 12x de R$ 47,64" nunca são preço;
  "Vendido por: MK FIT ECOMMERCE"; "5,0 de 5 estrelas, 3 avaliações";
  distribuição "5..1 estrelas 100%0%0%0%0%"; sem BSR numérico; sem
  "N+ comprados no mês" (sold None, honesto).
- `amazon/product-01.md`: página US (mesmos blocos em inglês; vários
  "Sold by X" — vale o primeiro, do buybox).
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
    parse_bsr,
    parse_in_stock,
    parse_sold_count,
    parse_stars_distribution,
    product_price,
    product_rating,
    symbol_to_currency,
)

PARSER_VERSION = "amazon@2"

_SELLER_RES = [
    # Fixture amazon_br/product-01: "Vendido por: MK FIT ECOMMERCE".
    re.compile(r"Vendido por:?\s*([^\n\]\)]{2,80})"),
    # Fixture amazon/product-01: "Sold by AtivaFit and ships from ..." (buybox).
    re.compile(r"Sold by\s+([A-Z0-9][^\n\]\)]{1,60}?)(?:\s+and ships|\s*[\n\]])"),
]

_RATING_RE = re.compile(
    r"(?P<rating>\d[,\.]\d)\s*(?:de 5|out of 5|/ ?5)?\s*(?:estrelas?|stars?)",
    re.IGNORECASE,
)
# A contagem de avaliações de ANÚNCIOS RELACIONADOS polui a página (fixture
# amazon_br/product-01: "58 avaliações" de um patrocinado vs "3 avaliações
# globais" do produto). Ancorar no bloco do produto primeiro.
_GLOBAL_REVIEWS_RES = [
    # Fixture amazon_br/product-01: "3 avaliações globais".
    re.compile(r"(?P<count>[\d\.,]+)\s*avalia[cç][oõ]es?\s+globais", re.IGNORECASE),
    re.compile(
        r"(?P<rating>\d[,\.]\d)\s*(?:de 5|out of 5)\s*(?:estrelas?|stars?)[^.\n]{0,80}?"
        r"(?P<count>[\d\.,]+)\s*(?:avalia[cç][oõ]es?|ratings?|reviews?)",
        re.IGNORECASE,
    ),
]
_REVIEWS_RE = re.compile(
    r"(?P<count>[\d\.,]+)\s*(?:avalia[cç][oõ]es?|avaliações globais|ratings|reviews)",
    re.IGNORECASE,
)


def _seller(text: str) -> Optional[str]:
    for pattern in _SELLER_RES:
        match = pattern.search(text)
        if match:
            name = re.sub(r"\s+", " ", match.group(1)).strip(" -–—:;")
            if name and len(name) >= 2:
                return name
    return None


def _rating_reviews(text: str) -> tuple[Optional[float], Optional[int]]:
    rating: Optional[float] = None
    match = _RATING_RE.search(text)
    if match:
        try:
            rating = float(match.group("rating").replace(",", "."))
        except ValueError:
            rating = None
    reviews: Optional[int] = None
    for pattern in (*_GLOBAL_REVIEWS_RES, _REVIEWS_RE):
        match = pattern.search(text)
        if not match:
            continue
        try:
            reviews = int(re.sub(r"[^\d]", "", match.group("count")))
            break
        except (ValueError, IndexError):
            continue
    return rating, reviews


def parse(markdown: str, default_currency: str = "USD") -> ParsedListing:
    text = fix_mojibake(markdown)
    title = extract_title(text)
    sold_raw, sold_lower = parse_sold_count(text)
    seller = _seller(text)
    distribution = parse_stars_distribution(text)
    in_stock = parse_in_stock(text)
    bsr = parse_bsr(text)

    products = extract_json_ld_products(text)
    if len(products) == 1:
        product = products[0]
        price, currency, ambiguous = product_price(product)
        rating, reviews_count = product_rating(product)
        if not ambiguous and price is not None:
            md_rating, md_reviews = _rating_reviews(text)
            return ParsedListing(
                price=price,
                currency=currency,
                rating=rating if rating is not None else md_rating,
                reviews_count=reviews_count if reviews_count is not None else md_reviews,
                sold_count_raw=sold_raw,
                sold_count_lower=sold_lower,
                best_seller_rank=bsr,
                in_stock=in_stock,
                scrape_status="ok",
                parser_version=PARSER_VERSION,
                title=title,
                seller=seller,
                rating_distribution=distribution,
            )

    # Blocos do markdown (fixtures acima): principal, nunca parcela/lista.
    main = main_price(text)
    md_rating, md_reviews = _rating_reviews(text)
    if main is not None and title is not None:
        value, symbol = main
        return ParsedListing(
            price=value,
            currency=symbol_to_currency(symbol, default_currency),
            rating=md_rating,
            reviews_count=md_reviews,
            sold_count_raw=sold_raw,
            sold_count_lower=sold_lower,
            best_seller_rank=bsr,
            in_stock=in_stock,
            scrape_status="ok",
            parser_version=PARSER_VERSION,
            title=title,
            seller=seller,
            rating_distribution=distribution,
        )

    return ParsedListing(
        price=None,
        currency=None,
        rating=md_rating,
        reviews_count=md_reviews,
        sold_count_raw=sold_raw,
        sold_count_lower=sold_lower,
        best_seller_rank=bsr,
        in_stock=in_stock,
        scrape_status="partial",
        parser_version=PARSER_VERSION,
        title=title,
        seller=seller,
        rating_distribution=distribution,
    )


__all__ = ["PARSER_VERSION", "parse"]
