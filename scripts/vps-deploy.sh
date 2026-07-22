#!/usr/bin/env bash
set -euo pipefail

PROJECT_PATH="${PROJECT_PATH:-/opt/getirbakim}"
BRANCH="${BRANCH:-main}"
DOMAIN="${DOMAIN:-}"
ENV_FILE=".env.production"

# Version derivation (in priority order):
# 1. NEXT_PUBLIC_BUILD_VERSION env var (injected by GitHub Actions or manual)
# 2. GITHUB_REF_NAME env var (tag name from GitHub Actions)
# 3. VERSION env var (manual override)
# 4. Current git tag on the repo
# 5. Short git SHA
# 6. Fallback: "dev"
if [[ -n "${NEXT_PUBLIC_BUILD_VERSION:-}" ]]; then
  DEPLOY_VERSION="${NEXT_PUBLIC_BUILD_VERSION}"
elif [[ -n "${GITHUB_REF_NAME:-}" ]]; then
  DEPLOY_VERSION="${GITHUB_REF_NAME}"
elif [[ -n "${VERSION:-}" ]]; then
  DEPLOY_VERSION="${VERSION}"
elif git describe --tags --abbrev=0 >/dev/null 2>&1; then
  DEPLOY_VERSION=$(git describe --tags --abbrev=0)
else
  DEPLOY_VERSION=$(git rev-parse --short HEAD 2>/dev/null || echo "dev")
fi

export NEXT_PUBLIC_BUILD_VERSION="${DEPLOY_VERSION}"

if [[ ! -d "${PROJECT_PATH}/.git" ]]; then
  echo "FATAL: ${PROJECT_PATH} is not a git repository. Aborting."
  exit 1
fi

cd "${PROJECT_PATH}"

BEFORE=$(git rev-parse --short HEAD)

echo "=== GetirBakim V2 VPS Deploy ==="
echo "Directory: ${PROJECT_PATH}"
echo "Branch:    ${BRANCH}"
echo "Before:    ${BEFORE}"
echo "Version:   ${DEPLOY_VERSION}"
echo "Env file:  ${ENV_FILE}"
echo ""

echo ">>> Fetching origin..."
git fetch origin || { echo "WARN: fetch failed, continuing..."; }

echo ">>> Checking out ${BRANCH}..."
git checkout "${BRANCH}"

echo ">>> Pulling latest from origin/${BRANCH}..."
git reset --hard "origin/${BRANCH}" 2>/dev/null || \
  git pull origin "${BRANCH}" --ff-only 2>/dev/null || \
  { echo "WARN: git pull failed, using current state"; }

AFTER=$(git rev-parse --short HEAD)

# Re-derive version from tags after pull if the current version is a short SHA
CURRENT_SHORT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "")
if [[ "${DEPLOY_VERSION}" == "${CURRENT_SHORT_SHA}" ]] && git describe --tags --abbrev=0 >/dev/null 2>&1; then
  DEPLOY_VERSION=$(git describe --tags --abbrev=0)
  export NEXT_PUBLIC_BUILD_VERSION="${DEPLOY_VERSION}"
fi

echo "Deploy version: ${DEPLOY_VERSION}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "FATAL: ${ENV_FILE} not found in ${PROJECT_PATH}. Aborting."
  exit 1
fi

echo ""
# This stack no longer runs nginx or binds 80/443 — TLS + routing live in the
# standalone `edge` unit (see edge/README.md). The app attaches to the external
# `edge` network, so `docker compose up` fails if that network is missing.
# Ensure it exists (idempotent; the edge unit also creates it).
echo ">>> Ensuring shared 'edge' network exists..."
docker network inspect edge >/dev/null 2>&1 || docker network create edge

echo ">>> Removing any stale containers..."
docker rm -f getirbakim-app 2>/dev/null || true
docker rm -f getirbakim-meilisearch 2>/dev/null || true
docker rm -f getirbakim-postgres 2>/dev/null || true


echo ">>> Shutting down existing containers..."
docker compose --env-file "${ENV_FILE}" down --remove-orphans

echo ">>> Building and starting containers (NEXT_PUBLIC_BUILD_VERSION=${DEPLOY_VERSION})..."
NEXT_PUBLIC_BUILD_VERSION="${DEPLOY_VERSION}" docker compose --env-file "${ENV_FILE}" up -d --build

