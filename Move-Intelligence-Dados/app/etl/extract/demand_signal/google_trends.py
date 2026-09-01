"""Extractor de Google Trends via Bright Data.

Não há fallback para ``pytrends``: a fonte do MVP é deliberadamente única e
qualquer bloqueio ou mudança no payload deve aparecer como erro observável para
que o dado não seja substituído por uma simulação.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone
from typing import Any, Iterable, Mapping, Optional
from urllib.parse import quote, urlencode

from ..marketplace.common import BrightDataClient


def _as_number(value: Any) -> Optional[float]:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    text = re.sub(r"[^0-9,.-]", "", str(value or ""))
    if not text:
        return None
    if "," in text and "." in text:
        text = text.replace(",", "") if text.rfind(".") > text.rfind(",") else text.replace(".", "").replace(",", ".")
    elif "," in text:
        text = text.replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def _date_from_value(value: Any) -> Optional[date]:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if value is None:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    try:
        if text.isdigit():
            return datetime.fromtimestamp(int(text), tz=timezone.utc).date()
        return datetime.fromisoformat(text).date()
    except (ValueError, OverflowError):
        try:
            return date.fromisoformat(text[:10])
        except ValueError:
            return None


def _extract_json_after_key(text: str, key: str) -> Any:
    match = re.search(rf"[\"']?{re.escape(key)}[\"']?\s*:\s*", text)
    if not match:
        return None
    start = match.end()
    while start < len(text) and text[start].isspace():
        start += 1
    if start >= len(text) or text[start] not in "[{":
        return None

    opening = text[start]
    closing = "]" if opening == "[" else "}"
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == opening:
            depth += 1
        elif char == closing:
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start : index + 1])
                except json.JSONDecodeError:
                    return None
    return None


def _timeline_rows(response: Any) -> list[Mapping[str, Any]]:
    if isinstance(response, str):
        try:
            response = json.loads(response)
        except json.JSONDecodeError:
            response = _extract_json_after_key(response, "timelineData")

    if isinstance(response, Mapping):
        for key in ("timelineData", "timeline_data", "interest_over_time"):
            value = response.get(key)
            if isinstance(value, list):
                return [row for row in value if isinstance(row, Mapping)]
        for key in ("data", "result", "results", "content"):
            nested = response.get(key)
            rows = _timeline_rows(nested)
            if rows:
                return rows
        for nested in response.values():
            rows = _timeline_rows(nested)
            if rows:
                return rows
    if isinstance(response, list):
        direct_rows = [
            row
            for row in response
            if isinstance(row, Mapping)
            and ("time" in row or "date" in row or "week_start" in row)
        ]
        if direct_rows:
            return direct_rows
        for nested in response:
            rows = _timeline_rows(nested)
            if rows:
                return rows
    return []


def parse_bright_data_response(
    response: Any,
    keyword: str,
    geo: str,
    captured_at: Optional[date] = None,
) -> list[dict[str, Any]]:
    """Converte ``timelineData`` do Bright Data em registros brutos do ETL."""

    captured = captured_at or datetime.now(timezone.utc).date()
    rows: list[dict[str, Any]] = []
    for item in _timeline_rows(response):
        observed_date = _date_from_value(
            item.get("time") or item.get("date") or item.get("week_start")
        )
        values = item.get("value")
        if isinstance(values, list):
            value = values[0] if values else None
        else:
            value = values or item.get("raw_value") or item.get("interest_value")
        number = _as_number(value)
        if observed_date is None or number is None:
            continue
        rows.append(
            {
                "keyword": keyword,
                "geo": geo,
                "source": "google_trends",
                "week_start": observed_date.isoformat(),
                "raw_value": number,
                "captured_at": captured.isoformat(),
            }
        )
    if not rows:
        raise ValueError(f"Bright Data não retornou timelineData para {keyword!r}/{geo}")
    return rows


class GoogleTrendsExtractor:
    """Coleta a janela configurada através do MCP Bright Data."""

    def __init__(
        self,
        client: Optional[BrightDataClient] = None,
        timeframe: str = "today 12-m",
        base_url: str = "https://trends.google.com/trends/explore",
    ):
        self.client = client
        self.timeframe = timeframe
        self.base_url = base_url

    def build_url(self, keyword: str, geo: str) -> str:
        params = {
            "date": self.timeframe,
            "q": keyword,
            "brd_trends": "timeseries",
            "brd_json": "1",
        }
        if geo.upper() != "GLOBAL":
            params["geo"] = geo.lower()
        return f"{self.base_url}?{urlencode(params, quote_via=quote)}"

    def extract(
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
                response = active_client.google_trends(self.build_url(keyword, geo))
                collected.extend(parse_bright_data_response(response, keyword, geo, captured_at))
        return collected


__all__ = ["GoogleTrendsExtractor", "parse_bright_data_response"]
