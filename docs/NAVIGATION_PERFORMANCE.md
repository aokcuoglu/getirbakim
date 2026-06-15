# Navigation Performance - v0.2.3

## Overview

This document describes the navigation and route transition performance optimizations applied in v0.2.3.

## Baseline Issues (Before v0.2.3)

### Root Causes of Slow Navigation

1. **Category slug resolver (`getPartCategoryByUrlKey`)** — Cold cache triggered 4–8+ sequential DB round trips per category page:
   - Redis miss → `findUnique` by legacy ID → `findMany` by exact `url_key` → N child count queries → `findMany` by suffixed `url_key` → N child count queries → `findMany` for name-slug fallback → Iterative ancestry walk (1 query per parent level) → Siblings query
   - Ancestry walk was particularly expensive: one `findUnique` per parent level (3-4 queries for deeply nested categories)

2. **Layout `getMainNavCategories` on every page** — Called from `layout.tsx` in category, search, and catalog layouts. Used Redis but not Next.js ISR (`unstable_cache`). Every SSR request required a Redis round trip even for read-mostly data that rarely changes.

3. **`getPopularManufacturers` on non-leaf category pages** — Same: Redis-only caching, no ISR layer.

4. **No Next.js data cache layer** — Category and nav data used only Redis + React `cache()`. Next.js ISR (`unstable_cache`) was only used for `getCatalogData`, not for the more frequently called nav/category functions. This meant that even with warm Redis, every server render still made an async Redis call.

5. **N+1 child count queries in slug resolver** — When multiple slug candidates matched (`url_key` exact, suffixed, name-slug), the resolver ran one `findMany` per candidate to count children. This was an N+1 pattern.

## Changes Made

### 1. Category Slug Resolver Optimization (`lib/actions/getPartCategories.ts`)

**Before:** Sequential multi-fallback with N+1 queries per fallback level.

**After:** Batched child count queries using `WHERE parent_id IN (...)`.

Key changes:
- Extracted `findCategoryByUrlKey()` as an internal helper that returns raw category data
- Replaced `Promise.all(slugMatches.map(async cat => db.findMany({where: {parent_id: cat.id}})))` with a single `db.findMany({where: {parent_id: {in: candidateIds}}})` batched query
- Replaced iterative ancestry walk (1 `findUnique` per parent) with a batch approach: collect all ancestor IDs first, then fetch them in one `findMany` query
- Siblings query runs in parallel with ancestry fetch
- Added `unstable_cache` wrapper for ISR layer (key: `part-category-by-urlkey-v3`, revalidate: 3600s)
- React `cache()` per-request dedup still applies inside the ISR function

**Expected improvement:** From 4-8+ DB round trips to 2-3 DB round trips for cold cache. Warm ISR cache: 0 DB queries.

### 2. `getMainNavCategories` ISR Caching (`lib/actions/getPartCategories.ts`)

**Before:** Redis-only caching (1 hour TTL).

**After:** `unstable_cache` wrapper with `revalidate: 3600` + Redis fallback.

- Function wrapped with both `cache()` (per-request dedup) and `unstable_cache()` (Next.js data cache)
- On warm ISR cache: served from Next.js data cache, no Redis or DB calls
- On ISR miss: Redis check first, then DB fallback, result cached in both layers

### 3. `getPopularManufacturers` ISR Caching (`lib/actions/getPopularManufacturers.ts`)

**Before:** Redis-only caching (1 hour TTL), `'use server'` directive.

**After:** `unstable_cache` wrapper with `revalidate: 3600` + Redis fallback.

- Same dual-layer caching pattern as `getMainNavCategories`
- Removed `'use server'` directive (not needed for cached data fetchers called from server components)

### 4. Route Timing Instrumentation

Added `createTimerGroup` instrumentation to key server components:
- `app/[locale]/[...slug]/page.tsx` — `categoryPage` timer group
- `app/[locale]/[...slug]/layout.tsx` — `categoryLayout` timer group
- `app/[locale]/_lib/category-page-data.ts` — `categoryPagePayload` timer group with `resolveCategory` and `fetchData` stages

