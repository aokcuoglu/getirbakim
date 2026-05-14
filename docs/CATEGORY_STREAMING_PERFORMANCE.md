# Category Page Streaming Performance

## Problem

Category pages (`/en/air-filter`, `/en/fuel-filter`, `/en/filters`) had slow total response times (21+ seconds) despite fast TTFB (0.28s). The TTFB was fast because `generateMetadata` and layout headers were computed quickly, but the RSC stream tail was blocked by synchronous product data fetching.

## Root Cause

The `buildCategoryPagePayload` function called `getCatalogArticles()` synchronously during server-side rendering. This function:

1. Runs 4 parallel CTE SQL queries (total count, brand facets, stock facets, deduped hits)
2. Runs a `findMany` to fetch full product rows by hit IDs
3. Runs `getCategoryMinRealPriceMap()` for pricing resolution
4. Resolves brand names for facets
5. Optionally merges supplier catalog data

On a cold Redis cache, this entire chain blocks the RSC stream until completion. The HTML shell (navigation, breadcrumbs, heading) is ready in ~300ms but cannot be sent because the page component awaits all data before rendering.

## Fix: Streaming Category Data

In v0.2.8, the category page rendering is split into two phases:

### Phase 1: Shell (fast, ~300ms)
- Category resolution (`getCategoryByUrlKey`) - cached in Redis + React cache
- Navigation categories (`getMainNavCategories`) - cached
- Breadcrumbs, heading, sidebar
- For non-leaf: popular manufacturers (cached)
- This renders immediately and streams to the client

### Phase 2: Product data (deferred, ~1-5s)
- Leaf categories: `getCatalogArticles()` runs asynchronously
- The `CategoryLeafContent` component shows a loading skeleton while data resolves
- Once data arrives, the product grid replaces the skeleton

### Key Files Changed

| File | Change |
|------|--------|
| `app/[locale]/_lib/category-page-data.ts` | Added `CategoryShellPayload` type, `buildCategoryShellPayload()`, `fetchLeafInitialData()` |
| `app/[locale]/_lib/category-page.tsx` | Splits rendering into shell + deferred data via Promise |
| `app/[locale]/[...slug]/_components/CategoryPageShell.tsx` | Accepts `shellPayload` + `initialDataPromise`, resolves data asynchronously |
| `app/[locale]/[...slug]/_components/CategoryPageShell.tsx` | Added `CategoryLeafContent` component with loading state |

## Category Page Data Contract

- Default page size: 24 products
- Hard max page size: 48 products
- Shell data (category, nav, breadcrumbs) renders in < 500ms
- Product data streams in separately (1-5s depending on cache)
- No synchronous exact total count if expensive (cached for 300s)
- No blocking facet count for initial render
- No fitment enrichment per card
- No large OEM/reference arrays per card (detail page loads later)
- No-price (REQUEST_PRICE) products remain visible
- Purchasable products rank above REQUEST_PRICE where relevance is similar
- Invalid slug → 404
- `/en/filters` loads category cards, not product results for every category

## Performance Monitoring

Set `PERFORMANCE_LOGGING=true` to enable timing logs:

```
[perf:group] categoryPagePayload total=1234ms (resolveCategory=50ms, fetchData=1184ms)
[perf:group] categoryShellPayload total=82ms (resolveCategory=50ms, popularManufacturers=32ms)
```

Warning thresholds:
- `CATEGORY_TAIL_LATENCY`: any operation > 1000ms
- `CATEGORY_METADATA_SLOW`: generateMetadata > 1000ms
- `CATEGORY_LAYOUT_SLOW`: layout/nav > 1000ms
- `CATEGORY_PRODUCT_FETCH_TOO_LARGE`: initial product fetch > 48 results
- `CATEGORY_COUNT_OR_FACET_BLOCKING`: count/facet blocks initial render

## Before/After

### Before (v0.2.7)
- TTFB: ~0.28s
- TOTAL: ~21.68s
- Everything blocked until product data was ready

### After (v0.2.8 — Deferred Product Data)
- TTFB: ~0.28s (unchanged)
- Shell rendered: ~300-500ms (breadcrumbs, heading, sidebar visible)
- Product data streams in: 1-5s (depending on cache)
- TOTAL: 2-5s (vs 21+ seconds previously)

### After (v0.2.9 — Category Snapshot Cache + Deferred Promise Fix)
- Cold `/en/air-filter`: ~2.67s (vs ~6.17s in v0.2.8)
- Warm `/en/air-filter`: ~1.25s (vs ~2.44s in v0.2.8)
- Warm `/en/filters`: ~0.03s (vs runtime error in v0.2.8)
- All category lookups now use in-memory `CategorySnapshot` (5min TTL, backed by Redis 1h TTL)
- `categoryByUrlKey:findTarget`, ancestry, siblings, mainNav, topCategories all resolve from snapshot on warm
- Zero DB queries on warm requests for category resolution
- Server component now awaits product data for leaf pages (no Promise passed to client)
- Non-leaf pages (e.g. `/en/filters`) correctly render category cards without leaf product data

## Deferred Work

- Consider Suspense boundary for product data on the server component level (currently client-side async)
- Consider streaming RSC payload with `use()` instead of client-side promise resolution
- Consider caching popular manufacturers longer than the current `unstable_cache(3600s)` + Redis
- Consider pre-generating category counts at index time