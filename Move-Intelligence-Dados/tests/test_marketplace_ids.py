"""Testes de regressão para app/etl/extract/marketplace/common.py::extract_native_id.

Cobrem os bugs de identidade de anúncio descritos em RELATORIO_ANALISE_DADOS_E_SCORES.md,
seção 2.1 A3: o ID do Shopee capturava o shop_id (produtos distintos da mesma loja
colidiam no upsert) e o ID do Mercado Livre incluía o slug do título (mudava se o
vendedor editasse o título, e o anúncio/catálogo do mesmo produto ganhavam IDs
diferentes).
"""

from app.etl.extract.marketplace.common import extract_native_id


# ---------------------------------------------------------------------------
# Shopee
# ---------------------------------------------------------------------------

def test_shopee_extracts_item_id_not_shop_id():
    url = "https://shopee.com.br/Barra-de-Peso-Ajustavel-24kg-i.123456.987654321"

    record_id = extract_native_id(url, "shopee_br")

    # O item_id (2º grupo) é o único globalmente no Shopee; o shop_id (1º grupo,
    # 123456) não deve ser usado como record_id.
    assert record_id == "987654321"


def test_shopee_distinguishes_products_from_the_same_shop():
    # Dois produtos diferentes da mesma loja (mesmo shop_id) precisam gerar
    # record_ids diferentes -- antes colidiam e um sobrescrevia o outro no upsert.
    url_a = "https://shopee.com.br/Halter-Ajustavel-i.123456.111111111"
    url_b = "https://shopee.com.br/Barra-de-Ferro-i.123456.222222222"

    record_id_a = extract_native_id(url_a, "shopee_br")
    record_id_b = extract_native_id(url_b, "shopee_br")

    assert record_id_a != record_id_b
    assert record_id_a == "111111111"
    assert record_id_b == "222222222"


def test_shopee_extracts_item_id_with_querystring():
    url = "https://shopee.com.br/Kit-Halteres-i.123456.987654321?sp_atk=abc123&xptdk=def456"

    record_id = extract_native_id(url, "shopee_br")

    assert record_id == "987654321"


def test_shopee_alternate_product_url_format():
    # Formato alternativo: shopee.com.br/product/{shop_id}/{item_id}
    url = "https://shopee.com.br/product/123456/987654321"

    record_id = extract_native_id(url, "shopee_br")

    assert record_id == "987654321"


# ---------------------------------------------------------------------------
# Mercado Livre
# ---------------------------------------------------------------------------

def test_mercado_livre_normalizes_listing_url_with_title_slug():
    url = "https://produto.mercadolivre.com.br/MLB-3456789012-halter-ajustavel-24kg-_JM"

    record_id = extract_native_id(url, "mercado_livre")

    assert record_id == "MLB3456789012"


def test_mercado_livre_is_stable_when_seller_edits_the_title():
    # Mesmo anúncio (mesmo MLB), título diferente -- o record_id não pode mudar.
    url_before = "https://produto.mercadolivre.com.br/MLB-3456789012-halter-24kg-_JM"
    url_after = "https://produto.mercadolivre.com.br/MLB-3456789012-halter-ajustavel-profissional-_JM"

    assert extract_native_id(url_before, "mercado_livre") == extract_native_id(url_after, "mercado_livre")


def test_mercado_livre_catalog_url_matches_listing_id_format():
    # Página de catálogo: /p/MLB<id> (sem slug). Deve normalizar para o mesmo
    # formato "MLB<dígitos>" usado no anúncio.
    url = "https://www.mercadolivre.com.br/p/MLB12345"

    record_id = extract_native_id(url, "mercado_livre")

    assert record_id == "MLB12345"


def test_mercado_livre_extracts_id_with_querystring():
    url = "https://produto.mercadolivre.com.br/MLB-3456789012-halter-ajustavel-_JM?matt_tool=88888888"

    record_id = extract_native_id(url, "mercado_livre")

    assert record_id == "MLB3456789012"


def test_aliexpress_extracts_item_digits():
    # A4: ID nativo = dígitos do item em /item/<id>.html.
    url = "https://www.aliexpress.com/item/1005006123456789.html?spm=a2g0o.123"

    record_id = extract_native_id(url, "aliexpress")

    assert record_id == "1005006123456789"


def test_aliexpress_registry_e_enum():
    # A4: extractor registrado na descoberta e fonte canônica.
    from app.etl.extract.marketplace.aliexpress import AliExpressExtractor, PROFILE
    from app.etl.sources import CANONICAL_SOURCES, is_canonical_source
    from app.pipelines.run_live_intelligence import SUPPORTED_SOURCES, _extractor_registry

    assert "aliexpress" in CANONICAL_SOURCES
    assert is_canonical_source("aliexpress")
    assert "aliexpress" in SUPPORTED_SOURCES
    assert _extractor_registry()["aliexpress"] is AliExpressExtractor
    assert PROFILE.query_template == "site:aliexpress.com/item {query}"
    assert PROFILE.accepted_url.search("https://www.aliexpress.com/item/123.html")
    assert not PROFILE.accepted_url.search("https://www.aliexpress.com/store/123.html")
