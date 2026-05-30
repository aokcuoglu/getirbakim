-- Rename v0 schema tables to shorter meaningful names
-- dnmk_ptdrk_brand_mappings -> brand_mappings
-- dnmk_ptdrk_brands -> brand_list
-- dnmk_ptdrk_products -> product_list

ALTER TABLE v0.dnmk_ptdrk_brand_mappings RENAME TO brand_mappings;
ALTER TABLE v0.dnmk_ptdrk_brands RENAME TO brand_list;
ALTER TABLE v0.dnmk_ptdrk_products RENAME TO product_list;

-- Recreate trigger on renamed brand_list table
DROP TRIGGER IF EXISTS trg_enforce_uppercase_normalized_brand ON v0.brand_list;
CREATE TRIGGER trg_enforce_uppercase_normalized_brand
  BEFORE INSERT OR UPDATE ON v0.brand_list
  FOR EACH ROW EXECUTE FUNCTION v0.enforce_uppercase_normalized_brand();
