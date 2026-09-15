"""Contrato dos parsers de acompanhamento (F1.2, A2).

Cada parser expõe ``parse(markdown) -> ParsedListing``. A ordem de extração
é: JSON-LD / ``application/ld+json`` quando existir → blocos do markdown
validados nas fixtures reais (A1) → regex. Cada padrão fonte-específico cita
a fixture que o originou no docstring do módulo.

Sem fixture real para a fonte (A1 com gaps: aliexpress, 1688, tiktok_shop,
páginas de avaliações), o parser é só JSON-LD + título genérico: preço
ambíguo vira ``scrape_status='partial'`` em vez de chute.
"""

from .alibaba import PARSER_VERSION as ALIBABA_PARSER_VERSION
from .alibaba import parse as parse_alibaba
from .aliexpress import PARSER_VERSION as ALIEXPRESS_PARSER_VERSION
from .aliexpress import parse as parse_aliexpress
from .amazon import PARSER_VERSION as AMAZON_PARSER_VERSION
from .amazon import parse as _parse_amazon
from .base import ParsedListing, parse_sold_count
from .mercado_livre import PARSER_VERSION as MERCADO_LIVRE_PARSER_VERSION
from .mercado_livre import parse as parse_mercado_livre
from .p1688 import PARSER_VERSION as P1688_PARSER_VERSION
from .p1688 import parse as parse_p1688
from .shopee import PARSER_VERSION as SHOPEE_PARSER_VERSION
from .shopee import parse as parse_shopee
from .tiktok_shop import PARSER_VERSION as TIKTOK_SHOP_PARSER_VERSION
from .tiktok_shop import parse as parse_tiktok_shop

PARSERS = {
    "alibaba": parse_alibaba,
    "aliexpress": parse_aliexpress,
    "amazon": _parse_amazon,
    "amazon_br": lambda markdown: _parse_amazon(markdown, default_currency="BRL"),
    "mercado_livre": parse_mercado_livre,
    "shopee_br": parse_shopee,
    "1688": parse_p1688,
    "tiktok_shop": parse_tiktok_shop,
}


def parse_amazon(markdown: str) -> ParsedListing:
    """Amazon US (default USD)."""
    return _parse_amazon(markdown)


def parse(source: str, markdown: str) -> ParsedListing:
    """Despacha o markdown para o parser da fonte."""
    try:
        return PARSERS[source](markdown)
    except KeyError:
        raise ValueError(f"Fonte sem parser de acompanhamento: {source}") from None


__all__ = [
    "ALIBABA_PARSER_VERSION",
    "ALIEXPRESS_PARSER_VERSION",
    "AMAZON_PARSER_VERSION",
    "MERCADO_LIVRE_PARSER_VERSION",
    "P1688_PARSER_VERSION",
    "PARSERS",
    "SHOPEE_PARSER_VERSION",
    "TIKTOK_SHOP_PARSER_VERSION",
    "ParsedListing",
    "parse",
    "parse_alibaba",
    "parse_aliexpress",
    "parse_amazon",
    "parse_mercado_livre",
    "parse_p1688",
    "parse_shopee",
    "parse_sold_count",
    "parse_tiktok_shop",
]
