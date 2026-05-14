# Exact Code Search and Fitment Index Optimization

## Exact Code Search Strategy

### Problem

Before v0.2.5, searching for an OEM/EAN/SKU/reference code like `0445110376` could return 0 results even if the code exists in the database. This happened because:

1. Meilisearch index has a `maxTotalHits` limit of 10,000 and document caps (30,000 catalog-only, 10,000 orphan supplier)
2. Code normalization mismatch between index and query (spaces, dashes, case)
3. The primary search path (Meilisearch) could miss records that aren't indexed

### Solution: Exact Code Lookup Before Meilisearch

When a query is identified as a code query (length >= 5, predominantly alphanumeric), the search API now:

1. **Detects code-like queries** using `isExactCodeQuery()`
2. **Runs a fast PostgreSQL exact lookup** across all code tables
3. **Runs Meilisearch search** as normal
4. **Merges** exact results at the top, deduplicating by `partId`/`supplierProductId`
5. **Sets `exactCodeMatchUsed: true`** in the response when exact matches are found
6. **Falls back gracefully** if the exact lookup fails (logs error, continues with Meili results only)

This exact code lookup runs in BOTH the GET and POST search paths, including Meilisearch-enabled multi-search.

### OEM/EAN/SKU/Reference Lookup Order

The exact code lookup searches these tables in order of priority:

| Priority | Source Table | Score | Match Type |
|----------|-------------|-------|------------|
| 1 | `supplier_products` (SKU/barcode) | 125 | Supplier SKU / barcode exact |
| 2 | `part_oens` | 120 | Part OEM code exact |
| 3 | `part_eans` | 120 | Part EAN exact |
| 4 | `supplier_product_oems` (mapped) | 115 | Supplier product OEM exact |
| 5 | `part_cross_references` | 110 | Cross-reference exact |
| 6 | `supplier_product_oems` (orphan) | 100 | Orphan supplier OEM exact |

### Code Normalization Rules (`lib/search/code-normalization.ts`)

- **`normalizeCode(value)`**: Uppercase → remove spaces → remove dashes → remove dots/slashes/backslashes → preserves leading zeros
- **`compactCode(value)`**: Lowercase → remove all non-alphanumeric → preserves leading zeros
- Both are used for matching; exact match gets highest score

### `isExactCodeQuery()` Recognition

A query is treated as a code query if:
- Length >= 5
- >= 70% alphanumeric characters
- <= 3 separator chars (spaces, dashes, dots)
- Either: 4+ digits with 75%+ alphanumeric ratio
- Or: 3+ letters + 2+ digits with 75%+ alphanumeric ratio

## Fitment Enrichment Strategy

### Problem

The previous v0.2.4 reindex used `buildCatalogDocumentsWithFitment` which performed heavy vehicle fitment joins (across `part_vehicle_types`, `vehicle_types`, `vehicle_models`, `vehicle_brands`, and `vehicle_type_modifications`) inline in the main catalog query. This caused `statement_timeout` errors (57014) on large datasets.

### Solution: Batched Fitment Enrichment

Fitment data is now populated in a **separate enrichment phase** after documents are built:

1. **Base reindex** runs fast with `includeFitment: false` (no vehicle joins)
2. **Fitment enrichment** runs in batches of configurable size (`MEILI_REINDEX_FITMENT_BATCH_SIZE`, default 100)
3. Each batch fetches fitment data only for those part IDs
4. If a batch fails, it logs the error and continues (configurable via `MEILI_REINDEX_FITMENT_TIMEOUT_SAFE`)
5. Fitment is **disabled by default** in production until stable (`MEILI_REINDEX_INCLUDE_FITMENT=false`)

### v0.2.6 Change: Fitment Enriches Both Supplier-Backed and Catalog Documents

Previously, fitment enrichment only applied to catalog-only documents. As of v0.2.6, fitment enrichment now covers **both supplier-backed (supplier_offer) and catalog-only (canonical_part) documents**. This ensures that mapped parts with supplier offers also receive vehicle compatibility data, improving search quality for fitment-based queries.

Orphan supplier products (without a `partId`) are still excluded from fitment enrichment since they have no canonical part to link to vehicle types.

### Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `MEILI_REINDEX_INCLUDE_FITMENT` | `false` | Enable fitment enrichment |
| `MEILI_REINDEX_FITMENT_BATCH_SIZE` | `100` | Parts per fitment query batch |
| `MEILI_REINDEX_FITMENT_LIMIT_PER_PART` | `50` | Max fitment records per part |
| `MEILI_REINDEX_FITMENT_TIMEOUT_SAFE` | `true` | Continue on batch failure |

### Future: Materialized View Recommendation

If direct batch fitment is still slow, consider a materialized view:

