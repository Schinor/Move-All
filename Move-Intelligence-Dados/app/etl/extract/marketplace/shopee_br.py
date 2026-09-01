"""Extractor de produtos Shopee Brasil."""

import re

from .common import MarketplaceExtractor, MarketplaceProfile


PROFILE = MarketplaceProfile(
    source="shopee_br",
    country="br",
    query_template="site:shopee.com.br {query}",
    accepted_url=re.compile(r"shopee\.com\.br/.*-i\.\d+\.\d+", re.IGNORECASE),
    default_currency="BRL",
)


class ShopeeBRExtractor(MarketplaceExtractor):
    def __init__(self, client=None):
        super().__init__(PROFILE, client)


__all__ = ["ShopeeBRExtractor"]
