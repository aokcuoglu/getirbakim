-- v0 schema: rename generic/ambiguous columns for clarity

-- 1. dpmatch.normalized → dpmatch.normalized_name
ALTER TABLE v0.dpmatch RENAME COLUMN normalized TO normalized_name;
DROP INDEX IF EXISTS v0.idx_dpmatch_normalized;
CREATE INDEX idx_dpmatch_normalized_name ON v0.dpmatch (normalized_name) WHERE normalized_name IS NOT NULL;
COMMENT ON COLUMN v0.dpmatch.normalized_name IS 'Normalized product name derived from linked dproduct/ptproduct';

-- 2. dbrands_match.normalized → dbrands_match.normalized_brand
ALTER TABLE v0.dbrands_match RENAME COLUMN normalized TO normalized_brand;
DROP INDEX IF EXISTS v0.idx_dbrands_match_normalized;
CREATE INDEX idx_dbrands_match_normalized_brand ON v0.dbrands_match (normalized_brand) WHERE normalized_brand IS NOT NULL;
COMMENT ON COLUMN v0.dbrands_match.normalized_brand IS 'Normalized brand name for matching';

-- 3. ptproducts.model → ptproducts.product_model
ALTER TABLE v0.ptproducts RENAME COLUMN model TO product_model;
DROP INDEX IF EXISTS v0.idx_ptproducts_model;
DROP INDEX IF EXISTS v0.idx_ptproducts_model_norm;
CREATE INDEX idx_ptproducts_product_model ON v0.ptproducts (product_model) WHERE product_model IS NOT NULL;
CREATE INDEX idx_ptproducts_product_model_norm ON v0.ptproducts (upper(regexp_replace(product_model, '[^a-z0-9]', '', 'gi'))) WHERE product_model IS NOT NULL AND btrim(product_model) <> '';
COMMENT ON COLUMN v0.ptproducts.product_model IS 'Product model/variant info from parcatedarik.com';

-- 4. ptproducts.price → ptproducts.price_list
ALTER TABLE v0.ptproducts RENAME COLUMN price TO price_list;
COMMENT ON COLUMN v0.ptproducts.price_list IS 'List price (price_list from parcatedarik.com)';

-- 5. dproduct_details.stock_code → drop (redundant with dproducts.stock_code)
DROP INDEX IF EXISTS v0.dproduct_details_stock_code_idx;
ALTER TABLE v0.dproduct_details DROP COLUMN IF EXISTS stock_code;