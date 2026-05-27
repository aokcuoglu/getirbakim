#!/usr/bin/env bash
set -euo pipefail

PROJECT_PATH="${PROJECT_PATH:-/opt/getirbakim-v2}"
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
echo ">>> Stopping host nginx (if running) to free ports 80/443..."
systemctl stop nginx 2>/dev/null || true

echo ">>> Removing any stale containers..."
docker rm -f getirbakim-app 2>/dev/null || true
docker rm -f getirbakim-meilisearch 2>/dev/null || true
docker rm -f getirbakim-nginx 2>/dev/null || true
docker rm -f getirbakim-v2-app 2>/dev/null || true
docker rm -f getirbakim-v2-meilisearch 2>/dev/null || true

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

wait_for_healthy "getirbakim-meilisearch" 120 || echo "WARN: meilisearch not healthy, continuing anyway..."
wait_for_healthy "getirbakim-app" 90 || { echo "FATAL: app not healthy, aborting"; exit 1; }
wait_for_healthy "getirbakim-nginx" 30 || echo "WARN: nginx not healthy"

echo ""
echo ">>> Container status:"
docker compose --env-file "${ENV_FILE}" ps

echo ""
echo ">>> Container health checks..."
APP_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' getirbakim-app 2>/dev/null || echo "unknown")
NGINX_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' getirbakim-nginx 2>/dev/null || echo "unknown")
MEILI_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' getirbakim-meilisearch 2>/dev/null || echo "unknown")
echo "  app:        ${APP_HEALTH}"
echo "  nginx:      ${NGINX_HEALTH}"
echo "  meilisearch: ${MEILI_HEALTH}"

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

# Verify nginx is proxying correctly
if docker compose --env-file "${ENV_FILE}" exec -T nginx curl -sf http://localhost/api/health 2>/dev/null | grep -q '"status":"ok"'; then
  echo "OK: Nginx proxy health check passed"
else
  echo "WARN: Nginx proxy health check failed"
fi

if [[ -n "${DOMAIN}" ]]; then
  echo ""
  echo ">>> Public health check (${DOMAIN})..."
  curl -fsS "${DOMAIN}/api/health" > /dev/null && echo "OK: ${DOMAIN}/api/health" || echo "WARN: ${DOMAIN}/api/health failed"
  curl -fsSI "${DOMAIN}/tr" > /dev/null && echo "OK: ${DOMAIN}/tr" || echo "WARN: ${DOMAIN}/tr failed"
  curl -fsSI "${DOMAIN}/en" > /dev/null && echo "OK: ${DOMAIN}/en" || echo "WARN: ${DOMAIN}/en failed"
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