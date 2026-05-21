# Release Notes

## v0.3.7 - Fix Dockerfile for Prisma Config + Align Build Metadata Policy

### Fix: Dockerfile DATABASE_URL for prisma.config.ts

The deps stage was missing `DATABASE_URL`, causing `prisma generate` to fail when `prisma.config.ts` references environment variables. Both deps and builder stages now include a dummy `DATABASE_URL`.

### Fix: Node.js 22 builder/runner (no Bun for next build)

Previous versions attempted to run `next build` with Bun, which caused SWC/N-API SIGILL crashes on the VPS. The builder and runner stages now use `node:22` and `node:22-slim` respectively. Bun is still used for `bun install` in the deps stage and copied to the runner for operational scripts only.

### Build Version Metadata Alignment

- **Root cause of v0.3.8 footer mismatch:** Production footer showed `v0.3.8` because a manual deploy set `NEXT_PUBLIC_BUILD_VERSION=v0.3.8` without a corresponding git tag. The deployed code was identical to v0.3.7. No v0.3.8 tag exists or should be created.
- **Client footer** reads `process.env.NEXT_PUBLIC_BUILD_VERSION` which is inlined at `next build` time (client component). Changing `.env.production` after build has no effect on the footer.
- **`/api/health`** reads `process.env.NEXT_PUBLIC_BUILD_VERSION` at runtime (server-side).
- **Policy fix:** `NEXT_PUBLIC_BUILD_VERSION` must NOT exist in `.env.production`. It is injected by `scripts/vps-deploy.sh` or GitHub Actions at Docker build time.
- **`.env.example`** updated to v0.3.7 with comment explaining it is a reference only.

### Docker Build Baseline

- Stage 1 (deps): `oven/bun:1` — `bun install`, `bunx prisma generate`
- Stage 2 (builder): `node:22` — `npx next build`
- Stage 3 (runner): `node:22-slim` — `CMD ["node", "server.js"]`
- `NEXT_PUBLIC_BUILD_VERSION` is a build ARG (Dockerfile:31) and runtime ENV (Dockerfile:42)
- Dummy `DATABASE_URL` in deps (Dockerfile:9) and builder (Dockerfile:47)

## v0.3.2 - Fix Production 502 on Compat API Routes, Expand Response Contract

### Bug Fix: Production 502 on /api/products and /api/catalog

Both `/api/products?category=air-filter` and `/api/catalog/air-filter` were returning HTTP 502 with `{"error":{"code":"UPSTREAM_ERROR","message":"fetch failed"}}` on production. The root cause was that these routes self-fetched via HTTP using `new URL(request.url).origin`, which resolves to `http://localhost:3000` inside Docker containers behind a reverse proxy, causing the internal fetch to fail.

Both routes now call `getCategoryProducts()` directly (a server-side function), eliminating all internal HTTP roundtrips.

### Response Contract Alignment

All three category product endpoints now return a consistent, complete response shape:

```json
{
  "products": [...],
  "hits": [...],
  "page": 1,
  "limit": 24,
  "hasMore": true,
  "totalHits": 32240,
  "totalEstimate": 32240,
  "facetDistribution": { "brandName": {...}, "stockStatus": {...} },
  "brandFacetDistribution": {...},
  "stockFacetDistribution": {...},
  "dataSource": "meilisearch-category-products",
  "durationMs": 85,
  "cached": false,
  "liveFallbackUsed": false,
  "purchasableCount": 18,
  "outOfStockCount": 4,
  "requestPriceCount": 2,
  "verifyFitmentCount": 0
}
```

The `/api/products` and `/api/catalog/<slug>` endpoints additionally include `source` ("products-compat" or "catalog-compat"), `category`, and `originalEndpoint` fields for backward compatibility.

### Structured Error Logging

All three routes now log structured error messages on failure:
```
[api/products] route=/api/products category=air-filter source=error durationMs=120 error=...
[api/catalog] route=/api/catalog category=air-filter source=error durationMs=95 error=...
[category-products] route=/api/category-products slug=air-filter source=error error=...
```

### Technical Changes

- **Changed:** `lib/actions/getCategoryProducts.ts` — Return type expanded with `hits`, `totalHits`, `facetDistribution`, `liveFallbackUsed`, `purchasableCount`, `outOfStockCount`, `requestPriceCount`, `verifyFitmentCount`
- **Changed:** `app/api/products/route.ts` — Full response contract, direct function call, structured logging
- **Changed:** `app/api/catalog/[...path]/route.ts` — Full response contract, direct function call, structured logging
- **Changed:** `app/api/category-products/route.ts` — Full response contract, structured logging

---

## v0.3.1 - Category Page Performance Optimization

### Performance: Server-Side Rendering of Initial Products

Category leaf pages (e.g., `/en/air-filter`) now fetch and render the first 24 products server-side using React Query `HydrationBoundary`. This eliminates the client-side fetch waterfall that previously caused LCP delays.

**Before:** Page shell SSR → client JS loads → React Query fires → products appear (2-3s+ delay)
**After:** Full page SSR with hydrated product data → products visible immediately on first paint

### Bug Fix: API Compatibility Routes 502 on Production

`/api/products?category=air-filter` and `/api/catalog/air-filter` were returning 502 errors because they self-fetched via HTTP. Both routes now call the data layer directly via `getCategoryProducts()`, resolving the 502 errors.

### Technical Changes

- **New:** `lib/actions/getCategoryProducts.ts` — Reusable server-side function for category product fetching (Meilisearch-first with Prisma fallback), extracted from API route
- **Changed:** `/api/products/route.ts` — Uses `getCategoryProducts()` directly instead of HTTP self-fetch
- **Changed:** `/api/catalog/[...path]/route.ts` — Uses `getCategoryProducts()` directly instead of HTTP self-fetch
- **Changed:** `/api/category-products/route.ts` — Uses `getCategoryProducts()` instead of inline logic
- **Changed:** `app/[locale]/_lib/category-page.tsx` — Added `HydrationBoundary` with pre-fetched initial products for leaf categories
- **Changed:** `ProductCard` and `GridProductCard` — Added `isFirst` prop for LCP-aware image loading (`priority`, `sizes`, `loading`)
- **Changed:** `SafeImage` — Added `priority` prop passthrough to `next/image`

### Image Optimization

- First product card image: `priority={true}`, `loading="eager"`, explicit `sizes` attribute
- Subsequent images: `loading="lazy"`, explicit `sizes` attribute
- ProductCard: `sizes="(max-width: 1024px) 176px, 176px"`
- GridProductCard: `sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"`

---

## v0.3.0-stage-2 - Dinamik ParçaTedarik Model Matching Admin

### Feature: Dinamik-ParçaTedarik Model Matching Admin

Connects Dinamik supplier products to ParçaTedarik catalog products via barcode-to-model matching, resolving to canonical `public.parts` through ParçaTedarik `ref_no` reference tokens.

**Matching Pipeline:**
- Dinamik `barcode_1/2/3` normalized against ParçaTedarik `normalized_model`
- Confidence: barcode_1 (0.98), barcode_2 (0.96), barcode_3 (0.94), +0.01 brand boost
- Multiple PT matches → `NEEDS_REVIEW`, single match → `CANDIDATE`
- Approval resolves `ref_no` tokens to `public.parts` via OEM/EAN/cross-reference/part_no

**Admin UI:** `/admin/supplier-matching/dinamik-parcatedarik`
- Summary cards, filters, match table, approve/reject/ignore actions, bulk approve, detail drawer

**API Routes:**
- `GET /api/admin/supplier-matching/dinamik-parcatedarik` — list/filter/paginate
- `POST /api/admin/supplier-matching/dinamik-parcatedarik` — generate candidates
- `POST .../:id/approve|reject|ignore|needs-review` — single match actions
- `POST .../bulk-approve` — bulk approve high-confidence unique matches

