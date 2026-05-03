# Recommended Search Indexes

> **Manual review required before production execution.**
>
> These index recommendations are based on query patterns in catalog-search.ts.
> Run each statement individually after reviewing its impact.
> Do not run these against production without verifying current index coverage first.

## Inspect Current Indexes First

```sql
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'supplier_products' ORDER BY indexname;
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'supplier_product_oems' ORDER BY indexname;
```

## 1. pg_trgm Extension (Required for GIN trigram indexes)

```sql
-- Manual review required before production execution.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

## 2. GIN Trigram Indexes (ILIKE acceleration)

```sql
-- Manual review required before production execution.
-- These indexes significantly speed up ILIKE '%query%' patterns.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_normalized_name_trgm
  ON supplier_products USING gin (normalized_name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_supplier_name_trgm
  ON supplier_products USING gin (supplier_name gin_trgm_ops);
```

## 3. B-tree Indexes (exact match and prefix lookups)

```sql
-- Manual review required before production execution.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_provider_id
  ON supplier_products (provider_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_supplier_sku
  ON supplier_products (supplier_sku);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_normalized_sku
  ON supplier_products (normalized_sku);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_supplier_brand
  ON supplier_products (supplier_brand);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_supplier_price
  ON supplier_products (supplier_price);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_supplier_stock_qty
  ON supplier_products (supplier_stock_qty);
```

## 4. OEM Table Indexes

```sql
-- Manual review required before production execution.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_product_oems_normalized_oem_code
  ON supplier_product_oems (normalized_oem_code);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_product_oems_supplier_product_id
  ON supplier_product_oems (supplier_product_id) WHERE is_active = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_product_oems_oem_code
  ON supplier_product_oems (oem_code) WHERE is_active = true;
```

## 5. Composite Indexes (common filter + sort patterns)

```sql
-- Manual review required before production execution.

-- Stock-aware sorting
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_stock_price_updated
  ON supplier_products (supplier_stock_qty > 0, supplier_price, updated_at DESC NULLS LAST);

-- Brand + stock filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_brand_stock
  ON supplier_products (supplier_brand, supplier_stock_qty);
```

## Notes

- `CONCURRENTLY` allows index creation without locking the table for writes.
- GIN trigram indexes are larger but dramatically speed up `%pattern%` searches.
- B-tree indexes are compact and ideal for exact/prefix matches and ordering.
- After creating indexes, run `ANALYZE supplier_products;` and `ANALYZE supplier_product_oems;` to update statistics.
- Monitor query plans with `EXPLAIN ANALYZE` to verify index usage.