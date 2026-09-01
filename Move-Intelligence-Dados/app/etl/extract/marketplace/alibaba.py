"""Extractor de produtos Alibaba."""

import re

from .common import MarketplaceExtractor, MarketplaceProfile


PROFILE = MarketplaceProfile(
    source="alibaba",
    country="us",
    query_template="site:alibaba.com/product-detail {query}",
    accepted_url=re.compile(r"alibaba\.com/product-detail/", re.IGNORECASE),
    default_currency="USD",
)


class AlibabaExtractor(MarketplaceExtractor):
    def __init__(self, client=None):
        super().__init__(PROFILE, client)


__all__ = ["AlibabaExtractor"]
