#!/usr/bin/env bash
set -euo pipefail

# ── One-time Prisma baseline for the existing production database ────────────
#
# Why: production's schema was created by scripts/v0-init.sql + a data restore,
# never by `prisma migrate`. So `_prisma_migrations` is empty and
# `prisma migrate deploy` refuses with:
#     Error: P3005 — The database schema is not empty.
#
# This adopts Prisma Migrate on the existing DB WITHOUT re-running the migrations
# already reflected in the schema:
#   1. FULL backup (all schemas, including v1 which migration 12 drops).
#   2. Mark the 10 pre-existing "base" migrations as already applied.
#   3. Decide whether the column-drop migration must run (columns still present)
#      or be baselined (already minimal).
#   4. `migrate deploy` applies the genuinely-new migrations (catalog schema).
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

# Migrations already reflected in the prod schema (mark as applied):
BASE_MIGRATIONS="20260608000000_add_password_hash \
20260614000000_add_ptbrd_logo \
20260617000000_add_oem_child_tables_and_reset_matching \
20260617000100_ensure_v0_matching_tables \
20260618000000_drop_oem_child_tables_redefine_products_oems \
20260618000100_clean_v0_products \
20260619000000_drop_v0_matching_enrichment_tables \
20260620000000_add_product_mapping_and_reset_dnmk_oem \
20260620000100_make_ptdrk_products_id_nullable \
20260620000200_add_bsbg_products_id_and_product_mapping_fk"

if [[ "${BASELINE}" == "1" ]]; then
  # 1. FULL backup (all schemas incl. v1) before any change.
  mkdir -p "${BACKUP_DIR}"
  TS=$(date +%Y%m%d_%H%M%S)
  FULL="${BACKUP_DIR}/baseline_full_${PG_DB}_${TS}.sql.gz"
  echo ">>> Full backup (all schemas) → ${FULL}"
  docker exec "${PG_CONTAINER}" pg_dump -U "${PG_USER}" -d "${PG_DB}" --no-owner --no-acl | gzip > "${FULL}"
  echo "  $(du -h "${FULL}" | cut -f1) written"

  # 2. The column-drop migration runs only if the columns still exist;
  #    otherwise baseline it as applied.
  DROP_MIG="20260620000300_drop_product_mappings_extra_columns"
  HAS_COL=$(psql_q "SELECT count(*) FROM information_schema.columns WHERE table_schema='v0' AND table_name='product_mappings' AND column_name='confidence';" || echo "0")
  APPLIED_LIST="${BASE_MIGRATIONS}"
  if [[ "${HAS_COL}" == "0" ]]; then
    echo ">>> product_mappings already minimal → baseline ${DROP_MIG} too"
    APPLIED_LIST="${APPLIED_LIST} ${DROP_MIG}"
  else
    echo ">>> product_mappings still has extra columns → ${DROP_MIG} will run via deploy"
  fi

  # Safety guard: the catalog migration runs `DROP SCHEMA IF EXISTS v1 CASCADE`.
  # Refuse to proceed if v1 actually holds tables, unless explicitly forced.
  # (A full backup was already taken above, so FORCE_DROP_V1=1 stays recoverable.)
  V1_TABLES=$(psql_q "SELECT count(*) FROM information_schema.tables WHERE table_schema='v1';" 2>/dev/null || echo "0")
  if [[ "${V1_TABLES}" != "0" && "${FORCE_DROP_V1:-0}" != "1" ]]; then
    echo "FATAL: v1 schema has ${V1_TABLES} table(s); migration 12 would DROP it (CASCADE)."
    echo "       Full backup: ${FULL}. Inspect v1, then re-run with FORCE_DROP_V1=1 to proceed."
    exit 1
  fi
  echo ">>> v1 schema tables: ${V1_TABLES} (safe to drop)"
else
  APPLIED_LIST=""
fi

# 3. Single container: install the pinned CLI once, mark migrations applied,
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
echo "  v1 schema present:      $(psql_q "SELECT count(*) FROM pg_namespace WHERE nspname='v1';")"
echo "  migrations recorded:    $(psql_q "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;")"
