"""Identificadores e atributos usados na resolução de identidade de produtos."""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Mapping, Optional


GTIN_RE = re.compile(r"\b(\d{8}|\d{12,14})\b")
MODEL_RE = re.compile(
    r"\b(?:mod(?:elo)?|model|ref(?:erencia)?)[:.\s-]*([A-Z0-9][A-Z0-9-]{2,20})\b",
    re.IGNORECASE,
)
UNIT_RE = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*(kg|g|cm|mm|m|lb|lbs|un|und|pcs|pecas?|pares?)\b",
    re.IGNORECASE,
)

SYNONYMS = {
    "dumbbell": "halter",
    "dumbbells": "halter",
    "halteres": "halter",
    "mat": "tapete",
    "colchonete": "tapete",
    "pieces": "peca",
    "piece": "peca",
    "pcs": "peca",
    "adjustable": "ajustavel",
    "adjustables": "ajustavel",
    "ajustaveis": "ajustavel",
}
MARKETING_STOPWORDS = {
    "premium",
    "original",
    "novo",
    "nova",
    "oficial",
    "promocao",
    "frete",
    "gratis",
    "envio",
    "rapido",
    "com",
    "de",
    "do",
    "da",
    "para",
    "kit",
    "set",
    "par",
}
UNIT_ALIASES = {
    "lbs": "lb",
    "und": "un",
    "pcs": "un",
    "peca": "un",
    "pecas": "un",
    "par": "un",
    "pares": "un",
}


def _plain_text(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").casefold())
    return "".join(char for char in text if not unicodedata.combining(char))


def _first(raw: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        value = raw.get(key)
        if value not in (None, "", []):
            return value
    return None


def normalize_brand(value: Any) -> Optional[str]:
    brand = re.sub(r"[^a-z0-9]+", " ", _plain_text(value)).strip()
    return brand or None


def canonical_title(title: str) -> tuple[str, dict[str, str]]:
    text = _plain_text(title)
    attrs: dict[str, str] = {}
    for value, raw_unit in UNIT_RE.findall(text):
        unit = UNIT_ALIASES.get(raw_unit.casefold(), raw_unit.casefold())
        attrs[unit] = value.replace(",", ".")

    # Unidades ficam nos atributos estruturados. Retirá-las do título evita
    # que "20kg" e "20 KG" produzam identidades textuais diferentes.
    title_without_units = UNIT_RE.sub(" ", text)
    tokens = [
        SYNONYMS.get(token, token)
        for token in re.findall(r"[a-z0-9]+", title_without_units)
    ]
    tokens = [token for token in tokens if token not in MARKETING_STOPWORDS]
    return " ".join(sorted(set(tokens))), attrs


def extract_identifiers(record: Mapping[str, Any], source_specific: Mapping[str, Any]) -> dict[str, Any]:
    raw_fields = source_specific.get("_raw_record_fields")
    raw = dict(source_specific)
    if isinstance(raw_fields, Mapping):
        raw.update(raw_fields)

    gtin = _first(raw, "gtin", "ean", "upc", "barcode")
    searchable = " ".join(
        str(value)
        for value in (_first(raw, "specifications", "specs", "description"), record.get("title"))
        if value
    )
    if not gtin:
        match = GTIN_RE.search(searchable)
        gtin = match.group(1) if match else None
    gtin = re.sub(r"\D", "", str(gtin)) if gtin else None
    if gtin and len(gtin) not in {8, 12, 13, 14}:
        gtin = None

    model = _first(raw, "model_number", "model", "modelo", "reference")
    if not model:
        match = MODEL_RE.search(str(record.get("title") or ""))
        model = match.group(1) if match else None

    canonical, attrs = canonical_title(str(record.get("title") or ""))
    if model:
        attrs["model"] = str(model).strip().upper()
    return {
        "canonical_title": canonical,
        "gtin": gtin,
        "brand": normalize_brand(_first(raw, "brand", "marca")),
        "attrs": attrs,
    }


__all__ = ["canonical_title", "extract_identifiers", "normalize_brand"]