**Scripts:**
- `DRY_RUN=true bun scripts/generate-dinamik-parcatedarik-model-matches.ts`
- `APPLY=true bun scripts/generate-dinamik-parcatedarik-model-matches.ts`

**Constraints:**
- `raw_json` never exposed to browser
- Vehicle fitment read from `public.parts` relations, not copied to `dinamik.products`
- Checkout/payment behavior unchanged
- Production indexing not enabled

## v0.2.11 - Category Products API Meilisearch Filter Optimization

### Performance: Serve Category Product API from Meilisearch Filters
- `/api/category-products` now uses Meilisearch category filter by default when `MEILI_ENABLED=true`
- Product API latency target: <300ms ideal, <800ms acceptable (was ~3000ms with Prisma fallback)
- Leaf page shell remains fast — no SSR blocking regression
- Prisma fallback preserved when Meilisearch is unavailable or has zero hits
- Brand and availability facets served from Meilisearch `facetDistribution`

### Architecture Change
- `searchCategoryProductsWithMeili()` queries Meilisearch `products` index with `categorySlug` filter
- Filter: `categorySlug = "<slug>" AND documentType IN ["canonical_part", "supplier_offer", "orphan_supplier_product"]`
- Sort: `rankScore:desc` by default, supports `price:asc`, `price:desc`, `name:asc`
- Vehicle-specific queries (vehicleId present) skip Meilisearch and use Prisma fallback (vehicle filtering not in Meili index)
- Meilisearch error or zero hits → automatic Prisma fallback with logged warning

### Document Changes
- Added `brandLogo` field to `CanonicalSearchDocument` type and all document builders
- Meilisearch documents now include `brandLogo` for product card rendering
- `categorySlug` and `categoryId` were already present in documents and filterable attributes (v0.2.5)
- Reindex required after this change (new `brandLogo` field)

### New Files
- `lib/search/category-products-meili.ts` — Meilisearch category product search with filter/sort/facet support
- `lib/search/category-products-meili.test.ts` — Tests for filter construction, mapping, limits, sort, fallback
- `scripts/debug-meili-category.ts` — Diagnostic script for Meilisearch category filter debugging

### Diagnostic Script
- `bun run search:debug-category` or `CATEGORY_SLUG=air-filter bun scripts/debug-meili-category.ts`
- Reports: index stats, filterable attributes, hit counts, sample documents, facet distribution

### Tests
- 15 new tests covering: filter construction, document mapping, limit capping, rank bucket, sort, fallback, response shape, no raw_json exposure
- 7 existing tests updated for `brandLogo` field in `CanonicalSearchDocument`
- Total: 262 tests passing

### No breaking changes
- No checkout/payment changes
- No Meilisearch removal — Prisma fallback preserved
- No production indexing enabled
- Leaf page initial HTML remains fast
- Product card shape unchanged — `CategoryClientWrapper` compatible

## v0.2.10 - Production Leaf Category Product Loading Fix

### Performance: Decouple Leaf Category Products from Blocking Page Render
- Leaf category pages (`/en/air-filter`, `/en/fuel-filter`) now render shell in ~0.3-0.5s (was ~15s)
- Product data loads asynchronously after shell renders, visible in 1-5s depending on cache
- `/api/category-page` for leaf categories returns shell metadata only (~0.3-1s, was ~15s)
- No Promise props cross server/client boundary — product fetch is entirely client-side
- Non-leaf pages (`/en/filters`) unchanged at ~0.3s

### Architecture Change
- Removed `initialData` from `CategoryPagePayload` and `CategoryShellPayload`
- `buildCategoryPagePayload()` no longer awaits `getCatalogArticles()` for leaf categories
- `renderCategoryPage()` calls `buildCategoryShellPayload()` only — no product data in RSC stream
- `CategoryClientWrapper` always fetches products via `useCategorySearch` hook on mount
- Added `GET /api/category-products` endpoint for category product data with slug validation, limit capping, and cached queries

### New API Endpoint
- `GET /api/category-products?locale=en&slug=air-filter&page=1&limit=24`
- Validates category slug (returns 404 for invalid slugs)
- Returns empty products for non-leaf categories
- Caps limit at 48 (default 24)
- Includes `durationMs`, `dataSource`, `cached`, `hasMore`, `totalEstimate`
- Uses `getCatalogArticles()` internally (same as `/api/catalog/articles`)

### Instrumentation
- `LEAF_PRODUCT_FETCH_BLOCKING` — logged when category products API >1000ms
- `LEAF_PRODUCT_COUNT_TOO_LARGE` — logged when products returned >48
- `LEAF_CATEGORY_STREAM_SLOW` — logged when `renderCategoryPage` total >3000ms (PERFORMANCE_LOGGING only)

### Tests
- 12 new tests covering: category page data contract, product loader states, API endpoint contract, search independence
- Existing test for `fetchLeafInitialData` updated to match new architecture
- Total: 233 tests passing

### No breaking changes
- No checkout/payment changes
- No Meilisearch changes
- No PostgreSQL fallback removal
- No product visibility changes (no-price products remain visible)
- No URL or route changes

### Remaining follow-up
- `www.getirbakim.com` currently serves 200 and should redirect to `getirbakim.com` with 301
- Consider Meilisearch category filter for `/api/category-products` for faster product queries
- Consider limited server-rendered top products for SEO without blocking

## v0.2.9 - Category Navigation and Resolver Cache Optimization

### Performance: Category Snapshot Cache
- Introduced `CategorySnapshot` — single in-memory snapshot of all active categories (979 rows)
- Snapshot is indexed by id, urlKey, nameSlug, and parentId for O(1) lookups
- All category resolution (findCategoryByUrlKey, ancestry, siblings, mainNav, topCategories) now uses snapshot on warm
- Eliminates up to 8-10 sequential DB queries per category page request on warm cache
- `categoryByUrlKey:findTarget` reduced from ~2323ms (5 sequential DB queries) to <10ms (snapshot lookup)
- `mainNavCategories` reduced from ~1640ms to <10ms (snapshot filter)
- Ancestry + siblings reduced from ~687ms (sequential DB + separate query) to <1ms (in-memory walk)
- Cold `/en/air-filter` improved from ~6.17s to ~2.67s
- Warm `/en/air-filter` improved from ~2.44s to ~1.25s

### Fix: Category Deferred Promise Runtime Error
- Fixed runtime error `"can't access property 'catch', s.then(...) is undefined"` on `/en/filters` and non-leaf category pages
- The v0.2.8 streaming approach passed a `Promise` as a prop from server to client component, which is not serializable across the React server/client boundary
- Replaced `initialDataPromise` prop with awaited `initialData` prop — server component now awaits product data for leaf pages and passes the resolved result
- Non-leaf pages (e.g. `/en/filters`) correctly render category cards without leaf product data
- `/en/filters` now renders in ~30ms warm (previously caused runtime error)

### Caching Architecture
- Category snapshot cached in Redis (`category-snapshot-v1`) with 1h TTL
- In-memory category snapshot with 5min TTL (process-local, avoids Redis round-trip)
- Falls back to DB on both cache misses
- No user-specific data cached; snapshot contains only public category metadata
- Cache keys include locale and slug where relevant

### Instrumentation
- `CATEGORY_RESOLVE_SLOW` warning when categoryByUrlKey total > 1000ms
- `CATEGORY_NAV_SLOW` warning when mainNavCategories total > 1000ms
- `CATEGORY_CACHE_HIT` / `CATEGORY_CACHE_MISS` logs for snapshot when `PERFORMANCE_LOGGING=true`

### Tests
- Added 15 new tests for `CategorySnapshot` (byId, byUrlKey, byNameSlug, childrenByParentId, duplicate handling, ancestry from snapshot, siblings from snapshot, main nav filtering)
- Added tests verifying cache key includes locale and slug
- Added tests verifying no user-specific data in snapshot
- All 221 existing tests still pass

