-- Add part_no column to bsbg_products
-- Splits malzeme_no (e.g. "BCH 0242129515" → part_no = "0242129515")

-- 1. Add the column
ALTER TABLE v0.bsbg_products ADD COLUMN IF NOT EXISTS part_no TEXT;

-- 2. Backfill existing rows — split by space, take the part after
UPDATE v0.bsbg_products
SET part_no = split_part(malzeme_no, ' ', 2)
WHERE malzeme_no LIKE '% %';

-- 3. Add index for part_no lookups
CREATE INDEX IF NOT EXISTS idx_bsbg_products_part_no ON v0.bsbg_products (part_no);
