# Release Notes — v0.3.2 Search Performance & Pagination Patch

**Release Date:** 2026-05-03

## Overview

v0.3.2 is a performance and UX patch for the catalog search. The existing DB-backed search was measuring ~9 seconds for a "Bosch" query. This patch reduces cold-uncached response time significantly through query optimization, pagination, selective enrichment, caching, and frontend debounce.

## Highlights

- Added fast-path DB-backed search: only queries required columns, skips OEM/facets by default
- Added pagination with default 24 products, max 48, and `hasMore` cursor
- Reduced default response payload by skipping OEM numbers and facet counts unless explicitly requested
- Made facet and OEM enrichment optional via `includeFacets=true` and `includeOems=true` query params
- Added server-side in-memory TTL search cache (`SEARCH_CACHE_ENABLED`, `SEARCH_CACHE_TTL_SECONDS`, `SEARCH_CACHE_MAX_ENTRIES`)
- Added safe timing instrumentation to `/api/search` (logs `db_search_duration_ms`, `oem_duration_ms`, `facet_duration_ms`, `total_duration_ms`; no secrets logged)
- Added frontend 400ms debounce and minimum 2-char query threshold
- Added "Daha fazla göster" load-more button for paginated results
- Cached provider names and column schema in-process to avoid repeated queries
- Avoided `SELECT *` — only 19 required columns fetched in fast path
- Avoided `COUNT(*)` — uses `LIMIT + 1` pattern for `hasMore`
- Added recommended search indexes documentation (`docs/existing-db/RECOMMENDED_SEARCH_INDEXES.md`)
- Preserved `raw_json` safety (never exposed to browser)
- Preserved admin authentication
- Preserved Docker local setup on http://localhost:3001

## API Changes

### `/api/search` — New Query Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `page` | 1 | Page number (1-based) |
| `limit` | 24 | Products per page (max 48) |
| `includeFacets` | false | If true, compute supplierCounts/brandCounts from full result set |
| `includeOems` | false | If true, fetch OEM numbers for returned products |

### `/api/search` — New Response Fields

| Field | Description |
|-------|-------------|
| `page` | Current page number |
| `limit` | Products per page |
| `hasMore` | Whether more pages are available |
| `resultCountShown` | Number of products in this response |
| `totalEstimate` | null (exact count avoided for performance) |
| `timings` | Performance timings object (only when DB-backed) |

### `/api/search` — Timing Response (server logs only)

```
[search-perf] q_len=5 type=text db=120ms oem=0ms facets=0ms map=5ms total=130ms page=1 limit=24 hasMore=true facets=false oems=false
```

## Frontend Changes

- Search input debounced at 400ms with `abortRef` for stale request cancellation
- Results page now uses load-more pagination ("Daha fazla göster" button) instead of showing all results
- Mobile filter drawer triggers navigation immediately on select changes
- Desktop sidebar filters use `onBlur` for text inputs and `onChange` for selects

## Architecture Changes

### `src/lib/search-cache.ts` (new)

Server-side in-memory TTL cache for DB search responses. Cache key includes query, page, limit, all filters, and catalog source mode. Only successful responses cached. Max entries configurable.

### `src/lib/catalog-search.ts` (revised)

- `searchCatalogDb()` now accepts `page`, `limit`, `includeFacets`, `includeOems` parameters
- Fast path: queries only 19 columns, skips `COUNT(*)`, skips OEM/facets by default
- For SKU-like queries: fetches only exact OEM matches for returned product IDs
- `includeFacets=true`: runs separate aggregate query for full-set counts
- `includeOems=true`: fetches all OEM codes for the returned page's product IDs
- Uses `LIMIT limit+1` pattern and `hasMore` flag
- Provider names cached in-process for 5 minutes
- Column schema cached in-process for 10 minutes
- `classifyQuery()` logs query type (sku_like/oem_like/text) for safe diagnostics

### `src/app/api/search/route.ts` (revised)

- Checks in-memory cache before querying DB
- Caches successful DB responses
- Passes pagination and enrichment params to `searchCatalogDb()`
- Returns `page`, `limit`, `hasMore`, `resultCountShown`, `totalEstimate`, `timings`
- Safe timing logs with query length and type only (never logs full query or secrets)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SEARCH_CACHE_ENABLED` | true | Enable/disable search response cache |
| `SEARCH_CACHE_TTL_SECONDS` | 60 | Cache TTL in seconds |
| `SEARCH_CACHE_MAX_ENTRIES` | 500 | Maximum cache entries before eviction |

## Known Notes

- Exact total count is omitted by default for performance (`totalEstimate: null`)
- Facet counts are optional; default response only includes per-page supplierCounts
- Price and stock still require verification before commercial order confirmation
- Product request flow is not included in this version
- `raw_json` is never exposed to the browser
- Recommended indexes in `docs/existing-db/RECOMMENDED_SEARCH_INDEXES.md` should be reviewed before production execution

## Migration from v0.3.1

1. Pull the latest code
2. Review and optionally apply recommended indexes from `docs/existing-db/RECOMMENDED_SEARCH_INDEXES.md`
3. Set `SEARCH_CACHE_ENABLED=true` (default) in `.env` or Docker environment
4. Rebuild Docker: `docker compose build --no-cache && docker compose up -d`
5. Verify at http://localhost:3001
6. Test: `curl -s "http://localhost:3001/api/search?q=Bosch" | jq '.products | length, .page, .hasMore'`