### DB Index Recommendations
- Existing indexes sufficient for snapshot approach (snapshot loads all active categories in one query)
- No new indexes required; `is_active` index already used for the snapshot query

### No breaking changes
- No checkout/payment changes
- No Meilisearch changes
- No PostgreSQL fallback removal
- No product visibility changes (no-price products remain visible)
- No UI changes

### Performance: Category Page Streaming Fix
- Split category page rendering into shell (fast) and product data (deferred) phases
- `buildCategoryShellPayload()` returns category, nav, breadcrumbs, sidebar immediately (~50-300ms)
- Product data for leaf categories resolves asynchronously via `fetchLeafInitialData()` promise
- `CategoryLeafContent` component shows loading skeleton while product data loads
- Total page time reduced from 15-21s to 2-5s (shell visible in <500ms, products stream in 1-5s)
- TTFB remains fast (~0.28s) — unchanged

### Category Page Data Contract Enforcement
- Default page size: 24 products
- Hard max page size: 48 products
- Shell payload does not include `initialData` (product fetch is deferred)
- Non-leaf categories do not fetch product data at all
- Loading skeleton shown while product data resolves
- No synchronous exact total count blocking initial render
- No fitment enrichment per card
- No large OEM/reference arrays per card

### v0.2.7 Changes Also Included
- Added exact code lookup to POST handler's Meilisearch path (GET and POST both boost code queries)
- Extended fitment enrichment to supplier-backed documents
- Prioritized code-bearing records (OEM/EAN/barcode) in reindex ordering
- Updated search-debug-code to check `parts.part_no`
- Added `mergeExactCodeResults` tests for deduplication

### No breaking changes
- Search API response shape unchanged (additive fields only)
- Checkout/payment untouched
- No-price (REQUEST_PRICE) products remain visible
- Meilisearch and PostgreSQL fallback paths preserved
- Production indexing remains disabled

## v0.2.7 - Fitment Index Optimization and Exact Code Search Coverage

### Exact Code Search Improvements
- Added exact code lookup to POST handler's Meilisearch path (was only in GET handler)
- Exact code lookup now works in both single-search and multi-search modes
- POST search response now includes `exactCodeMatchUsed` and `source` fields when exact matches found
- Updated `scripts/search-debug-code.ts` to also check `parts.part_no` column for code matches

### Fitment Enrichment Improvements
- Fitment enrichment now covers **both supplier-backed and catalog-only documents** (was catalog-only only)
- Supplier-backed documents (`documentType: supplier_offer`) with a valid `partId` receive vehicle fitment data
- Orphan supplier products without a `partId` are still excluded from fitment enrichment
- No changes to fitment configuration defaults (`MEILI_REINDEX_INCLUDE_FITMENT=false` in production)

### Reindex Coverage Improvements
- Orphan supplier products with OEM codes are now prioritized in the index sort order
- Orphan products with barcodes are prioritized second
- Orphan products with price and stock are prioritized third
- Catalog-only parts with OEM codes, EAN codes, or cross-references are prioritized over those without
- This ensures code-bearing products are included within index limits

### Tests
- Added `mergeExactCodeResults` tests for deduplication by partId/supplierProductId
- Added `isExactCodeQuery` edge case tests (VIN codes, SKU-style, mixed separators)
- Added `normalizeCode`/`compactCode` edge case tests (EAN codes with spaces, mixed separators)
- Added document type validation tests for supplier_offer vs canonical_part vs orphan fitment behavior

### No breaking changes
- Search API response shape is unchanged (new fields added are additive)
- Checkout/payment behavior untouched
- No-price (REQUEST_PRICE) products remain visible
- Meilisearch and PostgreSQL fallback paths preserved
- Production indexing remains disabled until fitment is tested

## v0.2.6 - Category Page Payload and Navigation Performance Fix

### Problem
Category and filter pages were very slow on first load. Root cause analysis revealed:
- Unbounded limit (up to 96 products per page)
- Triple CTE scan for facets/count (total count, brand facets, stock facets)
- Aggressive client prefetching (4 concurrent API calls per navigation)
- Short Redis cache TTLs (60s for catalog articles)
- Unbounded `popularManufacturers` query on non-leaf pages
- No loading skeleton for category transitions

### Changes
- **Product limit capped at 48** for category pages (was 96). Default remains 24.
- **Added `hasMore` field** to `CatalogArticlesResult` for proper pagination awareness.
- **Reduced client prefetching** from 4 concurrent requests to 1 (next page only).
- **Increased cache TTL** for catalog articles from 60s to 300s (5 min).
- **Capped `popularManufacturers`** at 48 results (was unbounded).
- **Added loading skeleton** (`loading.tsx`) for category page transitions.
- **Removed 96-product option** from per-page dropdown (now 24/48 only).
- **Added `CATEGORY_PAYLOAD_TOO_LARGE` warning** for performance monitoring.
- **Increased `staleTime`** from 30s to 60s in category search hook.

### Category page data contract
- Default page size: 24 products
- Hard max page size: 48 products
- Initial SSR render uses exactly 24 products (or user-selected limit, capped at 48)
- `hasMore` indicates whether additional pages are available
- No full product dataset is ever loaded for a category page

### No breaking changes
- Search API unchanged (separate limit cap of 60)
- Checkout/payment untouched
- No-price (REQUEST_PRICE) products remain visible
- Meilisearch and PostgreSQL fallback paths preserved

## v0.2.5 - Fitment Index Optimization and Exact Code Search Coverage

### Exact Code Search Diagnostics
- Added `scripts/search-debug-code.ts` — diagnostic script that searches all code tables (part_oens, part_eans, part_cross_references, part_no, supplier_products.sku/barcode, supplier_product_oems, supplier_part_mappings, part_supplier_offers) for a given code
- Reports: where the code exists, matched part/supplier IDs, mapping status, whether records are included in current index, why they might be missing
- Usage: `CODE=0445110376 bun scripts/search-debug-code.ts`

### Exact Code Lookup Before Meilisearch
- Added `lib/search/exact-code-lookup.ts` — PostgreSQL exact code lookup that runs alongside Meilisearch for code-like queries
- Queries that look like codes (length >= 5, mostly alphanumeric, few separators) trigger exact DB lookup
- Searched tables: part_oens, part_eans, part_cross_references, supplier_product_oems, supplier_products (SKU/barcode)
- Exact results merged at top of Meili results, deduplicated by partId/supplierProductId
- Response includes `exactCodeMatchUsed: true` and `source: "meilisearch_with_exact_code_boost"` when exact matches are found
- If Meili returns 0 but exact DB lookup finds results, those results are still returned

### Code Normalization
- Added `lib/search/code-normalization.ts` — centralized code normalization
- `normalizeCode()`: uppercase, remove spaces/dashes/dots/slashes, preserve leading zeros
- `compactCode()`: lowercase, remove all non-alphanumeric, preserve leading zeros
- `isExactCodeQuery()`: detects code-like queries (5+ chars, 75%+ alphanumeric, 4+ digits or 3+ letters+2+ digits)
- Applied consistently across OEM, EAN, SKU, barcode, cross-reference lookups

### Exact Codes in Meilisearch Documents
- Added `exactCodes` field to `CanonicalSearchDocument` — array of all normalized+compact codes
- Includes: normalized OENs, compact OENs, EANs, cross-references, reference numbers, SKUs, article link IDs
- Added `normalizedSku` field to document type — normalized supplier SKU
- `exactCodes` and `normalizedSku` added to Meilisearch searchable attributes

