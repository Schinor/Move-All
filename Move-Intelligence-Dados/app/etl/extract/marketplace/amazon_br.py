"""Extractor de produtos Amazon Brasil."""

import re

from .common import MarketplaceExtractor, MarketplaceProfile


PROFILE = MarketplaceProfile(
    source="amazon_br",
    country="br",
    query_template="site:amazon.com.br/dp {query}",
    accepted_url=re.compile(r"amazon\.com\.br/.*dp/[A-Z0-9]{10}", re.IGNORECASE),
    default_currency="BRL",
)


class AmazonBRExtractor(MarketplaceExtractor):
    def __init__(self, client=None):
        super().__init__(PROFILE, client)


__all__ = ["AmazonBRExtractor"]
