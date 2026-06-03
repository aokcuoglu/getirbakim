-- Catalog + Offer Search Index Recommendations
-- Run with CONCURRENTLY to avoid locking
-- Run one at a time during low-traffic periods

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_parts_name_trgm
  ON parts USING gin (name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_part_brands_name_trgm
  ON part_brands USING gin (name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pe_code_trgm
  ON part_eans USING gin (code gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_po_code_trgm
  ON part_oens USING gin (code gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pcr_article_number_trgm
  ON part_cross_references USING gin (article_number gin_trgm_ops);