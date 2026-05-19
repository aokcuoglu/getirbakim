# Category Page Streaming Performance

## Problem

Category leaf pages (e.g., `/en/air-filter`, `/en/fuel-filter`) had slow total response times (~15s) despite fast TTFB (~0.23s). The shell (breadcrumbs, heading, sidebar) rendered quickly, but product data blocked the full response.

## Root Cause

In v0.2.9, the fix for a Promise serialization crash (`initialDataPromise` → awaited `initialData`) inadvertently reintroduced blocking product data fetching in the server render path. When `getCatalogArticles()` was awaited during server-side rendering, the 4 parallel CTE SQL queries + follow-up queries blocked the RSC stream for the entire duration (~15s on cold cache).

Additionally, client-side navigation via `/api/category-page` also awaited `getCatalogArticles()` for leaf categories, making every sidebar category click blocking.

## Fix: v0.2.10 — Decouple Product Data from Blocking Page Render

### Architecture Change

Product data for leaf categories is now fully decoupled from the server render path:

1. **Server renders shell only** — `renderCategoryPage()` calls `buildCategoryShellPayload()` which fetches only category metadata (fast, cached via CategorySnapshot)
2. **No `initialData` prop** — `CategoryPagePayload` and `CategoryShellPayload` no longer contain `initialData` / `CatalogArticlesResult`
3. **Client fetches products** — `useCategorySearch` hook fetches from `POST /api/catalog/articles` after mount (existing)
4. **New `/api/category-products` GET endpoint** — validates category slug, returns product data
5. **Client-side navigation is fast** — `/api/category-page` returns shell-only payload (no product data for leaf categories)

### Data Flow (v0.2.10)

```
Server: page.tsx → renderCategoryPage() → buildCategoryShellPayload() → CategoryPageShell (shell only)
Client: CategoryClientWrapper → useCategorySearch() → POST /api/catalog/articles → products render
```

### Key Files Changed

| File | Change |
|------|--------|
| `app/[locale]/_lib/category-page-data.ts` | Removed `initialData` from `CategoryPagePayload`; removed `fetchLeafInitialData` and `getInitialLeafData`; `buildCategoryPagePayload` no longer awaits product data for leaf categories |
| `app/[locale]/_lib/category-page.tsx` | Removed `initialData` prop; only renders shell with `CategoryPageShell` |
| `app/[locale]/[...slug]/_components/CategoryPageShell.tsx` | Removed `initialData` prop; no longer passes `initialData` to `CategoryClientWrapper` |
| `app/[locale]/[...slug]/_components/CategoryClientWrapper.tsx` | Removed `initialData` prop; always fetches from `/api/catalog/articles` on mount |
| `hooks/use-category-search.ts` | Removed `initialData` parameter from `useCategorySearch` hook |
| `app/api/category-products/route.ts` | New GET endpoint for category product data |

### Performance Instrumentation

New warning logs added:

- `[LEAF_CATEGORY_STREAM_SLOW]` — logged when `renderCategoryPage` total > 3000ms (PERFORMANCE_LOGGING=true)
- `[LEAF_PRODUCT_FETCH_BLOCKING]` — logged when `/api/category-products` request duration > 1000ms
- `[LEAF_PRODUCT_COUNT_TOO_LARGE]` — logged when products returned > 48

### API Endpoint: `/api/category-products`

```
GET /api/category-products?locale=en&slug=air-filter&page=1&limit=24
```

Parameters:
- `locale` — `tr` or `en` (default: `tr`)
- `slug` — Category URL key (required)
- `page` — Page number (default: 1)
- `limit` — Items per page (default: 24, max: 48)
- `brands` — Pipe-delimited brand names (e.g., `Bosch|Mann`)
- `stock` — Pipe-delimited stock statuses (e.g., `in-stock|on-order`)
- `sort` — Sort option (`popularity`, `price-asc`, `price-desc`, `name`)
- `minPrice`, `maxPrice` — Price range
- `vehicleId` — TecDoc vehicle type ID

Response:
```json
{
  "data": {
    "products": [...],
    "page": 1,
    "limit": 24,
    "hasMore": true,
    "totalEstimate": 150,
    "brandFacetDistribution": {...},
    "stockFacetDistribution": {...},
    "dataSource": "prisma-fallback-deduped+resolved-supplier",
    "durationMs": 1200,
    "cached": false
  }
}
```

- Returns 404 for invalid category slugs
- Returns empty products array for non-leaf categories
- Caps limit at 48
- **v0.2.11**: Uses Meilisearch first when `MEILI_ENABLED=true` and no `vehicleId` filter
- **v0.2.11**: Falls back to Prisma when Meilisearch unavailable or vehicle-specific query
- **v0.2.11**: `dataSource` indicates path: `meilisearch-category-products` or Prisma fallback
- Uses Redis cache with 5-minute TTL (Prisma path only)
- Uses `getCatalogArticles()` as Prisma fallback

## Before/After

### Before (v0.2.9 — Blocking Product Data)
- TTFB: ~0.23s (shell starts)
- TOTAL: ~15s (entire response blocked by product data)
- `/api/category-page` for leaf categories: ~15s (awaits `getCatalogArticles`)
- Product grid visible: after full response completes

### After (v0.2.10 — Decoupled Product Data)
- TTFB: ~0.23s (unchanged)
- Shell visible: ~300-500ms (category, breadcrumbs, heading)
- TOTAL: ~0.3-0.5s (shell only, no product data in response)
- Product grid visible: 1-5s (separate `/api/catalog/articles` fetch)
- `/api/category-page` for leaf categories: <1s (shell metadata only)

## Category Page Data Contract

- Default page size: 24 products
- Hard max page size: 48 products
- Shell data (category, nav, breadcrumbs) renders in ~300ms
- Product data fetches asynchronously after shell renders
- No Promise prop crosses server/client boundary
- No `initialData` or `initialDataPromise` in any component

## Preservation

- Category heading, description, breadcrumbs: rendered in shell (SEO-safe)
- Subcategory sidebar: rendered in shell (SEO-safe)
- Internal category links: rendered in shell (SEO-safe)
- Product cards: load after shell via client fetch
- All product data (including no-price/REQUEST_PRICE products) remains visible
- Meilisearch: untouched
- PostgreSQL fallback: untouched
- Checkout/payment: untouched
- v0.2.9 CategorySnapshot cache: preserved

## Deferred Work

- Add Meilisearch category filter to `/api/category-products` for faster product queries
- Add limited server-rendered top products for SEO (without blocking)
- Add `www.getirbakim.com` → `getirbakim.com` 301 redirect in nginx