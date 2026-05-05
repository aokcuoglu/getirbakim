#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/opt/getirbakim-v2"
ENV_FILE=".env.production"
BRANCH="main"

if [[ ! -d "${REPO_DIR}/.git" ]]; then
  echo "FATAL: ${REPO_DIR} is not a git repository. Aborting."
  exit 1
fi

cd "${REPO_DIR}"

echo "=== GetirBakim V2 VPS Deploy ==="
echo "Directory: ${REPO_DIR}"
echo "Branch:    ${BRANCH}"
echo "Env file:  ${ENV_FILE}"
echo "Git HEAD:  $(git rev-parse --short HEAD)"
echo ""

echo ">>> Pulling latest code from origin/${BRANCH}..."
git pull origin "${BRANCH}"

echo ">>> Shutting down existing containers..."
docker compose --env-file "${ENV_FILE}" down --remove-orphans

echo ">>> Building and starting containers..."
docker compose --env-file "${ENV_FILE}" up -d --build

echo ">>> Waiting for container to start..."
sleep 10

echo ""
echo ">>> Container status:"
docker compose --env-file "${ENV_FILE}" ps

echo ""
echo ">>> Container logs (last 30 lines):"
docker compose --env-file "${ENV_FILE}" logs app --tail=30

echo ""
echo ">>> Internal health check:"
HEALTH=$(curl -sf http://127.0.0.1:3000/api/health 2>/dev/null) && echo "${HEALTH}" || echo "FAILED: internal health check"

if echo "${HEALTH}" | grep -q '"status":"ok"'; then
  echo "Internal health check: OK"
else
  echo "WARNING: Internal health check did not return 'ok'. Check container logs."
fi

echo ""
echo ">>> External health check (HTTPS):"
curl -sf https://getirbakim.com/api/health && echo "" || echo "SKIPPED: HTTPS external health check"

echo ""
echo ">>> /tr response:"
curl -sI https://getirbakim.com/tr | head -1 || echo "SKIPPED"

echo ">>> /en response:"
curl -sI https://getirbakim.com/en | head -1 || echo "SKIPPED"

echo ""
echo ">>> Current git tag:"
git describe --tags --abbrev=0 2>/dev/null || echo "(no tags)"

echo ""
echo "=== Deploy complete ==="
echo "Reminder: Run 'bash scripts/vps-smoke.sh' for comprehensive smoke tests."