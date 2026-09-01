"""Normalização de snapshots de marketplace para o contrato ``products``."""

from __future__ import annotations

import copy
import hashlib
import json
import re
import unicodedata
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Mapping, Optional

from .extract_identifiers import extract_identifiers


SOURCE_ALIASES = {
    "alibaba": "alibaba",
    "amazon": "amazon",
    "amazon us": "amazon",
    "amazon br": "amazon_br",
    "amazon brasil": "amazon_br",
    "amazon_br": "amazon_br",
    "mercado livre": "mercado_livre",
    "mercadolivre": "mercado_livre",
    "mercado_livre": "mercado_livre",
    "shopee": "shopee_br",
    "shopee br": "shopee_br",
    "shopee_br": "shopee_br",
    "tiktok": "tiktok_shop",
    "tiktok shop": "tiktok_shop",
    "taobao": "taobao",
    "1688": "1688",
}


CLUSTER_ALIASES = {
    "resistancebands": "resistance_bands",
    "dumbbells": "dumbbells",
    "vibrationplate": "vibration_plate",
    "compactcardio": "compact_cardio",
    "spinningbike": "spinning_bike",
    "ellipticaltrainer": "elliptical_trainer",
    "kettlebells": "kettlebells",
    "kettlebell": "kettlebells",
    "abwheel": "ab_wheel",
    "rowingmachine": "rowing_machine",
    "pullupequipment": "pull_up_equipment",
    "recoverymassage": "recovery_massage",
    "recoverymobility": "recovery_massage",
    "yogapilates": "yoga_pilates",
    "yogamat": "yoga_mat",
    "weightbench": "weight_bench",
    "pushupequipment": "push_up_equipment",
    "jumprope": "jump_rope",
    "homegymstation": "home_gym_station",
    "commercialgymequipment": "commercial_gym_equipment",
    "functionaltraining": "functional_training",
    "homefitnessequipment": "home_fitness_equipment",
}


# Tokens explícitos que indicam produtos fora do segmento fitness (eletrônicos,
# ferramentas, móveis, cosméticos, vestuário casual, etc.).
NON_FITNESS_TITLE_TOKENS = (
    "headphone",
    "earphone",
    "fonedeouvido",
    "smartwatch",
    "videogame",
    "interactivegaming",
    "gamingfigures",
    "gamingconsole",
    "playstation",
    "ps5",
    "xbox",
    "nintendo",
    "book",
    "livro",
    "kindle",
    "watershoes",
    "aquasocks",
    "shoelace",
    "cadarco",
    "smartphone",
    "mobilephone",
    "iphone",
    "celular",
    "capinha",
    "carregador",
    "laptop",
    "notebook",
    "computador",
    "teclado",
    "mouse",
    "monitor",
    "tablet",
    "drone",
    "smarttv",
    "televisao",
    "birdfeeder",
    "alimentadordepassaros",
    "laserpecker",
    "mousesemfio",
    "knifesharpener",
    "afiadordefaca",
    "wallart",
    "artedeparede",
    "cortinadechuveiro",
    "fishingrod",
    "varadepesca",
    "bowling",
    "paddleboard",
    "jewelry",
    "necklace",
    "makeup",
    "cosmetic",
    "handbag",
    "vestido",
    "dress",
    "atenas",
    "helenas",
    "parafusadeira",
    "furadeira",
    "esmerilhadeira",
    "fechadura",
    "aspiradorrobo",
    "lampadainteligente",
    "alexa",
    "jogodeferramentas",
    "alicate",
    "martelo",
    "chavefenda",
)