### Fitment Enrichment Optimization
- Fitment joins removed from main catalog query (fixes statement_timeout 57014)
- Fitment now populated via separate batch enrichment in `scripts/meili-reindex.ts`
- Fetches fitment for only current batch of part IDs (`MEILI_REINDEX_FITMENT_BATCH_SIZE=100`)
- Limits fitment records per part (`MEILI_REINDEX_FITMENT_LIMIT_PER_PART=50`)
- Continues on batch failure (configurable via `MEILI_REINDEX_FITMENT_TIMEOUT_SAFE=true`)
- `MEILI_REINDEX_INCLUDE_FITMENT=false` by default in production until stable
- `buildSearchDocumentsFromCatalog` always uses without-fitment path; fitment enrichment handled by reindex script

### Diagnostic Script
- `scripts/search-debug-code.ts` — diagnose why a code returns 0 results in search
- Searches: part_oens, part_eans, part_cross_references, parts.article_link_id, supplier_products (sku, normalized_sku, barcodes), supplier_product_oems, supplier_part_mappings, part_supplier_offers
- Reports mapping status and index coverage for each match

### Documentation
- Added `docs/SEARCH_CODE_AND_FITMENT.md` — exact code search strategy, code normalization, fitment batch enrichment, materialized view recommendation
- Updated `docs/SEARCH_MEILISEARCH_SELF_HOSTED.md` — new searchable attributes, exact code lookup flow
- Updated `docs/SUPPLIER_PART_MATCHING.md` — code normalization reference
- Updated `docs/SEARCH_CATALOG_OFFER.md` — exact code boost in search flow

### No Changes
- Production indexing remains disabled (MEILI_REINDEX_INCLUDE_FITMENT=false)
- No Meilisearch removal
- No PostgreSQL fallback removal
- No REQUEST_PRICE/no-price product hiding
- No checkout/payment behavior changes

---

## v0.2.4 - Canonical Part Search Index and Supplier Matching

### Canonical Part Search Index
- Meilisearch documents now follow canonical-parts-first strategy
- Three document types: `canonical_part`, `supplier_offer`, `orphan_supplier_product`
- Canonical part documents (`part_<partId>`) include full enrichment: OEM codes, EAN codes, cross-references, supplier offers, vehicle fitment data
- Orphan supplier product documents (`sp_<supplierProductId>`) indexed when no part mapping exists
- No-price canonical parts remain visible as `REQUEST_PRICE`
- Products with stock+price are `PURCHASABLE` with `add_to_cart` CTA
- Each document includes: `documentType`, `partId`, `supplierProductId`, `canonicalPartId`, `matchStatus`, `matchConfidence`, `matchReason`, `hasSupplierOffer`, `offerCount`, `bestOfferProvider`

### Supplier Product Matching
- Added `lib/search/supplier-part-matching.ts` — reindex-time candidate scoring for orphan supplier products
- Match reasons: `OEM_EXACT` (0.95–0.99), `EAN_EXACT` (0.95–0.99), `CROSS_REFERENCE_EXACT` (0.85–0.95), `BRAND_ALIAS_REFERENCE` (0.75–0.90), `NAME_SIMILARITY` (0.40–0.70)
- OEM/EAN exact matches auto-approve (≥0.95 confidence)
- Cross-reference and brand alias matches are `CANDIDATE` (never auto-approved)
- Name similarity matches are `NEEDS_REVIEW` (never auto-approved)
- Existing manual/approved mappings are respected

### Turkish/English Search Synonyms
- Added `lib/search/search-synonyms.ts` — curated Turkish/English automotive synonym mappings
- Synonym groups: fuel filter ↔ yakıt filtresi ↔ mazot filtresi, oil filter ↔ yağ filtresi, air filter ↔ hava filtresi, cabin filter ↔ polen filtresi ↔ kabin filtresi, brake pad ↔ fren balatası, brake disc ↔ fren diski, clutch ↔ debriyaj, shock absorber ↔ amortisör, spark plug ↔ buji, glow plug ↔ kızdırma bujisi, belt ↔ kayış, water pump ↔ su pompası ↔ devirdaim
- Synonyms configured in Meilisearch index settings
- Synonyms text included in `normalizedSearchText` and `synonymsText` fields

### Search API Response
- `/api/search` response now exposes: `documentType`, `canonicalPartId`, `matchStatus`, `matchConfidence`, `matchReason`, `hasSupplierOffer`, `offerCount`, `bestOfferProvider`, `crossReferences`, `referenceNumbers`, `vehicleBrandNames`, `vehicleModelNames`, `fitmentCount`
- No-price canonical parts remain `REQUEST_PRICE`
- Orphan supplier products appear only when no canonical match exists

### Meilisearch Index Configuration (v0.2.4)
- New searchable attributes: `titleTr`, `categoryNameTr`, `crossReferences`, `referenceNumbers`, `searchKeywords`, `synonymsText`, `vehicleBrandNames`, `vehicleModelNames`, `vehicleTypeNames`, `engineCodes`
- New filterable attributes: `documentType`, `providerCode`, `providerName`, `hasSupplierOffer`, `matchStatus`, `vehicleBrandNames`, `vehicleModelNames`
- New sortable attributes: `offerCount`, `fitmentCount`
- Synonyms configured for Turkish/English bilingual search

### Reindex Script Updates
- Three-phase reindex: supplier-backed → catalog-only → orphan supplier products
- Configurable limits: `MEILI_REINDEX_MAX_PARTS`, `MEILI_REINDEX_MAX_ORPHAN_SUPPLIERS`
- Summary output includes: `canonicalPartDocuments`, `orphanSupplierDocuments`, `purchasableCount`, `requestPriceCount`, `mappedSupplierProducts`, `unmappedSupplierProducts`
- Low DB pool pressure with batch processing

### Detail URL Strategy
- Canonical part: `/part/<partId>`
- Orphan supplier product: `/supplier-product/<supplierProductId>`
- Mapped supplier product: prefers canonical part URL, includes `supplierProductId` as metadata

### Documentation
- Added `docs/SUPPLIER_PART_MATCHING.md` — canonical parts strategy, match reasons, auto-approve rules, orphan behavior, admin workbench requirements
- Updated `docs/SEARCH_MEILISEARCH_SELF_HOSTED.md` — document types, index fields, reindex phases, synonym configuration
- Updated `docs/SEARCH_CATALOG_OFFER.md` — v0.2.4 strategy, supplier matching
- Updated `docs/SUPPLIER_API_OPERATIONS.md` — matching strategy, new files

### Tests
- Added tests for canonical part document, orphan supplier product, document IDs, rank scores, availability, synonym expansion, Meili synonyms, match confidence thresholds, no auto-approve for name similarity

### No Behavior Changes
- No checkout/payment changes
- PostgreSQL fallback remains functional
- `MEILI_ENABLED=false` still works
- Docker Compose setup unchanged
- Self-hosted Meilisearch Docker setup unchanged

## v0.2.3 - Self-Hosted Meilisearch Search Engine

### Meilisearch (Self-Hosted)
- Added self-hosted Meilisearch Docker service to `docker-compose.yml` and `docker-compose.local.yml`
- Meilisearch binds to `127.0.0.1:7700` only — not exposed to public network
- Uses internal Docker network (`app-network`) for app-to-Meili communication
- Persists data in `meili_data` (production) / `meili_data_local` (local) Docker volumes
- `MEILI_ENABLED=true` activates Meilisearch as primary search engine
- `MEILI_ENABLED=false` (default) keeps PostgreSQL catalog+offer search as fallback
- `MEILI_MASTER_KEY` is server-only — never exposed to browser
- Added `lib/search/meilisearch-client.ts` — server-side Meili client with `isMeiliEnabled()`, `getMeiliHost()`, `getProductsIndexName()`, `checkMeiliHealth()`
- Added `lib/search/search-document-builder.ts` — unified document builder for supplier-backed and catalog-only products
- Document shape includes: availability status (PURCHASABLE/REQUEST_PRICE/OUT_OF_STOCK), price, stock, CTA, category, brand, OEM/EAN codes, provider name, search text
- Added `scripts/meili-setup.ts` — creates/configures products index with searchable, filterable, and sortable attributes
- Added `scripts/meili-reindex.ts` — batch reindexing from PostgreSQL into Meilisearch, supports `MEILI_REINDEX_CLEAR=true` and `MEILI_REINDEX_BATCH_SIZE`
- Added package scripts: `bun run search:setup` and `bun run search:reindex`

