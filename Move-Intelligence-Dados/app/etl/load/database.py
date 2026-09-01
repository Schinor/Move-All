"""Infraestrutura de persistência do ETL v2.

O aplicativo legado usa um modelo diferente para ``products``. O ETL de
inteligência usa PostgreSQL por padrão, configurável por
``MOVE_ETL_DATABASE_URL``; SQLite pode ser passado explicitamente nos testes.
"""

from __future__ import annotations

import os
import threading
from contextlib import contextmanager
from datetime import date, datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Iterator, Optional

import yaml
from sqlalchemy import (
    JSON,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    create_engine,
    event,
)
from sqlalchemy.orm import Session, declarative_base, sessionmaker
from sqlalchemy.dialects.postgresql import JSONB, UUID as PostgreSQLUUID


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_DATABASE_URL = "postgresql+psycopg2://move:move@localhost:5432/move_intelligence"

ETLBase = declarative_base()
IDENTIFIER_TYPE = String(36).with_variant(PostgreSQLUUID(as_uuid=False), "postgresql")
JSON_TYPE = JSON().with_variant(JSONB(), "postgresql")
_INITIALIZED_URLS: set[str] = set()
_INIT_LOCK = threading.Lock()


class ProductSnapshotModel(ETLBase):
    __tablename__ = "products"

    id = Column(IDENTIFIER_TYPE, primary_key=True)
    source = Column(String, nullable=False)
    record_id = Column(String, nullable=False)
    captured_at = Column(Date, nullable=False)
    title = Column(String, nullable=False)
    canonical_title = Column(String)
    gtin = Column(String(14))
    brand = Column(String)
    attrs = Column(JSON_TYPE, nullable=False, default=dict)
    cluster = Column(String)
    price_value = Column(Numeric)
    price_currency = Column(String(12))
    rating = Column(Numeric)
    reviews_count = Column(Integer)
    monthly_sales = Column(Integer)
    moq = Column(Integer)
    supplier = Column(String)
    data_quality = Column(String, nullable=False)
    source_specific = Column(JSON_TYPE, nullable=False, default=dict)

    __table_args__ = (
        UniqueConstraint(
            "source",
            "record_id",
            "captured_at",
            name="uq_products_source_record_capture",
        ),
    )


class DemandSignalModel(ETLBase):
    __tablename__ = "demand_signals"

    id = Column(IDENTIFIER_TYPE, primary_key=True)
    keyword = Column(String, nullable=False)
    geo = Column(String(16), nullable=False)
    source = Column(String(32), nullable=False)
    week_start = Column(Date, nullable=False)
    trend_index = Column(Numeric, nullable=False)
    raw_value = Column(Numeric)
    captured_at = Column(Date, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "keyword",
            "geo",
            "source",
            "week_start",
            name="uq_demand_keyword_geo_source_week",
        ),
    )


class ProductDemandLinkModel(ETLBase):
    __tablename__ = "product_demand_link"

    id = Column(IDENTIFIER_TYPE, primary_key=True)
    product_id = Column(
        IDENTIFIER_TYPE,
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=False,
    )
    demand_signal_id = Column(
        IDENTIFIER_TYPE,
        ForeignKey("demand_signals.id", ondelete="CASCADE"),
        nullable=False,
    )
    keyword = Column(String, nullable=False)
    match_method = Column(String(32), nullable=False)
    created_at = Column(
        DateTime,
        nullable=False,
        default=lambda: datetime.now(timezone.utc).replace(tzinfo=None),
    )

    __table_args__ = (
        UniqueConstraint(
            "product_id",
            "demand_signal_id",
            "keyword",
            name="uq_product_demand_link",
        ),
    )


def _configured_database_url() -> str:
    configured = os.getenv("MOVE_ETL_DATABASE_URL")
    if configured:
        return configured

    config_path = REPOSITORY_ROOT / "config" / "sources.yaml"
    if config_path.exists():
        with config_path.open("r", encoding="utf-8") as config_file:
            config = yaml.safe_load(config_file) or {}
        return config.get("database", {}).get(
            "connection_string", DEFAULT_DATABASE_URL
        )

    return DEFAULT_DATABASE_URL


def _ensure_sqlite_directory(database_url: str) -> None:
    if not database_url.startswith("sqlite:///"):
        return

    sqlite_path = database_url.removeprefix("sqlite:///")
    if sqlite_path == ":memory:":
        return

    path = Path(sqlite_path)
    if not path.is_absolute():
        path = REPOSITORY_ROOT / path
    path.parent.mkdir(parents=True, exist_ok=True)


def resolve_database_url(database_url: Optional[str] = None) -> str:
    """Resolve uma única chave de conexão para evitar pools duplicados."""

    url = database_url or _configured_database_url()
    if url.startswith("postgresql"):
        from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit
        parsed = urlsplit(url)
        if parsed.query:
            query_params = parse_qs(parsed.query)
            query_params.pop("schema", None)
            new_query = urlencode(query_params, doseq=True)
            url = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, new_query, parsed.fragment))
    return url


@lru_cache(maxsize=8)
def _get_engine(url: str):
    _ensure_sqlite_directory(url)
    engine_options = {"pool_pre_ping": True, "future": True}
    if url.startswith("postgresql"):
        engine_options.update(
            pool_size=5,
            max_overflow=5,
            pool_recycle=1800,
            pool_timeout=30,
            connect_args={"options": "-c statement_timeout=60000"},
        )
    engine = create_engine(url, **engine_options)

    if url.startswith("sqlite:"):

        @event.listens_for(engine, "connect")
        def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine


def get_engine(database_url: Optional[str] = None):
    return _get_engine(resolve_database_url(database_url))


@lru_cache(maxsize=8)
def _get_session_factory(url: str):
    return sessionmaker(
        bind=_get_engine(url),
        autocommit=False,
        autoflush=False,
        expire_on_commit=False,
    )


def get_session_factory(database_url: Optional[str] = None):
    return _get_session_factory(resolve_database_url(database_url))


def init_db(database_url: Optional[str] = None) -> None:
    """Inicialização explícita para testes/instalações; produção usa Prisma Migrate."""

    url = resolve_database_url(database_url)
    with _INIT_LOCK:
        if url in _INITIALIZED_URLS:
            return
        ETLBase.metadata.create_all(bind=get_engine(url))
        _INITIALIZED_URLS.add(url)


def get_session(database_url: Optional[str] = None) -> Session:
    # SQLite é usado somente nos testes e precisa de bootstrap local. No
    # PostgreSQL, o schema pertence exclusivamente ao Prisma Migrate.
    if resolve_database_url(database_url).startswith("sqlite:"):
        init_db(database_url)
    return get_session_factory(database_url)()


@contextmanager
def session_scope(database_url: Optional[str] = None) -> Iterator[Session]:
    """Context manager simples mantido como gerador para os loaders."""

    session = get_session(database_url)
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


__all__ = [
    "DemandSignalModel",
    "ETLBase",
    "ProductDemandLinkModel",
    "ProductSnapshotModel",
    "get_engine",
    "get_session",
    "init_db",
    "resolve_database_url",
    "session_scope",
]
