"""Normalização dos sinais semanais de demanda."""

from __future__ import annotations

import re
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Mapping, Optional


SOURCE_ALIASES = {
    "google": "google_trends",
    "google_trends": "google_trends",
    "google trends": "google_trends",
    "tiktok": "tiktok_search",
    "tiktok_search": "tiktok_search",
    "tiktok search": "tiktok_search",
}

GEO_ALIASES = {
    "br": "BR",
    "brazil": "BR",
    "brasil": "BR",
    "us": "US",
    "usa": "US",
    "united states": "US",
    "global": "GLOBAL",
    "world": "GLOBAL",
    "": "GLOBAL",
}


def _number(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float, Decimal)):
        return float(value)
    text = re.sub(r"[^0-9,.-]", "", str(value).strip())
    if not text:
        return None
    if "," in text and "." in text:
        text = text.replace(",", "") if text.rfind(".") > text.rfind(",") else text.replace(".", "").replace(",", ".")
    elif "," in text:
        text = text.replace(",", ".")
    try:
        return float(Decimal(text))
    except (InvalidOperation, ValueError):
        return None


def _date(value: Any) -> date:
    if isinstance(value, datetime):
        value = value.date()
    if isinstance(value, date):
        result = value
    else:
        text = str(value or "").strip().replace("Z", "+00:00")
        result = None
        if text:
            try:
                result = datetime.fromisoformat(text).date()
            except ValueError:
                try:
                    result = date.fromisoformat(text[:10])
                except ValueError:
                    result = None
        if result is None:
            result = datetime.now(timezone.utc).date()
    return result - timedelta(days=result.weekday())


def canonical_source(value: Any) -> str:
    key = str(value or "").strip().casefold()
    return SOURCE_ALIASES.get(key, re.sub(r"[^a-z0-9]+", "_", key).strip("_"))


def canonical_geo(value: Any) -> str:
    key = str(value or "").strip().casefold()
    return GEO_ALIASES.get(key, str(value or "GLOBAL").strip().upper())


def _first_present(record: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in record and record[key] is not None and record[key] != "":
            return record[key]
    return None


def normalize_demand(record: Mapping[str, Any]) -> dict[str, Any]:
    """Normaliza um ponto de demanda sem reescalar a série ainda."""

    if not isinstance(record, Mapping):
        raise TypeError("Cada sinal de demanda precisa ser um objeto/dicionário")

    keyword = str(_first_present(record, "keyword", "query", "term") or "").strip()
    if not keyword:
        raise ValueError("Sinal de demanda sem keyword")

    source = canonical_source(record.get("source"))
    if not source:
        raise ValueError("Sinal de demanda sem source")

    geo = canonical_geo(record.get("geo"))
    week_start = _date(
        _first_present(record, "week_start", "date", "week", "timestamp", "captured_at")
    )
    raw_value = _number(
        _first_present(
            record,
            "raw_value",
            "value",
            "interest_value",
            "video_count",
            "post_count",
            "hashtag_count",
            "count",
            "trend_index",
        )
    )
    if raw_value is None:
        raise ValueError(f"Sinal {keyword!r} sem valor numérico")

    supplied_index = _number(record.get("trend_index"))
    captured_at = _date(record.get("captured_at"))
    # captured_at é uma data de captura, não a semana observada. A função _date
    # sempre retorna segunda-feira, o que é desejável para week_start, mas aqui
    # precisamos manter a data real da coleta quando ela for fornecida.
    raw_captured = record.get("captured_at")
    if raw_captured:
        if isinstance(raw_captured, datetime):
            captured_at = raw_captured.date()
        elif isinstance(raw_captured, date):
            captured_at = raw_captured
        else:
            text = str(raw_captured).replace("Z", "+00:00")
            try:
                captured_at = datetime.fromisoformat(text).date()
            except ValueError:
                try:
                    captured_at = date.fromisoformat(text[:10])
                except ValueError:
                    pass

    normalized = {
        "id": str(
            uuid.uuid5(
                uuid.NAMESPACE_URL,
                f"move-intelligence:demand:{keyword.casefold()}:{geo}:{source}:{week_start.isoformat()}",
            )
        ),
        "keyword": keyword,
        "geo": geo,
        "source": source,
        "week_start": week_start,
        "trend_index": max(0.0, min(100.0, supplied_index if supplied_index is not None else raw_value)),
        "raw_value": raw_value,
        "captured_at": captured_at,
    }
    return normalized


def normalize_demand_records(
    records: Iterable[Mapping[str, Any]],
    group_by: tuple[str, ...] = ("geo", "source"),
) -> list[dict[str, Any]]:
    """Normaliza sinais usando Min-Max no conjunto comparável.

    Por padrão, ``geo × source`` é o conjunto de comparação: assim keywords
    diferentes são colocadas na mesma escala quando vierem da mesma região e
    fonte, em vez de cada keyword receber automaticamente pico 100. O valor
    bruto observado permanece em ``raw_value``. ``group_by`` permite uma
    segmentação mais estreita no futuro, sem alterar o contrato salvo.
    """

    parsed: list[dict[str, Any]] = []
    for index, record in enumerate(records):
        try:
            parsed.append(normalize_demand(record))
        except (TypeError, ValueError) as error:
            raise ValueError(f"Falha ao normalizar demanda no índice {index}: {error}") from error

    valid_group_fields = {"keyword", "geo", "source", "week_start"}
    if not group_by or any(field not in valid_group_fields for field in group_by):
        raise ValueError("group_by precisa conter apenas keyword, geo, source ou week_start")

    def group_key(item: Mapping[str, Any]) -> tuple[Any, ...]:
        return tuple(
            item[field].casefold() if isinstance(item[field], str) else item[field]
            for field in group_by
        )

    minima: dict[tuple[Any, ...], float] = {}
    maxima: dict[tuple[Any, ...], float] = {}
    for item in parsed:
        key = group_key(item)
        value = float(item["raw_value"])
        minima[key] = min(minima.get(key, value), value)
        maxima[key] = max(maxima.get(key, value), value)

    # A chave do contrato é única. Se um extractor enviar o mesmo ponto mais
    # de uma vez, o último registro observado vence de forma determinística.
    unique: dict[tuple[str, str, str, date], dict[str, Any]] = {}
    for item in parsed:
        series_key = group_key(item)
        minimum = minima[series_key]
        maximum = maxima[series_key]
        value_range = maximum - minimum
        item["trend_index"] = round(
            ((float(item["raw_value"]) - minimum) / value_range * 100.0)
            if value_range > 0
            else 0.0,
            4,
        )
        item["id"] = str(
            uuid.uuid5(
                uuid.NAMESPACE_URL,
                f"move-intelligence:demand:{item['keyword'].casefold()}:{item['geo']}:{item['source']}:{item['week_start'].isoformat()}",
            )
        )
        unique[
            (
                item["keyword"].casefold(),
                item["geo"],
                item["source"],
                item["week_start"],
            )
        ] = item

    return sorted(unique.values(), key=lambda item: (item["keyword"].casefold(), item["geo"], item["source"], item["week_start"]))


__all__ = [
    "canonical_geo",
    "canonical_source",
    "normalize_demand",
    "normalize_demand_records",
]
