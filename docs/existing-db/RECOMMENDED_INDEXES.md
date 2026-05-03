# Recommended Indexes for Catalog Search Performance

**Status:** Manual review required — Do NOT run these automatically on production.

These indexes are recommended to improve catalog search performance for the v0.3.1 search features.

## Existing Indexes (Already in place)

These indexes already exist on the `supplier_products` table:

- `idx_supplier_products_search_trgm` — GIN trigram on concatenated searchable fields (SKU + name + brand + barcodes)
- `idx_supplier_products_supplier_sku_trgm` — GIN trigram on `supplier_sku`
- `supplier_products_supplier_sku_idx` — B-tree on `supplier_sku`
- `idx_supplier_products_supplier_brand` — B-tree on `supplier_brand`
- `idx_supplier_products_provider_sku` — B-tree on `(provider_id, supplier_sku)`
- `idx_supplier_products_provider_updated_at` — B-tree on `(provider_id, updated_at DESC)`
- `idx_supplier_products_provider_brand_updated_at` — B-tree on `(provider_id, supplier_brand, updated_at DESC)`
- `idx_supplier_products_sku_lower` — B-tree on `lower(supplier_sku)`

## Existing Indexes on `supplier_product_oems`

- `idx_supplier_product_oems_normalized_oem_code` — B-tree on `normalized_oem_code`
- `idx_supplier_product_oems_provider_normalized_oem_code` — B-tree on `(provider_id, normalized_oem_code)`
- `idx_supplier_product_oems_supplier_product_id` — B-tree on `supplier_product_id`

## Recommended New Indexes

### 1. GIN trigram on `normalized_sku`

Improves fuzzy/prefix search on normalized SKU codes.

```sql
-- Manual review required
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_normalized_sku_trgm
ON public.supplier_products USING gin (normalized_sku gin_trgm_ops);
```

### 2. GIN trigram on `supplier_name`

Improves free-text search on product names/descriptions.

```sql
-- Manual review required
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_supplier_name_trgm
ON public.supplier_products USING gin (supplier_name gin_trgm_ops);
```

### 3. GIN trigram on `normalized_oem_code`

Improves OEM number fuzzy search in `supplier_product_oems`.

```sql
-- Manual review required
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_product_oems_oem_code_trgm
ON public.supplier_product_oems USING gin (normalized_oem_code gin_trgm_ops);
```

### 4. Composite index for stock + price filtering

Improves queries that filter by stock status and sort by price.

```sql
-- Manual review required
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_stock_price
ON public.supplier_products (supplier_stock_qty, supplier_price);
```

### 5. Composite index for brand + stock filtering

Improves queries that filter by brand and stock status.

```sql
-- Manual review required
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_brand_stock
ON public.supplier_products (supplier_brand, supplier_stock_qty);
```

## Notes

- All recommended indexes use `CONCURRENTLY` to avoid locking the table during creation.
- The existing trigram index on concatenated fields (`idx_supplier_products_search_trgm`) already covers many search scenarios, but individual column trigram indexes can help with column-specific queries.
- `pg_trgm` extension is already installed on the database.
- The OEM table is relatively small (2,879 rows), so index impact is limited, but will grow as more OEM data is added.
- Always test index performance on a staging/database replica before applying to production.