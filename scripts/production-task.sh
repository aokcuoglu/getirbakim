#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
test -f .local/production-data-ready
export BUILD_VERSION="$(git rev-parse --short=12 HEAD)"
compose=(docker compose --env-file .env.production -f deploy/production.compose.yml)
case "${1:-}" in
  supplier-sync)
    exec "${compose[@]}" run --rm --no-deps operations node --import tsx scripts/sync-suppliers.ts
    ;;
  backup)
    mkdir -p .local/backups
    target=".local/backups/daily-$(date -u +%Y%m%dT%H%M%SZ).dump"
    "${compose[@]}" exec -T postgres pg_dump -U getirbakim_app -d getirbakim -Fc > "${target}.partial"
    "${compose[@]}" exec -T postgres pg_restore --list < "${target}.partial" >/dev/null
    mv "${target}.partial" "$target"
    find .local/backups -maxdepth 1 -type f -name 'daily-*.dump' -mtime +14 -delete
    ;;
  *) echo 'Usage: production-task.sh supplier-sync|backup' >&2; exit 2 ;;
esac
