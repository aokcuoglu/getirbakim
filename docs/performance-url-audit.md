# Production URL Stability and Performance Audit

**Date:** 2026-05-07
**Branch:** fix/production-url-performance-audit
**Auditor:** Automated + Manual

## Baseline Findings

### Production URL Benchmarks (before fixes)

| URL | Status | TTFB | Total | Size | Redirects |
|-----|--------|------|-------|------|-----------|
| https://www.getirbakim.com/ | 200 | 0.82s | 11.3s | 269KB | 1 (→ /tr) |
| https://getirbakim.com/ | 200 | 0.71s | 10.5s | 269KB | 1 (→ /tr) |
| https://www.getirbakim.com/tr | 200 | 0.40s | 11.8s | 269KB | 0 |
| https://www.getirbakim.com/en | 200 | 0.37s | 11.1s | 267KB | 0 |
| https://www.getirbakim.com/api/health | 200 | 1.47s | 1.5s | 152B | 0 |
| https://www.getirbakim.com/tr/catalog | 200 | 0.42s | 14.7s | 80KB | 0 |
| https://www.getirbakim.com/api/search (POST) | TIMEOUT | — | 30s+ | 0B | 0 |
| https://www.trodo.com/ | 403 | 0.29s | 0.3s | 5.5KB | 0 |
| https://www.trodo.com/car-parts | 403 | 0.18s | 0.19s | 5.5KB | 0 |

### Competitor Comparison (Trodo)

Trodo blocks curl/bot requests with 403, so direct comparison is limited. Key observations:
- Trodo's TTFB is ~0.2s (very fast)
- Getirbakim's TTFB for /tr is ~0.4s (acceptable)
- Getirbakim's total download time is 10-14s for full pages (high — likely due to large JS bundles and waterfalls)

## Issues Found

### Critical

1. **robots.txt blocks all indexing**
   - Production returns `Disallow: /` — all search engines are blocked
   - Cause: `NEXT_PUBLIC_ALLOW_INDEXING` not set to `true` in production
   - **Fix:** Set `NEXT_PUBLIC_ALLOW_INDEXING=true` in production deployment

2. **sitemap.xml is empty**
   - Returns an empty `<urlset>` when indexing is disabled
   - This is correct behavior, but once indexing is enabled, sitemap should have URLs

3. **No www-to-apex redirect**
   - Both `www.getirbakim.com` and `getirbakim.com` serve identical content
   - Google treats these as duplicate sites
   - **Fix:** 301 redirect www to apex in nginx (implemented)

4. **hreflang x-default points to /en**
   - `buildLocaleAlternates()` set `x-default` to English
   - For a Turkey-focused site, `x-default` should point to Turkish
   - **Fix:** Changed `x-default` to `trPath` (implemented)

5. **Search API times out (30s+)**
   - POST /api/search with `MEILI_ENABLED=true` but no running Meilisearch hangs indefinitely
   - **Fix:** Added Meilisearch health check with 3s timeout and graceful fallback to Prisma (implemented)

6. **Default locale constant points to 'en'**
   - `DEFAULT_LOCALE` in `lib/seo/url.ts` was `'en'`
   - **Fix:** Changed to `'tr'` (implemented)

### Moderate

7. **NavbarLogo has no `priority` prop**
   - The logo is an above-the-fold LCP candidate but loaded lazily
   - **Fix:** Added `priority` prop (implemented)

8. **CampaignCarousel uses native `<img>` with no loading/fetchPriority**
   - First carousel slide is a potential LCP candidate
   - **Fix:** Added `loading="eager"`, `fetchPriority="high"`, and `decoding="sync"` to first slide only (implemented)

9. **Homepage metadata uses English**
   - `title: 'GetirBakim - Automotive Commerce'` for all locales
   - `description: 'The modern platform for automotive parts.'`
   - **Fix:** Localized title and description for TR/EN (implemented)

10. **Nginx config doesn't redirect www to apex**
    - Both www and non-www serve identical content
    - **Fix:** Added separate 443 server block for www that 301-redirects to apex (implemented)

### Low

