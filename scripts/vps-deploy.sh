#!/usr/bin/env bash
set -euo pipefail

PROJECT_PATH="${PROJECT_PATH:-/opt/getirbakim-v2}"
BRANCH="${BRANCH:-main}"
DOMAIN="${DOMAIN:-}"
ENV_FILE=".env.production"

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
echo "Env file:  ${ENV_FILE}"
echo ""

echo ">>> Fetching origin..."
git fetch origin

echo ">>> Checking out ${BRANCH}..."
git checkout "${BRANCH}"

echo ">>> Pulling latest from origin/${BRANCH}..."
git pull origin "${BRANCH}"

AFTER=$(git rev-parse --short HEAD)

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "FATAL: ${ENV_FILE} not found in ${PROJECT_PATH}. Aborting."
  exit 1
fi

echo ""
echo ">>> Shutting down existing containers..."
docker compose --env-file "${ENV_FILE}" down --remove-orphans

echo ">>> Building and starting containers..."
docker compose --env-file "${ENV_FILE}" up -d --build

echo ">>> Waiting for container to start (15s)..."
sleep 15

echo ""
echo ">>> Container status:"
docker compose --env-file "${ENV_FILE}" ps

echo ""
echo ">>> Internal health check (http://127.0.0.1:3000/api/health)..."
if HEALTH=$(curl -sf http://127.0.0.1:3000/api/health 2>/dev/null); then
  if echo "${HEALTH}" | grep -q '"status":"ok"'; then
    echo "OK: Internal health check passed"
  else
    echo "WARNING: Internal health check returned unexpected response"
    echo "${HEALTH}"
  fi
else
  echo "FAILED: Internal health check did not respond"
  docker compose --env-file "${ENV_FILE}" logs app --tail=50
  exit 1
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
echo "  Before: ${BEFORE}"
echo "  After:  ${AFTER}"
echo ""
echo "Run 'bash scripts/vps-smoke.sh' for comprehensive smoke tests."