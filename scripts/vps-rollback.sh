#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${PROJECT_PATH:-/opt/getirbakim-v2}"
ENV_FILE=".env.production"

TARGET_REF="${1:-${ROLLBACK_REF:-}}"

if [[ -z "${TARGET_REF}" ]]; then
  echo "Usage: ROLLBACK_REF=<git-ref> bash scripts/vps-rollback.sh"
  echo "   or: bash scripts/vps-rollback.sh <git-tag-or-commit>"
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
echo "Target:      ${TARGET_REF}"
echo "Env file:    ${ENV_FILE}"
echo ""
echo "WARNING: This will roll back to a previous version."
echo "Press Ctrl+C to cancel, or wait 5 seconds to continue..."
sleep 5

if ! git fetch --tags origin 2>/dev/null; then
  echo "WARN: Could not fetch tags from origin, using local tags only"
fi

if ! git rev-parse "${TARGET_REF}" >/dev/null 2>&1; then
  echo "FATAL: Ref '${TARGET_REF}' not found. Available tags:"
  git tag -l --sort=-v:refname | head -10
  exit 1
fi

echo ""
echo ">>> Saving current commit for reference: ${CURRENT_COMMIT}"
echo "${CURRENT_COMMIT}" > .rollback-point

echo ">>> Checking out ${TARGET_REF}..."
git checkout "${TARGET_REF}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "FATAL: ${ENV_FILE} not found in ${REPO_DIR}. Aborting."
  echo ">>> Restoring previous state..."
  git checkout main
  exit 1
fi

echo ">>> Shutting down existing containers..."
docker compose --env-file "${ENV_FILE}" down --remove-orphans

echo ">>> Building and starting containers from ${TARGET_REF}..."
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
    echo "OK: Rollback health check passed"
  else
    echo "WARNING: Health check returned unexpected response"
    echo "${HEALTH}"
  fi
else
  echo "FAILED: Health check did not respond after rollback"
  docker compose --env-file "${ENV_FILE}" logs app --tail=50
  echo ""
  echo "=== Rollback to ${TARGET_REF} may have issues ==="
  echo "Check container logs above."
  exit 1
fi

echo ""
echo "=== Rollback to ${TARGET_REF} complete ==="
echo ""
echo "To return to main branch development:"
echo "  cd ${REPO_DIR}"
echo "  git checkout main"
echo ""
echo "Rollback reference saved in ${REPO_DIR}/.rollback-point"