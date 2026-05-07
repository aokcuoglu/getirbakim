#!/usr/bin/env bash
# GetirBakim Production URL Stability and Performance Audit
# Usage: bash scripts/audit-production-performance.sh [BASE_URL]
set -euo pipefail

BASE_URL="${1:-https://getirbakim.com}"
TIMEOUT=30

echo "=========================================="
echo "GetirBakim Performance Audit"
echo "Base URL: $BASE_URL"
echo "Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "=========================================="
echo ""

probe() {
  local url="$1"
  local label="$2"
  local method="${3:-GET}"
  local body="${4:-}"

  echo "--- $label ---"
  echo "  URL: $url"
  echo "  Method: $method"

  if [ -n "$body" ]; then
    result=$(curl -s -o /dev/null \
      -w "status=%{http_code}\nttfb=%{time_starttransfer}\ntotal=%{time_total}\nsize=%{size_download}\nredirects=%{num_redirects}\nurl_effective=%{url_effective}\n" \
      --max-time "$TIMEOUT" \
      -X "$method" \
      -H "Content-Type: application/json" \
      -d "$body" \
      "$url" 2>&1 || echo "status=TIMEOUT")
  else
    result=$(curl -s -o /dev/null \
      -w "status=%{http_code}\nttfb=%{time_starttransfer}\ntotal=%{time_total}\nsize=%{size_download}\nredirects=%{num_redirects}\nurl_effective=%{url_effective}\n" \
      --max-time "$TIMEOUT" \
      "$url" 2>&1 || echo "status=TIMEOUT")
  fi

  echo "$result" | while IFS= read -r line; do
    echo "  $line"
  done
  echo ""
}

echo "=== DOMAIN REDIRECT CHECKS ==="
probe "https://www.getirbakim.com/" "www-root -> should redirect to apex"
probe "https://getirbakim.com/" "apex-root -> should redirect to /tr"

echo "=== LOCALE ROUTES ==="
probe "https://getirbakim.com/tr" "/tr - Turkish homepage"
probe "https://getirbakim.com/en" "/en - English homepage"

echo "=== CATALOG AND PRODUCT ROUTES ==="
probe "https://getirbakim.com/tr/catalog" "/tr/catalog redirect"
probe "https://getirbakim.com/en/catalog" "/en/catalog redirect"
probe "https://getirbakim.com/tr/car-parts" "/tr/car-parts category"
probe "https://getirbakim.com/en/car-parts" "/en/car-parts category"

echo "=== API ROUTES ==="
probe "https://getirbakim.com/api/health" "Health API"
probe "https://getirbakim.com/api/search?q=Bosch" "Search API GET"

echo "=== SEO ROUTES ==="
probe "https://getirbakim.com/robots.txt" "robots.txt"
probe "https://getirbakim.com/sitemap.xml" "Sitemap (global)"
probe "https://getirbakim.com/tr/sitemap.xml" "Sitemap (TR)"

echo "=== COMPETITOR BENCHMARK ==="
probe "https://www.trodo.com/" "Trodo root"
probe "https://www.trodo.com/car-parts" "Trodo car-parts"

echo "=========================================="
echo "Audit complete."
echo "=========================================="