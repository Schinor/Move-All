#!/usr/bin/env python3
"""Agendador / Timer de Coleta de Inteligência Contínua e Periódica.

Executa a coleta periódica de acordo com o intervalo ou cron configurado,
garantindo dados sempre atualizados e séries históricas sem gaps.
"""

from __future__ import annotations

import logging
import os
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [Scheduler] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
LOGGER = logging.getLogger("CollectorScheduler")

from app.pipelines import run_historical_collection, run_weekly_intelligence

RUNNING = True


def _signal_handler(signum, frame):
    global RUNNING
    LOGGER.info("Recebido sinal de encerramento (%s). Finalizando scheduler...", signum)
    RUNNING = False


signal.signal(signal.SIGINT, _signal_handler)
signal.signal(signal.SIGTERM, _signal_handler)


def main():
    interval_hours = float(os.getenv("SCHEDULE_INTERVAL_HOURS", "168"))  # padrão: 7 dias (168h)
    run_on_startup = os.getenv("RUN_INIT_ON_STARTUP", "true").lower() in ("true", "1", "yes")
    period_years = int(os.getenv("COLLECTION_PERIOD_YEARS", "2"))
    database_url = os.getenv("MOVE_ETL_DATABASE_URL") or os.getenv("DATABASE_URL")

    LOGGER.info("=" * 60)
    LOGGER.info("Move Intelligence - Data Collector Scheduler iniciado")
    LOGGER.info("Intervalo entre coletas: %.1f horas", interval_hours)
    LOGGER.info("Executar coleta inicial no boot: %s (Período: %d anos)", run_on_startup, period_years)
    LOGGER.info("=" * 60)

    if run_on_startup:
        LOGGER.info("Iniciando coleta inicial pré-formatada de %d anos...", period_years)
        try:
            res = run_historical_collection.run(
                period_years=period_years,
                database_url=database_url,
            )
            LOGGER.info("Coleta inicial concluída com sucesso: %s", res)
        except Exception as err:
            LOGGER.error("Erro na coleta inicial: %s", err, exc_info=True)

    interval_seconds = int(interval_hours * 3600)
    last_run = time.time()

    LOGGER.info("Scheduler ativo em background. Próxima coleta em %.1f horas.", interval_hours)

    while RUNNING:
        time.sleep(5)
        now = time.time()
        if now - last_run >= interval_seconds:
            LOGGER.info("Disparando rotina periódica de coleta de inteligência...")
            try:
                # Executa a varredura semanal
                res = run_weekly_intelligence.run(
                    database_url=database_url,
                )
                LOGGER.info("Varredura periódica finalizada: %s", res)
            except Exception as err:
                LOGGER.error("Falha na varredura periódica: %s", err, exc_info=True)
            last_run = time.time()
            LOGGER.info("Aguardando próximo ciclo (%.1f horas)...", interval_hours)

    LOGGER.info("Scheduler encerrado.")


if __name__ == "__main__":
    main()