### Search API (`/api/search`)
- When `MEILI_ENABLED=true`: Meilisearch is queried first via the `products` index
- Response includes `source: "meilisearch"`, `liveFallbackUsed: false`, `durationMs`
- Products mapped to `CatalogOfferProduct` shape with full availability/CTA metadata
- When Meili fails or is unavailable: falls back to PostgreSQL catalog+offer search with `liveFallbackUsed: true`
- When `MEILI_ENABLED=false`: PostgreSQL catalog+offer search remains the default
- No-price products remain visible as `REQUEST_PRICE` / `Fiyat Al`
- Both GET and POST handlers support Meili-first flow with proper fallback

### Health Endpoint
- `/api/health` now reports Meilisearch status: reachable/unreachable/disabled with timing
- Added `/api/internal/search/health` — returns `meiliEnabled`, `meiliReachable`, `indexName`, `documentCount` (requires CRON_SECRET)

### Docker Compose
- Production (`docker-compose.yml`): added `meilisearch` service, `app-network` bridge network, `meili_data` volume, `depends_on` app→meilisearch
- Local (`docker-compose.local.yml`): added `meilisearch` service, `app-network`, `meili_data_local`, `depends_on` app→meilisearch
- App container environment now includes `MEILI_ENABLED`, `MEILI_HOST`, `MEILI_MASTER_KEY`, `MEILI_INDEX_PRODUCTS`
- Both compose files bind Meilisearch port to `127.0.0.1:7700` only

### Environment Variables
- `MEILI_ENABLED` — `true`/`false` (default: `false`). Keep `false` until index is built and smoke-tested.
- `MEILI_HOST` — Meilisearch host URL. Inside Docker: `http://meilisearch:7700`. Outside: `http://127.0.0.1:7700`.
- `MEILI_MASTER_KEY` — Server-only admin key. **Never expose to browser.**
- `MEILI_INDEX_PRODUCTS` — Index name (default: `products`).
- Updated `.env.example` with detailed comments and security warnings.

### Documentation
- Added `docs/SEARCH_MEILISEARCH_SELF_HOSTED.md` — full setup guide, env vars, security, troubleshooting
- Updated `docs/SEARCH_CATALOG_OFFER.md` — Meili primary, PostgreSQL fallback clarified
- Updated `docs/PERFORMANCE_BASELINE.md` — Meili resolved critical search bottleneck
- Updated `docs/DEPLOYMENT_CONTABO.md` — Meilisearch setup on VPS
- Updated `docs/OPERATIONS_RUNBOOK.md` — Meilisearch operations (setup, reindex, health, logs, volume)
- Updated `docs/meilisearch-switchback.md` — reflects self-hosted status

### Critical Fixes (Blockers)
- **PostgreSQL fallback SQL**: Replaced `Prisma.sql` template interpolation in CTE strings with `escapeSqlLiteral()`/`escapeSqlLike()` helpers — the old code produced `[object Object]` in SQL queries causing `42601` syntax errors
- **PostgreSQL fallback SQL execution**: Replaced `db.$queryRawUnsafe()` with `db.$queryRaw()` in both `fetchSupplierBackedHits` and `fetchCatalogOnlyHits` — `$queryRawUnsafe` does not correctly handle `Prisma.sql` tagged template objects
- **Reindex script execution**: Removed `import 'server-only'` from `lib/search/search-document-builder.ts` — the module is pure data transformation with no server-only guards needed; CLI scripts (`meili-reindex`, `meili-setup`) can now run outside Next.js context
- **Docker runner lacks Bun**: Copied Bun binary from `oven/bun:1` build stage to `node:22-slim` runner stage; added source files, Prisma schema, `tsconfig.json`, and required `node_modules` subdirectories for reindex scripts to run in production containers
- **Docker `.dockerignore` excludes scripts**: Removed `scripts` exclusion from `.dockerignore` (added `!scripts` and `!scripts/**` exceptions) — the previous exclusion caused `/app/scripts` to be missing from Docker build, breaking `bun run search:setup` and `bun run search:reindex`
- **Reindex document IDs**: Meilisearch rejects document IDs containing colons (e.g., `part:5000001381`). This is a pre-existing data format issue — the reindex script connects and processes batches correctly, but `part:xxx` IDs fail validation. Tracked separately.
- **SQL GROUP BY**: Fixed `spo.updated_at` / `spo2.updated_at` in `JSONB_AGG` subqueries causing PostgreSQL `42803` error — wrapped inner queries in subquery selectors to comply with GROUP BY rules

### Tests
- Added 9 new tests in `lib/search/catalog-offer-search-sql.test.ts` covering SQL escaping, `[object Object]` injection prevention, MEILI_ENABLED fallback behavior, availability status mapping, and search page size caps

### No Behavior Changes
- No UI redesign
- PostgreSQL catalog+offer search remains available as fallback
- No-price products remain visible
- Docker-first local and VPS deployment workflow unchanged

### Category Route Transition Optimization
- Rewrote `getPartCategoryByUrlKey` to minimize DB round trips from 4-8+ sequential queries to 2-3 batched queries
- Replaced N+1 child count queries with single `WHERE parent_id IN (...)` batched query
- Replaced iterative ancestry walk (1 query per parent) with batched ancestor lookup (single `findMany` for all ancestors)
- Siblings and ancestry data now fetched in parallel
- Added `unstable_cache` ISR layer with 1-hour revalidation and Redis fallback
- React `cache()` per-request deduplication still applies inside ISR function

### Nav and Category Data Caching
- Added Next.js `unstable_cache` ISR layer to `getMainNavCategories` (key: `main-nav-categories-v3`, revalidate: 3600s)
- Added Next.js `unstable_cache` ISR layer to `getPopularManufacturers` (key: `popular-manufacturers-v2`, revalidate: 3600s)
- Added Next.js `unstable_cache` ISR layer to `getPartCategoryByUrlKey` (key: `part-category-by-urlkey-v3`, revalidate: 3600s)
- On warm ISR cache: 0 DB queries, 0 Redis calls for nav/category/manufacturer data
- Redis remains as fallback inside ISR functions for cache warm-up and cross-instance sharing

### Route Timing Instrumentation
- Added `createTimerGroup` to category page (`categoryPage`), category layout (`categoryLayout`), and category page payload builder (`categoryPagePayload`)
- Timing logs appear when `PERFORMANCE_LOGGING=true` in `.env`

### Database Index
- Added composite index `part_categories_active_url_key_idx` on `(is_active, url_key)` to Prisma schema
- Added SQL migration `20260509000000_add_category_performance_indexes`
- Supports the most common slug resolution query: `WHERE is_active = true AND url_key = ?`

### Caching Architecture (v0.2.2)
| Layer | Mechanism | TTL | Scope |
|-------|-----------|-----|-------|
| Next.js Data Cache | `unstable_cache` | 1 hour | Category by urlKey, Main nav, Popular manufacturers, Catalog data |
| Redis (Upstash) | `lib/redis.ts` | 1 hour | All server data (fallback inside unstable_cache) |
| React `cache()` | Per-request | Single render | `getPartCategoryByUrlKey` dedup |
| CDN | middleware `Cache-Control` | s-maxage=300 | Anonymous HTML pages |

### No Behavior Changes
- No product, payment, supplier sync, vehicle compatibility, auth, search, or checkout changes
- No UI redesign
- No-price products remain visible
- Search endpoint unchanged
- MEILI_ENABLED=false compatible
- Docker-first local runtime and VPS deploy workflow unchanged

