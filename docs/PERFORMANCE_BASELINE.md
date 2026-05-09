# Performance Baseline — v0.2.0

## Baseline Timings (After Changes)

Local Docker without Redis (every request hits DB — on VPS with Redis, warm requests would be cached).

| Endpoint | Run | TTFB (s) | Total (s) | Notes |
|----------|-----|----------|------------|-------|
| `/api/health` | Cold | 1.731 | 1.731 | DB pool init |
| `/api/health` | Warm | 0.230 | 0.231 | Stable |
| `/api/health` | Warm 2 | 0.318 | 0.318 | Stable |
| `/tr` (homepage) | Cold | 0.038 | 2.472 | First request after deploy |
| `/tr` (homepage) | Warm | 0.015 | 1.304 | DB queries still slow without Redis |
| `/tr` (homepage) | Warm 2 | 0.021 | 0.295 | Subsequent warm |
| `/en` (homepage) | Warm | 0.014 | 0.295 | |
| `/en` (homepage) | Warm 2 | 0.013 | 0.321 | |
| `/en` (homepage) | Warm 3 | 0.037 | 0.355 | |

### Performance Logs Observed (without Redis)

All slow operations are DB-bound (no Redis cache locally):
- `mainNavCategories:dbQuery` — 1200-1800ms
- `popularManufacturers:dbQuery` — 1100-2400ms
- `catalogData:allCategories` — ~600ms (979 categories)
- `categoryByUrlKey:findTarget` — 500-2100ms (targeted queries, much better than loading ALL categories)

### No Errors Found

- No EMAXCONNSESSION errors
- No Prisma P1000 errors
- No server component render failures
- No crashes or panics

## Baseline Timings (Before Changes)

Measured via local Docker (docker-compose.local.yml) against Supabase session pooler.

| Endpoint | Run | TTFB (s) | Total (s) | Notes |
|----------|-----|----------|------------|-------|
| `/tr` (homepage) | Cold | 0.163 | 1.940 | First request after deploy |
| `/tr` (homepage) | Warm | 0.017 | 0.198 | Cached |
| `/tr` (homepage) | Warm 2 | 0.017 | 0.197 | Cached |
| `/en` (homepage) | Cold | 0.019 | 0.683 | First request |
| `/en` (homepage) | Warm | 0.016 | 0.194 | Cached |
| `/en` (homepage) | Warm 2 | 0.016 | 0.193 | Cached |
| `/api/health` | Cold | 1.517 | 1.517 | DB ping cold |
| `/api/health` | Warm | 0.180 | 0.180 | DB pool warm |
| `/api/health` | Warm 2 | 0.194 | 0.195 | Stable |
| `/api/search` POST `q=Bosch` | Cold | 135.4 | 135.4 | **Critical bottleneck** |
| `/api/search` POST `q=0445110376` | Cold | — | — | Not tested (timeout risk) |

### Key Finding: Search Endpoint Bottleneck

The `/api/search` POST endpoint with query "Bosch" took **135 seconds** on cold cache. This is because:
1. MeiliSearch is disabled (`MEILI_ENABLED !== 'true'`), forcing Prisma fallback
2. The Prisma fallback uses deeply nested OR conditions across 10+ related tables
3. Token-bundle-based hybrid ranking fetches large datasets for scoring
4. No result size limiting in the initial candidate query for broad searches

## Changes Made

### 1. Performance Timing Utility (`lib/performance/timing.ts`)

- `startTimer(name)` / `endTimer(marker)` — measures named operations
- `createTimerGroup(label)` — groups related operations with summary logging
- Logs only when `PERFORMANCE_LOGGING=true` or `SLOW_QUERY_THRESHOLD` exceeded
- Default threshold: 500ms (reduced from 1000ms)
- Never logs secrets — only operation names and durations

### 2. Instrumented Critical Data Paths

| File | Instrumented Operations |
|------|--------------------------|
| `app/[locale]/page.tsx` | `catalogData`, `manufacturers`, `mainNav` |
| `lib/actions/getPopularManufacturers.ts` | `cacheLookup`, `dbQuery`, `cacheSet` + Redis caching added |
| `lib/actions/getPartCategories.ts` | `partCategories`, `categoriesForVehicle`, `mainNav`, `categoryByUrlKey` — all with cache hit/miss tracking |
| `lib/actions/getCatalogCategories.ts` | `mainNav`, `allCategories` |
| `lib/hierarchy-service.ts` | `cacheLookup` hit/miss + removed `vehicle_brands.count()` debug query |
| `app/api/health/route.ts` | DB timing, Redis status check |

