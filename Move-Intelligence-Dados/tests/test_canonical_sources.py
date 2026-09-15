"""Testes do enum único de fontes (F1.8)."""

from app.etl.sources import (
    CANONICAL_SOURCES,
    is_canonical_source,
    normalize_source,
)


def test_aliases_normalizam_para_canonica():
    assert normalize_source("mercadolivre") == "mercado_livre"
    assert normalize_source("tiktok-shop") == "tiktok_shop"
    assert normalize_source("google-shopping") == "google_shopping"
    assert normalize_source("shopee") == "shopee_br"
    assert normalize_source("1688") == "1688"


def test_enum_tem_as_dez_fontes():
    assert set(CANONICAL_SOURCES) == {
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
        # A4: fonte de sourcing/custo.
        "aliexpress",
    }
    assert is_canonical_source("mercado_livre")
    assert is_canonical_source("aliexpress")
    assert not is_canonical_source("mercadolivre")
