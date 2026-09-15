"""Parser de acompanhamento do Mercado Livre — v2 (A2).

Ordem: JSON-LD (oferta única) → blocos do markdown validados nas fixtures
→ partial sem inventar.

Fixtures (14/09/2026):
- `mercado_livre/product-01.md`: página de CATÁLOGO /p/MLB28528777 (Odin
  Fit 24kg). Título repetido; "Novo | +500 vendidos"; "4.7 Avaliação 4.7
  de 5. 47 opiniões"; "Acesse a Loja Oficial de Odin Fit"; 54 menções de
  preço (ofertas agregadas de variantes).
- `mercado_livre/product-02.md`: página de ANÚNCIO MLB-2083738377 (30kg).
  "R$813,71 / R$594 27% OFF / 12x R$57,44": o R$ imediatamente antes de
  "N% OFF" é o preço vigente (594), o anterior é lista; parcela nunca é
  preço. "Novo | +25 vendidos"; "Vendido por AIKAU"; "Estoque disponível";
  sem bloco de avaliação (rating None, honesto).
"""

from __future__ import annotations

import re
from typing import Optional

from .base import (
    ParsedListing,
    extract_json_ld_products,
    extract_title,
    fix_mojibake,
    is_freight,
    is_installment,
    is_list_price,
    main_price,
    parse_amount,
    parse_bsr,
    parse_in_stock,
    parse_sold_count,
    price_candidates,
    product_price,
    product_rating,
    symbol_to_currency,
)

PARSER_VERSION = "mercado_livre@2"

# Fixtures product-01 ("R$778,90 34% OFF") e product-02 ("R$594 27% OFF",
# colado: "R$59427% OFF"): o R$ imediatamente antes de "N% OFF" é o vigente.
# O número pode vir colado ("59427"): separa pela cauda = nº do OFF
# ("594"+"27"; "778,90"+"34"), convenção de centavos das páginas BR.
# OFF com 1–2 dígitos: com 3, "59427%" casaria off="427" em vez de "27".
_OFF_RE = re.compile(r"(?P<off>\d{1,2})\s*%\s*OFF", re.IGNORECASE)
_SELLER_RES = [
    # Fixture product-02: "Vendido por[AIKAU](https://...".
    re.compile(r"Vendido por\[?([^\]\n\(]{2,60})"),
    # Fixture product-01: "Acesse a Loja Oficial de Odin Fit".
    re.compile(r"Loja Oficial de\s+([^\n\]\)]{2,60})"),
]
_RATING_RE = re.compile(
    r"(?P<rating>\d[,\.]\d)\s*(?:Avalia[cç][aã]o\s*)?(?:\d[,\.]\d\s*)?de 5",
    re.IGNORECASE,
)
_REVIEWS_RE = re.compile(r"(?P<count>[\d\.,]+)\s*opini[õo]es", re.IGNORECASE)


def _current_price(text: str) -> Optional[tuple[float, str]]:
    """Preço vigente: R$ antes de "N% OFF"; senão a heurística principal."""
    off = _OFF_RE.search(text)
    if off:
        before = text[max(0, off.start() - 40):off.start()]
        price_match = re.search(r"R\$\s?([\d\.,]+)\s*$", before)
        if price_match:
            blob = price_match.group(1)
            tail = off.group("off")
            if blob.endswith(tail) and len(blob) > len(tail):
                blob = blob[: -len(tail)]
            value = parse_amount(blob)
            if value is not None:
                return value, "R$"
    # Sem OFF: exclui parcela/frete/lista e pega o mais frequente (nunca parcela).
    candidates = [
        (value, symbol, start, end)
        for value, symbol, start, end in price_candidates(text)
        if not is_installment(text, start, end)
        and not is_list_price(text, start, end)
        and not is_freight(text, start, end)
    ]
    if not candidates:
        return None
    counts: dict[tuple[float, str], int] = {}
    order: list[tuple[float, str]] = []
    for value, symbol, _s, _e in candidates:
        key = (round(value, 2), symbol)
        if key not in counts:
            counts[key] = 0
            order.append(key)
        counts[key] += 1
    best = max(order, key=lambda key: (counts[key], -order.index(key)))
    return best[0], best[1]


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
    match = _REVIEWS_RE.search(text)
    if match:
        try:
            reviews = int(re.sub(r"[^\d]", "", match.group("count")))
        except ValueError:
            reviews = None
    return rating, reviews


def parse(markdown: str) -> ParsedListing:
    text = fix_mojibake(markdown)
    title = extract_title(text)
    sold_raw, sold_lower = parse_sold_count(text)
    seller = _seller(text)
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
                seller=seller,
            )

    current = _current_price(text)
    md_rating, md_reviews = _rating_reviews(text)
    if current is not None and title is not None:
        value, symbol = current
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
            seller=seller,
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
        seller=seller,
    )


__all__ = ["PARSER_VERSION", "parse"]
