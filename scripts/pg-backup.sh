#!/usr/bin/env bash
set -euo pipefail

# PostgreSQL Backup Script for GetirBakim V2
# Runs pg_dump inside the Docker container and stores compressed backups locally.
#
# Usage:
#   ./scripts/pg-backup.sh
#
# Cron (daily at 03:00):
#   0 3 * * * /opt/getirbakim/scripts/pg-backup.sh >> /var/log/pg-backup.log 2>&1
#
# Environment variables (or defaults):
#   PG_CONTAINER   — Docker container name (default: getirbakim-postgres)
#   PG_USER        — PostgreSQL user (default: postgres)
#   PG_DB          — Database name (default: getirbakim)
#   BACKUP_DIR     — Local directory for backups (default: /var/backups/postgresql)
#   RETENTION_DAYS — Delete backups older than N days (default: 14)

PG_CONTAINER="${PG_CONTAINER:-getirbakim-postgres}"
PG_USER="${PG_USER:-postgres}"
PG_DB="${PG_DB:-getirbakim}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/postgresql}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/${PG_DB}_${TIMESTAMP}.sql.gz"

echo "=== PostgreSQL Backup ==="
echo "  Container: ${PG_CONTAINER}"
echo "  Database:  ${PG_DB}"
echo "  User:      ${PG_USER}"
echo "  Output:    ${BACKUP_FILE}"
echo "  Retention: ${RETENTION_DAYS} days"
echo ""

mkdir -p "${BACKUP_DIR}"

echo ">>> Checking PostgreSQL container..."
if ! docker inspect --format='{{.State.Health.Status}}' "${PG_CONTAINER}" 2>/dev/null | grep -q "healthy"; then
  echo "FATAL: PostgreSQL container '${PG_CONTAINER}' is not healthy or not running."
  exit 1
fi

echo ">>> Running pg_dump..."
docker exec "${PG_CONTAINER}" pg_dump -U "${PG_USER}" -d "${PG_DB}" --no-owner --no-acl --clean --if-exists \
  -n public -n trodo -n v0 \
  | gzip > "${BACKUP_FILE}"

FILE_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo "  Backup created: ${BACKUP_FILE} (${FILE_SIZE})"

echo ">>> Cleaning up backups older than ${RETENTION_DAYS} days..."
DELETED=$(find "${BACKUP_DIR}" -name "${PG_DB}_*.sql.gz" -mtime +${RETENTION_DAYS} -print -delete 2>/dev/null | wc -l || true)
REMAINING=$(find "${BACKUP_DIR}" -name "${PG_DB}_*.sql.gz" -mtime -${RETENTION_DAYS} 2>/dev/null | wc -l || true)
echo "  Deleted: ${DELETED}, Remaining: ${REMAINING}"

echo ""
echo "=== Backup complete ==="