#!/bin/bash
# Cutover step: export the VPS's transactional tables (data only) for the AWS restore. Run from your Mac after the VPS is
# in maintenance mode (bash /opt/edge/getirbakim-maintenance.sh on), so no order or cart is written afterwards.
#   bash scripts/cutover/export-vps-transactional.sh   → VPS /opt/getirbakim-v2-production/.local/aws-export-tx-<UTC time>
# The columns of these tables are the same in v0.23 and v0.24 (checked 2026-11-12), so Lokum Ops loads the dump with
# pg_restore --data-only after the local catalog restore; commerce_settings is left empty in the local export.
set -euo pipefail
HOST=${PRODUCTION_SSH_ALIAS:-getirbakim-prod}
ssh -n "$HOST" 'set -euo pipefail
cd /opt/getirbakim-v2-production
umask 077
OUT=.local/aws-export-tx-$(date -u +%Y%m%dT%H%M%SZ); mkdir -p "$OUT"
C="docker compose --env-file .env.production -f deploy/production.compose.yml"
T="account_vehicles commerce_orders commerce_order_items commerce_payments commerce_returns commerce_cart_items guest_carts guest_cart_items cart_items newsletter_subscriptions newsletter_subscription_attempts service_application_attempts commerce_settings"
args=""; for t in $T; do args="$args -t public.$t"; done
$C exec -T postgres pg_dump -U getirbakim_app -d getirbakim -Fc --data-only --no-owner --no-acl $args > "$OUT/transactional.dump"
n=$($C exec -T postgres pg_restore --list < "$OUT/transactional.dump" | grep -c "TABLE DATA")
[ "$n" = 13 ] || { echo "expected 13 tables, got $n" >&2; exit 1; }
for t in $T; do echo "$t $($C exec -T postgres psql -U getirbakim_app -d getirbakim -At -c "SELECT count(*) FROM public.$t")"; done > "$OUT/table-counts.txt"
cd "$OUT" && sha256sum transactional.dump table-counts.txt > SHA256SUMS
echo "$PWD"; ls -lh; paste -sd" " table-counts.txt'
