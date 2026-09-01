#!/usr/bin/env bash
set -euo pipefail

# Script utilitário para disparar coleta pontual ou temporizada
# Uso:
#   ./run_collector_timer.sh 2y        -> Roda coleta de 2 anos
#   ./run_collector_timer.sh weekly    -> Roda varredura semanal
#   ./run_collector_timer.sh schedule  -> Inicia scheduler contínuo

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

MODE="${1:-2y}"

case "$MODE" in
  2y|historical)
    echo "[Move Intelligence] Disparando coleta histórica pré-formatada de 2 anos..."
    python3 main.py --pipeline historical-collection --period-years 2
    ;;
  weekly)
    echo "[Move Intelligence] Disparando varredura semanal de catálogo..."
    python3 main.py --pipeline weekly-intelligence
    ;;
  schedule|timer)
    echo "[Move Intelligence] Iniciando scheduler com timer contínuo..."
    python3 scripts/collector_scheduler.py
    ;;
  *)
    echo "Modo desconhecido: $MODE"
    echo "Uso: $0 [2y | weekly | schedule]"
    exit 1
    ;;
esac
