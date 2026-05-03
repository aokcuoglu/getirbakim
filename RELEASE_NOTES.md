# Release Notes

## v0.3.3 — Supabase Search Index Optimization

**Release Date:** 2026-05-03

### Overview

v0.3.3 applies additive search indexes to the existing Supabase catalog DB and restructures the text-search query to use the new trigram indexes. Cold DB-backed search latency is significantly reduced.

### Highlights

- Added safe search index inspection tooling (`scripts/inspect-search-indexes.ts`)
- Added additive Supabase search index SQL (`scripts/sql/search-indexes-v0.3.3.sql`)
- Added guarded index application script requiring `APPLY_SEARCH_INDEXES=true`
- Applied GIN trigram indexes on `normalized_name`, `supplier_name`, `supplier_brand` for ILIKE acceleration
- Applied B-tree indexes on `provider_id`, `supplier_sku`, `normalized_sku`, `supplier_price`, `supplier_stock_qty`
- Applied OEM table indexes on `normalized_oem_code`, `oem_code`, `supplier_product_id`
- Restructured text search query to use UNION CTE pattern enabling individual trigram index usage
- Two-step query: ID search via indexed UNION CTE, then detail fetch by IDs
- Added search performance diagnostic script (`scripts/diagnose-search-performance.ts`)
- Improved cold DB-backed search performance (DB time reduced from ~3.2-3.5s to ~1.3-1.7s)
- Preserved warm cache performance (~27ms)
- Preserved `raw_json` safety
- Preserved Docker local setup on http://localhost:3001

### Performance Improvement

| Metric | v0.3.2 | v0.3.3 |
|--------|--------|--------|
| Bosch cold DB time | ~3.5s | ~1.7s |
| filtre cold DB time | ~3.2s | ~1.4s |
| balata cold DB time | ~3.3s | ~1.3s |
| Warm cache | ~25ms | ~27ms |

### Indexes Applied

| Index Name | Type | Table |
|------------|------|-------|
| `idx_supplier_products_normalized_name_trgm` | GIN trigram | supplier_products |
| `idx_supplier_products_supplier_name_trgm` | GIN trigram | supplier_products |
| `idx_supplier_products_supplier_brand_trgm` | GIN trigram | supplier_products |
| `idx_supplier_products_provider_id` | B-tree | supplier_products |
| `idx_supplier_products_supplier_sku` | B-tree | supplier_products |
| `idx_supplier_products_normalized_sku` | B-tree | supplier_products |
| `idx_supplier_products_supplier_price` | B-tree | supplier_products |
| `idx_supplier_products_supplier_stock_qty` | B-tree | supplier_products |
| `idx_supplier_product_oems_oem_code` | B-tree (partial) | supplier_product_oems |

### Scripts Added

| Script | Purpose |
|--------|---------|
| `scripts/inspect-search-indexes.ts` | Inspect current index state and detect missing indexes |
| `scripts/apply-search-indexes.ts` | Apply indexes safely (requires `APPLY_SEARCH_INDEXES=true`) |
| `scripts/diagnose-search-performance.ts` | Run EXPLAIN ANALYZE on key search patterns |
| `scripts/sql/search-indexes-v0.3.3.sql` | Raw SQL for manual index application |

### Known Notes

- Index creation is additive but should be monitored on production DB
- `CREATE INDEX CONCURRENTLY` may take time on large tables (GIN trigram on 391K rows took ~13-15s)
- No destructive migrations are included
- Product request flow is not included in this version
- First cold query includes provider cache warming (~200ms); subsequent queries skip this
- OEM EXISTS subquery still uses Seq Scan on `supplier_product_oems` (only 2,879 rows; acceptable)
- Multi-column OR still forces Seq Scan; UNION CTE approach works around this

### Migration from v0.3.2

1. Pull the latest code
2. Run `npx tsx scripts/inspect-search-indexes.ts` to check current state
3. Run `APPLY_SEARCH_INDEXES=true npx tsx scripts/apply-search-indexes.ts` to apply indexes
4. Rebuild Docker: `docker compose build --no-cache && docker compose up -d`
5. Verify at http://localhost:3001

---

## v0.3.2 — Search Performance & Pagination Patch

**Release Date:** 2026-05-03

### Overview

v0.3.2 is a performance and UX patch for the catalog search. The existing DB-backed search was measuring ~9 seconds for a "Bosch" query. This patch reduces cold-uncached response time significantly through query optimization, pagination, selective enrichment, caching, and frontend debounce.

### Highlights