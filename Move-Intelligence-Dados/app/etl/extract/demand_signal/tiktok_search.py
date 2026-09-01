"""Extractor de volume atual de hashtag/busca TikTok via Bright Data.

O TikTok não oferece histórico nativo equivalente ao Trends; portanto este
extractor gera snapshots semanais a partir do momento da coleta e não inventa
os 12 meses retroativos.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone
from typing import Any, Iterable, Mapping, Optional
from urllib.parse import quote

from ..marketplace.common import BrightDataClient


def _number(value: Any) -> Optional[float]:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    text = str(value or "").strip().lower().replace(",", "")
    multiplier = 1.0
    if text.endswith("k"):
        multiplier, text = 1000.0, text[:-1]
    elif text.endswith("m"):
        multiplier, text = 1_000_000.0, text[:-1]
    text = re.sub(r"[^0-9.]", "", text)
    try:
        return float(text) * multiplier if text else None
    except ValueError:
        return None


def _find_count(payload: Any) -> Optional[float]:
    if isinstance(payload, Mapping):
        for key in (
            "video_count",
            "post_count",
            "hashtag_count",
            "videoCount",
            "postCount",
            "view_count",
            "count",
        ):
            value = _number(payload.get(key))
            if value is not None:
                return value
        for value in payload.values():
            found = _find_count(value)
            if found is not None:
                return found
    elif isinstance(payload, list):
        for value in payload:
            found = _find_count(value)
            if found is not None:
                return found
    elif isinstance(payload, str):
        try:
            decoded = json.loads(payload)
            found = _find_count(decoded)
            if found is not None:
                return found
        except json.JSONDecodeError:
            pass
        match = re.search(r"([0-9][0-9,.]*\s*[kKmM]?)\s+(?:videos?|posts?)", payload, re.IGNORECASE)
        if match:
            return _number(match.group(1))
    return None


def parse_tiktok_search_response(
    response: Any,
    keyword: str,
    geo: str,
    captured_at: Optional[date] = None,
) -> dict[str, Any]:
    captured = captured_at or datetime.now(timezone.utc).date()
    count = _find_count(response)
    if count is None:
        raise ValueError(f"Bright Data não retornou contagem para {keyword!r}/{geo}")
    return {
        "keyword": keyword,
        "geo": geo,
        "source": "tiktok_search",
        "week_start": captured.isoformat(),
        "raw_value": count,
        "captured_at": captured.isoformat(),
    }


class TikTokSearchExtractor:
    def __init__(
        self,
        client: Optional[BrightDataClient] = None,
        base_url: str = "https://www.tiktok.com/tag",
    ):
        self.client = client
        self.base_url = base_url.rstrip("/")

    def build_url(self, keyword: str, geo: str) -> str:
        slug = quote(keyword.strip().replace(" ", "-"), safe="-")
        return f"{self.base_url}/{slug}?lang=en&region={geo.upper()}"

    def extract_snapshot(
        self,
        keywords: Iterable[str],
        geos: Iterable[str] = ("BR", "US", "GLOBAL"),
        *,
        client: Optional[BrightDataClient] = None,
        captured_at: Optional[date] = None,
    ) -> list[dict[str, Any]]:
        active_client = client or self.client or BrightDataClient()
        collected: list[dict[str, Any]] = []
        for geo in geos:
            for keyword in keywords:
                response = active_client.scrape(self.build_url(keyword, geo), "us")
                collected.append(parse_tiktok_search_response(response, keyword, geo, captured_at))
        return collected


__all__ = ["TikTokSearchExtractor", "parse_tiktok_search_response"]
