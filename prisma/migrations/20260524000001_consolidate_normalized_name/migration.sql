-- Add consolidated normalized_name column
ALTER TABLE parcatedarik.dbrands_match
ADD COLUMN normalized_name TEXT;

-- Backfill: prefer normalized_dinamik_brand, fallback to normalized_pc_manufacturer
UPDATE parcatedarik.dbrands_match
SET normalized_name = COALESCE(
  NULLIF(normalized_dinamik_brand, ''),
  normalized_pc_manufacturer
);

-- Drop old index on normalized_dinamik_brand
DROP INDEX IF EXISTS parcatedarik.dpba_normalized_dinamik_brand;

-- Add index on normalized_name
CREATE INDEX dpba_normalized_name ON parcatedarik.dbrands_match (normalized_name);