### Documentation
- Added `docs/NAVIGATION_PERFORMANCE.md` with full bottleneck analysis, caching strategy, and production checklist
- Updated `docs/CATEGORY_ROUTING.md` with v0.2.2 caching improvements and slug resolver optimization
- Updated `docs/PERFORMANCE_BASELINE.md` with v0.2.2 cache architecture and index additions
- Updated `RELEASE_NOTES.md` and `CHANGELOG.md`

### Category Route Resolution
- Fixed category pages (e.g., `/en/fuel-filter`) returning 404 when `url_key` in the database contains a legacy numeric ID suffix
- Root cause: 959 of 979 active categories have `url_key` values like `"fuel-filter-100261"` (with a 5+ digit numeric suffix). `normalizeUrlKey()` strips these suffixes for link generation (producing `"fuel-filter"`), but `getPartCategoryByUrlKey()` only performed an exact `WHERE url_key = 'fuel-filter'` match, which always returned 0 rows for these categories
- Added suffixed url_key fallback in `getPartCategoryByUrlKey()`: when exact `url_key` match fails, queries `WHERE url_key LIKE '{urlKey}-%'` and filters results by `normalizeUrlKey()` to find the canonical match
- Added same fallback in `getCategorySearchIdFromUrlKey()` for category ID resolution
- No link generation changes needed — links already used `normalizeUrlKey()` consistently
- No product/payment/checkout behavior changes
- Category pages for valid categories no longer 404

### Category URL Strategy
- SEO-friendly category URLs: `/{locale}/{categorySlug}` (e.g., `/en/fuel-filter`, `/tr/yakit-filtresi`)
- Categories with clean `url_key` in DB (19 categories like `filters`, `car-parts`): resolved by exact `url_key` match
- Categories with legacy ID-suffixed `url_key` (959 categories like `fuel-filter-100261`): resolved by `startsWith` prefix match + `normalizeUrlKey()` post-filter
- Categories without `url_key` (1 category with null): resolved by name-derived slug fallback (`generateSlug(name)` or `generateSlug(name_tr)`)
- Turkish locale: also matches `name_tr`-derived slugs (e.g., `yakit-filtresi` from "Yakıt filtresi")
- `next.config.mjs` redirects strip legacy ID suffixes from URLs: `/en/fuel-filter-100261` → `/en/fuel-filter`

### Slug Resolution Flow (updated)
1. **Redis cache** — `part-category-v2-{urlKey}`
2. **Legacy ID suffix** — if urlKey matches `-(\d+)$`, parse ID and look up directly
3. **Exact `url_key` match** — `WHERE is_active = true AND url_key = urlKey`
4. **Suffixed `url_key` fallback** — `WHERE is_active = true AND url_key LIKE '{urlKey}-%'`, then filter by `normalizeUrlKey()` matching urlKey
5. **Name-derived slug fallback** — `WHERE is_active = true AND url_key IS NULL`, then match `generateSlug(name) === urlKey` or `generateSlug(name_tr) === urlKey`
6. **notFound()** — if none of the above match

### Tests
- Added 8 new tests for suffixed url_key resolution in `lib/actions/getPartCategories.test.ts`
- Added 3 new tests for canonical category URL generation in `lib/catalog-url.test.ts`
- Tests confirm `normalizeUrlKey` correctly strips ID suffixes, filters false positives, and produces consistent slugs
- All 100 tests pass

## v0.2.1 - Catalog + Offer Search MVP

### Catalog + Offer Search
- Replaced slow Prisma fallback search (~135s for "Bosch") with fast PostgreSQL catalog+offer search (<2s target)
- New `runCatalogOfferSearch()` uses tiered SQL queries: exact SKU/OEM/EAN, then brand, then name contains
- Supplier-backed products with price and stock prioritized at top of results
- Catalog-only products without offers remain visible with "Fiyat Al" (Request Price) CTA
- No expensive joins with vehicle compatibility in search path
- Strict limits: max 60 results per page, max 30 catalog-only results

### Availability Status Model
- Added typed `AvailabilityStatus`: `PURCHASABLE`, `REQUEST_PRICE`, `VERIFY_FITMENT`, `OUT_OF_STOCK`
- Added typed `SearchCTA`: `add_to_cart`, `request_price`, `verify_fitment`, `notify_or_request_price`
- CTA mapping: PURCHASABLE → Sepete Ekle, REQUEST_PRICE → Fiyat Al, VERIFY_FITMENT → Uygunluk Sor, OUT_OF_STOCK → Stok Gelince Haber Ver
- Search results include `availabilityStatus`, `cta`, `detailUrl` fields
- Response includes `purchasableCount`, `requestPriceCount`, `verifyFitmentCount`, `outOfStockCount`

### Search Response Enhancements
- `/api/search` returns `dataSource: "postgres_catalog_offer_search"` when using new path
- `liveFallbackUsed: false` indicates no live supplier API calls during search
- `durationMs` for search timing
- `hasMore`, `totalEstimate` for pagination metadata

### UI Updates
- ProductCard and GridProductCard support new `availabilityStatus` and `cta` props
- "Fiyat Al" button for no-price products via CustomerRequestDialog
- "Uygunluk Sor" button for fitment verification (prepared for v0.2.2)
- Detail URL links to `/part/[id]` or `/supplier-product/[id]`

### Request Price Preparation
- Added `FITMENT_CHECK` request type and `FITMENT_MODAL` source to customer requests
- Prepared route/link structure for v0.2.2 full request price flow

### Supplier API Documentation
- Added `docs/SUPPLIER_API_OPERATIONS.md` with Dinamik, SETA, Başbuğ strategy
- Covered: periodic sync schedule, live check policy, failure handling, stale data detection

### Search Documentation
- Added `docs/SEARCH_CATALOG_OFFER.md` explaining catalog-first + offer-prioritized strategy
- Documented: result statuses, ranking rules, performance targets, index recommendations, limitations

### Index Recommendations
- Added `scripts/search-indexes.sql` with pg_trgm indexes for normalized fields
- Recommended indexes for: supplier_products, supplier_product_oems, supplier_part_mappings, parts, part_brands, part_eans, part_oens, part_cross_references

### Meilisearch
- Meilisearch remains disabled. Integration code preserved for future re-enablement.
- No changes to Meilisearch integration when `MEILI_ENABLED=true`.

## v0.2.0 - Performance Baseline and Catalog Reliability

### Performance Baseline
- Measured baseline timings for all critical endpoints: homepage, health, search, category pages
- Established acceptance targets for key performance metrics
- Created `docs/PERFORMANCE_BASELINE.md` with full baseline data, cache architecture, and recommendations

### Server-Side Timing Instrumentation
- Added `lib/performance/timing.ts` — lightweight timing utility with named operations, timer groups, and threshold-based logging
- `PERFORMANCE_LOGGING` env variable enables verbose logging (default: false)
- `SLOW_QUERY_THRESHOLD` env variable controls slow query warning threshold (default: 500ms, was 1000ms)
- Instrumented homepage data loading (`catalogData`, `manufacturers`, `mainNav`)
- Instrumented `getPartCategories`, `getPartCategoriesForVehicle`, `getMainNavCategories` with cache hit/miss tracking
- Instrumented `getCatalogCategories`, `getPopularManufacturers` with cache hit/miss tracking
- Instrumented hierarchy service `getDropdownData` with cache hit/miss tracking
- Updated `lib/query-monitor.ts` to use consistent threshold and removed duplicate env parsing
- Added Redis availability check and DB timing to `/api/health` response

### Catalog and Search Measurement
- Search endpoint already had Server-Timing headers and timing logs (pre-existing)
- Catalog category data loading paths now tracked end-to-end
- Category page resolution (`getPartCategoryByUrlKey`) now has full timing instrumentation

