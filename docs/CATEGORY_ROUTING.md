# Category Routing

## Route Structure

Category pages use the SEO-friendly `/{locale}/{categorySlug}` pattern:

- `/en/fuel-filter` — English category page
- `/tr/yakit-filtresi` — Turkish category page (if `name_tr` slug exists)
- `/en/fuel-filters` — if `url_key` in DB stores the plural form

The catch-all route `app/[locale]/[...slug]/page.tsx` handles all category URLs.

## Slug Resolution

`getPartCategoryByUrlKey(urlKey)` resolves categories in this order:

1. **Redis cache** — `part-category-v2-{urlKey}`
2. **Legacy ID suffix** — if urlKey matches `-(\d+)$`, parse ID and look up directly
3. **Exact `url_key` match** — `WHERE is_active = true AND url_key = urlKey`
4. **Name-derived slug fallback** — if no `url_key` match, query categories where `url_key IS NULL` and match `generateSlug(name) === urlKey` or `generateSlug(name_tr) === urlKey`
5. **notFound()** — if none of the above match

## Why Fallback Is Needed

When `url_key` is NULL in the database:
- **Link generation** (`normalizeUrlKey`) generates a slug from `name` (e.g., `generateSlug("Fuel filter")` → `"fuel-filter"`)
- **Lookup** previously only queried `WHERE url_key = 'fuel-filter'`, which doesn't match NULL rows in SQL
- The fallback ensures categories without `url_key` are still resolvable

## Link Generation

All category links use `normalizeUrlKey(url_key, name)` which:
- Returns `url_key` if present and non-empty (strips legacy 5+ digit ID suffixes)
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