FITNESS_POSITIVE_TOKENS = (
    "resistanceband",
    "faixaelastica",
    "bandaelastica",
    "miniband",
    "superband",
    "elasticband",
    "powerband",
    "dumbbell",
    "halter",
    "halteres",
    "kettlebell",
    "barbell",
    "anilha",
    "anilhas",
    "barramacica",
    "barradeacademia",
    "weightplate",
    "treadmill",
    "esteira",
    "walkingpad",
    "esteiradobravel",
    "esteiraeletrica",
    "rowingmachine",
    "maquinaderemo",
    "remoindoor",
    "airrower",
    "jumprope",
    "cordadepular",
    "speedrope",
    "pullupbar",
    "barrafixa",
    "barradeporta",
    "barradeparede",
    "chinup",
    "pushupboard",
    "pushupbar",
    "suporteparaflexao",
    "abwheel",
    "abroller",
    "rodaabdominal",
    "yogamat",
    "tapeteyoga",
    "tapetedeexercicio",
    "colchonetefitness",
    "colchonetedeacademia",
    "pilatesboard",
    "bolasuica",
    "pilatesball",
    "magiccircle",
    "anelpilates",
    "reformer",
    "foamroller",
    "rolodeliberacao",
    "weightbench",
    "bancodemusculacao",
    "bancoajustavel",
    "bancodeacademia",
    "vibrationplate",
    "plataformavibratoria",
    "massagegun",
    "pistolamassageadora",
    "musclerecovery",
    "recuperacaomuscular",
    "homegym",
    "homegymstation",
    "estacaodemusculacao",
    "multiestacao",
    "fitnessequipment",
    "workoutequipment",
    "equipamentofitness",
    "aparelhodeacademia",
    "aparelhomusculacao",
    "powerrack",
    "gaiolaagachamento",
    "smithmachine",
    "legpress",
    "extensoraflexora",
    "spinningbike",
    "bicicletaspinn",
    "bicicletaergometrica",
    "bikeindoor",
    "eliptico",
    "elliptical",
    "simuladordeescada",
    "stairclimber",
    "airbike",
    "assaultbike",
    "slamball",
    "wallball",
    "medicineball",
    "caixapliometrica",
    "plyobox",
    "fitadesuspensao",
    "suspensiontrainer",
    "trx",
    "coletedepeso",
    "parallettes",
    "barrasparalelas",
    "dipstation",
    "argolasolimpicas",
    "gymnasticrings",
    "calistenia",
    "calisthenics",
    "wheyprotein",
    "creatina",
)


def is_fitness_product(product: Any) -> bool:
    """Filtra contaminações evidentes e valida se o item pertence ao segmento fitness (residencial ou comercial)."""
    if isinstance(product, str):
        title_text = product
        cluster_text = ""
    elif isinstance(product, Mapping):
        title_text = str(product.get("title") or product.get("name") or product.get("product_title") or "")
        cluster_text = str(product.get("cluster") or product.get("category") or "")
    else:
        return False

    title_key = _ascii_key(title_text)
    cluster = canonical_cluster(cluster_text) if cluster_text else None
    cluster_key = _ascii_key(cluster_text)

    # 1. Rejeita se contiver tokens explicitamente não-fitness
    combined_key = f"{title_key}{cluster_key}"
    if any(token in combined_key for token in NON_FITNESS_TITLE_TOKENS):
        return False

    # 2. Aceita se o cluster for canonicamente fitness
    if cluster and cluster in CLUSTER_ALIASES.values():
        return True

    # 3. Valida contra lista positiva de termos fitness
    return any(token in title_key for token in FITNESS_POSITIVE_TOKENS)


TITLE_KEYS = ("title", "name", "product_title")
SOURCE_SPECIFIC_KEYS = ("source_specific", "sourceSpecific")
NORMALIZED_INPUT_KEYS = {
    "source",
    "source_type",
    "record_id",
    "source_id",
    "id",
    "captured_at",
    "title",
    "name",
    "product_title",
    "cluster",
    "category",
    "price_value",
    "price_values",
    "price_currency",
    "currency",
    "rating",
    "reviews_count",
    "monthly_sales",
    "moq",
    "supplier",
    "supplier_or_seller",
    "data_quality",
    "source_specific",
    "sourceSpecific",
    "canonical_title",
    "gtin",
    "brand",
    "attrs",
}


def _ascii_key(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", "", text.casefold())


def _parse_number(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float, Decimal)):
        return float(value)

    text = str(value).strip().replace("\u00a0", " ")
    if not text:
        return None

    multiplier = 1.0
    lowered = text.casefold()
    if lowered.endswith(("k", "mil")):
        multiplier = 1000.0
        text = re.sub(r"\s*(k|mil)$", "", text, flags=re.IGNORECASE)

    text = re.sub(r"[^0-9,.-]", "", text)
    if not text:
        return None

    # Trata 1.500,50, 1,500.50 e 1500,50 sem converter moeda.
    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        fractional = text.rsplit(",", 1)[-1]
        text = text.replace(",", ".") if len(fractional) <= 2 else text.replace(",", "")

    try:
        return float(Decimal(text) * Decimal(str(multiplier)))
    except (InvalidOperation, ValueError):
        return None


