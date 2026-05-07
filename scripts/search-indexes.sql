-- Catalog + Offer Search Index Recommendations
-- Run with CONCURRENTLY to avoid locking
-- Run one at a time during low-traffic periods

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sp_normalized_sku_trgm
  ON supplier_products USING gin (normalized_sku gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sp_normalized_name_trgm
  ON supplier_products USING gin (normalized_name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sp_supplier_brand_trgm
  ON supplier_products USING gin (supplier_brand gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sp_barcode_1
  ON supplier_products (barcode_1) WHERE barcode_1 IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sp_barcode_2
  ON supplier_products (barcode_2) WHERE barcode_2 IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_spo_normalized_oem_code_trgm
  ON supplier_product_oems USING gin (normalized_oem_code gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_spo_active_normalized
  ON supplier_product_oems (is_active, normalized_oem_code) WHERE is_active = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_spm_status_part
  ON supplier_part_mappings (status, part_id) WHERE status = 'APPROVED';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_spm_status_provider_product
  ON supplier_part_mappings (status, provider_id, supplier_product_id) WHERE status = 'APPROVED';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_parts_name_trgm
  ON parts USING gin (name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_part_brands_name_trgm
  ON part_brands USING gin (name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pi_sellable
  ON part_pricing_inventory (part_id, computed_selling_price_ex_vat, supplier_stock_qty)
  WHERE computed_selling_price_ex_vat IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pe_code_trgm
  ON part_eans USING gin (code gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_po_code_trgm
  ON part_oens USING gin (code gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pcr_article_number_trgm
  ON part_cross_references USING gin (article_number gin_trgm_ops);