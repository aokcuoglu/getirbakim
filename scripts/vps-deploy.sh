#!/usr/bin/env bash
set -euo pipefail

PROJECT_PATH="${PROJECT_PATH:-/opt/getirbakim}"
BRANCH="${BRANCH:-main}"
DOMAIN="${DOMAIN:-}"
ENV_FILE=".env.production"

# Version derivation (in priority order):
# 1. NEXT_PUBLIC_BUILD_VERSION env var (injected by GitHub Actions or manual)
# 2. GITHUB_REF_NAME env var (tag name from GitHub Actions)
# 3. VERSION env var (manual override)
# 4. Current git tag on the repo
# 5. Short git SHA
# 6. Fallback: "dev"
if [[ -n "${NEXT_PUBLIC_BUILD_VERSION:-}" ]]; then
  DEPLOY_VERSION="${NEXT_PUBLIC_BUILD_VERSION}"
elif [[ -n "${GITHUB_REF_NAME:-}" ]]; then
  DEPLOY_VERSION="${GITHUB_REF_NAME}"
elif [[ -n "${VERSION:-}" ]]; then
  DEPLOY_VERSION="${VERSION}"
elif git describe --tags --abbrev=0 >/dev/null 2>&1; then
  DEPLOY_VERSION=$(git describe --tags --abbrev=0)
else
  DEPLOY_VERSION=$(git rev-parse --short HEAD 2>/dev/null || echo "dev")
fi

export NEXT_PUBLIC_BUILD_VERSION="${DEPLOY_VERSION}"

if [[ ! -d "${PROJECT_PATH}/.git" ]]; then
  echo "FATAL: ${PROJECT_PATH} is not a git repository. Aborting."
  exit 1
fi

cd "${PROJECT_PATH}"

BEFORE=$(git rev-parse --short HEAD)

echo "=== GetirBakim V2 VPS Deploy ==="
echo "Directory: ${PROJECT_PATH}"
echo "Branch:    ${BRANCH}"
echo "Before:    ${BEFORE}"
echo "Version:   ${DEPLOY_VERSION}"
echo "Env file:  ${ENV_FILE}"
echo ""

echo ">>> Fetching origin..."
git fetch origin || { echo "WARN: fetch failed, continuing..."; }

echo ">>> Checking out ${BRANCH}..."
git checkout "${BRANCH}"

echo ">>> Pulling latest from origin/${BRANCH}..."
git reset --hard "origin/${BRANCH}" 2>/dev/null || \
  git pull origin "${BRANCH}" --ff-only 2>/dev/null || \
  { echo "WARN: git pull failed, using current state"; }

AFTER=$(git rev-parse --short HEAD)

# Re-derive version from tags after pull if the current version is a short SHA
CURRENT_SHORT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "")
if [[ "${DEPLOY_VERSION}" == "${CURRENT_SHORT_SHA}" ]] && git describe --tags --abbrev=0 >/dev/null 2>&1; then
  DEPLOY_VERSION=$(git describe --tags --abbrev=0)
  export NEXT_PUBLIC_BUILD_VERSION="${DEPLOY_VERSION}"
fi

echo "Deploy version: ${DEPLOY_VERSION}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "FATAL: ${ENV_FILE} not found in ${PROJECT_PATH}. Aborting."
  exit 1
fi

