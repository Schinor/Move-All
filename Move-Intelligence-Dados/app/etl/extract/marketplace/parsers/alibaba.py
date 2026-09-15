"""Parser de acompanhamento do Alibaba — v1 (A2, decisão 8: sourcing).

Fonte B2B: o que importa é o FORNECEDOR (nome, anos, selo, MOQ, faixas de
preço por quantidade, volume), não um "preço de venda".

Fixture (14/09/2026): `alibaba/product-01.md` (oferta 1601248525393,
página em holandês). SEM JSON-LD. Fornecedor no link da loja
"[SHANDONG AOCHUANG FITNESS EQUIPMENT CO., LTD](https://acfitness.m.en.alibaba.com/...)";
"9 jaar" (anos); "5/5(266)" (nota + avaliações); faixa "€82,82-93,28"
(mojibake "â82¬" normalizado pelo fix_mojibake); quebras "1 - 20 /
21 - 100 / 101 - 500 / > 500"; "Minimale bestelhoeveelheid: 30 stukken"
(MOQ 30). Preço unitário único NÃO existe na página (é faixa por
quantidade) → `price` fica None e as faixas vão para `price_tiers`.

`scrape_status` ok = título + fornecedor + MOQ (identidade B2B completa).
"""

from __future__ import annotations

import re
from typing import Any, Optional

from .base import (
    ParsedListing,
    extract_json_ld_products,
    extract_title,
    fix_mojibake,
    parse_amount,
    parse_sold_count,
    product_price,
    product_rating,
)

PARSER_VERSION = "alibaba@1"

# Fixture: link da loja "[NOME](https://<loja>.m.en.alibaba.com/...".
_SUPPLIER_RE = re.compile(
    r"\[([A-Z][^\]]{3,120}?)\]\(https?://[a-z0-9\-]+\.m\.en\.alibaba\.com",
    re.IGNORECASE,
)
_YEARS_RE = re.compile(r"(\d{1,2})\s*(?:jaar|years?|anos?)", re.IGNORECASE)
_VERIFIED_RE = re.compile(
    r"(verified supplier|geverifieerd|verificado|diamond member|assessed supplier)",
    re.IGNORECASE,
)
# Fixture: "5/5(266)".
_RATING_RE = re.compile(r"(\d(?:[,\.]\d)?)\s*/\s*5\s*\(([\d\.]+)\)")
# Fixture: "Minimale bestelhoeveelheid: 30 stukken" / "Min. Order: 30".
_MOQ_RES = [
    re.compile(r"Minimale bestelhoeveelheid\s*:?\s*(\d+)", re.IGNORECASE),
    re.compile(r"Min\.?\s*Order\s*:?\s*(\d+)", re.IGNORECASE),
    re.compile(r"\bMOQ\s*:?\s*(\d+)", re.IGNORECASE),
]
# Fixture: "€82,82-93,28".
_PRICE_RANGE_RE = re.compile(r"€\s?([\d\.,]+)\s*-\s*€?\s?([\d\.,]+)")
# Fixture: quebras "1 - 20" ... "> 500".
_BREAK_RE = re.compile(r"(?P<lo>\d+)\s*-\s*(?P<hi>\d+)")
_BREAK_OPEN_RE = re.compile(r">\s*(?P<lo>\d+)")


def _supplier(text: str) -> tuple[Optional[str], Optional[int], Optional[bool]]:
    name: Optional[str] = None
    match = _SUPPLIER_RE.search(text)
    if match:
        # O texto do link traz o alt da imagem ("... CO., LTD logo").
        name = re.sub(r"\s+", " ", match.group(1)).strip()
        name = re.sub(r"\s+logo$", "", name, flags=re.IGNORECASE)
    years: Optional[int] = None
    match = _YEARS_RE.search(text)
    if match:
        try:
            years = int(match.group(1))
        except ValueError:
            years = None
    verified: Optional[bool] = None
    if _VERIFIED_RE.search(text):
        verified = True
    return (name or None), years, verified


def _moq(text: str) -> Optional[int]:
    for pattern in _MOQ_RES:
        match = pattern.search(text)
        if match:
            try:
                return int(match.group(1))
            except ValueError:
                continue
    return None


def _tiers(text: str) -> Optional[list[dict[str, Any]]]:
    tiers: list[dict[str, Any]] = []
    seen: set[tuple[int, Optional[int]]] = set()
    for match in _BREAK_RE.finditer(text):
        # "€82,82-93,28" (faixa de preço) não é quebra por quantidade:
        # ignora quando o match está colado num decimal ("82,82|-93") ou
        # com moeda na vizinhança. Quebras reais são inteiras ("1 - 20").
        glued = text[max(0, match.start() - 3):match.start()]
        if re.search(r"\d[,\.]$", glued) or re.search(r"[€$R¥]", text[max(0, match.start() - 10):match.start()]):
            continue
        try:
            key = (int(match.group("lo")), int(match.group("hi")))
        except ValueError:
            continue
        if key not in seen:
            seen.add(key)
            tiers.append({"min_qty": key[0], "max_qty": key[1], "price": None})
    match = _BREAK_OPEN_RE.search(text)
    if match:
        try:
            key = (int(match.group("lo")), None)
            if key not in seen:
                seen.add(key)
                tiers.append({"min_qty": key[0], "max_qty": None, "price": None})
        except ValueError:
            pass
    return tiers or None


def parse(markdown: str) -> ParsedListing:
    text = fix_mojibake(markdown)
    title = extract_title(text)
    sold_raw, sold_lower = parse_sold_count(text)
    supplier_name, supplier_years, supplier_verified = _supplier(text)
    moq = _moq(text)
    tiers = _tiers(text)

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
                seller=supplier_name,
                supplier_name=supplier_name,
                supplier_years=supplier_years,
                supplier_verified=supplier_verified,
                moq=moq,
                price_tiers=tiers,
            )

    # Blocos B2B da fixture: nota "5/5(266)", MOQ e faixas por quantidade.
    rating: Optional[float] = None
    reviews_count: Optional[int] = None
    match = _RATING_RE.search(text)
    if match:
        try:
            rating = float(match.group(1).replace(",", "."))
            reviews_count = int(match.group(2).replace(".", ""))
        except ValueError:
            rating, reviews_count = None, None

    if title is not None and supplier_name is not None and moq is not None:
        return ParsedListing(
            price=None,
            currency="EUR" if "€" in text else "USD",
            rating=rating,
            reviews_count=reviews_count,
            sold_count_raw=sold_raw,
            sold_count_lower=sold_lower,
            best_seller_rank=None,
            in_stock=None,
            scrape_status="ok",
            parser_version=PARSER_VERSION,
            title=title,
            seller=supplier_name,
            supplier_name=supplier_name,
            supplier_years=supplier_years,
            supplier_verified=supplier_verified,
            moq=moq,
            price_tiers=tiers,
        )

    return ParsedListing(
        price=None,
        currency=None,
        rating=rating,
        reviews_count=reviews_count,
        sold_count_raw=sold_raw,
        sold_count_lower=sold_lower,
        best_seller_rank=None,
        in_stock=None,
        scrape_status="partial",
        parser_version=PARSER_VERSION,
        title=title,
        seller=supplier_name,
        supplier_name=supplier_name,
        supplier_years=supplier_years,
        supplier_verified=supplier_verified,
        moq=moq,
        price_tiers=tiers,
    )


__all__ = ["PARSER_VERSION", "parse"]
