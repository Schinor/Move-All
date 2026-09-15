"""Job diário de câmbio (F1.7): popula `exchange_rates` (USD/BRL e CNY/BRL).

Fonte (sugestão D5): PTAX do Banco Central (API pública, sem chave). Sem
cotações (feriado/fim de semana), retrocede até 7 dias; sem nada, falha de
forma observável em vez de inventar taxa. D5 pendente: confirmar a fonte.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional

import requests

from app.etl.load.database import get_session

LOGGER = logging.getLogger(__name__)

PTAX_URL = (
    "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/"
    "CotacaoMoedaDia(moeda=@moeda,dataCotacao=@dataCotacao)"
    "?@moeda='{currency}'&@dataCotacao='{quoted}'&$format=json"
)
PAIRS = (("USD", "BRL"), ("CNY", "BRL"))
LOOKBACK_DAYS = 7


def fetch_ptax_sale(currency: str, day: date) -> Optional[Decimal]:
    """Cotação de venda PTAX de `currency` em `day` (None se sem pregão)."""
    quoted = day.strftime("%m-%d-%Y")
    response = requests.get(PTAX_URL.format(currency=currency, quoted=quoted), timeout=30)
    response.raise_for_status()
    payload = response.json()
    values = payload.get("value") if isinstance(payload, dict) else None
    if not values:
        return None
    sale = values[0].get("cotacaoVenda")
    try:
        rate = Decimal(str(sale))
    except Exception:
        return None
    return rate if rate > 0 else None


def fetch_rate_with_lookback(currency: str, ref: date) -> tuple[Decimal, date]:
    """Taxa mais recente em até LOOKBACK_DAYS (inclui a referência)."""
    for offset in range(LOOKBACK_DAYS + 1):
        day = ref - timedelta(days=offset)
        rate = fetch_ptax_sale(currency, day)
        if rate is not None:
            return rate, day
    raise RuntimeError(f"PTAX sem cotação de {currency} nos últimos {LOOKBACK_DAYS} dias")


def run(
    *,
    database_url: Optional[str] = None,
    dry_run: bool = False,
    ref_date: Optional[date] = None,
) -> dict[str, Any]:
    """Busca USD/BRL e CNY/BRL e grava em `exchange_rates` (idempotente)."""
    today = ref_date or datetime.now(timezone.utc).date()
    rates: list[dict[str, Any]] = []
    for base, quote in PAIRS:
        rate, day = fetch_rate_with_lookback(base, today)
        rates.append({"base": base, "quote": quote, "rate": rate, "day": day})

    stored = 0
    if not dry_run:
        from app.etl.load.database import ExchangeRateModel

        db = get_session(database_url)
        try:
            for item in rates:
                exists = (
                    db.query(ExchangeRateModel)
                    .filter_by(
                        base_currency=item["base"],
                        quote_currency=item["quote"],
                        captured_at=item["day"],
                    )
                    .first()
                )
                if exists is None:
                    db.add(
                        ExchangeRateModel(
                            id=str(uuid.uuid4()),
                            base_currency=item["base"],
                            quote_currency=item["quote"],
                            rate=item["rate"],
                            captured_at=item["day"],
                        )
                    )
                    stored += 1
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    return {
        "status": "success",
        "ref_date": today.isoformat(),
        "rates": [
            {"base": item["base"], "quote": item["quote"], "rate": float(item["rate"]), "day": item["day"].isoformat()}
            for item in rates
        ],
        "stored": stored,
        "dry_run": dry_run,
    }


__all__ = ["PAIRS", "fetch_ptax_sale", "fetch_rate_with_lookback", "run"]
