-- Add sku and price_actual to v0.ptproducts (approved parcatedarik scrape format).
-- price_list continues to map to existing price column (numeric(10,2)).

ALTER TABLE v0.ptproducts
  ADD COLUMN IF NOT EXISTS sku TEXT,
  ADD COLUMN IF NOT EXISTS price_actual NUMERIC(10, 2);

CREATE INDEX IF NOT EXISTS idx_ptproducts_sku ON v0.ptproducts (sku);

COMMENT ON COLUMN v0.ptproducts.sku IS 'ParcaTedarik SKU (e.g. 3rg-10109)';
COMMENT ON COLUMN v0.ptproducts.price IS 'List price (price_list from parcatedarik.com)';
COMMENT ON COLUMN v0.ptproducts.price_actual IS 'Actual/sale price from parcatedarik.com';
