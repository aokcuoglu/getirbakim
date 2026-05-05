#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/opt/getirbakim-v2"
ENV_FILE=".env.production"

TARGET_TAG="${1:-}"
if [[ -z "${TARGET_TAG}" ]]; then
  echo "Usage: bash scripts/vps-rollback.sh <git-tag>"
  echo ""
  echo "Available tags:"
  cd "${REPO_DIR}" 2>/dev/null && git tag -l --sort=-v:refname | head -10 || echo "(no tags found)"
  exit 1
fi

if [[ ! -d "${REPO_DIR}/.git" ]]; then
  echo "FATAL: ${REPO_DIR} is not a git repository. Aborting."
  exit 1
fi

cd "${REPO_DIR}"

CURRENT_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "none")
CURRENT_COMMIT=$(git rev-parse --short HEAD)

echo "=== GetirBakim V2 Rollback ==="
echo "Repository:  ${REPO_DIR}"
echo "Current:     ${CURRENT_TAG} (${CURRENT_COMMIT})"
echo "Target:      ${TARGET_TAG}"
echo "Env file:    ${ENV_FILE}"
echo ""
echo "WARNING: This will roll back to a previous version."
echo "Press Ctrl+C to cancel, or wait 5 seconds to continue..."
sleep 5

if ! git tag -l | grep -q "^${TARGET_TAG}$"; then
  echo "FATAL: Tag '${TARGET_TAG}' not found. Available tags:"
  git tag -l --sort=-v:refname | head -10
  exit 1
fi

echo ""
echo ">>> Saving current commit for reference: ${CURRENT_COMMIT}"
echo "${CURRENT_COMMIT}" > .rollback-point

echo ">>> Checking out tag ${TARGET_TAG}..."
git checkout "${TARGET_TAG}"

echo ">>> Shutting down existing containers..."
docker compose --env-file "${ENV_FILE}" down --remove-orphans

echo ">>> Building and starting containers from ${TARGET_TAG}..."
docker compose --env-file "${ENV_FILE}" up -d --build

echo ">>> Waiting for container to start..."
sleep 10

echo ""
echo ">>> Container status:"
docker compose --env-file "${ENV_FILE}" ps

echo ""
echo ">>> Internal health check:"
HEALTH=$(curl -sf http://127.0.0.1:3000/api/health 2>/dev/null) && echo "${HEALTH}" || echo "FAILED: internal health check"

if echo "${HEALTH}" | grep -q '"status":"ok"'; then
  echo "Rollback health check: OK"
else
  echo "WARNING: Health check did not return 'ok'. Container may not be healthy."
fi

echo ""
echo ">>> External health check (HTTPS):"
curl -sf https://getirbakim.com/api/health && echo "" || echo "SKIPPED: HTTPS external health check"

echo ""
echo "=== Rollback to ${TARGET_TAG} complete ==="
echo ""
echo "To return to main branch development:"
echo "  cd ${REPO_DIR}"
echo "  git checkout main"
echo ""
echo "Rollback reference saved in ${REPO_DIR}/.rollback-point"