#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="/opt/getirbakim-v2"
ENV_FILE=".env.production"
BRANCH="main"

echo "=== GetirBakim V2 VPS Deploy ==="
echo "Directory: ${DEPLOY_DIR}"
echo "Branch:    ${BRANCH}"
echo "Env file:  ${ENV_FILE}"
echo ""

cd "${DEPLOY_DIR}"

echo ">>> Pulling latest code from origin/${BRANCH}..."
git pull origin "${BRANCH}"

echo ">>> Shutting down existing containers..."
docker compose --env-file "${ENV_FILE}" down --remove-orphans

echo ">>> Building and starting containers..."
docker compose --env-file "${ENV_FILE}" up -d --build

echo ">>> Waiting for container to start..."
sleep 5

echo ">>> Container status:"
docker compose --env-file "${ENV_FILE}" ps

echo ""
echo ">>> Internal health check:"
curl -sf http://127.0.0.1:3000/api/health && echo "" || echo "FAILED: internal health check"

echo ""
echo ">>> External health check (HTTP):"
curl -sf http://getirbakim.com/api/health && echo "" || echo "FAILED: external HTTP health check"

echo ""
echo ">>> External health check (HTTPS):"
curl -sf https://getirbakim.com/api/health && echo "" || echo "SKIPPED: HTTPS not available"

echo ""
echo ">>> /tr response:"
curl -sI http://getirbakim.com/tr | head -1

echo ">>> /en response:"
curl -sI http://getirbakim.com/en | head -1

echo ""
echo "=== Deploy complete ==="