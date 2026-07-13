#!/usr/bin/env bash
# Populate / refresh the catalog schema from the raw supplier layer
# (v0.dnmk_products / v0.bsbg_products) by calling the internal catalog endpoints
# from INSIDE the VPS — nginx blocks /api/internal/* publicly, so we hit the app
# container directly over the Docker network.
#
# Invoked by .github/workflows/catalog-sync.yml (or run by hand on the VPS).
# Env: ENRICH (true/false, default true), TIMEOUT (per-request seconds, default 1800).
#
# NOTE: intentionally NOT using `set -e` — we want every step's output and an
# explicit rc check, so a failure is visible instead of a silent early exit.
set -uo pipefail

PROJECT_PATH="${PROJECT_PATH:-/opt/getirbakim}"
ENV_FILE="${ENV_FILE:-.env.production}"
APP="${APP_CONTAINER:-getirbakim-app}"
DB="${PG_CONTAINER:-getirbakim-postgres}"
ENRICH="${ENRICH:-true}"
TIMEOUT="${TIMEOUT:-1800}"

cd "$PROJECT_PATH" || { echo "FATAL: cannot cd to $PROJECT_PATH"; exit 1; }

SECRET=$(grep -m1 '^CRON_SECRET=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r\n"')
PGU=$(grep -m1 '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r\n"'); PGU="${PGU:-postgres}"
PGD=$(grep -m1 '^POSTGRES_DB=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r\n"'); PGD="${PGD:-getirbakim}"
if [ -z "$SECRET" ]; then
  echo "FATAL: CRON_SECRET not found in $ENV_FILE"; exit 1
fi

echo "== raw supplier counts =="
docker exec -i "$DB" psql -U "$PGU" -d "$PGD" -tAc \
  "SELECT 'dnmk='||count(*) FROM v0.dnmk_products
   UNION ALL SELECT 'bsbg='||count(*) FROM v0.bsbg_products;" \
  || echo "WARN: could not read raw counts (continuing)"

echo "== catalog sync (match -> products/offers, OEM/EAN, rollups) =="
docker exec "$APP" curl -sS -m "$TIMEOUT" --fail-with-body \
  -H "Authorization: Bearer $SECRET" \
  http://localhost:3000/api/internal/catalog/sync
SYNC_RC=$?
echo
if [ "$SYNC_RC" -ne 0 ]; then
  echo "FATAL: catalog sync request failed (rc=$SYNC_RC)"; exit 1
fi

if [ "$ENRICH" = "true" ]; then
  echo "== enrich from public.parts =="
  docker exec "$APP" curl -sS -m "$TIMEOUT" --fail-with-body \
    -H "Authorization: Bearer $SECRET" \
    http://localhost:3000/api/internal/catalog/enrich
  ENRICH_RC=$?
  echo
  if [ "$ENRICH_RC" -ne 0 ]; then
    echo "FATAL: enrich request failed (rc=$ENRICH_RC)"; exit 1
  fi
fi

echo "== verify =="
docker exec -i "$DB" psql -U "$PGU" -d "$PGD" -tAc \
  "SELECT count(*) AS products,
          count(*) FILTER (WHERE in_stock) AS in_stock,
          count(*) FILTER (WHERE slug IS NOT NULL) AS with_slug
   FROM catalog.products;"