```sql
CREATE MATERIALIZED VIEW search_part_fitment_documents AS
SELECT
  pvt.part_id,
  ARRAY_AGG(DISTINCT vb.name) AS vehicle_brand_names,
  ARRAY_AGG(DISTINCT vm.name) AS vehicle_model_names,
  ARRAY_AGG(DISTINCT vt.name) AS vehicle_type_names,
  ARRAY_AGG(DISTINCT COALESCE(vt.year_of_constr_from, vt.year_of_constr_to)) AS vehicle_years,
  ARRAY_AGG(DISTINCT vtm.motor_type) FILTER (WHERE vtm.motor_type IS NOT NULL) AS engine_codes,
  COUNT(*) AS fitment_count
FROM part_vehicle_types pvt
JOIN vehicle_types vt ON vt.id = pvt.vehicle_type_id
JOIN vehicle_models vm ON vm.id = vt.model_id
JOIN vehicle_brands vb ON vb.id = vm.brand_id
LEFT JOIN vehicle_type_modifications vtm ON vtm.vehicle_type_id = vt.id
GROUP BY pvt.part_id;
```

This can be refreshed incrementally or on a schedule.

## Reindex Coverage Improvements (v0.2.6)

### Priority Indexing for Code-Bearing Records

Products with OEM codes, EAN/barcodes, or cross-reference numbers are now prioritized when building search documents:

1. **Orphan supplier products**: Those with active OEM codes (`supplier_product_oems`) are indexed first, followed by those with barcodes, then those with price/stock, then the rest. This ensures code-bearing products are not excluded by the orphan cap.

2. **Catalog-only parts**: Those with OEM codes (`part_oens`) are indexed first, followed by those with EAN codes (`part_eans`), then cross-references, then by pricing availability. This ensures catalogs with codes are included within the 30,000 limit.

These priority changes only affect ordering within the limits — they do not change the total number of documents indexed.

## Diagnostic: Debugging Missing Codes

To diagnose why a specific code returns 0 results:

```bash
CODE=0445110376 bun scripts/search-debug-code.ts
```

This script searches all relevant DB tables and reports:
- Which tables contain the code
- Matched part IDs and supplier product IDs
- Mapping status (APPROVED/CANDIDATE/orphan)
- Whether those records are likely included in the current index
- If not, why (index limit, missing mapping, etc.)

## Exact Codes in Meilisearch Documents

Each search document now includes an `exactCodes` array containing:
- All normalized OEM codes (`0 445 110 376` → `0445110376`)
- All compact OEM codes (same as normalized for all-numeric codes)
- All EAN/barcode codes (normalized)
- All cross-reference numbers (normalized + compact)
- All reference numbers (normalized)
- Supplier SKU (normalized)
- Part article link ID (normalized)

The `exactCodes` field is a Meilisearch **searchable attribute**, allowing exact code matches through both Meilisearch and the PostgreSQL fallback.

## Known Settings

- `MEILI_REINDEX_INCLUDE_FITMENT=false` until fitment enrichment is tested and stable
- Meilisearch `maxTotal_hits=10000` — may need increase for full coverage
- Catalog-only documents currently capped at 30,000
- Orphan supplier documents currently capped at 10,000
- Exact code lookup queries are limited to 50 results per search

## Validation (v0.2.8)

To validate exact code search changes locally:

```bash
# 1. Start Docker
docker compose -f docker-compose.local.yml down --remove-orphans
docker compose --env-file .env -f docker-compose.local.yml up -d --build

# 2. Setup and reindex
docker compose -f docker-compose.local.yml exec app bun run search:setup
docker compose -f docker-compose.local.yml exec app bun run search:reindex

# 3. Debug missing codes
docker compose -f docker-compose.local.yml exec app sh -lc 'CODE=0445110376 bun scripts/search-debug-code.ts'

# 4. Search smoke tests
curl -s "http://localhost:3001/api/search?q=0445110376" | jq '.source // .dataSource, .exactCodeMatchUsed, .durationMs, (.products | length), .products[0]'
curl -s "http://localhost:3001/api/search?q=Bosch" | jq '.source // .dataSource, .durationMs, (.products | length)'
curl -s "http://localhost:3001/api/search?q=yakıt filtresi" | jq '.source // .dataSource, .durationMs, (.products | length)'

# 5. Meili fallback test
docker compose -f docker-compose.local.yml stop meilisearch
curl -s "http://localhost:3001/api/search?q=Bosch" | jq '.source // .dataSource, .liveFallbackUsed, .durationMs, (.products | length)'
docker compose -f docker-compose.local.yml start meilisearch

# 6. Category page performance
curl -D /tmp/headers.txt -w "\nTTFB:%{time_starttransfer} TOTAL:%{time_total}\n" -o /tmp/air-filter.html -s http://localhost:3001/en/air-filter
```

Expected results:
- 0445110376: should not silently return 0 if code exists in DB; `exactCodeMatchUsed` should be `true` when exact DB lookup finds a match
- Bosch: should return Meilisearch results with `source: "meilisearch"` or `"meilisearch_with_exact_code_boost"`
- Turkish synonym: should work (`yakıt filtresi` → fuel filter)
- Meili fallback: should return `liveFallbackUsed: true` with `source: "postgres_catalog_offer_search"`
- Category page TTFB: < 1s; total time: 2-5s