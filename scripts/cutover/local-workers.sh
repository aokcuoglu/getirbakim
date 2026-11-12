#!/bin/bash
# Stops or starts the local launchd jobs that write to the local database (enrichment workers, supplier sync).
# Cutover: `stop` before the final local export so nothing written after it is lost; `start` once production runs on AWS
# (and STOREFRONT_SYNC_TARGET=aws carries later enrichment there).
#   bash scripts/cutover/local-workers.sh stop|start|status
set -euo pipefail
DOMAIN="gui/$(id -u)"
AGENTS="$HOME/Library/LaunchAgents"
LABELS=(com.getirbakim.trodo-pending com.getirbakim.spareto-pending com.getirbakim.parts2world-pending
  com.getirbakim.enrichment-fallback com.getirbakim.supplier-sync com.getirbakim.supplier-monitor)
STATE="$(cd "$(dirname "$0")/../.." && pwd)/.local/cutover/stopped-workers.txt"

loaded() { launchctl print "$DOMAIN/$1" >/dev/null 2>&1; }

case "${1:-}" in
  stop)
    mkdir -p "$(dirname "$STATE")"; : > "$STATE"
    for label in "${LABELS[@]}"; do
      if loaded "$label"; then
        launchctl bootout "$DOMAIN/$label" && echo "$label" >> "$STATE" && echo "stopped $label"
      fi
    done
    # A worker started by hand (outside launchd) would keep writing.
    pgrep -fl "enrichment-worker|spareto-enrichment|parts2world-enrichment|otoparcasan-enrichment|enrichment-fallback|sync-suppliers" \
      && { echo "processes above are still running; stop them before the export" >&2; exit 1; } || echo "no worker processes left"
    ;;
  start)
    [ -s "$STATE" ] || { echo "nothing recorded in $STATE"; exit 0; }
    while read -r label; do
      launchctl bootstrap "$DOMAIN" "$AGENTS/$label.plist" && echo "started $label"
    done < "$STATE"
    rm -f "$STATE"
    ;;
  status)
    for label in "${LABELS[@]}"; do echo "$label: $(loaded "$label" && echo loaded || echo not loaded)"; done
    pgrep -fl "enrichment-worker|spareto-enrichment|parts2world-enrichment|otoparcasan-enrichment|enrichment-fallback|sync-suppliers" || echo "no worker processes"
    ;;
  *) echo "usage: $0 stop|start|status" >&2; exit 2 ;;
esac
