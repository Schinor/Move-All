"""Extractor de produtos Taobao."""

import re

from .common import MarketplaceExtractor, MarketplaceProfile


PROFILE = MarketplaceProfile(
    source="taobao",
    country="cn",
    query_template="site:world.taobao.com/item {query}",
    accepted_url=re.compile(r"world\.taobao\.com/item/", re.IGNORECASE),
    default_currency="CNY",
)


class TaobaoExtractor(MarketplaceExtractor):
    def __init__(self, client=None):
        super().__init__(PROFILE, client)


__all__ = ["TaobaoExtractor"]
