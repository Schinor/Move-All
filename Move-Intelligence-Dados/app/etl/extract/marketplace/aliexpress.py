"""Extractor de produtos AliExpress (A4).

Fonte de SOURCING/CUSTO (junto de Alibaba e 1688), nunca preço de venda BR.
ID nativo = dígitos do item em `/item/<id>.html`. Moeda padrão: a página
varia por região do comprador — a fixture real (A1) valida; o parser (A2)
lê a moeda do JSON-LD quando existir.
"""

import re

from .common import MarketplaceExtractor, MarketplaceProfile


PROFILE = MarketplaceProfile(
    source="aliexpress",
    country="us",
    query_template="site:aliexpress.com/item {query}",
    accepted_url=re.compile(r"aliexpress\.com/item/\d+\.html", re.IGNORECASE),
    default_currency="USD",
)


class AliExpressExtractor(MarketplaceExtractor):
    def __init__(self, client=None):
        super().__init__(PROFILE, client)


__all__ = ["AliExpressExtractor"]
