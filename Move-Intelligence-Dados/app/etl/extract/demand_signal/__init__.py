"""Extractors de sinais de demanda; não contém persistência."""

from .google_trends import GoogleTrendsExtractor
from .tiktok_search import TikTokSearchExtractor

__all__ = ["GoogleTrendsExtractor", "TikTokSearchExtractor"]
