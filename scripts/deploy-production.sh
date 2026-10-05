#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! "${DEPLOY_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || [[ "$(git rev-parse HEAD)" != "$DEPLOY_SHA" ]]; then
  echo 'Production requires the exact checked-out commit.' >&2; exit 1
fi
test -z "$(git status --porcelain --untracked-files=normal)"
test -f .env.production
test -f .local/production-data-ready || { echo 'Local development snapshot must be restored and verified first.' >&2; exit 1; }
export BUILD_VERSION="${DEPLOY_SHA:0:12}"
compose=(docker compose --env-file .env.production -f deploy/production.compose.yml)
"${compose[@]}" up -d --no-build --wait --wait-timeout 120 postgres minio
mkdir -p .local/backups
chmod 700 .local .local/backups
backup=".local/backups/production-$(date -u +%Y%m%dT%H%M%SZ)-${BUILD_VERSION}.dump"
"${compose[@]}" exec -T postgres pg_dump -U getirbakim_app -d getirbakim -Fc </dev/null > "${backup}.partial"
chmod 600 "${backup}.partial"; mv "${backup}.partial" "$backup"
"${compose[@]}" run -T --rm --no-deps operations node --import tsx scripts/setup.ts </dev/null
"${compose[@]}" exec -T postgres psql -U getirbakim_app -d getirbakim -c 'ANALYZE' </dev/null
"${compose[@]}" up -d --no-build --wait --wait-timeout 120 app
"${compose[@]}" exec -T app node --input-type=module <<'JS'
for (const path of ['/api/health','/','/katalog','/giris','/robots.txt']) {
  const response=await fetch(`http://127.0.0.1:3000${path}`,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error(`${path}: ${response.status}`);
  if(path==='/robots.txt' && !(await response.text()).includes('Sitemap: https://getirbakim.com/sitemap.xml'))throw Error('Production indexing settings missing');
  console.log(`PASS production ${path}`);
}
JS
bash scripts/prune-release-images.sh getirbakim-v2-production-app getirbakim-v2-production-operations
echo "Production application ready on edge alias getirbakim-v2-live and loopback :3004 (${BUILD_VERSION})."
