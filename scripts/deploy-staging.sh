#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# This script owns only the isolated staging compose project. It never selects
# the legacy production checkout, shared edge network, or production volumes.
if [[ "$(git branch --show-current)" != "next-system" && "${STAGING_DETACHED_RELEASE:-}" != "1" ]]; then
  echo "Staging requires next-system or an explicitly detached staging release." >&2
  exit 1
fi
if [[ ! "${DEPLOY_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || [[ "$(git rev-parse HEAD)" != "$DEPLOY_SHA" ]]; then
  echo "DEPLOY_SHA must equal this checkout's full commit SHA." >&2
  exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "Preserve checkout changes before deploying staging." >&2
  exit 1
fi
export BUILD_VERSION="${DEPLOY_SHA:0:12}"
test -f .env.staging || { echo "Missing .env.staging" >&2; exit 1; }
compose=(docker compose --env-file .env.staging -f deploy/staging.compose.yml)

if [[ "${STAGING_IMAGES_READY:-}" != "1" ]]; then
  "${compose[@]}" build app operations
fi
"${compose[@]}" up -d --wait --wait-timeout 120 postgres minio
mkdir -p .local/backups
chmod 700 .local .local/backups
backup=".local/backups/$(date -u +%Y%m%dT%H%M%SZ)-${BUILD_VERSION}.sql.gz"
"${compose[@]}" exec -T postgres pg_dump -U getirbakim_app -d getirbakim | gzip > "${backup}.partial"
chmod 600 "${backup}.partial"
mv "${backup}.partial" "$backup"
"${compose[@]}" run --rm --no-deps createbuckets
"${compose[@]}" run --rm --no-deps operations node --import tsx scripts/setup.ts
"${compose[@]}" run --rm --no-deps operations node --import tsx scripts/import-assets.ts
"${compose[@]}" run --rm --no-deps operations node --import tsx scripts/import-vehicles.ts
"${compose[@]}" up -d --no-build --wait --wait-timeout 120 app
bash scripts/smoke-staging.sh
echo "Staging ready at VPS loopback 127.0.0.1:3003; backup: $backup"
