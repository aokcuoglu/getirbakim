# Category Page Performance - v0.2.5

## Root Cause

Category pages were slow on first load due to several compounding factors:

1. **Unbounded data fetching**: The `getCatalogArticles` function allowed `limit` up to 96, meaning a single category page request could fetch up to 96 products with full data (pricing, OEM codes, properties, images).

2. **Triple CTE scan for facets**: For every leaf category page load, the PostgreSQL deduplication CTE query was executed 3 times in parallel — once for total count, once for brand facets, and once for stock facets. Each scan processes the entire matching result set (potentially 30K+ rows for large categories).

3. **Aggressive client prefetching**: The `useCategorySearch` hook prefetched up to 4 additional API requests (next page, previous page, and 2 stock filter toggles) on every render, multiplying server load by 4-5x per navigation.

4. **Short cache TTLs**: Redis cache TTL for catalog articles was only 60 seconds, causing frequent cache misses and repeated heavy queries.

5. **Unbounded `popularManufacturers`**: On non-leaf category pages, all brands with logo URLs were loaded without a limit, potentially hundreds of records.

6. **No loading state**: Category pages lacked a `loading.tsx`, causing perceived slowness as the browser waited for the full RSC payload before showing anything.

## Category Page Data Contract

After v0.2.5:

- **Default page size**: 24 products
- **Hard max page size**: 48 products (server-enforced in `normalizeBody`)
- **Hard max for category pages**: 48 products (enforced in `getInitialLeafData`)
- **`hasMore` field**: Added to `CatalogArticlesResult` for pagination awareness
- **No full product list**: Category pages never load all products for a category
- **`CATEGORY_PAYLOAD_TOO_LARGE` warning**: Logged when `PERFORMANCE_LOGGING=true` and more than 48 products are returned

## Product Fetch Changes

### `getCatalogArticles` (`lib/actions/getCatalogArticles.ts`)

- `MAX_CATEGORY_LIMIT` constant added (48), replacing inline `96`
- `normalizeBody()` caps `limit` at `MAX_CATEGORY_LIMIT` (48)
- `hasMore: boolean` field added to `CatalogArticlesResult`
- `hasMore` computed as `page * limit < totalHits` or `hits.length > limit`
- Redis cache TTL increased from 60s to 300s (5 minutes)
- `CATEGORY_PAYLOAD_TOO_LARGE` warning when hits exceed `MAX_CATEGORY_LIMIT`

### `category-page-data.ts` (`app/[locale]/_lib/category-page-data.ts`)

- `getInitialLeafData` caps `limit` to `Math.min(parseNumberParam(...) ?? 24, 48)`
- Performance logging added for large payloads

### `use-category-search.ts` (`hooks/use-category-search.ts`)

- `MAX_LIMIT` constant added (48)
- `parseFiltersFromURL` caps limit at `MAX_LIMIT`
- `setLimit` caps at `MAX_LIMIT`
- Prefetching reduced from 4 targets to 1 (next page only)
- `staleTime` increased from 30s to 60s

### `CategoryContent.tsx` (client component)

- Per-page dropdown options reduced from 24/48/96 to 24/48
- 96-option removed to prevent excessively large payloads

### `getPopularManufacturers.ts`

- Added `take: 48` limit to brand query (was unbounded)

### `loading.tsx` (new)

- Added `app/[locale]/[...slug]/loading.tsx` with skeleton UI for immediate feedback

## Cache Strategy

| Data | Cache Layer | TTL |
|------|-----------|-----|
| Category slug lookup | Redis + unstable_cache | 1 hour |
| Category tree/nav | Redis | 1 hour |
| Catalog articles | Redis | 5 minutes (was 60s) |
| Popular manufacturers | Redis + unstable_cache | 1 hour |
| Search results | Redis | 5 minutes |

## Files Changed

1. `lib/actions/getCatalogArticles.ts` — limit cap, hasMore, cache TTL, payload warning
2. `app/[locale]/_lib/category-page-data.ts` — limit cap, performance logging
3. `hooks/use-category-search.ts` — limit cap, reduced prefetching, stale time
4. `app/[locale]/[...slug]/_components/CategoryContent.tsx` — removed 96 option
5. `lib/actions/getPopularManufacturers.ts` — added take limit
6. `app/[locale]/[...slug]/loading.tsx` — new skeleton loading state
7. `lib/actions/getCatalogArticles.test.ts` — new test file for limit contract

## Future Improvements

1. **Combine CTE queries**: The total count and facet CTEs could be merged into fewer queries to reduce DB round-trips.
2. **Meilisearch category filter**: Add `categorySlug` / `categoryId` filter attributes to the search index so category pages can use Meilisearch instead of PostgreSQL CTEs.
3. **Streaming RSC**: Use React Server Components streaming to send the page skeleton first, then hydrate the product grid.
4. **Edge caching**: Add `Cache-Control` headers for category pages at the CDN/edge level.
5. **Cursor-based pagination**: Replace `OFFSET` with keyset pagination for better performance on later pages.