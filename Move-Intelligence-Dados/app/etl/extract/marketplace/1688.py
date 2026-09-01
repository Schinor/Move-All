"""Extractor de produtos 1688.

O nome do arquivo segue a plataforma. Para importar em código Python, use
``importlib.import_module('app.etl.extract.marketplace.1688')``.
"""

import re

from .common import MarketplaceExtractor, MarketplaceProfile


PROFILE = MarketplaceProfile(
    source="1688",
    country="cn",
    query_template="site:detail.1688.com/offer {query}",
    accepted_url=re.compile(r"detail\.1688\.com/offer/", re.IGNORECASE),
    default_currency="CNY",
)


class Supplier1688Extractor(MarketplaceExtractor):
    def __init__(self, client=None):
        super().__init__(PROFILE, client)


__all__ = ["Supplier1688Extractor"]