### Cache Improvements
- Added Redis caching to `getPopularManufacturers` (was uncached, now 1h TTL with key `popular-manufacturers-v1`)
- Removed `vehicle_brands.count()` debug query from `getDropdownData('vehicle_brands')` — unnecessary DB call on every invocation
- Optimized `getPartCategoryByUrlKey` to use targeted queries instead of loading ALL categories (reduces cold-cache DB load from O(N) full-table scan to O(depth) targeted lookups)
- Optimized `getCategorySearchIdFromUrlKey` to trace ancestry via iterative parent lookups instead of loading all categories
- Documented all cache keys and TTLs in `docs/PERFORMANCE_BASELINE.md`

### DB Index Recommendations
- Added Prisma indexes: `part_brands(logo_url)`, `part_categories(is_active, is_main_nav)`, `part_categories(is_active, parent_id)`, `part_cross_references(article_number, part_id)`, `part_eans(part_id)`, `part_oens(code, part_id)`
- Documented additional SQL index recommendations for future releases in `docs/PERFORMANCE_BASELINE.md`

### Search Findings
- Confirmed MeiliSearch is disabled — all search goes through Prisma fallback
- Broad search queries (e.g., "Bosch") take 135+ seconds on cold cache due to deeply nested OR conditions across 10+ tables
- Code-like queries (e.g., OEM numbers) use fast lookup path and are significantly faster
- Search Redis cache mitigates repeat queries (300s TTL for Meili, 120s for Prisma fallback)

### No product UI redesign
- No pricing, payment, supplier sync, vehicle compatibility, or order behavior changes
- No visual or UX changes to any page

---

## v0.1.5 - Deploy Version Consistency and VPS Compose Hardening

### Deployment Version Consistency
- Fixed `/api/health` version reporting: deploy script now injects `NEXT_PUBLIC_BUILD_VERSION` at Docker build time instead of relying on `.env.production`
- GitHub Actions workflow now determines deploy version from: manual input > tag name > short commit SHA
- Deploy script (`scripts/vps-deploy.sh`) derives version in priority order: `NEXT_PUBLIC_BUILD_VERSION` env var > `GITHUB_REF_NAME` > `VERSION` > git tag > short SHA > fallback "dev"
- Health endpoint correctly reports the version of the deployed release, not a stale hardcoded value

### VPS Compose Strategy Hardening
- Removed stale `image: ghcr.io/aokcuoglu/getirbakim-v2:latest` from `docker-compose.yml` — production VPS builds from local Dockerfile only
- Removed hard-coded `NEXT_PUBLIC_BUILD_VERSION:-v0.1.3` default from `docker-compose.yml` — replaced with `dev` fallback
- Updated `docker-compose.yml` comments to document local build strategy and version injection
- Updated `docker-compose.local.yml` comments to remove reference to GHCR image strategy

### GitHub Actions Workflow Updates
- Added `version` input to `workflow_dispatch` trigger (optional string, e.g. `v0.1.5`)
- Added version determination step: resolves from input, tag name, or commit SHA
- Passes `NEXT_PUBLIC_BUILD_VERSION` to deploy script via SSH command
- Deploy script exports `NEXT_PUBLIC_BUILD_VERSION` and passes it to `docker compose up --build`

### VPS Deploy Script Hardening
- `scripts/vps-deploy.sh` now computes and exports `NEXT_PUBLIC_BUILD_VERSION` before `docker compose up --build`
- Prints deploy version before and after build
- Reports health check version after deploy for verification
- Increased container startup wait from 15s to 20s
- Does not require `.env.production` to contain `NEXT_PUBLIC_BUILD_VERSION`

### Documentation Updates
- `docs/GITHUB_ACTIONS_DEPLOY.md`: documented version inference logic, manual workflow_dispatch version input, build version priority order, updated security checklist
- `docs/DEPLOYMENT_CONTABO.md`: removed `NEXT_PUBLIC_BUILD_VERSION` from `.env.production` critical settings, added version injection instructions, updated deploy/rollback commands to pass `NEXT_PUBLIC_BUILD_VERSION`
- `docs/OPERATIONS_RUNBOOK.md`: updated version in example health response, updated all deploy/rollback commands to include `NEXT_PUBLIC_BUILD_VERSION`, added version source explanation
- `README.md`: updated production deploy instructions to use deploy script and note about build version

### Post-v0.1.4 Fixes
- This release captures the version consistency fixes that were missing from v0.1.4
- v0.1.4 deployed successfully but reported `v0.1.2` via `/api/health` due to stale `.env.production`
- After v0.1.5, `/api/health` will correctly report the deployed version

### No product feature changes
- No pricing, payment, supplier sync, vehicle compatibility, auth, search, or UI changes
- No landing page modifications

---

## v0.1.4 - GitHub Actions SSH Deploy Automation

### GitHub Actions Deployment
- Added `.github/workflows/deploy-vps.yml` — controlled SSH-based deployment workflow
- Triggers on `workflow_dispatch` (manual) and `push` tags matching `v*`
- Does NOT auto-deploy on every push to `main`
- Deploys via SSH: pulls latest code, rebuilds Docker, restarts app, runs smoke tests
- Uses native SSH commands (no third-party action dependencies)
- Cleans up SSH key from runner after each run

### VPS Script Hardening
- `scripts/vps-deploy.sh`: accepts `PROJECT_PATH`, `BRANCH`, `DOMAIN` env vars; verifies `.env.production` exists before rebuild; fails cleanly on health check failure; 15s wait for container startup; shows before/after commit; does not print secrets
- `scripts/vps-smoke.sh`: accepts `DOMAIN` env var or argument; checks internal endpoints (health, /tr, /en) plus public HTTPS if domain set; 10s curl timeout; exits non-zero on any failure
- `scripts/vps-rollback.sh`: accepts `ROLLBACK_REF` env var or argument; fetches tags from origin; validates ref exists; verifies `.env.production` before rebuild; fails on health check failure with logs; saves rollback point

### Documentation
- Added `docs/GITHUB_ACTIONS_DEPLOY.md` — GitHub Actions deploy setup, SSH key generation, GitHub Secrets reference, deploy key vs SSH key distinction, rollback instructions, root user warning, security checklist
- Updated `docs/OPERATIONS_RUNBOOK.md` — added GitHub Actions deploy section, script env var usage, rollback env var, GitHub Actions failure troubleshooting (SSH auth, known_hosts, .env.production missing, git pull, docker build, smoke, nginx stale)
- Updated `docs/PRODUCTION_SECURITY_CHECKLIST.md` — added GitHub Secrets section, deploy workflow security checklist, root user documentation, SSH key rotation guidance
- Updated `README.md` — added Automated VPS Deployment section with link to docs

### Replaced Workflow
- Removed old `.github/workflows/deploy.yml` (GHCR-based, auto-deploy on main push, had path and service name mismatches)
- Replaced with `.github/workflows/deploy-vps.yml` (SSH-based, controlled trigger, uses existing VPS deploy scripts)

### No product feature changes
- No pricing, payment, supplier sync, vehicle compatibility, auth, search, or UI changes
- No landing page modifications

---

## v0.1.3 - Production Go-Live Hardening

### Secret Hygiene Hardening
- Added `scripts/secret-scan.sh` — release guard that scans tracked files, staged diffs, and gitignore status without broad recursive grep
- Hardened `.gitignore`: added `!.env.*.example`, `*.env.bak`, `*.env.backup`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, `id_ed25519` (removed duplicate `*.pem`)
- Hardened `.dockerignore`: explicit `.env`/`.env.*`/`!.env.example` exclusions, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, `id_ed25519`
- Clarified policy: ignored local `.env` files are allowed, but tracked/staged secrets are blocking
- Removed `.env.bak-*` and `.env.production` from repository root (backed up externally)
- Updated `docs/PRODUCTION_SECURITY_CHECKLIST.md` with secret hygiene policy and scan script reference

### Production Domain and Canonical Hardening
- Hardcoded `https://www.getirbakim.com` URL fallbacks in `lib/supabase/storage.ts` and `lib/actions/category-actions.ts` replaced with `resolveSiteUrl()` calls
- `lib/site-url.ts` now exports `isIndexingAllowed()` for SEO indexing control
- `.env.example` updated with `NEXT_PUBLIC_ALLOW_INDEXING` variable

