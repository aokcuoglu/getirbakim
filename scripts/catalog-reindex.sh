#!/usr/bin/env bash
# Configure the Meilisearch `products` index and backfill it from the catalog
# schema, then verify search returns hits. Runs INSIDE the VPS — the app
# container reaches meili over the Docker network and /api/internal/* is
# nginx-blocked publicly.
#
# Prereq: MEILI_ENABLED=true in .env.production AND the app recreated so it picked
# that up (otherwise search short-circuits to empty). This script checks that.
#
# Env: FRESH (true/false → ?fresh=1 drops stale docs first, default true),
#      TIMEOUT (per-request seconds, default 1800).
set -uo pipefail

PROJECT_PATH="${PROJECT_PATH:-/opt/getirbakim}"
ENV_FILE="${ENV_FILE:-.env.production}"
APP="${APP_CONTAINER:-getirbakim-app}"
FRESH="${FRESH:-true}"
TIMEOUT="${TIMEOUT:-1800}"

cd "$PROJECT_PATH" || { echo "FATAL: cannot cd to $PROJECT_PATH"; exit 1; }

SECRET=$(grep -m1 '^CRON_SECRET=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r\n"')
if [ -z "$SECRET" ]; then echo "FATAL: CRON_SECRET not found in $ENV_FILE"; exit 1; fi

echo "== preflight: MEILI_ENABLED =="
MEILI_STATE=$(grep -m1 '^MEILI_ENABLED=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r\n"')
echo "  .env.production MEILI_ENABLED=${MEILI_STATE:-unset}"
if [ "$MEILI_STATE" != "true" ]; then
  echo "FATAL: MEILI_ENABLED is not 'true'. Set it in $ENV_FILE and recreate the app:"
  echo "       docker compose --env-file $ENV_FILE up -d --force-recreate --no-deps app"
  exit 1
fi
# Confirm the RUNNING app actually has meili enabled (env change needs a recreate).
HEALTH=$(docker exec "$APP" curl -sS -m 10 http://localhost:3000/api/health 2>/dev/null || echo "")
echo "  app health meilisearch: $(echo "$HEALTH" | grep -o '\"meilisearch\":\"[^\"]*\"' || echo '?')"
case "$HEALTH" in
  *'"meilisearch":"disabled"'*)
    echo "FATAL: the running app still reports meilisearch:disabled — recreate the app first:"
    echo "       docker compose --env-file $ENV_FILE up -d --force-recreate --no-deps app"
    exit 1;;
esac

echo "== configure products index (search:setup) =="
docker exec "$APP" bun run search:setup
SETUP_RC=$?
if [ "$SETUP_RC" -ne 0 ]; then echo "FATAL: search:setup failed (rc=$SETUP_RC)"; exit 1; fi

FRESH_Q=""
[ "$FRESH" = "true" ] && FRESH_Q="?fresh=1"
echo "== backfill catalog -> meili (index-catalog${FRESH_Q}) =="
docker exec "$APP" curl -sS -m "$TIMEOUT" --fail-with-body \
  -H "Authorization: Bearer $SECRET" \
  "http://localhost:3000/api/internal/search/index-catalog${FRESH_Q}"
IDX_RC=$?
echo
if [ "$IDX_RC" -ne 0 ]; then echo "FATAL: index-catalog failed (rc=$IDX_RC)"; exit 1; fi

echo "== verify search (expect hits > 0) =="
docker exec "$APP" curl -sS -m 30 -X POST \
  -H "Content-Type: application/json" \
  -d '{"query":"filtre","locale":"tr","limit":3}' \
  http://localhost:3000/api/search
echo