echo ">>> Waiting for containers to become healthy..."
wait_for_healthy() {
  local container="$1"
  local timeout="$2"
  local elapsed=0
  local interval=5
  while [ $elapsed -lt $timeout ]; do
    local status
    status=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "unknown")
    if [ "$status" = "healthy" ]; then
      echo "  $container: healthy (${elapsed}s)"
      return 0
    fi
    if [ "$status" = "unhealthy" ]; then
      echo "  $container: unhealthy after ${elapsed}s — checking logs..."
      docker logs "$container" --tail=30 2>/dev/null || true
      return 1
    fi
    echo "  $container: $status (waiting ${elapsed}s/${timeout}s)..."
    sleep $interval
    elapsed=$((elapsed + interval))
  done
  echo "  $container: timed out after ${timeout}s"
  docker logs "$container" --tail=30 2>/dev/null || true
  return 1
}

wait_for_healthy "getirbakim-postgres" 60 || { echo "FATAL: postgres not healthy, aborting"; exit 1; }

PG_CONTAINER="getirbakim-postgres"

# Build DATABASE_URL from POSTGRES_* compose env vars (the .env.production
# does NOT carry DATABASE_URL — it is synthesized in docker-compose.yml from
# POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB). Mirror that logic here so the
# migrate container can reach postgres over the project network.
PG_USER=$(grep -m1 'POSTGRES_USER=' "${ENV_FILE}" 2>/dev/null | cut -d= -f2- | tr -d '\r\n"' || echo "")
PG_USER="${PG_USER:-postgres}"
PG_PASS=$(grep -m1 'POSTGRES_PASSWORD=' "${ENV_FILE}" 2>/dev/null | cut -d= -f2- | tr -d '\r\n"' || echo "")
PG_DB=$(grep -m1 'POSTGRES_DB=' "${ENV_FILE}" 2>/dev/null | cut -d= -f2- | tr -d '\r\n"' || echo "")
PG_DB="${PG_DB:-getirbakim}"
if [[ -z "${PG_PASS}" ]]; then
  echo "FATAL: POSTGRES_PASSWORD missing in ${ENV_FILE}, cannot build DATABASE_URL"
  echo "       Expected a line like: POSTGRES_PASSWORD=your_password"
  echo "       Raw grep output for POSTGRES_PASSWORD:"
  grep -n 'POSTGRES_PASSWORD' "${ENV_FILE}" 2>/dev/null || echo "       (no match found)"
  exit 1
fi
DATABASE_URL="postgresql://${PG_USER}:${PG_PASS}@postgres:5432/${PG_DB}"

# ── Safety backup BEFORE migrations ─────────────────────────────────────────
# Migrations can be destructive (column drops, DROP SCHEMA ... CASCADE). Take a
# compressed pg_dump first so a bad migration is recoverable. A backup failure
# aborts the deploy — we do not run migrations without a fresh restore point.
# Escape hatch: set SKIP_PREDEPLOY_BACKUP=1 to bypass intentionally.
if [[ "${SKIP_PREDEPLOY_BACKUP:-0}" == "1" ]]; then
  echo ">>> Skipping pre-migrate backup (SKIP_PREDEPLOY_BACKUP=1)"
else
  echo ">>> Pre-migrate database backup..."
  if PG_CONTAINER="${PG_CONTAINER}" PG_USER="${PG_USER}" PG_DB="${PG_DB}" \
       bash scripts/pg-backup.sh; then
    echo "  Pre-migrate backup OK"
  else
    echo "FATAL: pre-migrate backup failed — aborting before migrations."
    echo "       Check disk space, permissions on the backup dir, and that the"
    echo "       postgres container is healthy. To bypass intentionally, re-run"
    echo "       the deploy with SKIP_PREDEPLOY_BACKUP=1."
    exit 1
  fi
fi

echo ">>> Running Prisma migrations..."
# Prisma 7 keeps BOTH the schema path and the datasource url in prisma.config.ts
# at the repo root (the schema's datasource block has no `url`), and migrate also
# needs prisma/migrations + the pinned prisma@7 CLI. Mounting only prisma/ and
# running unpinned `npx prisma` from `/` fails with "Could not find Prisma Schema"
# and silently applies nothing. So mount the WHOLE project, run from its root, and
# install the exact CLI from the project's own bun.lock. DIRECT_URL is what
# prisma.config.ts reads for CLI ops (direct 5432 port, prepared-statement safe).
# Network name is <project>_<network>, i.e. getirbakim_app-network.
MIGRATE_RC=0
MIGRATE_OUTPUT=$(docker run --rm \
  --network getirbakim_app-network \
  -v "$PWD:/repo" -w /repo \
  -e DIRECT_URL="${DATABASE_URL}" \
  -e DATABASE_URL="${DATABASE_URL}" \
  oven/bun:1 \
  sh -c "bun install --frozen-lockfile && bunx prisma migrate deploy" 2>&1) || MIGRATE_RC=$?