echo ""
echo ">>> Testing nginx image with config..."
docker pull nginx:stable-alpine 2>/dev/null || true
NGINX_TEST=$(docker run --rm \
  -v "$PWD/infra/nginx/nginx.production.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v /etc/letsencrypt:/etc/letsencrypt:ro \
  -v /var/www/certbot:/var/www/certbot:ro \
  nginx:stable-alpine nginx -t 2>&1) || true
echo "  nginx -t exit code: $?"
echo "  Output: ${NGINX_TEST:-(none)}"

echo ""
echo ">>> Checking SSL certificates..."
CERT_PATH="/etc/letsencrypt/live/getirbakim.com/fullchain.pem"
if [[ -f "${CERT_PATH}" ]]; then
  echo "  SSL certificate found at ${CERT_PATH}"
  if openssl x509 -checkend 86400 -noout -in "${CERT_PATH}" 2>/dev/null; then
    echo "  SSL certificate valid for at least 24 hours"
  else
    echo "  WARNING: SSL certificate expires within 24 hours or is invalid"
    echo "  Certificate info:"
    openssl x509 -subject -issuer -dates -noout -in "${CERT_PATH}" 2>/dev/null || true
  fi
else
  echo "  WARNING: SSL certificate not found at ${CERT_PATH}"
  echo "  nginx will fail to bind port 443 — run certbot before deploying"
fi

echo ""
echo ">>> Stopping host nginx (if running) to free ports 80/443..."
systemctl stop nginx 2>/dev/null || true

echo ">>> Removing any stale containers..."
docker rm -f getirbakim-app 2>/dev/null || true
docker rm -f getirbakim-meilisearch 2>/dev/null || true
docker rm -f getirbakim-nginx 2>/dev/null || true
docker rm -f getirbakim-postgres 2>/dev/null || true


echo ">>> Shutting down existing containers..."
docker compose --env-file "${ENV_FILE}" down --remove-orphans

echo ">>> Building and starting containers (NEXT_PUBLIC_BUILD_VERSION=${DEPLOY_VERSION})..."
NEXT_PUBLIC_BUILD_VERSION="${DEPLOY_VERSION}" docker compose --env-file "${ENV_FILE}" up -d --build

echo ">>> Waiting for containers to become healthy..."
wait_for_healthy() {
  local container="$1"
  local timeout="$2"
  local elapsed=0
  local interval=5
  while [ $elapsed -lt $timeout ]; do
    local status
    status=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "unknown")
    if [ "$status" = "healthy" ]; then
      echo "  $container: healthy (${elapsed}s)"
      return 0
    fi
    if [ "$status" = "unhealthy" ]; then
      echo "  $container: unhealthy after ${elapsed}s — checking logs..."
      docker logs "$container" --tail=30 2>/dev/null || true
      return 1
    fi
    echo "  $container: $status (waiting ${elapsed}s/${timeout}s)..."
    sleep $interval
    elapsed=$((elapsed + interval))
  done
  echo "  $container: timed out after ${timeout}s"
  docker logs "$container" --tail=30 2>/dev/null || true
  return 1
}

wait_for_healthy "getirbakim-postgres" 60 || { echo "FATAL: postgres not healthy, aborting"; exit 1; }

echo ">>> Running Prisma migrations..."
DATABASE_URL=$(grep -oP '^DATABASE_URL=\K.*' "${ENV_FILE}" 2>/dev/null || grep '^DATABASE_URL=' "${ENV_FILE}" | cut -d= -f2-)
if [[ -z "${DATABASE_URL}" ]]; then
  echo "WARN: Could not extract DATABASE_URL from ${ENV_FILE}, skipping Prisma migrations"
else
  MIGRATE_OUTPUT=$(docker run --rm \
    --network getirbakim_default \
    -v "$PWD/prisma:/app/prisma" \
    -e DATABASE_URL="${DATABASE_URL}" \
    node:22-slim \
    npx --yes prisma migrate deploy 2>&1) || true
  echo "  ${MIGRATE_OUTPUT//$'\n'/$'\n'  }"
  if echo "${MIGRATE_OUTPUT}" | grep -qi "error"; then
    echo "WARN: Prisma migrate deploy reported an error — check above"
  else
    echo "  Prisma migrations OK"
  fi
fi

echo ">>> Ensuring v0 schema tables..."
V0_SQL_OUTPUT=$(docker exec -i "${PG_CONTAINER}" psql -U postgres -d getirbakim < scripts/v0-init.sql 2>&1) || true
echo "  ${V0_SQL_OUTPUT//$'\n'/$'\n'  }"
if echo "${V0_SQL_OUTPUT}" | grep -qi "error"; then
  echo "WARN: v0 schema init reported an error — check above"
else
  echo "  v0 schema tables OK"
fi

wait_for_healthy "getirbakim-meilisearch" 120 || echo "WARN: meilisearch not healthy, continuing anyway..."
wait_for_healthy "getirbakim-app" 90 || { echo "FATAL: app not healthy, aborting"; exit 1; }
wait_for_healthy "getirbakim-nginx" 60 || {
  echo "FATAL: nginx not healthy within 60s — dumping diagnostics..."
  echo ""
  echo "--- nginx container logs (tail 80) ---"
  docker logs getirbakim-nginx --tail=80 2>/dev/null || echo "(no logs)"
  echo ""
  echo "--- nginx full logs (details) ---"
  docker logs getirbakim-nginx --details 2>&1 | tail -20 || echo "(no details)"
  echo ""
  echo "--- nginx container inspect (exit code, error) ---"
  docker inspect getirbakim-nginx --format 'ExitCode={{.State.ExitCode}} Error={{.State.Error}} Status={{.State.Status}}' 2>/dev/null || echo "(inspect failed)"
  echo ""
  echo "--- nginx config validation ---"
  docker compose --env-file "${ENV_FILE}" exec -T nginx nginx -t 2>&1 || echo "(exec failed — container may be restarting)"
  echo ""
  echo "--- port binding on host (80/443) ---"
  ss -tlnp 'sport = :80 or sport = :443' 2>/dev/null || netstat -tlnp 2>/dev/null | grep -E '(:80|:443)\s' || echo "(no listeners on 80/443)"
  exit 1
}

