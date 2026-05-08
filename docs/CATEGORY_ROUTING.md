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

1. **Redis cache** — `part-category-v2-{urlKey}`
2. **Legacy ID suffix** — if urlKey matches `-(\d+)$`, parse ID and look up directly by `id`
3. **Exact `url_key` match** — `WHERE is_active = true AND url_key = urlKey`
4. **Suffixed `url_key` fallback** — `WHERE is_active = true AND url_key LIKE '{urlKey}-%'`, then filter by `normalizeUrlKey(cat.url_key, cat.name) === urlKey`
5. **Name-derived slug fallback** — `WHERE is_active = true AND url_key IS NULL`, then match `generateSlug(name) === urlKey` or `generateSlug(name_tr) === urlKey`
6. **notFound()** — if none of the above match

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

- Category lookup results cached in Redis with key `part-category-v2-{urlKey}`, TTL 3600s
- Category tree cached in Redis with key `part-categories-tree-{locale}-v2`, TTL 3600s
- Client-side SPA navigation via `CategoryPageShell` with `/api/category-page` API