"""Loaders idempotentes do ETL de inteligência de produto."""

from .database import get_session, init_db
from .products import upsert_products
from .demand_snapshots import upsert_demand_signals
from .product_demand_link import upsert_product_demand_links

__all__ = [
    "get_session",
    "init_db",
    "upsert_products",
    "upsert_demand_signals",
    "upsert_product_demand_links",
]
