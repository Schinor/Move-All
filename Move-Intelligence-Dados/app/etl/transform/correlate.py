"""Correlação semântica entre snapshots de produto e sinais de demanda."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any, Mapping, Optional

import yaml

from .normalize_product import canonical_cluster


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_KEYWORD_MAP = REPOSITORY_ROOT / "config" / "keyword_map.yaml"


def _canonical_keyword(value: Any) -> str:
    return " ".join(str(value or "").casefold().split())


def load_keyword_map(path: Optional[str | Path] = None) -> dict[str, dict[str, list[str]]]:
    """Carrega o mapa e normaliza listas sem alterar o texto exibido."""

    map_path = Path(path) if path else DEFAULT_KEYWORD_MAP
    with map_path.open("r", encoding="utf-8") as map_file:
        payload = yaml.safe_load(map_file) or {}

    clusters = payload.get("clusters", payload)
    result: dict[str, dict[str, list[str]]] = {}
    for raw_cluster, config in clusters.items():
        cluster = canonical_cluster(raw_cluster) or str(raw_cluster)
        geo_keywords = (config or {}).get("keywords", config or {})
        result[cluster] = {}
        for raw_geo, keywords in geo_keywords.items():
            geo = str(raw_geo).upper()
            if not isinstance(keywords, list):
                raise ValueError(f"keywords de {cluster}/{geo} precisa ser uma lista")
            result[cluster][geo] = [str(keyword).strip() for keyword in keywords if str(keyword).strip()]
    return result


def build_product_demand_links(
    products: list[Mapping[str, Any]],
    demand_signals: list[Mapping[str, Any]],
    keyword_map: Optional[Mapping[str, Any]] = None,
) -> list[dict[str, Any]]:
    """Gera links por ``cluster_map`` sem fazer acesso a banco.

    Produtos sem cluster mapeado são mantidos no catálogo, mas não recebem
    links silenciosos ou inferidos por preço; a correlação deve ser auditável.
    """

    mapping = load_keyword_map() if keyword_map is None else keyword_map
    links: dict[tuple[str, str, str], dict[str, Any]] = {}

    for product in products:
        product_id = str(product.get("id") or "").strip()
        cluster = canonical_cluster(product.get("cluster"))
        if not product_id or not cluster or cluster not in mapping:
            continue

        cluster_config = mapping[cluster]
        if "keywords" in cluster_config:
            cluster_config = cluster_config["keywords"]

        for signal in demand_signals:
            signal_id = str(signal.get("id") or "").strip()
            keyword = str(signal.get("keyword") or "").strip()
            geo = str(signal.get("geo") or "GLOBAL").upper()
            if not signal_id or not keyword:
                continue

            keywords = cluster_config.get(geo) or cluster_config.get("GLOBAL") or []
            keyword_lookup = {_canonical_keyword(candidate): candidate for candidate in keywords}
            canonical_signal_keyword = _canonical_keyword(keyword)
            if canonical_signal_keyword not in keyword_lookup:
                continue

            key = (product_id, signal_id, keyword)
            links[key] = {
                "id": str(
                    uuid.uuid5(
                        uuid.NAMESPACE_URL,
                        f"move-intelligence:link:{product_id}:{signal_id}:{keyword.casefold()}",
                    )
                ),
                "product_id": product_id,
                "demand_signal_id": signal_id,
                "keyword": keyword,
                "match_method": "cluster_map",
            }

    return sorted(
        links.values(),
        key=lambda item: (item["product_id"], item["demand_signal_id"], item["keyword"]),
    )


__all__ = ["build_product_demand_links", "load_keyword_map"]
