#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VENV_DIR="$PROJECT_DIR/.venv"
LOG_DIR="$PROJECT_DIR/logs"

mkdir -p "$LOG_DIR"

# venv yoksa oluştur ve bağımlılıkları kur
if [ ! -d "$VENV_DIR" ]; then
  echo "venv oluşturuluyor..."
  PYTHON="$(command -v python3.12 || command -v python3.11 || command -v python3)"
  "$PYTHON" -m venv "$VENV_DIR"
  "$VENV_DIR/bin/pip" install --quiet requests psycopg2-binary python-dotenv pysocks
  echo "venv hazır."
fi

LOG_FILE="$LOG_DIR/parcatedarik_$(date +%Y%m%d_%H%M%S).log"

echo "Log: $LOG_FILE"
echo "Argümanlar: $*"

PYTHONUNBUFFERED=1 "$VENV_DIR/bin/python" "$SCRIPT_DIR/parcatedarik_scraper.py" "$@" 2>&1 | tee "$LOG_FILE"
