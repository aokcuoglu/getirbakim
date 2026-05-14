# Category Routing

## Route Structure

Category pages use the SEO-friendly `/{locale}/{categorySlug}` pattern:

- `/en/fuel-filter` — English category page
- `/tr/yakit-filtresi` — Turkish category page (if `name_tr` slug matches)
- `/en/fuel-filters` — if `url_key` in DB stores the plural form
- `/en/fuel-filter-100261` — legacy URL with ID suffix, redirects to `/en/fuel-filter` via `next.config.mjs`

The catch-all route `app/[locale]/[...slug]/page.tsx` handles all category URLs.

## Slug Resolution

`getPartCategoryByUrlKey(urlKey)` resolves categories in this order:

1. **In-memory category snapshot** (5min TTL) → Redis snapshot cache (1h TTL) → DB fallback
2. **Redis per-key cache** — `part-category-v2-{urlKey}`
3. **Legacy ID suffix** — if urlKey matches `-(\d+)$`, parse ID and look up in `snapshot.byId`
4. **Exact `url_key` match** — lookup in `snapshot.byUrlKey`
5. **Suffixed `url_key` fallback** — iterate `snapshot.byUrlKey` entries starting with `urlKey + '-'`, then filter by `normalizeUrlKey`
6. **Name-derived slug fallback** — iterate `snapshot.rows` where `url_key IS NULL`, match `generateSlug(name)` or `generateSlug(name_tr)`
7. **notFound()** — if none of the above match

### Why Each Fallback Exists

| Fallback | Reason | Example |
|----------|--------|---------|
| Legacy ID | Old URLs had categoryId embedded (`fuel-filter-100261`) | `/en/fuel-filter-100261` redirected then resolved by ID |
| Exact `url_key` | Clean canonical slugs stored in DB | `filters`, `car-parts`, `brake-system` (19 categories) |
| Suffixed `url_key` | Most categories have `url_key` with ID suffix | `fuel-filter-100261` → normalized to `fuel-filter` (959 categories) |
| Name-derived | Rare: categories with `url_key IS NULL` | `generateSlug("Fuel filter")` → `fuel-filter` (1 category) |

### The v0.2.2 Bug Fix

The original slug resolution only had steps 1–3 and 5. Step 4 (suffixed fallback) was missing.

- **Link generation** used `normalizeUrlKey()` which strips the `-\d{5,}$` suffix: `"fuel-filter-100261"` → `"fuel-filter"`
- **Lookup** only did `WHERE url_key = 'fuel-filter'` which returned 0 rows (the DB had `"fuel-filter-100261"`)
- This meant 959 of 979 categories returned 404 when accessed via their canonical URL

Step 4 adds: when exact match fails, query `WHERE url_key LIKE 'fuel-filter-%'`, then verify `normalizeUrlKey(result.url_key, result.name) === 'fuel-filter'` to filter false positives (e.g., `"fuel-filterhousing-100253"` does not match `"fuel-filter"`).

## Link Generation

All category links use `normalizeUrlKey(url_key, name)` which:
- Returns `url_key` with legacy 5+ digit ID suffixes stripped (e.g., `"fuel-filter-100261"` → `"fuel-filter"`)
- Returns `url_key` unchanged if no suffix (e.g., `"filters"` → `"filters"`)
- Returns `generateSlug(name)` if `url_key` is null/empty

Components that generate category links:
- `CategoryContent.tsx` — subcategory cards
- `CategoryNavigation.tsx` — sidebar
- `BreadcrumbSection.tsx` — breadcrumbs
- `TopCategories.tsx` — hero category bar
- `MegaMenu.tsx` — mega menu
- `CatalogSheet.tsx` — catalog sheet
- `Navbar.tsx` — navbar links
- `Footer.tsx` — footer links
- `Hero.tsx` — home page category links
- `HomePageClient.tsx` — make/brand navigation

All use `buildCategoryUrl(locale, { categoryUrlKey: urlKey })` which produces `/{locale}/{urlKey}`.

