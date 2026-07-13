#!/usr/bin/env bash
# Reconcile the PRODUCTION database schema with prisma/schema.prisma.
#
# Why this exists:
#   Prod's v0 schema was built by scripts/v0-init.sql (not by `prisma migrate`),
#   and the one-time baseline (scripts/prisma-baseline.sh) marked migrations as
#   applied WITHOUT running their v0 ALTERs. So prod can be missing columns/indexes
#   the catalog code expects — e.g. v0.dnmk_products.oem_no — which surface as
#   `column ... does not exist` (SQLSTATE 42703) during catalog sync.
#
# What it does:
#   Uses `prisma migrate diff` to compute the DDL that would make prod match the
#   Prisma datamodel, then splits it into:
#     - ADDITIVE  (CREATE SCHEMA/TABLE/INDEX, ADD COLUMN) — safe, fixes the gaps
#     - RISKY     (DROP*, ALTER COLUMN, ADD CONSTRAINT)   — printed, NEVER auto-applied
#
# Usage (on the VPS, from the project root):
#   bash scripts/reconcile-schema.sh           # DRY RUN — show the diff, change nothing
#   APPLY=1 bash scripts/reconcile-schema.sh   # apply ADDITIVE statements only
#
# A pre-change full backup is taken before any APPLY. RISKY statements are yours
# to review and run by hand.
set -uo pipefail

PROJECT_PATH="${PROJECT_PATH:-/opt/getirbakim}"
ENV_FILE="${ENV_FILE:-.env.production}"
DB="${PG_CONTAINER:-getirbakim-postgres}"
NETWORK="${NETWORK:-getirbakim_app-network}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/postgresql}"
APPLY="${APPLY:-0}"

cd "$PROJECT_PATH" || { echo "FATAL: cannot cd to $PROJECT_PATH"; exit 1; }

PGU=$(grep -m1 '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r\n"'); PGU="${PGU:-postgres}"
PGP=$(grep -m1 '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r\n"')
PGD=$(grep -m1 '^POSTGRES_DB=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r\n"'); PGD="${PGD:-getirbakim}"
if [ -z "$PGP" ]; then echo "FATAL: POSTGRES_PASSWORD missing in $ENV_FILE"; exit 1; fi
DBURL="postgresql://${PGU}:${PGP}@postgres:5432/${PGD}"

TS=$(date +%Y%m%d_%H%M%S)
DIFF_SQL="/tmp/reconcile_${TS}.sql"
ADDITIVE="/tmp/reconcile_additive_${TS}.sql"

echo ">>> Computing schema diff (prod -> prisma/schema.prisma)..."
if ! docker run --rm --network "$NETWORK" -v "$PWD:/repo" -w /repo \
       -e DIRECT_URL="$DBURL" -e DATABASE_URL="$DBURL" oven/bun:1 \
       sh -c "bun install --frozen-lockfile >/dev/null 2>&1 && \
              bunx prisma migrate diff \
                --from-url \"$DBURL\" \
                --to-schema-datamodel prisma/schema.prisma \
                --script" > "$DIFF_SQL" 2>/tmp/reconcile_err.$$; then
  echo "FATAL: prisma migrate diff failed:"; cat /tmp/reconcile_err.$$; rm -f /tmp/reconcile_err.$$; exit 1
fi
rm -f /tmp/reconcile_err.$$

if ! grep -qiE '[A-Z]' "$DIFF_SQL" || grep -qi "already in sync" "$DIFF_SQL"; then
  echo ">>> Prod schema is already in sync with the datamodel. Nothing to do."
  exit 0
fi

# Additive = things prod is MISSING and are safe to add.
grep -iE '^[[:space:]]*(CREATE SCHEMA|CREATE TABLE|CREATE (UNIQUE )?INDEX|ALTER TABLE .*ADD COLUMN)' \
  "$DIFF_SQL" > "$ADDITIVE" || true

echo ""
echo "================ ADDITIVE (safe to apply) ================"
cat "$ADDITIVE"
[ -s "$ADDITIVE" ] || echo "(none)"
echo ""
echo "======= RISKY — NOT auto-applied, review by hand ========="
grep -iE 'DROP |ALTER COLUMN|DROP COLUMN|ADD CONSTRAINT|SET NOT NULL' "$DIFF_SQL" || echo "(none)"
echo "=========================================================="
echo ""
echo ">>> Full diff saved to: $DIFF_SQL"

if [ "$APPLY" != "1" ]; then
  echo ">>> DRY RUN. Re-run with APPLY=1 to apply the ADDITIVE statements above."
  exit 0
fi
if [ ! -s "$ADDITIVE" ]; then
  echo ">>> No additive statements to apply."
  exit 0
fi

# Backup before changing anything.
mkdir -p "$BACKUP_DIR"
BK="${BACKUP_DIR}/reconcile_full_${PGD}_${TS}.sql.gz"
echo ">>> Full backup before apply → $BK"
docker exec "$DB" pg_dump -U "$PGU" -d "$PGD" --no-owner --no-acl | gzip > "$BK"
echo "  $(du -h "$BK" | cut -f1) written"

# Apply additive statements; keep going on individual errors (e.g. an object that
# already exists) so one failure doesn't block the rest.
echo ">>> Applying additive statements..."
docker exec -i "$DB" psql -U "$PGU" -d "$PGD" < "$ADDITIVE"
echo ">>> Done. Re-run the catalog sync afterwards."
