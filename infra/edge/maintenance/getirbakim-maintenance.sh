#!/bin/bash
# getirbakim.com maintenance mode on the Contabo VPS (AWS cutover).
#   on     → getirbakim.com serves the maintenance page (503) and the getirbakim timers stop
#   off    → site back, timers start again
#   status → flag, timers and what the public URL returns
# Only getirbakim.com is affected; the shared edge serves bakimx unchanged. No nginx reload:
# conf.d/getirbakim.conf checks the flag file on every request.
set -euo pipefail
DIR=/var/www/certbot/getirbakim-maintenance
FLAG=$DIR/on
TIMERS=(getirbakim-production-sync.timer getirbakim-production-backup.timer)

page_check() {
  [ -s "$DIR/index.html" ] || { echo "missing $DIR/index.html" >&2; exit 1; }
  docker exec edge-nginx test -f /var/www/certbot/getirbakim-maintenance/index.html \
    || { echo "edge-nginx cannot see the page" >&2; exit 1; }
}
probe() {
  curl -sk -o /dev/null -w '%{http_code}' --max-time 15 --resolve getirbakim.com:443:127.0.0.1 https://getirbakim.com/ || true
}

case "${1:-}" in
  on)
    page_check
    date -u +%FT%TZ > "$FLAG"
    chmod 644 "$FLAG"
    for t in "${TIMERS[@]}"; do systemctl stop "$t"; done
    # A sync that already started keeps running; wait for it so the export sees a quiet database.
    while systemctl is-active --quiet getirbakim-production-sync.service; do
      echo "waiting for the running supplier sync to finish..."; sleep 10
    done
    echo "maintenance ON since $(cat "$FLAG"); edge answers $(probe)"
    ;;
  off)
    rm -f "$FLAG"
    for t in "${TIMERS[@]}"; do systemctl start "$t"; done
    echo "maintenance OFF; edge answers $(probe)"
    ;;
  status)
    if [ -f "$FLAG" ]; then echo "flag: ON since $(cat "$FLAG")"; else echo "flag: off"; fi
    for t in "${TIMERS[@]}"; do echo "$t: $(systemctl is-active "$t")"; done
    echo "sync service: $(systemctl is-active getirbakim-production-sync.service || true)"
    echo "edge answers: $(probe)"
    ;;
  *) echo "usage: $0 on|off|status" >&2; exit 2 ;;
esac
