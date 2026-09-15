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

    # Legado: "trend_index" por execução foi removido (F1.6); vale o bruto.
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
        # Sem reescala por execução (F1.6): Google Trends já é 0–100 por
        # requisição e o TikTok guarda a contagem bruta (o crescimento é
        # calculado depois sobre o bruto, Δlog). Comparabilidade temporal
        # exige que o valor gravado não dependa dos outros pontos do lote.
        "trend_index": raw_value,
        "raw_value": raw_value,
        "captured_at": captured_at,
        # Contexto da observação (F1.6): âncora/timeframe/request que tornam
        # execuções comparáveis. Ausentes em seeds antigos → None.
        "request_id": record.get("request_id"),
        "timeframe": record.get("timeframe"),
        "anchor_keyword": record.get("anchor_keyword"),
    }
    return normalized


def normalize_demand_records(
    records: Iterable[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Normaliza sinais SEM min-max por execução (F1.6).

    Cada ponto mantém ``trend_index = raw_value``. A chave do contrato é
    única: se um extractor enviar o mesmo ponto mais de uma vez, o último
    registro observado vence de forma determinística.
    """

    parsed: list[dict[str, Any]] = []
    for index, record in enumerate(records):
        try:
            parsed.append(normalize_demand(record))
        except (TypeError, ValueError) as error:
            raise ValueError(f"Falha ao normalizar demanda no índice {index}: {error}") from error

    unique: dict[tuple[str, str, str, date], dict[str, Any]] = {}
    for item in parsed:
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