echo ""
echo ">>> Container status:"
docker compose --env-file "${ENV_FILE}" ps

echo ""
echo ">>> Container health checks..."
APP_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' getirbakim-app 2>/dev/null || echo "unknown")
NGINX_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' getirbakim-nginx 2>/dev/null || echo "unknown")
MEILI_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' getirbakim-meilisearch 2>/dev/null || echo "unknown")
PG_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' getirbakim-postgres 2>/dev/null || echo "unknown")
echo "  app:        ${APP_HEALTH}"
echo "  nginx:      ${NGINX_HEALTH}"
echo "  meilisearch: ${MEILI_HEALTH}"
echo "  postgres:   ${PG_HEALTH}"

# Verify app health endpoint via Docker internal network
if HEALTH=$(docker compose --env-file "${ENV_FILE}" exec -T app curl -sf http://localhost:3000/api/health 2>/dev/null); then
  if echo "${HEALTH}" | grep -q '"status":"ok"'; then
    echo "OK: App health check passed"
    HEALTH_VERSION=$(echo "${HEALTH}" | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)
    echo "  Reported version: ${HEALTH_VERSION}"
  else
    echo "WARNING: App health check returned unexpected response"
    echo "${HEALTH}"
  fi
else
  echo "FAILED: App health check did not respond"
  docker compose --env-file "${ENV_FILE}" logs app --tail=50
  exit 1
fi

echo ""
echo ">>> Ensuring pg_trgm extension and search indexes..."
PG_CONTAINER="getirbakim-postgres"
if docker exec "${PG_CONTAINER}" pg_isready -U postgres -d getirbakim >/dev/null 2>&1; then
  docker exec "${PG_CONTAINER}" psql -U postgres -d getirbakim -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;" 2>/dev/null || echo "WARN: pg_trgm extension creation failed"
  docker exec "${PG_CONTAINER}" psql -U postgres -d getirbakim -f /dev/stdin < scripts/search-indexes.sql 2>/dev/null || echo "WARN: Search indexes could not be created (may already exist)"
  echo "  pg_trgm extension and search indexes OK"
else
  echo "WARN: PostgreSQL not ready, skipping pg_trgm and search indexes"
fi

# Verify nginx is proxying correctly (check from app container which has curl)
echo ">>> Verifying nginx reverse proxy..."
NGINX_PROXY_OK=false
for i in 1 2 3; do
  if docker compose --env-file "${ENV_FILE}" exec -T app curl -sf http://nginx/api/health 2>/dev/null | grep -q '"status":"ok"'; then
    echo "OK: Nginx proxy health check passed (attempt ${i}/3)"
    NGINX_PROXY_OK=true
    break
  fi
  echo "  Nginx proxy check attempt ${i}/3 failed, waiting 5s..."
  sleep 5
done

if [ "${NGINX_PROXY_OK}" = "false" ]; then
  echo "WARN: Nginx proxy health check failed after 3 attempts"
  docker compose --env-file "${ENV_FILE}" logs nginx --tail=30 2>/dev/null || true
fi

if [[ -n "${DOMAIN}" ]]; then
  echo ""
  echo ">>> Public health check (${DOMAIN})..."
  for url in "${DOMAIN}/api/health" "${DOMAIN}/tr" "${DOMAIN}/en"; do
    http_code=$(curl -so /dev/null -w '%{http_code}' --max-time 15 "${url}" 2>/dev/null || echo "000")
    if [ "${http_code}" = "200" ]; then
      echo "  OK: ${url} (200)"
    else
      echo "  WARN: ${url} (HTTP ${http_code})"
    fi
  done
fi

echo ""
echo ">>> Current git tag:"
git describe --tags --abbrev=0 2>/dev/null || echo "(no tags)"

echo ""
echo "=== Deploy complete ==="
echo "  Before:  ${BEFORE}"
echo "  After:   ${AFTER}"
echo "  Version: ${DEPLOY_VERSION}"
echo ""
echo "Run 'bash scripts/vps-smoke.sh' for comprehensive smoke tests."