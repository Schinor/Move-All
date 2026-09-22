"""Extractor de Google Trends via Bright Data.

Não há fallback para ``pytrends``: a fonte do MVP é deliberadamente única e
qualquer bloqueio ou mudança no payload deve aparecer como erro observável para
que o dado não seja substituído por uma simulação.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Iterable, Mapping, Optional, Sequence
from urllib.parse import quote, urlencode

from ..marketplace.common import BrightDataClient


LOGGER = logging.getLogger(__name__)
DEFAULT_TRENDS_TIMEOUT = 180


def trends_timeout_seconds() -> int:
    """Timeout exclusivo do Google Trends; os demais extractors continuam em 60s."""
    raw = os.getenv("BRIGHTDATA_TRENDS_TIMEOUT", str(DEFAULT_TRENDS_TIMEOUT)).strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return DEFAULT_TRENDS_TIMEOUT


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
    *,
    keyword_index: int = 0,
    anchor_keyword: Optional[str] = None,
    anchor_index: Optional[int] = None,
) -> list[dict[str, Any]]:
    """Converte ``timelineData`` do Bright Data em registros brutos do ETL.

    Com âncora (A3.8), a requisição traz uma série por termo: ``keyword_index``
    é a posição da keyword e ``anchor_index`` a da âncora. A série da âncora
    vira linhas próprias (mesmo ``request_id``/timeframe a jusante), para que
    execuções diferentes sejam encadeadas sem reescalar o histórico.
    """

    captured = captured_at or datetime.now(timezone.utc).date()

    def _at(values: Any, index: int) -> Optional[float]:
        if isinstance(values, list):
            return _as_number(values[index]) if len(values) > index else None
        return _as_number(values) if index == 0 else None

    rows: list[dict[str, Any]] = []
    for item in _timeline_rows(response):
        observed_date = _date_from_value(
            item.get("time") or item.get("date") or item.get("week_start")
        )
        values = item.get("value")
        if values is None:
            values = item.get("raw_value") or item.get("interest_value")
        number = _at(values, keyword_index)
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
                "anchor_keyword": anchor_keyword,
            }
        )
        if anchor_keyword and anchor_index is not None:
            anchor_number = _at(values, anchor_index)
            if anchor_number is not None:
                rows.append(
                    {
                        "keyword": anchor_keyword,
                        "geo": geo,
                        "source": "google_trends",
                        "week_start": observed_date.isoformat(),
                        "raw_value": anchor_number,
                        "captured_at": captured.isoformat(),
                        "anchor_keyword": anchor_keyword,
                    }
                )
    if not rows:
        raise ValueError(f"Bright Data não retornou timelineData para {keyword!r}/{geo}")
    return rows


_MD_ESCAPES = (("\\[", "["), ("\\]", "]"), ("\\_", "_"), ("\\&", "&"), ("\\*", "*"))


def _unescape_markdown(text: str) -> str:
    for escaped, plain in _MD_ESCAPES:
        text = text.replace(escaped, plain)
    return text


@dataclass
class TrendsPayload:
    points: list = field(default_factory=list)
    related_top: list = field(default_factory=list)
    related_rising: list = field(default_factory=list)


def parse_trends_payload(response: Any) -> TrendsPayload:
    """Resposta do Trends via Bright Data (MCP devolve JSON com escape de markdown)."""
    data = response
    if isinstance(response, str):
        try:
            data = json.loads(_unescape_markdown(response.strip()))
        except json.JSONDecodeError as error:
            raise ValueError(f"Resposta do Trends não é JSON: {error}") from error
    widgets = data.get("widgets") if isinstance(data, Mapping) else None
    if not isinstance(widgets, list):
        raise ValueError("Resposta do Trends sem 'widgets' (TIMESERIES ausente)")
    by_id = {str(widget.get("id")): widget for widget in widgets if isinstance(widget, Mapping)}
    series = by_id.get("TIMESERIES")
    if series is None:
        raise ValueError("Resposta do Trends sem o widget TIMESERIES")

    points = []
    for row in series.get("data", {}).get("default", {}).get("timelineData", []):
        week = _date_from_value(row.get("time"))
        values = row.get("value")
        value = _as_number(values[0] if isinstance(values, list) and values else values)
        if week is None or value is None:
            continue
        points.append({
            "week_start": week.isoformat(),
            "value": int(round(value)),
            "partial": bool(row.get("isPartial")),
        })

    payload = TrendsPayload(points=points)
    related = next((widget for key, widget in by_id.items() if key.startswith("RELATED_QUERIES")), None)
    if related is not None:
        ranked = related.get("data", {}).get("default", {}).get("rankedList", [])
        if len(ranked) > 0:
            payload.related_top = [
                {"query": keyword.get("query"), "value": keyword.get("value")}
                for keyword in ranked[0].get("rankedKeyword", [])
            ]
        if len(ranked) > 1:
            payload.related_rising = [
                {
                    "query": keyword.get("query"),
                    "value": keyword.get("value"),
                    "label": keyword.get("formattedValue"),
                    "breakout": str(keyword.get("formattedValue", "")).strip().lower() == "breakout",
                }
                for keyword in ranked[1].get("rankedKeyword", [])
            ]
    return payload


def _mean(values: Sequence[float]) -> Optional[float]:
    return sum(values) / len(values) if values else None


def trend_growth(points: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Crescimento dentro da MESMA coleta (índice relativo por requisição); ignora a semana parcial."""
    complete = [float(point["value"]) for point in points if not point.get("partial")]
    if not complete or all(value == 0 for value in complete):
        return {
            "last_value": int(complete[-1]) if complete else None,
            "growth_4w": None,
            "growth_12w": None,
            "status": "sem_volume",
        }

    def growth(window: int) -> Optional[float]:
        if len(complete) < 2 * window:
            return None
        recent = _mean(complete[-window:])
        previous = _mean(complete[-2 * window:-window])
        if not previous:
            return None
        return recent / previous - 1

    return {
        "last_value": int(complete[-1]),
        "growth_4w": growth(4),
        "growth_12w": growth(12),
        "status": "ok",
    }