echo "  ${MIGRATE_OUTPUT//$'\n'/$'\n'  }"
if [[ "${MIGRATE_RC}" -ne 0 ]]; then
  if echo "${MIGRATE_OUTPUT}" | grep -q "P3005"; then
    # P3005 = non-empty database with no _prisma_migrations history. Prod's schema
    # was built by v0-init.sql, never by `prisma migrate`, so Migrate must first be
    # adopted (baseline) before it will apply anything. Run the one-time baseline;
    # it is guarded (only baselines when history is empty) and idempotent, so this
    # branch is a no-op on every deploy after the first successful one.
    echo ">>> P3005: existing schema without migration history — running one-time baseline..."
    if PROJECT_PATH="${PROJECT_PATH:-$PWD}" ENV_FILE="${ENV_FILE}" \
         PG_CONTAINER="${PG_CONTAINER}" NETWORK="getirbakim_app-network" \
         bash scripts/prisma-baseline.sh; then
      echo "  Baseline complete — migrations applied"
    else
      echo "FATAL: baseline failed — aborting deploy. A pre-migrate backup was taken;"
      echo "       inspect the output above before retrying."
      exit 1
    fi
  elif echo "${MIGRATE_OUTPUT}" | grep -q "P3018"; then
    # P3018 = a previous migration is marked failed in _prisma_migrations, so
    # `migrate deploy` refuses to apply anything until it is resolved. This most
    # commonly happens after a squashed `init` migration tries `CREATE TABLE` on
    # a prod schema that already had those tables (built outside Prisma via
    # v0-init.sql), fails with 42P07 "relation already exists", and is recorded
    # as failed. The schema already matches the squashed migration (it was
    # generated FROM that schema), so the failed row just needs to be marked
    # applied. We resolve every migration in prisma/migrations as applied, then
    # retry deploy. A pre-migrate backup exists, so this is recoverable.
    echo ">>> P3018: a migration is marked failed — resolving as applied and retrying..."
    MIGRATION_NAMES=$(ls -1 prisma/migrations/ 2>/dev/null | grep -E '^[0-9]' || echo "")
    if [[ -z "${MIGRATION_NAMES}" ]]; then
      echo "FATAL: no migrations found in prisma/migrations/ — cannot auto-resolve."
      exit 1
    fi
    # First drop any failed rows (resolve --applied won't clear a 'failed' state;
    # it only inserts/updates a non-existent or 'rolled-back' row).
    for m in ${MIGRATION_NAMES}; do
      docker exec -i "${PG_CONTAINER}" psql -U "${PG_USER}" -d "${PG_DB}" \
        -c "DELETE FROM _prisma_migrations WHERE migration_name='${m}' AND finished_at IS NULL;" >/dev/null 2>&1 || true
    done
    RESOLVE_LIST="${MIGRATION_NAMES}"
    RESOLVE_RC=0
    RESOLVE_OUTPUT=$(docker run --rm \
      --network getirbakim_app-network \
      -v "$PWD:/repo" -w /repo \
      -e DIRECT_URL="${DATABASE_URL}" \
      -e DATABASE_URL="${DATABASE_URL}" \
      -e RESOLVE_LIST="${RESOLVE_LIST}" \
      oven/bun:1 \
      sh -c 'set -e; bun install --frozen-lockfile >/dev/null 2>&1; for m in $RESOLVE_LIST; do echo ">>> resolve --applied $m"; bunx prisma migrate resolve --applied "$m"; done' 2>&1) || RESOLVE_RC=$?
    echo "  ${RESOLVE_OUTPUT//$'\n'/$'\n'  }"
    if [[ "${RESOLVE_RC}" -ne 0 ]]; then
      echo "FATAL: migrate resolve failed (rc=${RESOLVE_RC}) — aborting deploy."
      echo "       A pre-migrate backup was taken. Inspect the output above and retry."
      exit 1
    fi
    echo ">>> Retrying migrate deploy after resolve..."
    RETRY_RC=0
    RETRY_OUTPUT=$(docker run --rm \
      --network getirbakim_app-network \
      -v "$PWD:/repo" -w /repo \
      -e DIRECT_URL="${DATABASE_URL}" \
      -e DATABASE_URL="${DATABASE_URL}" \
      oven/bun:1 \
      sh -c "bun install --frozen-lockfile && bunx prisma migrate deploy" 2>&1) || RETRY_RC=$?
    echo "  ${RETRY_OUTPUT//$'\n'/$'\n'  }"
    if [[ "${RETRY_RC}" -ne 0 ]]; then
      echo "FATAL: migrate deploy still failing after resolve (rc=${RETRY_RC}) — aborting."
      echo "       A pre-migrate backup was taken. Inspect the output above and retry."
      exit 1
    fi
    echo "  Prisma migrations OK (after P3018 auto-resolve)"
  else
    # Abort loudly: a failed/partial migration must not be reported as a green
    # deploy (that is how a broken schema previously reached production unnoticed).
    # A fresh pre-migrate backup exists, so it is safe to stop and investigate.
    echo "FATAL: prisma migrate deploy failed (rc=${MIGRATE_RC}) — aborting deploy."
    echo "       A pre-migrate backup was taken. Inspect the output above, fix the"
    echo "       migration, and re-run. To bypass DB steps entirely, deploy with"
    echo "       SKIP_PREDEPLOY_BACKUP=1 only after resolving the migration."
    exit 1
  fi
