#!/bin/bash
# Cutover: refresh local supplier prices/stock before the final export. The storefront hides a price older than
# max_age_hours (36 h), and the local database is otherwise only as fresh as its last manual sync. Writes only the
# local database. Run after local-workers.sh stop.
#   bash scripts/cutover/refresh-local-suppliers.sh                 # Başbuğ (+1 retry), SETA, master catalog
#   bash scripts/cutover/refresh-local-suppliers.sh --with-dinamik  # also a Dinamik full pass through an SSH tunnel
# Rehearsal 2026-11-12: Başbuğ 140-407 s (one transient upstream error, the retry passed), SETA 45 s, master catalog
# 78-97 s. Dinamik is off by default: its API timed out after 28 of 799 brands (303 s) and the circuit breaker skipped
# the rest; on AWS the scheduler refreshes Dinamik through the VPS proxy, and Dinamik is not sold on the VPS today.
set -uo pipefail
cd "$(dirname "$0")/../.."
ts(){ date -u +%FT%TZ; }
run(){ local name=$1; shift; local S=$SECONDS; echo "[$(ts)] $name başlıyor"; "$@"; local rc=$?; echo "[$(ts)] $name bitti exit=$rc ($((SECONDS-S)) sn)"; return $rc; }
SYNC=(node --env-file=.env.local --import tsx scripts/sync-suppliers.ts --force)
U=$(grep -E "^DATABASE_URL=" .env.local | cut -d= -f2-)
q(){ psql "$U" -At -c "$1"; }

run basbug "${SYNC[@]}" --supplier=basbug --mode=full
# A failed group stops the run (upstream errors count as "supplier unreachable"); one retry covered it in the rehearsal.
fresh=$(q "SELECT count(*) FROM supplier_items WHERE supplier='basbug' AND last_seen_at>now()-interval '36 hours'")
recent=$(q "SELECT count(*) FROM supplier_items WHERE supplier='basbug' AND last_seen_at>now()-interval '60 days'")
if [ "$fresh" -lt $((recent * 95 / 100)) ]; then
  echo "[$(ts)] basbug: $fresh / $recent taze, bir kez daha"
  run basbug-retry "${SYNC[@]}" --supplier=basbug --mode=full
fi
run seta "${SYNC[@]}" --supplier=seta --mode=full

if [ "${1:-}" = "--with-dinamik" ]; then
  ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 18443:dinamikapp-api.dinamik.online:443 "${PRODUCTION_SSH_ALIAS:-getirbakim-prod}" &
  TUNNEL=$!; sleep 4
  if kill -0 $TUNNEL 2>/dev/null; then DINAMIK_DIRECT_TUNNEL=127.0.0.1:18443 run dinamik "${SYNC[@]}" --supplier=dinamik --mode=full
  else echo "[$(ts)] dinamik: SSH tüneli açılamadı"; fi
  kill $TUNNEL 2>/dev/null; wait $TUNNEL 2>/dev/null
fi

run match node --env-file=.env.local --import tsx scripts/match-products.ts
psql "$U" -At -F' | ' -c "SELECT supplier, count(*) AS toplam, count(*) FILTER (WHERE last_seen_at>now()-interval '36 hours') AS taze36s, max(last_seen_at) FROM supplier_items GROUP BY 1 ORDER BY 1"
echo "[$(ts)] TAMAM"