class GoogleTrendsExtractor:
    """Coleta a janela configurada através do MCP Bright Data."""

    def __init__(
        self,
        client: Optional[BrightDataClient] = None,
        timeframe: str = "today 12-m",
        base_url: str = "https://trends.google.com/trends/explore",
        timeout: Optional[int] = None,
    ):
        self.client = client
        self.timeframe = timeframe
        self.base_url = base_url
        self.timeout = timeout if timeout is not None else trends_timeout_seconds()

    def _active_client(self, client: Optional[BrightDataClient] = None) -> BrightDataClient:
        return client or self.client or BrightDataClient(timeout=self.timeout)

    def build_url(self, keywords: Sequence[str] | str, geo: str) -> str:
        terms = [keywords] if isinstance(keywords, str) else [term for term in keywords if str(term).strip()]
        if not terms:
            raise ValueError("Google Trends exige ao menos 1 termo")
        # A Bright Data recusa `q` repetido; vários termos vão no MESMO q, separados por vírgula.
        params = [
            ("date", self.timeframe),
            ("q", ",".join(str(term).strip() for term in terms)),
            ("brd_trends", "timeseries,related_queries"),
            ("brd_json", "1"),
        ]
        if geo.upper() != "GLOBAL":
            params.append(("geo", geo.lower()))
        return f"{self.base_url}?{urlencode(params, quote_via=quote, doseq=True)}"

    def fetch_payload(self, term: str, geo: str, client: Optional[BrightDataClient] = None) -> TrendsPayload:
        """Subprojeto C: 1 termo por requisição, sem âncora."""
        active_client = self._active_client(client)
        return parse_trends_payload(active_client.google_trends(self.build_url([term], geo)))

    def extract(
        self,
        keywords: Iterable[str],
        geos: Iterable[str] = ("BR", "US", "GLOBAL"),
        *,
        client: Optional[BrightDataClient] = None,
        captured_at: Optional[date] = None,
        anchor_keyword: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """Coleta a janela; com âncora, keyword + âncora na MESMA requisição.

        A3.8: a âncora (ex.: "academia") torna execuções comparáveis sem
        reescalar. Se a Bright Data não aceitar múltiplos termos, registra o
        aviso e mantém só o crescimento por keyword (sem âncora).
        """
        active_client = self._active_client(client)
        anchor = (anchor_keyword or "").strip() or None
        collected: list[dict[str, Any]] = []
        for geo in geos:
            for keyword in keywords:
                terms = [keyword] + (
                    [anchor] if anchor and anchor.casefold() != keyword.strip().casefold() else []
                )
                with_anchor = len(terms) > 1
                try:
                    response = active_client.google_trends(self.build_url(terms, geo))
                    rows = parse_bright_data_response(
                        response, keyword, geo, captured_at,
                        anchor_keyword=anchor if with_anchor else None,
                        anchor_index=1 if with_anchor else None,
                    )
                    if with_anchor and not any(row["keyword"] == anchor for row in rows):
                        LOGGER.warning(
                            "Bright Data não retornou a série da âncora %r; "
                            "mantido só o crescimento por keyword",
                            anchor,
                        )
                except ValueError:
                    raise
                except Exception as error:
                    if not with_anchor:
                        raise
                    # Possível rejeição a múltiplos termos: registra e tenta só
                    # a keyword, sem âncora.
                    LOGGER.warning(
                        "Bright Data não aceitou múltiplos termos no Trends "
                        "(%s); mantido só o crescimento por keyword, sem âncora",
                        error,
                    )
                    response = active_client.google_trends(self.build_url([keyword], geo))
                    rows = parse_bright_data_response(response, keyword, geo, captured_at)
                collected.extend(rows)
        return collected


__all__ = [
    "GoogleTrendsExtractor",
    "DEFAULT_TRENDS_TIMEOUT",
    "TrendsPayload",
    "parse_bright_data_response",
    "parse_trends_payload",
    "trends_timeout_seconds",
    "trend_growth",
]