def _parse_integer(value: Any) -> Optional[int]:
    number = _parse_number(value)
    return int(number) if number is not None else None


def _parse_date(value: Any) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if value:
        text = str(value).strip().replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(text).date()
        except ValueError:
            try:
                return date.fromisoformat(text[:10])
            except ValueError:
                pass
    return datetime.now(timezone.utc).date()


def canonical_source(value: Any) -> str:
    key = str(value or "").strip().casefold()
    return SOURCE_ALIASES.get(key, re.sub(r"[^a-z0-9]+", "_", key).strip("_"))


def canonical_cluster(value: Any) -> Optional[str]:
    if value is None or not str(value).strip():
        return None
    text = str(value).strip()
    return CLUSTER_ALIASES.get(_ascii_key(text), re.sub(r"[^a-z0-9]+", "_", text.casefold()).strip("_"))


def _infer_cluster(title: str) -> Optional[str]:
    normalized = _ascii_key(title)
    rules = (
        ("resistance_bands", ("resistanceband", "elasticband", "powerband", "faixaelastica", "miniband", "superband")),
        ("dumbbells", ("dumbbell", "halter", "halteres", "anilha", "anilhaolimpica")),
        ("vibration_plate", ("vibrationplate", "vibratingplate", "plataformavibratoria")),
        ("compact_cardio", ("walkingpad", "treadmill", "esteira", "esteiraeletrica", "foldingtreadmill")),
        ("spinning_bike", ("spinningbike", "bicicletaspinn", "bikeindoor", "bicicletaergometrica")),
        ("elliptical_trainer", ("elliptical", "eliptico", "crosstrainer")),
        ("kettlebells", ("kettlebell",)),
        ("ab_wheel", ("abwheel", "abroller", "rodaabdominal")),
        ("rowing_machine", ("rowingmachine", "indoorrower", "maquinaderemo", "remoindoor", "airrower")),
        ("pull_up_equipment", ("pullupbar", "pullup", "chinup", "barrafixa", "barradeporta")),
        ("recovery_massage", ("massagegun", "massager", "musclerecovery", "pistolamassageadora", "foamroller", "rolodeliberacao")),
        ("yoga_mat", ("yogamat", "exercisemat", "fitnessmat", "tapeteyoga", "colchonetefitness")),
        ("weight_bench", ("weightbench", "workoutbench", "bancodemusculacao", "bancodeacademia")),
        ("push_up_equipment", ("pushupbar", "pushupboard", "suporteparaflexao")),
        ("jump_rope", ("jumprope", "speedrope", "cordadepular")),
        ("commercial_gym_equipment", ("legpress", "powerrack", "gaiolaagachamento", "smithmachine", "extensoraflexora")),
        ("functional_training", ("slamball", "wallball", "plyobox", "caixapliometrica", "suspensiontrainer", "trx", "dipstation", "calistenia")),
        ("home_gym_station", ("homegymstation", "multigym", "estacaodemusculacao", "multiestacao")),
    )
    for cluster, tokens in rules:
        if any(token in normalized for token in tokens):
            return cluster
    return "home_fitness_equipment" if title.strip() else None


