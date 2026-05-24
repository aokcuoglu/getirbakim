-- Enable pg_trgm extension for ILIKE '%search%' performance
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- pg_trgm GIN indexes for ILIKE searches on brand aliases
CREATE INDEX IF NOT EXISTS idx_dbrands_match_dbrands_id_trgm
  ON parcatedarik.dbrands_match USING GIN (dbrands_id gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_dbrands_match_normalized_trgm
  ON parcatedarik.dbrands_match USING GIN (normalized gin_trgm_ops);

-- pg_trgm GIN indexes for ILIKE searches on Dinamik products
CREATE INDEX IF NOT EXISTS dproducts_stock_code_trgm
  ON parcatedarik.dproducts USING GIN (stock_code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS dproducts_stock_name_trgm
  ON parcatedarik.dproducts USING GIN (stock_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS dproducts_brand_trgm
  ON parcatedarik.dproducts USING GIN (brand gin_trgm_ops);

CREATE INDEX IF NOT EXISTS dproducts_barcode_1_trgm
  ON parcatedarik.dproducts USING GIN (barcode_1 gin_trgm_ops);

CREATE INDEX IF NOT EXISTS dproducts_barcode_2_trgm
  ON parcatedarik.dproducts USING GIN (barcode_2 gin_trgm_ops);

CREATE INDEX IF NOT EXISTS dproducts_barcode_3_trgm
  ON parcatedarik.dproducts USING GIN (barcode_3 gin_trgm_ops);

-- pg_trgm GIN indexes for ILIKE searches on ParcaTedarik
CREATE INDEX IF NOT EXISTS manufacturer_name_trgm
  ON parcatedarik.manufacturer USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS product_title_trgm
  ON parcatedarik.product USING GIN (title gin_trgm_ops);

-- Composite index for fast EXISTS subquery on brand-approved filters
CREATE INDEX IF NOT EXISTS idx_dbrands_match_manufacturer_status
  ON parcatedarik.dbrands_match (manufacturer_id, mapping_status);
