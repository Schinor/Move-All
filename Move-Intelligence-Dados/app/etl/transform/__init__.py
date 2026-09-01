"""Transformações puras do ETL de inteligência de produto."""

from .normalize_product import normalize_product, normalize_products
from .normalize_demand import normalize_demand, normalize_demand_records
from .correlate import build_product_demand_links, load_keyword_map

__all__ = [
    "normalize_product",
    "normalize_products",
    "normalize_demand",
    "normalize_demand_records",
    "build_product_demand_links",
    "load_keyword_map",
]
from .extract_identifiers import canonical_title, extract_identifiers, normalize_brand

__all__ = ["canonical_title", "extract_identifiers", "normalize_brand"]
