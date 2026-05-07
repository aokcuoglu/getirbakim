#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-${DOMAIN:-}}"

echo "=== GetirBakim V2 VPS Smoke Test ==="
echo "Domain: ${DOMAIN:-<not set>}"

PASS=0
FAIL=0

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
echo "--- Internal checks (127.0.0.1:3000) ---"
check "127.0.0.1:3000/api/health" "http://127.0.0.1:3000/api/health" 200 15 1
check "127.0.0.1:3000/tr" "http://127.0.0.1:3000/tr" 200 30 3
check "127.0.0.1:3000/en" "http://127.0.0.1:3000/en" 200 30 3

if [[ -n "${DOMAIN}" ]]; then
  echo ""
  echo "--- External HTTPS checks (${DOMAIN}) ---"
  check "${DOMAIN} HTTPS /api/health" "https://${DOMAIN}/api/health" 200 10 1
  check "${DOMAIN} HTTPS /tr"         "https://${DOMAIN}/tr"         200 30 2
  check "${DOMAIN} HTTPS /en"         "https://${DOMAIN}/en"         200 30 2
fi

echo ""
echo "=== Results: ${PASS} passed, ${FAIL} failed ==="

if [ "${FAIL}" -gt 0 ]; then
  exit 1
fi