### 3. Cache Improvements

| Change | Before | After |
|--------|--------|-------|
| `getPopularManufacturers` | No Redis cache | Redis cache with 1h TTL (`popular-manufacturers-v1`) |
| `vehicle_brands.count()` | Ran on every `getDropdownData('vehicle_brands')` call | Removed (debug-only, unnecessary in production) |
| `getPartCategoryByUrlKey` | Loaded ALL categories from DB on every Redis miss | Targeted queries by ID, parent_id, siblings |
| `getCategorySearchIdFromUrlKey` | Loaded ALL categories for ancestry check | Iterative parent lookup (O(depth) queries vs O(N) full scan) |

### 4. DB Index Additions

| Table | Index | Rationale |
|-------|-------|-----------|
| `part_brands` | `logo_url` | `getPopularManufacturers` WHERE logo_url IS NOT NULL |
| `part_categories` | `(is_active, is_main_nav)` | Main nav category queries |
| `part_categories` | `(is_active, parent_id)` | Parent-child lookups |
| `part_cross_references` | `(article_number, part_id)` | Code lookup + join |
| `part_eans` | `part_id` | Part detail joins (only had unique constraint, no index) |
| `part_oens` | `(code, part_id)` | Code lookup + join optimization |

### 5. Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PERFORMANCE_LOGGING` | `false` | Enable verbose performance logging |
| `SLOW_QUERY_THRESHOLD` | `500` (was 1000) | Threshold in ms for slow query warnings |

## Cache Architecture (Current State — v0.2.3)

| Layer | Mechanism | TTL | Scope | v0.2.3 Change |
|-------|-----------|-----|-------|----------------|
| CDN/Edge | middleware `Cache-Control` | s-maxage=300, stale-while-revalidate=900 | Anonymous HTML pages | Unchanged |
| Next.js Data Cache | `unstable_cache` | 1 hour | Category by urlKey, Main nav, Popular manufacturers, Catalog data | **Expanded** to cover category, nav, manufacturers |
| Redis (Upstash) | `lib/redis.ts` | Per-call (300s-7d) | All server data (fallback inside unstable_cache) | Unchanged |
| React `cache()` | Per-request dedup | Single render | `getPartCategoryByUrlKey` dedup | Unchanged |
| In-memory | `lib/cache.ts` Map | 1-5m | Admin API only | Unchanged |
| Client | `CategoryCacheProvider` | Session-scoped | Category navigation | Unchanged |

### Cache Keys Documented

| Key Pattern | TTL | Invalidated By |
|-------------|-----|----------------|
| `main-nav-categories-{locale}-v2` | 3600s | Category changes |
| `part-categories-tree-{locale}-v2` | 3600s | Category changes |
| `part-categories-vehicle-{id}-{locale}-v2` | 1800s | Vehicle/category changes |
| `part-category-v2-{urlKey}` | 3600s | Category changes |
| `top-categories-{locale}-v2` | 3600s | Category changes |
| `popular-manufacturers-v1` | 3600s | Brand changes |
| `catalog-full-data-v5-{locale}` | 3600s | Category changes |
| `cat-min-price-v1-{ids}` | 1800s | Pricing changes |
| `meilisearch:search:v3:{hash}` | 300s/120s | Search expiration |
| `ref:makes` / `ref:models:{id}` etc. | 604800s (7d) | Hierarchy changes |

## Known Bottlenecks

### Critical
1. **Search endpoint without MeiliSearch** — Prisma fallback on broad queries is extremely slow (135s for "Bosch")
2. **Search candidate fetching** — `runPrismaSearchFallback` does not limit candidate set size for broad queries

### High
3. **Health endpoint cold start** — 1.5s on first DB connection (pool initialization)
4. **Category page cold cache** — `getPartCategoryByUrlKey` with targeted queries is faster but still multiple DB round-trips on miss

### Medium
5. **In-memory rate limiting** — `lib/api/route-utils.ts` uses per-process Map, doesn't scale across instances
6. **No CDN caching** for API responses — middleware skips API routes before setting Cache-Control headers

## Search Endpoint Analysis

### Response Shape
```json
{
  "hits": [...],
  "totalHits": number,
  "facetDistribution": { "brandName": {}, "categoryName": {} },
  "processingTimeMs": number,
  "query": "string",
  "cached": boolean,
  "source": "search-prisma-fallback",
  "degraded": true
}
```

