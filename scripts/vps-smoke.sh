#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-getirbakim.com}"

echo "=== GetirBakim V2 VPS Smoke Test ==="
echo "Domain: ${DOMAIN}"

PASS=0
FAIL=0

check() {
  local label="$1"
  local url="$2"
  local expected_status="${3:-200}"

  status=$(curl -so /dev/null -w '%{http_code}' "${url}" 2>/dev/null || echo "000")

  if [ "${status}" = "${expected_status}" ]; then
    echo "  PASS  ${label}  (${status})"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  ${label}  (expected ${expected_status}, got ${status})"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "--- Internal checks ---"
check "127.0.0.1:3000/api/health" "http://127.0.0.1:3000/api/health"

echo ""
echo "--- External HTTP checks ---"
check "${DOMAIN}/api/health"  "http://${DOMAIN}/api/health"
check "${DOMAIN} /tr"         "http://${DOMAIN}/tr"
check "${DOMAIN} /en"         "http://${DOMAIN}/en"

echo ""
echo "--- External HTTPS checks ---"
check "${DOMAIN} HTTPS /api/health" "https://${DOMAIN}/api/health" 200
check "${DOMAIN} HTTPS /tr"         "https://${DOMAIN}/tr"         200
check "${DOMAIN} HTTPS /en"         "https://${DOMAIN}/en"         200

echo ""
echo "=== Results: ${PASS} passed, ${FAIL} failed ==="

if [ "${FAIL}" -gt 0 ]; then
  exit 1
fi