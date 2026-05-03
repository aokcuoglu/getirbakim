-- getirbakim v0.3.3 — Search Index Optimization
-- Additive only. No destructive statements.
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction.
-- Execute each statement individually.

-- 1. pg_trgm extension (required for GIN trigram indexes)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. GIN trigram indexes for ILIKE '%pattern%' acceleration
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_normalized_name_trgm
  ON supplier_products USING gin (normalized_name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_supplier_name_trgm
  ON supplier_products USING gin (supplier_name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_supplier_brand_trgm
  ON supplier_products USING gin (supplier_brand gin_trgm_ops);

-- 3. B-tree indexes for exact match, prefix, and ordering
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

-- 4. OEM table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_product_oems_normalized_oem_code
  ON supplier_product_oems (normalized_oem_code);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_product_oems_supplier_product_id
  ON supplier_product_oems (supplier_product_id) WHERE is_active = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_product_oems_oem_code
  ON supplier_product_oems (oem_code) WHERE is_active = true;

-- 5. Update statistics after index creation
ANALYZE supplier_products;
ANALYZE supplier_product_oems;