### MeiliSearch Toggle
- When `MEILI_ENABLED=true`: uses MeiliSearch multi-search, 5min Redis cache
- When `MEILI_ENABLED !== 'true'` (current): Prisma fallback with 2min Redis cache
- MeiliSearch fallback on error: same Prisma path with 2min cache

### Bottleneck Detail (Prisma Fallback)
1. `buildHybridTokenBundles()` splits query into token bundles
2. For code-like queries (digits): fast code lookup path via `part_cross_references`, `part_oens`, `part_eans`
3. For text queries: deeply nested OR across `name`, `part_brands.name`, `part_categories.name`, `part_oens.code`, `part_eans.code`, `part_cross_references`, `part_infos.content`, `part_properties`, and full vehicle hierarchy joins
4. Hybrid ranking scores and sorts all candidates in-memory
5. Price enrichment via `getCategoryMinRealPriceMap()` and `resolvePublicPriceAndPurchasability()`
6. Supplier catalog merge via `fetchResolvedSupplierCatalogHits()`

## Acceptance Targets

| Metric | Target | Current |
|--------|--------|---------|
| `/api/health` | < 500ms | ~180ms warm ✅ |
| `/tr` cold | < 3s | ~1.9s ✅ |
| `/tr` warm | < 1s | ~0.2s ✅ |
| `/api/search?q=Bosch` warm | < 1s | 135s cold ❌ (cached response fast) |
| Category page warm | < 1.5s | Not measured yet |
| EMAXCONNSESSION | None | None observed ✅ |
| Prisma P1000 | None | None observed ✅ |
| Server component failures | None | None observed ✅ |

## Remaining Bottlenecks / Recommendations

### v0.2.1 Suggestions
1. **Re-enable MeiliSearch** — single biggest performance improvement; eliminates Prisma fallback entirely
2. **Limit Prisma fallback candidate set** — add `take: 500` to initial broad queries before scoring
3. **Add Redis-backed rate limiting** — replace in-memory Map with Redis counter
4. **Cache category page data** — `buildCategoryPagePayload` makes parallel but un-cached DB calls

### v0.3.0 Suggestions
5. **Database connection pooling** — consider PgBouncer or Supabase transaction pooler (port 6543) for short-lived queries
6. **CDN headers for API** — add `Cache-Control` for `api/health` and cached search responses in middleware
7. **Vehicle hierarchy first-level prefetch** — pre-resolve and cache makes + popular models on startup
8. **PostgreSQL query plan analysis** — run EXPLAIN ANALYZE on the Prisma fallback WHERE clauses

## SQL Index Recommendations

The following indexes are recommended if not already present. Those added to Prisma schema in v0.2.0 will create automatically on next `prisma db push` or migration:

```sql
-- Added in Prisma schema (v0.2.0)
CREATE INDEX IF NOT EXISTS part_brands_logo_url_idx ON part_brands(logo_url);
CREATE INDEX IF NOT EXISTS part_categories_active_main_nav_idx ON part_categories(is_active, is_main_nav);
CREATE INDEX IF NOT EXISTS part_categories_active_parent_idx ON part_categories(is_active, parent_id);
CREATE INDEX IF NOT EXISTS part_cross_refs_article_part_idx ON part_cross_references(article_number, part_id);
CREATE INDEX IF NOT EXISTS part_eans_part_id_idx ON part_eans(part_id);
CREATE INDEX IF NOT EXISTS part_oens_code_part_idx ON part_oens(code, part_id);

-- Added in Prisma schema (v0.2.3)
CREATE INDEX IF NOT EXISTS part_categories_active_url_key_idx ON part_categories(is_active, url_key);

-- Recommended for future (not in Prisma schema)
CREATE INDEX IF NOT EXISTS part_oens_code_normalized_idx ON part_oens(upper(regexp_replace(code, '[^A-Z0-9]+', '', 'g')));
CREATE INDEX IF NOT EXISTS part_cross_refs_article_normalized_idx ON part_cross_references(upper(regexp_replace(article_number, '[^A-Z0-9]+', '', 'g')));
CREATE INDEX IF NOT EXISTS part_brands_name_normalized_idx ON part_brands(upper(regexp_replace(name, '[^A-Z0-9]+', '', 'g')));
CREATE INDEX IF NOT EXISTS part_categories_name_tr_active_idx ON part_categories(name_tr, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS supplier_product_oems_oem_code_idx ON supplier_product_oems(oem_code) WHERE is_active = true;
```