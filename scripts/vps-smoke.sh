#!/usr/bin/env bash
set -uo pipefail

echo "=== GetirBakim V2 VPS Smoke Test ==="

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
check "getirbakim.com/api/health"  "http://getirbakim.com/api/health"
check "getirbakim.com /tr"         "http://getirbakim.com/tr"
check "getirbakim.com /en"         "http://getirbakim.com/en"

echo ""
echo "--- External HTTPS checks ---"
check "getirbakim.com HTTPS /api/health" "https://getirbakim.com/api/health" 200
check "getirbakim.com HTTPS /tr"         "https://getirbakim.com/tr"         200
check "getirbakim.com HTTPS /en"         "https://getirbakim.com/en"         200

echo ""
echo "=== Results: ${PASS} passed, ${FAIL} failed ==="

if [ "${FAIL}" -gt 0 ]; then
  exit 1
fi