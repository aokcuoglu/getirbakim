#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-${DOMAIN:-}}"

echo "=== GetirBakim V2 VPS Smoke Test ==="
echo "Domain: ${DOMAIN:-<not set>}"

PASS=0
FAIL=0
WARN=0

check() {
  local label="$1"
  local url="$2"
  local expected_status="${3:-200}"
  local timeout="${4:-30}"
  local retries="${5:-2}"

  local attempt=1
  local status="000"

  while [ "${attempt}" -le "${retries}" ]; do
    status=$(curl -so /dev/null -w '%{http_code}' --max-time "${timeout}" "${url}" 2>/dev/null) || status="000"
    if [ "${status}" = "${expected_status}" ]; then
      echo "  PASS  ${label}  (${status}${attempt:+, attempt ${attempt}/${retries}})"
      PASS=$((PASS + 1))
      return 0
    fi
    if [ "${attempt}" -lt "${retries}" ]; then
      echo "  RETRY ${label}  (got ${status}, retrying...)"
      sleep 5
    fi
    attempt=$((attempt + 1))
  done

  echo "  FAIL  ${label}  (expected ${expected_status}, got ${status})"
  FAIL=$((FAIL + 1))
}

echo ""
echo "--- Internal checks (docker exec app) ---"

internal_check() {
  local label="$1"
  local path="$2"
  local timeout="${4:-30}"
  local retries="${5:-2}"
  # Accept 200–399 (success + redirect) and 401 (unauthorized means routing works)
  local attempt=1
  local status="000"

  while [ "${attempt}" -le "${retries}" ]; do
    status=$(docker compose --env-file .env.production exec -T app curl -so /dev/null -w '%{http_code}' --max-time "${timeout}" "http://localhost:3000${path}" 2>/dev/null) || status="000"
    if [ "${status}" -ge 200 ] 2>/dev/null && [ "${status}" -lt 400 ]; then
      echo "  PASS  ${label}  (${status}${attempt:+, attempt ${attempt}/${retries}})"
      PASS=$((PASS + 1))
      return 0
    fi
    if [ "${attempt}" -lt "${retries}" ]; then
      echo "  RETRY ${label}  (got ${status}, retrying...)"
      sleep 5
    fi
    attempt=$((attempt + 1))
  done

  echo "  FAIL  ${label}  (expected 200–399, got ${status})"
  FAIL=$((FAIL + 1))
}

internal_check "app:3000/api/health" "/api/health" 200 15 1
internal_check "app:3000/tr" "/tr" 200 30 3
internal_check "app:3000/en" "/en" 200 30 3

if [[ -n "${DOMAIN}" ]]; then
  echo ""
  echo "--- External HTTPS checks (${DOMAIN}) ---"
  # External checks are non-fatal — they may fail in CI if the domain
  # is not publicly reachable from the runner (DNS, firewall, Cloudflare).
  check_external() {
    local label="$1" url="$2" expected="${3:-200}" timeout="${4:-30}" retries="${5:-2}"
    local attempt=1 status="000"
    while [ "${attempt}" -le "${retries}" ]; do
      status=$(curl -so /dev/null -w '%{http_code}' --max-time "${timeout}" "${url}" 2>/dev/null) || status="000"
      if [ "${status}" = "${expected}" ]; then
        echo "  PASS  ${label}  (${status}${attempt:+, attempt ${attempt}/${retries}})"
        PASS=$((PASS + 1)); return 0
      fi
      [ "${attempt}" -lt "${retries}" ] && echo "  RETRY ${label}  (got ${status}, retrying...)" && sleep 5
      attempt=$((attempt + 1))
    done
    echo "  WARN  ${label}  (expected ${expected}, got ${status})"
    WARN=$((WARN + 1)); return 0
  }
  check_external "${DOMAIN} HTTPS /api/health" "https://${DOMAIN}/api/health" 200 10 1
  check_external "${DOMAIN} HTTPS /tr"         "https://${DOMAIN}/tr"         200 30 2
  check_external "${DOMAIN} HTTPS /en"         "https://${DOMAIN}/en"         200 30 2
fi

echo ""
echo "=== Results: ${PASS} passed, ${FAIL} failed${WARN:+ (${WARN} warnings)} ==="

if [ "${FAIL}" -gt 0 ]; then
  exit 1
fi