### SEO Indexing Control
- Added `NEXT_PUBLIC_ALLOW_INDEXING` env variable (set `true` in production to allow search engine indexing)
- `app/robots.ts` now respects `NEXT_PUBLIC_ALLOW_INDEXING`: disallows indexing when not `true`
- `app/[locale]/layout.tsx` adds `robots: { index: false, follow: false }` metadata when indexing is disabled
- `app/sitemap.xml/route.ts` returns empty sitemap with `X-Robots-Tag: noindex` when indexing is disabled
- `app/[locale]/sitemap.xml/route.ts` returns empty sitemap with `X-Robots-Tag: noindex` when indexing is disabled
- `scripts/validate-env.ts` now warns if `NEXT_PUBLIC_ALLOW_INDEXING` is not `true` in production

### Auth Production Readiness
- Reviewed auth routes, callback, middleware, login/signup flows
- Added `docs/AUTH_PRODUCTION.md` with Supabase dashboard settings, redirect URL checklist, server-only key warnings, and test checklist

### Tami Payment Production Readiness
- Reviewed payment callback, service, security hash verification, amount mismatch handling
- Added `docs/PAYMENT_TAMI_PRODUCTION.md` with production callback URL, env variables, sandbox vs production URLs, amount mismatch expectations, production switch checklist

### Admin and Operational Security
- Reviewed admin route protection, middleware, server-side auth, API admin endpoints
- Added `docs/PRODUCTION_SECURITY_CHECKLIST.md` with admin access, secret handling, env configuration, security headers, payment endpoint protection, supplier endpoint protection, rate limiting recommendations

### VPS Deploy Script Hardening
- `scripts/vps-deploy.sh`: improved with repo root detection, git HEAD display, container logs on deploy, wait time increase, structured output
- `scripts/vps-smoke.sh`: accepts `DOMAIN` parameter, uses `set -euo pipefail`
- Added `scripts/vps-rollback.sh` for git tag-based rollback with health check verification

### Monitoring and Healthcheck
- `/api/health` endpoint reviewed: returns version, checks database, no secrets exposed, lightweight
- Added `docs/OPERATIONS_RUNBOOK.md` with healthcheck commands, Docker logs, nginx logs, disk/memory checks, restart commands, deploy/rollback commands, common failure troubleshooting

### nginx/SSL Documentation
- Updated `docs/DEPLOYMENT_CONTABO.md` with HTTPS smoke tests, SSL renewal, security header verification, monitoring commands

### README Updates
- Added Production Go-Live section with pre-launch checklist and links to all production docs

### No product feature changes
- No pricing, payment, supplier sync, vehicle compatibility, auth, search, or UI changes
- No landing page modifications

### Infrastructure
- Clean Contabo VPS reinstall and provisioning verified
- Docker Engine installation verified (`docker --version`, `docker compose version`)
- Repository cloned to `/opt/getirbakim-v2` via GitHub read-only deploy key
- `.env.production` kept only on VPS (never committed to repository)
- Docker app container running and reachable at `http://127.0.0.1:3000`
- Database health check OK (`/api/health` returns `checks.database: ok`, `version: v0.1.2`)
- nginx HTTP reverse proxy working on `http://getirbakim.com`
- `/tr` and `/en` pages verified (HTTP 200)
- `/api/health` verified through nginx (HTTP 200, database OK)
- HTTPS/SSL status: **pending** (Not yet configured; Certbot/Cloudflare setup to be done separately)
- Fixed local Docker Supabase session pool exhaustion by making PrismaPg pool size env-configurable
- Added `DATABASE_POOL_MAX` / `PG_POOL_MAX` env variables for configurable pool sizing
- Recommended pool sizes: local Docker 2, VPS production 4, upper clamp 10
- Prevents `EMAXCONNSESSION` during concurrent local + VPS runtimes

### Added
- `docs/nginx/getirbakim.conf.example` — example nginx reverse proxy configuration with SSL, gzip, and caching headers
- `scripts/vps-deploy.sh` — VPS deployment script (git pull, rebuild, health check)
- `scripts/vps-smoke.sh` — VPS smoke test script (internal + external HTTP/HTTPS checks)

### Changed
- `docker-compose.yml`: updated default `NEXT_PUBLIC_BUILD_VERSION` to `v0.1.2`, updated GHCR image name to `ghcr.io/aokcuoglu/getirbakim-v2:latest`
- `docs/DEPLOYMENT_CONTABO.md`: updated git clone URL, directory references, and version references to match current repository

### Deployment
- GitHub push/tag/release does not automatically update the VPS. Production update requires manual deploy via `scripts/vps-deploy.sh` or the documented `git pull` + `docker compose` workflow.
- CI/CD deployment automation should be a future release.

### No product feature changes
- No pricing, payment, supplier sync, vehicle compatibility, auth, search, or UI changes
- No landing page modifications

---

## v0.1.1 - Docker-first Local Runtime and Contabo VPS Deployment Readiness

### Hardened
- `docker-compose.local.yml`: added CookieYes build args, NODE_ENV=production, healthcheck points to `/api/health`, added `start_period`, fixed default URLs to `localhost:3001`
- `docker-compose.yml`: added local build strategy alongside GHCR image, NODE_ENV=production, healthcheck points to `/api/health`, added `start_period`, supports both VPS local-build and GHCR pull strategies
- `/api/health` endpoint simplified: removed rate limiting wrapper (Docker healthcheck must always pass), added `version` field from `NEXT_PUBLIC_BUILD_VERSION`

### Added
- `docs/DOCKER_LOCAL.md` — full local Docker runtime guide with prerequisites, commands, healthcheck, and troubleshooting
- `docs/DEPLOYMENT_CONTABO.md` — Contabo VPS deployment guide with server setup, nginx reverse proxy, SSL, rollback, and backup strategy
- `docs/ENVIRONMENT.md` — complete environment variable reference with Supabase pooler requirements, server-only vs public classification, and secret rotation guidance

### Changed
- README.md Docker section rewritten as Docker-first with links to new docs

### No product feature changes
- No pricing, payment, supplier sync, vehicle compatibility, auth, search, or UI changes
- No landing page modifications

---

## v0.1.0 - Initial GitHub Baseline

### Fixed
- Supabase PrismaPg connection fixed to use session pooler mode (port 5432) instead of transaction mode (port 6543 with pgbouncer=true)
- PrismaPg pool size reduced from 20 to 10 to stay within Supabase session pool limit (15)
- SSL configuration added to PrismaPg adapter for Supabase connections
- Type errors resolved in `lib/actions/admin-suppliers.ts` (undefined `autoMatchOrCreatePartAfterOemSave` stub) and `lib/suppliers/dinamik-job-queue.ts` (Prisma string vs literal union type narrowing)
- VAT calculation test expectations corrected to match 20% DISPLAY_VAT_RATE
- Dinamik catalog-seed route test fixed to mock `server-only` import chain

### Added
- `.env.example` updated with Supabase session pooler documentation and all required variable placeholders
- `docker-compose.local.yml` for local Docker builds (port 3001)
- `.gitignore` updated to protect `.env.*` and `.env.bak-*` files
- `CHANGELOG.md` and `RELEASE_NOTES.md` for release tracking

### Changed
- `NODE_ENV` in `.env` set to `development` for local dev

### Local Dev Verified
- App runs at http://localhost:3001
- `/api/me` returns 200
- `/tr` and `/en` pages return 200
- `/api/category-page` returns 200
- No Prisma P1000 authentication errors

### Quality Gates
- `bun run lint` — pass
- `bun run typecheck` — pass
- `bun run test` — 48 pass, 0 fail
- `bun run build` — pass
- `bunx prisma validate` — pass