"""Testes unitários dos parsers de acompanhamento (F1.2, A2).

Usam trechos markdown SINTÉTICOS mínimos (blocos JSON-LD) para validar o
contrato ``parse(markdown) -> ParsedListing``. NÃO são fixtures reais de
página — a validação por fixture real vive em
``tests/test_parser_fixtures.py`` (A1 capturada em 14/09/2026 para amazon,
amazon_br, mercado_livre, shopee_br e alibaba; gaps: aliexpress, 1688,
tiktok_shop e páginas de avaliações).
"""

from app.etl.extract.marketplace.parsers import (
    parse_amazon,
    parse_mercado_livre,
    parse_shopee,
)
from app.etl.extract.marketplace.parsers.base import parse_sold_count

JSON_LD_PRODUCT = """\
# Haltere Ajustável 24kg

```json
{"@context": "https://schema.org", "@type": "Product", "name": "Haltere",
 "offers": {"@type": "Offer", "price": "1199.00", "priceCurrency": "BRL"},
 "aggregateRating": {"@type": "AggregateRating", "ratingValue": "4.8", "reviewCount": "240"}}
```

+1.000 vendidos
"""

JSON_LD_MULTI_OFFER = """\
```json
{"@type": "Product", "name": "X",
 "offers": [{"@type": "Offer", "price": "100.00"}, {"@type": "Offer", "price": "90.00"}]}
```
"""


def test_sold_count_limite_inferior():
    raw, lower = parse_sold_count("+1.000 vendidos")
    assert lower == 1000
    assert raw is not None and "vendidos" in raw


def test_sold_count_mil_multiplica():
    _, lower = parse_sold_count("5 mil vendidos")
    assert lower == 5000


def test_sold_count_sem_mencao_retorna_none():
    assert parse_sold_count("produto em estoque") == (None, None)


def test_amazon_json_ld_inequivoco_ok():
    parsed = parse_amazon(JSON_LD_PRODUCT)
    assert parsed.scrape_status == "ok"
    assert parsed.price == 1199.00
    assert parsed.currency == "BRL"
    assert parsed.rating == 4.8
    assert parsed.reviews_count == 240
    assert parsed.sold_count_lower == 1000
    assert parsed.title == "Haltere Ajustável 24kg"
    assert parsed.parser_version == "amazon@2"


def test_multiplas_ofertas_vira_partial_sem_preco():
    parsed = parse_amazon(JSON_LD_MULTI_OFFER)
    assert parsed.scrape_status == "partial"
    assert parsed.price is None


def test_sem_json_ld_vira_partial_sem_inventar_preco():
    for parse in (parse_amazon, parse_mercado_livre, parse_shopee):
        parsed = parse("# Produto\nPreço: 12x de R$ 99 sem juros\nFrete grátis\n")
        assert parsed.scrape_status == "partial"
        assert parsed.price is None
