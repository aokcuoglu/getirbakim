-- Normalize all normalized_brand values to UPPERCASE and add a trigger to enforce it.

-- 1. Merge duplicates that will collide after UPPER()
--    If two normalized_brand values differ only in case, e.g. 'Aksa' vs 'AKSA',
--    merge them into one canonical row (keeping the lower id).
WITH duplicates AS (
  SELECT
    UPPER(BTRIM(normalized_brand)) AS upper_brand,
    MIN(id) AS keeper_id
  FROM v0.dnmk_ptdrk_brands
  GROUP BY UPPER(BTRIM(normalized_brand))
  HAVING COUNT(*) > 1
),
to_merge AS (
  SELECT
    cb.id AS victim_id,
    d.keeper_id
  FROM v0.dnmk_ptdrk_brands cb
  JOIN duplicates d ON UPPER(BTRIM(cb.normalized_brand)) = d.upper_brand AND cb.id <> d.keeper_id
)
UPDATE v0.dnmk_ptdrk_brand_mappings
SET dnmk_ptdrk_brands_id = tm.keeper_id
FROM to_merge tm
WHERE dnmk_ptdrk_brands_id = tm.victim_id;

-- Delete the duplicate canonical rows
DELETE FROM v0.dnmk_ptdrk_brands
WHERE id IN (
  SELECT cb.id
  FROM v0.dnmk_ptdrk_brands cb
  JOIN (
    SELECT UPPER(BTRIM(normalized_brand)) AS upper_brand, MIN(id) AS keeper_id
    FROM v0.dnmk_ptdrk_brands
    GROUP BY UPPER(BTRIM(normalized_brand))
    HAVING COUNT(*) > 1
  ) d ON UPPER(BTRIM(cb.normalized_brand)) = d.upper_brand AND cb.id <> d.keeper_id
);

-- Also deduplicate mapping rows that now collide after merging
DELETE FROM v0.dnmk_ptdrk_brand_mappings a
WHERE a.id > (
  SELECT MIN(b.id)
  FROM v0.dnmk_ptdrk_brand_mappings b
  WHERE b.dnmk_ptdrk_brands_id = a.dnmk_ptdrk_brands_id
    AND b.dnmk_brands_id IS NOT DISTINCT FROM a.dnmk_brands_id
    AND b.ptdrk_brands_id IS NOT DISTINCT FROM a.ptdrk_brands_id
    AND b.bsbg_brands_id IS NOT DISTINCT FROM a.bsbg_brands_id
);

-- 2. Update all existing normalized_brand values to UPPER(BTRIM(...))
UPDATE v0.dnmk_ptdrk_brands
SET normalized_brand = UPPER(BTRIM(normalized_brand));

-- 3. Drop old unique constraint and index, recreate for uppercase
ALTER TABLE v0.dnmk_ptdrk_brands DROP CONSTRAINT IF EXISTS uq_dpbrands_normalized;
DROP INDEX IF EXISTS v0.idx_dpbrands_normalized_brand;

-- 4. Add BTRIM + UPPER trigger to enforce uppercase on insert/update
CREATE OR REPLACE FUNCTION v0.enforce_uppercase_normalized_brand()
RETURNS TRIGGER AS $$
BEGIN
  NEW.normalized_brand = UPPER(BTRIM(NEW.normalized_brand));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_uppercase_normalized_brand ON v0.dnmk_ptdrk_brands;

CREATE TRIGGER trg_enforce_uppercase_normalized_brand
  BEFORE INSERT OR UPDATE ON v0.dnmk_ptdrk_brands
  FOR EACH ROW EXECUTE FUNCTION v0.enforce_uppercase_normalized_brand();

-- 5. Recreate unique constraint and index
ALTER TABLE v0.dnmk_ptdrk_brands ADD CONSTRAINT uq_dpbrands_normalized UNIQUE (normalized_brand);
CREATE INDEX idx_dpbrands_normalized_brand ON v0.dnmk_ptdrk_brands(normalized_brand);