def _first_value(record: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        value = record.get(key)
        if value not in (None, "", []):
            return value
    return None


def _decode_source_specific(record: Mapping[str, Any]) -> dict[str, Any]:
    native: Any = None
    for key in SOURCE_SPECIFIC_KEYS:
        if key in record:
            native = record[key]
            break

    if isinstance(native, str):
        try:
            native = json.loads(native)
        except json.JSONDecodeError:
            native = {"raw_source_specific": native}
    if not isinstance(native, Mapping):
        native = {} if native is None else {"raw_source_specific": native}

    result = copy.deepcopy(dict(native))
    # Metadados observados fora do objeto nativo também são preservados, sem
    # sobrescrever os campos específicos já fornecidos pelo coletor.
    raw_fields = {
        key: copy.deepcopy(value)
        for key, value in record.items()
        if key not in NORMALIZED_INPUT_KEYS
    }
    if raw_fields:
        result.setdefault("_raw_record_fields", {}).update(raw_fields)
    return result


def _record_id(record: Mapping[str, Any], source: str, title: str, captured_at: date) -> str:
    source_specific = record.get("source_specific") or record.get("sourceSpecific")
    if isinstance(source_specific, Mapping):
        native_id = _first_value(
            source_specific,
            "product_id",
            "asin",
            "item_id",
            "offer_id",
            "video_id",
        )
    else:
        native_id = None

    value = _first_value(record, "record_id", "source_id", "id") or native_id
    if value:
        return str(value)

    url = _first_value(record, "url", "source_page_url")
    basis = str(url or title or f"{source}:{captured_at.isoformat()}").strip().lower()
    return hashlib.sha1(basis.encode("utf-8")).hexdigest()[:32]


def _observed_fields(record: Mapping[str, Any], normalized: Mapping[str, Any]) -> list[str]:
    observed = record.get("observed_fields")
    if isinstance(observed, str):
        fields = [field.strip() for field in observed.split(",") if field.strip()]
    elif isinstance(observed, Iterable) and not isinstance(observed, (bytes, str, Mapping)):
        fields = [str(field) for field in observed if field]
    else:
        fields = []

    for field in ("title", "cluster", "price_value", "rating", "reviews_count", "moq", "supplier"):
        if normalized.get(field) is not None and field not in fields:
            fields.append(field)
    return fields


def normalize_product(record: Mapping[str, Any]) -> dict[str, Any]:
    """Converte um registro de qualquer marketplace no contrato ``products``.

    A função não faz chamadas de rede nem acessa o banco. Campos nativos e
    evidências não mapeadas são mantidos em ``source_specific``.
    """

    if not isinstance(record, Mapping):
        raise TypeError("Cada produto bruto precisa ser um objeto/dicionário")

    source = canonical_source(record.get("source"))
    if not source:
        raise ValueError("Produto sem source")

    source_specific = _decode_source_specific(record)
    title = str(
        _first_value(
            record,
            *TITLE_KEYS,
        )
        or source_specific.get("titulo")
        or ""
    ).strip()
    if not title:
        raise ValueError(f"Produto {source!r} sem title")

    captured_at = _parse_date(record.get("captured_at"))
    record_id = _record_id(record, source, title, captured_at)
    cluster = canonical_cluster(_first_value(record, "cluster", "category")) or _infer_cluster(title)

    price_value = _parse_number(record.get("price_value"))
    if price_value is None:
        price_values = record.get("price_values")
        if isinstance(price_values, Iterable) and not isinstance(price_values, (str, bytes, Mapping)):
            for candidate in price_values:
                price_value = _parse_number(candidate)
                if price_value is not None:
                    break

    identity = extract_identifiers({**record, "title": title}, source_specific)
    normalized = {
        "id": str(
            uuid.uuid5(
                uuid.NAMESPACE_URL,
                f"move-intelligence:product:{source}:{record_id}:{captured_at.isoformat()}",
            )
        ),
        "source": source,
        "record_id": record_id,
        "captured_at": captured_at,
        "title": title,
        **identity,
        "cluster": cluster,
        "price_value": price_value,
        "price_currency": str(
            _first_value(record, "price_currency", "currency")
            or source_specific.get("moeda_capturada")
            or ""
        ).upper() or None,
        "rating": _parse_number(
            _first_value(record, "rating")
            or source_specific.get("rating_produto")
        ),
        "reviews_count": _parse_integer(
            _first_value(record, "reviews_count")
            or source_specific.get("n_reviews_produto")
            or source_specific.get("n_avaliacoes_loja")
        ),
        "monthly_sales": _parse_integer(
            _first_value(record, "monthly_sales")
            or source_specific.get("monthly_sales")
            or source_specific.get("vendidos")
        ),
        "moq": _parse_integer(
            _first_value(record, "moq") or source_specific.get("moq")
        ),
        "supplier": str(
            _first_value(record, "supplier", "supplier_or_seller")
            or source_specific.get("fornecedor")
            or ""
        ).strip() or None,
        "data_quality": str(record.get("data_quality") or "catalog_listing").strip(),
        "source_specific": source_specific,
    }
    normalized["observed_fields"] = _observed_fields(record, normalized)
    return normalized


def normalize_products(records: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Normaliza uma coleção e descarta contaminações fora do escopo fitness."""

    normalized: list[dict[str, Any]] = []
    for index, record in enumerate(records):
        try:
            product = normalize_product(record)
            if is_fitness_product(product):
                normalized.append(product)
        except (TypeError, ValueError) as error:
            raise ValueError(f"Falha ao normalizar produto no índice {index}: {error}") from error
    return normalized


__all__ = [
    "canonical_cluster",
    "canonical_source",
    "is_fitness_product",
    "normalize_product",
    "normalize_products",
]
