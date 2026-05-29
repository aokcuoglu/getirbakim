ALTER TABLE v0.ptdrk_products ADD COLUMN IF NOT EXISTS part_no_matches_model BOOLEAN;

-- product_model column does not exist in current schema; default to NULL until data source provides it
UPDATE v0.ptdrk_products
SET part_no_matches_model = NULL
WHERE part_no_matches_model IS DISTINCT FROM NULL;