All timing logs appear when `PERFORMANCE_LOGGING=true` in `.env`.

### 5. Database Index

Added composite index on `part_categories`:
```sql
CREATE INDEX IF NOT EXISTS part_categories_active_url_key_idx
  ON part_categories (is_active, url_key);
```

This index supports the most common query pattern in `getPartCategoryByUrlKey`:
```sql
WHERE is_active = true AND url_key = 'fuel-filter'
```

The existing single-column indexes on `[is_active]` and `[url_key]` were not optimal for this combined WHERE clause because PostgreSQL cannot efficiently combine two separate single-column indexes for a single table scan.

### 6. No Changes to `no-store` / `force-dynamic`

Reviewed all `cache: 'no-store'`, `unstable_noStore`, and `dynamic = 'force-dynamic'` expressions:
- All occurrences are in API routes, admin pages, or supplier sync endpoints that require real-time data
- Category pages already use `revalidate = 3600` and ISR
- No unnecessary dynamic directives were found on category-related pages

### 7. Caching Architecture After v0.2.3

| Layer | Mechanism | TTL | Scope | v0.2.3 Change |
|-------|-----------|-----|-------|---------------|
| Next.js Data Cache | `unstable_cache` | 1 hour | Category by urlKey, Main nav, Popular manufacturers, Catalog data | **NEW** for category, main nav, manufacturers |
| Redis (Upstash) | `lib/redis.ts` | 1 hour | All server data (fallback inside unstable_cache) | Unchanged |
| ISR/React Cache | `cache()` | Per-request | Category by urlKey dedup | Unchanged |
| CDN | middleware `Cache-Control` | s-maxage=300 | Anonymous HTML pages | Unchanged |

### 8. Query Reduction Summary

| Function | Before (cold) | After (cold) | After (warm ISR) |
|----------|---------------|-------------|-------------------|
| `getPartCategoryByUrlKey` | 4-8+ sequential DB queries | 2-3 DB queries | 0 DB queries |
| `getMainNavCategories` | 1 Redis + 1 DB query | 1 Redis + 1 DB query (unchanged cold) | 0 queries |
| `getPopularManufacturers` | 1 Redis + 1 DB query | 1 Redis + 1 DB query (unchanged cold) | 0 queries |
| Main layout nav fetch | 1 Redis per SSR | 0 (ISR data cache) | 0 queries |

## Recommended Production Checklist

- [ ] Run the SQL migration: `CREATE INDEX IF NOT EXISTS part_categories_active_url_key_idx ON part_categories (is_active, url_key);`
- [ ] Set `PERFORMANCE_LOGGING=true` temporarily to verify timing
- [ ] Monitor Redis hit rates for `part-category-v2-*`, `main-nav-categories-*`, `popular-manufacturers-*`
- [ ] Verify `Cache-Control: public, s-maxage=300` header is present on category pages
- [ ] After deployment, warm the ISR cache by visiting key category pages

## Remaining Bottlenecks

1. **`getCatalogArticles` for leaf categories** — The CTE-based product query with dedup, pricing resolution, and brand facets is inherently expensive. This is the primary cost for leaf category initial load. Consider:
   - Paginating the initial render to 24 products (already done with `DEFAULT_LIMIT = 24`)
   - Deferring facets to a parallel second request if acceptable
   - Adding `unstable_cache` with short TTL (60s) for identical query parameters

2. **Client-side category navigation (`/api/category-page`)** — Already optimized via the `CategoryPageShell` client-side cache. Navigation between categories uses client-side fetch + pushState, avoiding full page reloads.

3. **Middleware session refresh** — The middleware validates the NextAuth JWT session for authenticated users. This adds ~50-100ms for authenticated users but is unavoidable for auth consistency.

4. **Vehicle selector (`VehicleDataProvider`)** — Loads vehicle brands on every page for non-admin users. Already cached at 7 days in Redis. No change needed.