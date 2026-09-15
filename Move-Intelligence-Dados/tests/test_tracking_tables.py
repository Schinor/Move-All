"""Teste SQLite das tabelas de acompanhamento (F1.1).

Cria `tracked_listings` + `listing_observations` via SQLAlchemy, insere um
anúncio com uma observação e lê de volta, incluindo a restrição única
`(source, native_id)`.
"""

import uuid
from datetime import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.etl.load.database import (
    ETLBase,
    ListingObservationModel,
    TrackedListingModel,
)


@pytest.fixture()
def session():
    engine = create_engine("sqlite:///:memory:")
    ETLBase.metadata.create_all(bind=engine)
    factory = sessionmaker(bind=engine)
    db = factory()
    try:
        yield db
    finally:
        db.close()


def test_tracking_tables_criam_leem_e_respeitam_unique(session):
    listing = TrackedListingModel(
        id=str(uuid.uuid4()),
        source="amazon_br",
        native_id="B0EXAMPLE",
        canonical_url="https://www.amazon.com.br/dp/B0EXAMPLE",
        status="CANDIDATE",
        tier=3,
        next_due_at=datetime(2026, 9, 15),
    )
    session.add(listing)
    session.commit()

    observation = ListingObservationModel(
        id=str(uuid.uuid4()),
        listing_id=listing.id,
        price="199.90",
        currency="BRL",
        scrape_status="ok",
        parser_version="amazon@1",
        is_synthetic=False,
    )
    session.add(observation)
    session.commit()

    read_back = (
        session.query(ListingObservationModel)
        .filter_by(listing_id=listing.id)
        .one()
    )
    assert read_back.scrape_status == "ok"
    assert read_back.parser_version == "amazon@1"

    duplicado = TrackedListingModel(
        id=str(uuid.uuid4()),
        source="amazon_br",
        native_id="B0EXAMPLE",
        canonical_url="https://www.amazon.com.br/dp/B0EXAMPLE",
        status="CANDIDATE",
        tier=3,
    )
    session.add(duplicado)
    with pytest.raises(IntegrityError):
        session.commit()