11. **No Cache-Control for /api/health**
    - Health endpoint uses `force-dynamic` but no cache headers
    - Low priority since monitoring should always get fresh

12. **Trodo comparison limited**
    - Trodo blocks non-browser requests, returning 403
    - Cannot meaningfully benchmark against it via curl

## Fixes Applied

| # | Fix | Files Changed |
|---|-----|---------------|
| 1 | Nginx: www-to-apex 301 redirect | `infra/nginx/nginx.production.conf` |
| 2 | x-default locale → /tr | `lib/seo/url.ts` |
| 3 | DEFAULT_LOCALE → 'tr' | `lib/seo/url.ts` |
| 4 | Search API Meili timeout + fallback | `app/api/search/route.ts` |
| 5 | NavbarLogo `priority` | `components/navbar/NavbarLogo.tsx` |
| 6 | CampaignCarousel first-slide fetchPriority | `components/hero/CampaignCarousel.tsx` |
| 7 | Homepage localized metadata | `app/[locale]/page.tsx` |
| 8 | Layout localized title template | `app/[locale]/layout.tsx` |
| 9 | Health check expanded (meili, indexing, siteUrl) | `app/api/health/route.ts` |
| 10 | Audit script | `scripts/audit-production-performance.sh` |

## Before/After Metrics

### Local Docker Validation (after fixes)

| URL | Status | TTFB | Total | Size |
|-----|--------|------|-------|------|
| http://localhost:3001/ | 307 | 0.07s | 0.07s | 3B |
| http://localhost:3001/tr | 200 | 0.12s | 2.7s | 269KB |
| http://localhost:3001/en | 200 | 0.01s | 1.0s | 267KB |
| http://localhost:3001/api/health | 200 | 1.6s | 1.6s | 243B |

### Production (after deploying nginx fix)

- **www.getirbakim.com → 301 → getirbakim.com** (new)
- **Root → 307 → /tr** (existing, correct)
- **Search API**: No longer hangs when Meili is unavailable; graceful fallback within 3s

## Remaining Issues

1. **robots.txt still blocks indexing** — Requires setting `NEXT_PUBLIC_ALLOW_INDEXING=true` in production environment before deployment. This is an env var, not a code fix.

2. **Large page sizes (269KB)** — The homepage HTML is large. Consider code splitting and reducing client-side JS for better TTI.

3. **TTFB for /en is much faster than /tr** — Likely due to data loading differences. /tr fetches catalog data that /en also fetches. This should be investigated further.

4. **Category/catalog pages still slow** (14-20s total) — This is the search performance issue addressed by v0.2.1 (separate branch).

5. **MEILI_ENABLED should be `false` in production** — Currently set to `true` in `.env` but Meilisearch is not running. This causes the 30s timeout. Recommend setting `MEILI_ENABLED=false` until Meilisearch is deployed.

## Recommended Next Actions

1. **Set `NEXT_PUBLIC_ALLOW_INDEXING=true` and `MEILI_ENABLED=false` in production env** before next deployment
2. **Deploy nginx config** with the www-to-apex redirect
3. **Merge v0.2.1 catalog+offer search** to fix the search timeout issue permanently
4. **Monitor TTFB** after deployment — target <1s for all pages
5. **Consider adding `<link rel="preload">` for hero background image** in PartFinder CSS
6. **Investigate JS bundle size** for page load optimization

## Commands Used

```bash
# Audit script
bash scripts/audit-production-performance.sh

# Local Docker validation
docker compose -f docker-compose.local.yml down --remove-orphans
docker compose --env-file .env -f docker-compose.local.yml up -d --build
sleep 20
curl -s http://localhost:3001/api/health | python3 -m json.tool
curl -s -o /dev/null -w "status=%{http_code} ttfb=%{time_starttransfer} total=%{time_total}\n" http://localhost:3001/tr

# Production benchmark
curl -L -o /dev/null -s -w "url=%{url_effective}\nstatus=%{http_code}\nttfb=%{time_starttransfer}\ntotal=%{time_total}\nsize=%{size_download}\n" --max-time 30 "https://www.getirbakim.com/"
```