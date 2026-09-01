"""Extractor de produtos do Mercado Livre Brasil."""

import re

from .common import MarketplaceExtractor, MarketplaceProfile


PROFILE = MarketplaceProfile(
    source="mercado_livre",
    country="br",
    query_template="site:mercadolivre.com.br {query}",
    accepted_url=re.compile(r"mercadolivre\.com\.br/(?:p/|[^/]+/p/|MLB-)", re.IGNORECASE),
    default_currency="BRL",
)


class MercadoLivreExtractor(MarketplaceExtractor):
    def __init__(self, client=None):
        super().__init__(PROFILE, client)


__all__ = ["MercadoLivreExtractor"]
