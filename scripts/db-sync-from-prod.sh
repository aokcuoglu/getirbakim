#!/usr/bin/env bash
set -euo pipefail

# Sync production database to local development environment
# Usage: bash scripts/db-sync-from-prod.sh [--schema-only]
#
# Requirements:
#   - sshpass installed (brew install sshpass)
#   - Local Docker containers running (docker compose -f docker-compose.local.yml up -d)
#   - VPS_SSH_PASS env var set

SSH_HOST="173.249.36.2"
SSH_USER="root"
SSH_PASS="${VPS_SSH_PASS:-}"
PG_CONTAINER="getirbakim-postgres"
DUMP_FILE="/tmp/prod-dump-$(date +%Y%m%d-%H%M%S).sql"
SCHEMA_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --schema-only) SCHEMA_ONLY=true ;;
  esac
done

if [[ -z "${SSH_PASS}" ]]; then
  echo "FATAL: Set VPS_SSH_PASS environment variable"
  echo "  Usage: VPS_SSH_PASS='your-password' bash scripts/db-sync-from-prod.sh"
  exit 1
fi

echo "=== Production DB Sync ==="
echo "Host: ${SSH_HOST}"
echo "Dump file: ${DUMP_FILE}"
echo "Schema only: ${SCHEMA_ONLY}"
echo ""

echo ">>> Dumping production database..."
SCHEMA_FLAG=""
if $SCHEMA_ONLY; then
  SCHEMA_FLAG="--schema-only"
fi

sshpass -p "${SSH_PASS}" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 \
  "${SSH_USER}@${SSH_HOST}" \
  "docker exec -i ${PG_CONTAINER} pg_dump -U postgres -d getirbakim \
    ${SCHEMA_FLAG} \
    --no-owner \
    --no-privileges \
  " > "${DUMP_FILE}"

DUMP_SIZE=$(du -h "${DUMP_FILE}" | cut -f1)
echo "  Dump size: ${DUMP_SIZE}"

echo ">>> Checking local postgres..."
if ! docker compose -f docker-compose.local.yml exec -T postgres pg_isready -U postgres -d getirbakim >/dev/null 2>&1; then
  echo "FATAL: Local postgres not running. Start it with: docker compose -f docker-compose.local.yml up -d"
  exit 1
fi

echo ">>> Dropping and recreating local database..."
docker compose -f docker-compose.local.yml exec -T postgres psql -U postgres -c "
  SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'getirbakim' AND pid <> pg_backend_pid();
" 2>/dev/null || true
docker compose -f docker-compose.local.yml exec -T postgres psql -U postgres -c "DROP DATABASE IF EXISTS getirbakim;" 2>/dev/null || true
docker compose -f docker-compose.local.yml exec -T postgres psql -U postgres -c "CREATE DATABASE getirbakim;"

echo ">>> Restoring to local database..."
docker compose -f docker-compose.local.yml exec -T postgres psql -U postgres -d getirbakim < "${DUMP_FILE}"

rm -f "${DUMP_FILE}"

echo ""
echo "=== Sync complete ==="
echo "Local database restored from production (${DUMP_SIZE})"
echo ""
echo "Next steps:"
echo "  docker compose -f docker-compose.local.yml up -d --build"
echo ""
echo "Note: Storage files (brand logos, product images) are NOT synced."
echo "Access them via the production URLs or rsync from VPS:"
echo "  rsync -avz root@${SSH_HOST}:/opt/getirbakim/data/storage/ ./data/storage/"
