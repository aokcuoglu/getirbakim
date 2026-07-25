#!/usr/bin/env bash
set -euo pipefail

# ── Author a migration without ever touching the dev database ────────────────
#
# Why not `prisma migrate dev`: it diffs the *dev database* against the
# datamodel and offers to reset when they disagree. Ours disagree today (12
# stray indexes, a `parts.part_no` text/bigint mismatch, no `_prisma_migrations`
# table), and the local `public` schema holds a 129 GB TecDoc archive that exists
# nowhere else. See scripts/db-guard.sh.
#
# What this does instead — replay the committed migration history into a
# throwaway shadow database and diff *that* against the datamodel:
#
#     migrations/  --replay-->  shadow DB  --diff-->  schema.prisma
#
# `prisma migrate diff` is documented as read-only ("does not write to your
# datasource(s)"); the only database it writes is the shadow, which is dropped
# and recreated on every run.
#
# Usage:
#     bash scripts/db-migration-new.sh <migration_name>
#     bash scripts/db-migration-new.sh add_part_p2w_columns
#
# The generated SQL is NOT applied. Review it, then:
#     bunx prisma migrate deploy          # local
#     (prod applies it through scripts/vps-deploy.sh)

MIGRATION_NAME="${1:-}"
if [[ -z "${MIGRATION_NAME}" ]]; then
  echo "usage: db-migration-new.sh <migration_name>" >&2
  exit 2
fi
if [[ ! "${MIGRATION_NAME}" =~ ^[a-z0-9_]+$ ]]; then
  echo "FATAL: migration name must be lowercase alphanumeric + underscores: '${MIGRATION_NAME}'" >&2
  exit 1
fi

PG_CONTAINER="${PG_CONTAINER:-getirbakim-postgres-local}"
SHADOW_DB="${SHADOW_DB:-getirbakim_shadow}"
SHADOW_HOST="${SHADOW_HOST:-127.0.0.1}"
SHADOW_PORT="${SHADOW_PORT:-54322}"
MIGRATIONS_DIR="prisma/migrations"

# shellcheck source=scripts/db-guard.sh
source "$(dirname "$0")/db-guard.sh"

echo "=== New migration: ${MIGRATION_NAME} ==="
print_target

if ! docker exec "${PG_CONTAINER}" pg_isready -U postgres >/dev/null 2>&1; then
  echo "FATAL: local postgres container '${PG_CONTAINER}' is not ready." >&2
  echo "  Start it with: bun run dev:deps" >&2
  exit 1
fi

# The shadow DB must be empty; recreate it so a previous aborted run cannot leak
# state into this diff.
echo ">>> Recreating shadow database '${SHADOW_DB}'..."
docker exec "${PG_CONTAINER}" psql -U postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${SHADOW_DB}' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
docker exec "${PG_CONTAINER}" psql -U postgres -c "DROP DATABASE IF EXISTS ${SHADOW_DB};" >/dev/null
docker exec "${PG_CONTAINER}" psql -U postgres -c "CREATE DATABASE ${SHADOW_DB};" >/dev/null

PG_PASS="$(env_value .env.local DATABASE_URL | sed -E 's#^postgresql://[^:]+:([^@]*)@.*#\1#')"
if [[ -z "${PG_PASS}" ]]; then
  echo "FATAL: could not read the local postgres password from .env.local" >&2
  exit 1
fi
SHADOW_URL="postgresql://postgres:${PG_PASS}@${SHADOW_HOST}:${SHADOW_PORT}/${SHADOW_DB}"

TIMESTAMP="$(date -u +%Y%m%d%H%M%S)"
OUT_DIR="${MIGRATIONS_DIR}/${TIMESTAMP}_${MIGRATION_NAME}"

# Write the diff outside prisma/migrations. Creating the target folder first
# would make `--from-migrations` pick up the half-written migration and try to
# replay it into the shadow DB, which fails before any diff is produced.
TMP_SQL="$(mktemp -t getirbakim-migration)"
cleanup() { rm -f "${TMP_SQL}"; }
trap cleanup EXIT

echo ">>> Diffing migration history against schema.prisma..."
# Prisma 7 removed --shadow-database-url; prisma.config.ts reads it from here.
set +e
SHADOW_DATABASE_URL="${SHADOW_URL}" bunx prisma migrate diff \
  --from-migrations "${MIGRATIONS_DIR}" \
  --to-schema prisma/schema.prisma \
  --script \
  --exit-code > "${TMP_SQL}"
DIFF_EXIT=$?
set -e

# --exit-code: 0 = no diff, 2 = diff produced, 1 = error.
case "${DIFF_EXIT}" in
  0)
    echo "No schema changes — migration history already matches schema.prisma. Nothing written."
    ;;
  2)
    # Belt and braces: prisma.config.ts silences dotenv, but any tool that prints
    # a banner on stdout would otherwise end up inside the migration SQL.
    if grep -qE '^\[dotenv' "${TMP_SQL}"; then
      echo "WARNING: stripping banner lines that leaked into the SQL output." >&2
      grep -vE '^\[dotenv' "${TMP_SQL}" > "${TMP_SQL}.clean" && mv "${TMP_SQL}.clean" "${TMP_SQL}"
    fi
    mkdir -p "${OUT_DIR}"
    mv "${TMP_SQL}" "${OUT_DIR}/migration.sql"
    trap - EXIT
    echo ""
    echo "Created ${OUT_DIR}/migration.sql:"
    echo "────────────────────────────────────────────────────────"
    cat "${OUT_DIR}/migration.sql"
    echo "────────────────────────────────────────────────────────"
    cat <<EOF

REVIEW THIS SQL BEFORE APPLYING. In particular:
  - any DROP COLUMN / DROP INDEX / ALTER COLUMN ... TYPE is data loss unless the
    target table is empty in every environment;
  - objects that already exist locally need IF NOT EXISTS, since local was built
    by restore rather than by migrations.

Then apply:  bunx prisma migrate deploy
EOF
    ;;
  *)
    echo "FATAL: prisma migrate diff failed (exit ${DIFF_EXIT})." >&2
    docker exec "${PG_CONTAINER}" psql -U postgres -c "DROP DATABASE IF EXISTS ${SHADOW_DB};" >/dev/null 2>&1 || true
    exit 1
    ;;
esac

echo ">>> Dropping shadow database..."
docker exec "${PG_CONTAINER}" psql -U postgres -c "DROP DATABASE IF EXISTS ${SHADOW_DB};" >/dev/null
echo "Done."