else
  echo "  Prisma migrations OK"
fi

echo ">>> Ensuring v0 schema tables..."
V0_SQL_OUTPUT=$(docker exec -i "${PG_CONTAINER}" psql -U "${PG_USER}" -d "${PG_DB}" < scripts/v0-init.sql 2>&1) || true
echo "  ${V0_SQL_OUTPUT//$'\n'/$'\n'  }"
if echo "${V0_SQL_OUTPUT}" | grep -qi "error"; then
  echo "WARN: v0 schema init reported an error — check above"
else
  echo "  v0 schema tables OK"
fi

wait_for_healthy "getirbakim-meilisearch" 120 || echo "WARN: meilisearch not healthy, continuing anyway..."
wait_for_healthy "getirbakim-app" 90 || { echo "FATAL: app not healthy, aborting"; exit 1; }
# No nginx here — public traffic is served by the standalone edge unit. The
# public health check near the end (via ${DOMAIN}) exercises the edge path.

echo ""
echo ">>> Container status:"
docker compose --env-file "${ENV_FILE}" ps

echo ""
echo ">>> Container health checks..."
APP_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' getirbakim-app 2>/dev/null || echo "unknown")
MEILI_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' getirbakim-meilisearch 2>/dev/null || echo "unknown")
PG_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' getirbakim-postgres 2>/dev/null || echo "unknown")
echo "  app:        ${APP_HEALTH}"
echo "  meilisearch: ${MEILI_HEALTH}"
echo "  postgres:   ${PG_HEALTH}"

# Verify app health endpoint via Docker internal network
if HEALTH=$(docker compose --env-file "${ENV_FILE}" exec -T app curl -sf http://localhost:3000/api/health 2>/dev/null); then
  if echo "${HEALTH}" | grep -q '"status":"ok"'; then
    echo "OK: App health check passed"
    HEALTH_VERSION=$(echo "${HEALTH}" | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)
    echo "  Reported version: ${HEALTH_VERSION}"
  else
    echo "WARNING: App health check returned unexpected response"
    echo "${HEALTH}"
  fi
else
  echo "FAILED: App health check did not respond"
  docker compose --env-file "${ENV_FILE}" logs app --tail=50
  exit 1
fi

echo ""
echo ">>> Ensuring pg_trgm extension and search indexes..."
if docker exec "${PG_CONTAINER}" pg_isready -U "${PG_USER}" -d "${PG_DB}" >/dev/null 2>&1; then
  docker exec "${PG_CONTAINER}" psql -U "${PG_USER}" -d "${PG_DB}" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;" 2>/dev/null || echo "WARN: pg_trgm extension creation failed"
  docker exec "${PG_CONTAINER}" psql -U "${PG_USER}" -d "${PG_DB}" -f /dev/stdin < scripts/search-indexes.sql 2>/dev/null || echo "WARN: Search indexes could not be created (may already exist)"
  echo "  pg_trgm extension and search indexes OK"
else
  echo "WARN: PostgreSQL not ready, skipping pg_trgm and search indexes"
fi

if [[ -n "${DOMAIN}" ]]; then
  echo ""
  echo ">>> Public health check (${DOMAIN})..."
  for url in "${DOMAIN}/api/health" "${DOMAIN}/tr" "${DOMAIN}/en"; do
    http_code=$(curl -so /dev/null -w '%{http_code}' --max-time 15 "${url}" 2>/dev/null || echo "000")
    if [ "${http_code}" = "200" ]; then
      echo "  OK: ${url} (200)"
    else
      echo "  WARN: ${url} (HTTP ${http_code})"
    fi
  done
fi

echo ""
echo ">>> Current git tag:"
git describe --tags --abbrev=0 2>/dev/null || echo "(no tags)"

echo ""
echo "=== Deploy complete ==="
echo "  Before:  ${BEFORE}"
echo "  After:   ${AFTER}"
echo "  Version: ${DEPLOY_VERSION}"
echo ""
echo "Run 'bash scripts/vps-smoke.sh' for comprehensive smoke tests."