#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
compose=(docker compose --env-file .env.staging -f deploy/staging.compose.yml)
"${compose[@]}" exec -T app node --input-type=module <<'JS'
for (const path of ['/api/health', '/', '/katalog', '/giris', '/servisler', '/robots.txt', '/api/vehicles?kind=brands']) {
  const response = await fetch(`http://127.0.0.1:3000${path}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  if (path === '/api/health' && (await response.json()).status !== 'ok') throw new Error('Health contract failed');
  if (path === '/robots.txt' && !(await response.text()).includes('Disallow: /')) throw new Error('Staging indexing must be disabled');
  console.log(`PASS ${path}`);
}
JS