## Turkish Locale Support

- `url_key` values in the database are English-derived slugs
- Links always use the `url_key` (or English `name`-derived slug when `url_key` is NULL)
- Turkish category names are displayed via `getLocalizedCategoryName()` but URLs use English canonical slugs
- If a Turkish slug like `yakit-filtresi` is requested, the name-derived fallback matches `generateSlug(name_tr)`

## No-Price Products

Category pages show:
- Purchasable products first (with price and stock)
- Catalog/offer products without price remain visible with "Request Price" CTA
- No products are hidden based on price availability

## Indexing

Category page indexing remains disabled (`NEXT_PUBLIC_ALLOW_INDEXING=false`) until production SEO audit passes.

## Cache

### v0.2.3 Caching Improvements

Category and nav data now uses a 3-layer caching architecture:

1. **Next.js Data Cache (`unstable_cache`)** — ISR with 1-hour revalidation
   - `part-category-by-urlkey-v3` — category slug resolution
   - `main-nav-categories-v3` — main navigation categories
   - `popular-manufacturers-v2` — popular manufacturers

2. **Redis (Upstash)** — 1-hour TTL, fallback inside `unstable_cache`
   - `part-category-v2-{urlKey}` — category hierarchy
   - `main-nav-categories-{locale}-v2` — nav categories
   - `popular-manufacturers-v1` — manufacturers
   - `part-categories-tree-{locale}-v2` — category tree

3. **React `cache()`** — per-request deduplication
   - `getPartCategoryByUrlKey` deduplicates within a single server render

### Slug Resolver Optimization (v0.2.9 — Category Snapshot)

The slug resolver was rewritten to use a single `CategorySnapshot` loaded from DB (cold) / Redis (warm) / in-memory (hot):

- **Before (v0.2.3):** 2-3 batched DB queries per cold cache miss
- **Before (v0.2.8):** Still 2-3 batched DB queries on Redis miss
- **After (v0.2.9):** Zero DB queries on warm/hot; single `findMany` (979 rows) on cold, then cached

The `CategorySnapshot` class provides:
- `byId`: Map<number, CategorySnapshotRow> — O(1) lookup by category ID
- `byUrlKey`: Map<string, CategorySnapshotRow[]> — O(1) lookup by url_key
- `byNameSlug`: Map<string, CategorySnapshotRow[]> — O(1) lookup by name-derived slug
- `childrenByParentId`: Map<number|null, CategorySnapshotRow[]> — O(1) sibling/child lookup

All category lookups (nav, urlKey, ancestry, siblings, topCategories, search ID) now resolve from this snapshot.

Cache layers:
1. **In-memory CategorySnapshot** — 5min TTL, process-local (fastest)
2. **Redis snapshot cache** — `category-snapshot-v1`, 1h TTL (medium)
3. **DB fallback** — single `findMany` query, cached to both layers above

### Database Index

Added composite index `part_categories_active_url_key_idx` on `(is_active, url_key)` to support the most common slug resolution query pattern.

- Category lookup results cached in Redis with key `part-category-v2-{urlKey}`, TTL 3600s
- Category tree cached in Redis with key `part-categories-tree-{locale}-v2`, TTL 3600s
- Client-side SPA navigation via `CategoryPageShell` with `/api/category-page` API

### v0.2.6 Category Page Performance

Category page data contract:
- **Default page size**: 24 products
- **Hard max page size**: 48 products (enforced server-side in `normalizeBody` and client-side in `use-category-search`)
- **SSR initial render**: 24 products, capped to 48
- **`hasMore` field**: Added to `CatalogArticlesResult` for pagination awareness
- **Client prefetching**: Only next page (reduced from 4 concurrent prefetches)
- **Redis cache TTL for catalog articles**: 300s (was 60s)
- **`CATEGORY_PAYLOAD_TOO_LARGE` warning**: When `PERFORMANCE_LOGGING=true` and >48 products returned