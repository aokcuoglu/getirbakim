# Applied Search Indexes (v0.3.3)

These indexes were applied as part of v0.3.3 to optimize catalog search performance.

All statements are additive only. No destructive operations.

## SQL Source

See `scripts/sql/search-indexes-v0.3.3.sql` for the exact SQL.

## Application

Run with explicit opt-in:

```bash
APPLY_SEARCH_INDEXES=true npx tsx scripts/apply-search-indexes.ts
```

## Indexes Applied

### pg_trgm Extension

| Extension | Purpose |
|-----------|---------|
| `pg_trgm` | Required for GIN trigram indexes that accelerate `%pattern%` ILIKE queries |

### GIN Trigram Indexes (accelerate ILIKE '%pattern%')

| Index Name | Table | Column | Type |
|------------|-------|--------|------|
| `idx_supplier_products_normalized_name_trgm` | supplier_products | normalized_name | GIN (gin_trgm_ops) |
| `idx_supplier_products_supplier_name_trgm` | supplier_products | supplier_name | GIN (gin_trgm_ops) |
| `idx_supplier_products_supplier_brand_trgm` | supplier_products | supplier_brand | GIN (gin_trgm_ops) |

### B-tree Indexes (exact match, prefix, ordering)

| Index Name | Table | Column | Type |
|------------|-------|--------|------|
| `idx_supplier_products_provider_id` | supplier_products | provider_id | B-tree |
| `idx_supplier_products_supplier_sku` | supplier_products | supplier_sku | B-tree |
| `idx_supplier_products_normalized_sku` | supplier_products | normalized_sku | B-tree |
| `idx_supplier_products_supplier_brand` | supplier_products | supplier_brand | B-tree |
| `idx_supplier_products_supplier_price` | supplier_products | supplier_price | B-tree |
| `idx_supplier_products_supplier_stock_qty` | supplier_products | supplier_stock_qty | B-tree |

### OEM Table Indexes

| Index Name | Table | Column | Type | Condition |
|------------|-------|--------|------|-----------|
| `idx_supplier_product_oems_normalized_oem_code` | supplier_product_oems | normalized_oem_code | B-tree | — |
| `idx_supplier_product_oems_supplier_product_id` | supplier_product_oems | supplier_product_id | B-tree | WHERE is_active = true |
| `idx_supplier_product_oems_oem_code` | supplier_product_oems | oem_code | B-tree | WHERE is_active = true |

## Rollback

To remove these indexes (only if necessary):

```sql
DROP INDEX CONCURRENTLY IF EXISTS idx_supplier_products_normalized_name_trgm;
DROP INDEX CONCURRENTLY IF EXISTS idx_supplier_products_supplier_name_trgm;
DROP INDEX CONCURRENTLY IF EXISTS idx_supplier_products_supplier_brand_trgm;
DROP INDEX CONCURRENTLY IF EXISTS idx_supplier_products_provider_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_supplier_products_supplier_sku;
DROP INDEX CONCURRENTLY IF EXISTS idx_supplier_products_normalized_sku;
DROP INDEX CONCURRENTLY IF EXISTS idx_supplier_products_supplier_brand;
DROP INDEX CONCURRENTLY IF EXISTS idx_supplier_products_supplier_price;
DROP INDEX CONCURRENTLY IF EXISTS idx_supplier_products_supplier_stock_qty;
DROP INDEX CONCURRENTLY IF EXISTS idx_supplier_product_oems_normalized_oem_code;
DROP INDEX CONCURRENTLY IF EXISTS idx_supplier_product_oems_supplier_product_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_supplier_product_oems_oem_code;
```

> **Do not drop pg_trgm extension** — it may be used by other indexes or applications.