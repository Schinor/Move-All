"""Extractors de produto por marketplace."""

from .aliexpress import AliExpressExtractor
from .alibaba import AlibabaExtractor
from .amazon import AmazonExtractor
from .amazon_br import AmazonBRExtractor
from .mercado_livre import MercadoLivreExtractor
from .shopee_br import ShopeeBRExtractor
from .taobao import TaobaoExtractor
from .tiktok_shop import TikTokShopExtractor

__all__ = [
    "AliExpressExtractor",
    "AlibabaExtractor",
    "AmazonExtractor",
    "AmazonBRExtractor",
    "MercadoLivreExtractor",
    "ShopeeBRExtractor",
    "TaobaoExtractor",
    "TikTokShopExtractor",
]
