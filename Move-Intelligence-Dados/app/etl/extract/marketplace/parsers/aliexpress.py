"""Parser de acompanhamento do AliExpress — v1 conservador (A2, A4).

SEM fixture real (A1: item /item/<id>.html bloqueado no unlocker). Só
JSON-LD (oferta única) + título genérico; sem padrão validado, preço
ambíguo vira `partial`. Fonte de sourcing/custo (nunca preço de venda BR);
a moeda padrão (USD) será validada na fixture. Campos B2B (fornecedor,
MOQ, faixas) entram quando houver fixture.
"""

from __future__ import annotations

from .base import (
    ParsedListing,
    extract_json_ld_products,
    extract_title,
    fix_mojibake,
    parse_sold_count,
    product_price,
    product_rating,
)

PARSER_VERSION = "aliexpress@1"


def parse(markdown: str) -> ParsedListing:
    text = fix_mojibake(markdown)
    title = extract_title(text)
    sold_raw, sold_lower = parse_sold_count(text)

    products = extract_json_ld_products(text)
    if len(products) == 1:
        product = products[0]
        price, currency, ambiguous = product_price(product)
        rating, reviews_count = product_rating(product)
        if not ambiguous and price is not None:
            return ParsedListing(
                price=price,
                currency=currency or "USD",
                rating=rating,
                reviews_count=reviews_count,
                sold_count_raw=sold_raw,
                sold_count_lower=sold_lower,
                best_seller_rank=None,
                in_stock=None,
                scrape_status="ok",
                parser_version=PARSER_VERSION,
                title=title,
            )

    return ParsedListing(
        price=None,
        currency=None,
        rating=None,
        reviews_count=None,
        sold_count_raw=sold_raw,
        sold_count_lower=sold_lower,
        best_seller_rank=None,
        in_stock=None,
        scrape_status="partial",
        parser_version=PARSER_VERSION,
        title=title,
    )


__all__ = ["PARSER_VERSION", "parse"]
