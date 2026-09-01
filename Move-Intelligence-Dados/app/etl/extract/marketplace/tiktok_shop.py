"""Extractor de produto do TikTok Shop.

Este módulo aceita somente páginas PDP do Shop. Busca/hashtags pertencem ao
extractor separado ``demand_signal.tiktok_search`` e nunca entram aqui.
"""

import re

from .common import MarketplaceExtractor, MarketplaceProfile


PROFILE = MarketplaceProfile(
    source="tiktok_shop",
    country="us",
    query_template="site:shop.tiktok.com/pdp {query}",
    accepted_url=re.compile(r"shop\.tiktok\.com/.*/pdp/", re.IGNORECASE),
    default_currency="USD",
)


class TikTokShopExtractor(MarketplaceExtractor):
    def __init__(self, client=None):
        super().__init__(PROFILE, client)


__all__ = ["TikTokShopExtractor"]
