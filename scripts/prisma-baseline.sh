#!/usr/bin/env bash
set -euo pipefail

# ── One-time Prisma baseline for the existing production database ────────────
#
# Why: production's schema was created by scripts/v0-init.sql + a data restore,
# never by `prisma migrate`. So `_prisma_migrations` is empty and
# `prisma migrate deploy` refuses with:
#     Error: P3005 — The database schema is not empty.
#
# This adopts Prisma Migrate on the existing DB WITHOUT re-running the
# squashed init migration (whose `CREATE TABLE` statements would fail with
# 42P07 "relation already exists" because the tables already exist):
#   1. FULL backup.
#   2. Mark the single squashed `20260713180000_init` migration as applied.
#   3. `migrate deploy` is then a no-op (no newer migrations exist).
#
# Run ONCE, on the VPS, from the project root:
#     cd /opt/getirbakim && bash scripts/prisma-baseline.sh
#
# Idempotent: if the DB already has migration history it just runs deploy.

PROJECT_PATH="${PROJECT_PATH:-/opt/getirbakim}"
ENV_FILE="${ENV_FILE:-.env.production}"
PG_CONTAINER="${PG_CONTAINER:-getirbakim-postgres}"
NETWORK="${NETWORK:-getirbakim_app-network}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/postgresql}"

cd "${PROJECT_PATH}"

PG_USER=$(grep -m1 'POSTGRES_USER=' "${ENV_FILE}" | cut -d= -f2- | tr -d '\r\n"' || echo "")
PG_USER="${PG_USER:-postgres}"
PG_PASS=$(grep -m1 'POSTGRES_PASSWORD=' "${ENV_FILE}" | cut -d= -f2- | tr -d '\r\n"' || echo "")
PG_DB=$(grep -m1 'POSTGRES_DB=' "${ENV_FILE}" | cut -d= -f2- | tr -d '\r\n"' || echo "")
PG_DB="${PG_DB:-getirbakim}"
if [[ -z "${PG_PASS}" ]]; then
  echo "FATAL: POSTGRES_PASSWORD missing in ${ENV_FILE}"; exit 1
fi
DBURL="postgresql://${PG_USER}:${PG_PASS}@postgres:5432/${PG_DB}"

psql_q() { docker exec -i "${PG_CONTAINER}" psql -U "${PG_USER}" -d "${PG_DB}" -tAc "$1" | tr -d '[:space:]'; }

echo "=== Prisma baseline (one-time) — DB: ${PG_DB} ==="

# ── 0. Guard: only baseline when there is no migration history yet ───────────
APPLIED_COUNT=$(psql_q "SELECT count(*) FROM _prisma_migrations;" 2>/dev/null || echo "no-table")
BASELINE=1
if [[ "${APPLIED_COUNT}" != "no-table" && "${APPLIED_COUNT}" != "0" ]]; then
  echo ">>> _prisma_migrations already has ${APPLIED_COUNT} rows — DB is already"
  echo "    Prisma-managed. Skipping baseline; running deploy only."
  BASELINE=0
fi

# Migrations already reflected in the prod schema (mark as applied).
# After the migration squash (commit 4c67cccf) there is a single init migration.
BASE_MIGRATIONS="20260713180000_init"

if [[ "${BASELINE}" == "1" ]]; then
  # 1. FULL backup before any change.
  mkdir -p "${BACKUP_DIR}"
  TS=$(date +%Y%m%d_%H%M%S)
  FULL="${BACKUP_DIR}/baseline_full_${PG_DB}_${TS}.sql.gz"
  echo ">>> Full backup (all schemas) → ${FULL}"
  docker exec "${PG_CONTAINER}" pg_dump -U "${PG_USER}" -d "${PG_DB}" --no-owner --no-acl | gzip > "${FULL}"
  echo "  $(du -h "${FULL}" | cut -f1) written"
  APPLIED_LIST="${BASE_MIGRATIONS}"
else
  APPLIED_LIST=""
fi

# 2. Single container: install the pinned CLI once, mark migrations applied,
#    then apply the rest. DIRECT_URL is what prisma.config.ts reads.
echo ">>> Resolving/applying migrations..."
docker run --rm --network "${NETWORK}" -v "${PWD}:/repo" -w /repo \
  -e DIRECT_URL="${DBURL}" -e DATABASE_URL="${DBURL}" \
  -e APPLIED_LIST="${APPLIED_LIST}" \
  oven/bun:1 \
  sh -c '
    set -e
    bun install --frozen-lockfile >/dev/null
    for m in $APPLIED_LIST; do
      echo ">>> resolve --applied $m"
      bunx prisma migrate resolve --applied "$m"
    done
    echo ">>> migrate deploy"
    bunx prisma migrate deploy
  '

echo ""
echo "=== Baseline complete ==="
echo "  catalog schema present: $(psql_q "SELECT count(*) FROM pg_namespace WHERE nspname='catalog';")"
echo "  migrations recorded:    $(psql_q "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;")"
