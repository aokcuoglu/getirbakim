-- Add part_no column to ptdrk_products
-- Extracts part number from product_id and sku columns

-- 1. Add the column
ALTER TABLE v0.ptdrk_products ADD COLUMN IF NOT EXISTS part_no TEXT;

-- 2. Backfill from sku (most reliable source, 23K rows)
UPDATE v0.ptdrk_products
SET part_no = UPPER(
  CASE
    WHEN sku LIKE '%--%' THEN split_part(sku, '--', 2)
    WHEN sku LIKE '%-%' THEN substring(sku from position('-' in sku) + 1)
    ELSE sku
  END
)
WHERE sku IS NOT NULL;

-- 3. Add index for part_no lookups
CREATE INDEX IF NOT EXISTS idx_ptdrk_products_part_no ON v0.ptdrk_products (part_no);
