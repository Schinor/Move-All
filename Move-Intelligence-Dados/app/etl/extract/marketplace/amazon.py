"""Extractor de produtos Amazon US."""

import re

from .common import MarketplaceExtractor, MarketplaceProfile


PROFILE = MarketplaceProfile(
    source="amazon",
    country="us",
    query_template="site:amazon.com/dp {query}",
    accepted_url=re.compile(r"amazon\.com/dp/[A-Z0-9]{10}", re.IGNORECASE),
    default_currency="USD",
)


class AmazonExtractor(MarketplaceExtractor):
    def __init__(self, client=None):
        super().__init__(PROFILE, client)


__all__ = ["AmazonExtractor"]
