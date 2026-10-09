#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
test -f .local/production-data-ready
export BUILD_VERSION="$(git rev-parse --short=12 HEAD)"
compose=(docker compose --env-file .env.production -f deploy/production.compose.yml)
case "${1:-}" in
  supplier-sync)
    shift
    exec "${compose[@]}" run --rm --no-deps -T operations node --import tsx scripts/sync-suppliers.ts "$@"
    ;;
  supplier-health)
    exec "${compose[@]}" run --rm --no-deps -T operations node --import tsx scripts/supplier-health.ts
    ;;
  supplier-configure)
    shift
    exec "${compose[@]}" run --rm --no-deps -T operations node --import tsx scripts/configure-supplier-sync.ts "$@"
    ;;
  import-storefront)
    # Usage: import-storefront DIR [--apply]; DIR holds manifest.json + media/ from export-storefront-bundle.ts.
    bundle="$(cd "${2:?bundle directory required}" && pwd)"; shift 2
    exec "${compose[@]}" run --rm --no-deps -T -v "${bundle}:/bundle:ro" operations node --conditions=react-server --import tsx scripts/import-storefront-bundle.ts /bundle "$@"
    ;;
  rebuild-fitments)
    exec "${compose[@]}" run --rm --no-deps -T operations node --import tsx scripts/rebuild-product-fitments.ts
    ;;
  backup)
    mkdir -p .local/backups
    target=".local/backups/daily-$(date -u +%Y%m%dT%H%M%SZ).dump"
    "${compose[@]}" exec -T postgres pg_dump -U getirbakim_app -d getirbakim -Fc > "${target}.partial"
    "${compose[@]}" exec -T postgres pg_restore --list < "${target}.partial" >/dev/null
    mv "${target}.partial" "$target"
    find .local/backups -maxdepth 1 -type f -name 'daily-*.dump' -mtime +14 -delete
    ;;
  *) echo 'Usage: production-task.sh supplier-sync [--force [--group=A,B] [--mode=full|commerce]]|supplier-health|supplier-configure --group=ALL ...|import-storefront DIR [--apply]|rebuild-fitments|backup' >&2; exit 2 ;;
esac
