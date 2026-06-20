-- v0.products cleanup: trim text fields, normalize normalized_name consistently,
-- deduplicate by (brand_list_id, normalized_name), add CHECK constraint on status.

-- ==========================================
-- 1. Clean display_name: trim, collapse multi-space
-- ==========================================
UPDATE v0.products
SET display_name = TRIM(REGEXP_REPLACE(display_name, '\s+', ' ', 'g'))
WHERE display_name IS DISTINCT FROM TRIM(REGEXP_REPLACE(display_name, '\s+', ' ', 'g'));

-- ==========================================
-- 2. Recompute normalized_name consistently
--    Matches normalizeCode() behaviour from lib/matching/code-normalization.ts:
--    trim -> UPPER -> remove all whitespace -> remove -.\/
-- ==========================================
UPDATE v0.products
SET normalized_name = NULLIF(
  UPPER(
    REGEXP_REPLACE(
      REGEXP_REPLACE(TRIM(display_name), '\s+', '', 'g'),
      '[-./\\]', '', 'g'
    )
  ),
  ''
);

-- ==========================================
-- 3. Clean brand_name: trim, nullify empty
-- ==========================================
UPDATE v0.products
SET brand_name = NULLIF(TRIM(brand_name), '')
WHERE brand_name IS DISTINCT FROM NULLIF(TRIM(brand_name), '');

-- ==========================================
-- 4. Clean primary_image_url: trim, nullify empty
-- ==========================================
UPDATE v0.products
SET primary_image_url = NULLIF(TRIM(primary_image_url), '')
WHERE primary_image_url IS DISTINCT FROM NULLIF(TRIM(primary_image_url), '');

-- ==========================================
-- 5. Clean status: trim, default invalid to ACTIVE
-- ==========================================
UPDATE v0.products
SET status = 'ACTIVE'
WHERE status IS NULL
   OR TRIM(status) = ''
   OR TRIM(status) NOT IN ('ACTIVE', 'INACTIVE');

UPDATE v0.products
SET status = TRIM(status)
WHERE status IS DISTINCT FROM TRIM(status);

-- ==========================================
-- 6. Dedup: same (brand_list_id, normalized_name)
--    Keep lowest id, reassign children, delete duplicates.
--    Conflicts on unique child constraints are resolved by removing
--    the duplicate's conflicting row before reassigning.
-- ==========================================
WITH dup_groups AS (
  SELECT brand_list_id, normalized_name, MIN(id) AS keep_id
  FROM v0.products
  WHERE brand_list_id IS NOT NULL AND normalized_name IS NOT NULL
  GROUP BY brand_list_id, normalized_name
  HAVING COUNT(*) > 1
),
dup_ids AS (
  SELECT p.id AS dup_id, dg.keep_id
  FROM v0.products p
  JOIN dup_groups dg
    ON dg.brand_list_id IS NOT DISTINCT FROM p.brand_list_id
   AND dg.normalized_name IS NOT DISTINCT FROM p.normalized_name
  WHERE p.id != dg.keep_id
),
-- product_sources: no unique conflict risk on v0_product_id alone
reassign_sources AS (
  UPDATE v0.product_sources ps
  SET v0_product_id = di.keep_id
  FROM dup_ids di
  WHERE ps.v0_product_id = di.dup_id
),
-- product_code_signals: unique on (v0_product_id,source_type,source_record_id,normalized_code,origin)
rm_code_signals AS (
  DELETE FROM v0.product_code_signals pcs
  USING dup_ids di
  WHERE pcs.v0_product_id = di.dup_id
    AND EXISTS (
      SELECT 1 FROM v0.product_code_signals existing
      WHERE existing.v0_product_id = di.keep_id
        AND existing.source_type = pcs.source_type
        AND existing.source_record_id = pcs.source_record_id
        AND existing.normalized_code = pcs.normalized_code
        AND existing.origin = pcs.origin
    )
),
reassign_code_signals AS (
  UPDATE v0.product_code_signals pcs
  SET v0_product_id = di.keep_id
  FROM dup_ids di
  WHERE pcs.v0_product_id = di.dup_id
),
-- product_public_part_links: unique on (v0_product_id, part_id)
rm_pp_links AS (
  DELETE FROM v0.product_public_part_links ppl
  USING dup_ids di
  WHERE ppl.v0_product_id = di.dup_id
    AND EXISTS (
      SELECT 1 FROM v0.product_public_part_links existing
      WHERE existing.v0_product_id = di.keep_id
        AND existing.part_id = ppl.part_id
    )
),
reassign_pp_links AS (
  UPDATE v0.product_public_part_links ppl
  SET v0_product_id = di.keep_id
  FROM dup_ids di
  WHERE ppl.v0_product_id = di.dup_id
),
-- products_oems: unique on (v0_product_id, oem_no)
rm_oems AS (
  DELETE FROM v0.products_oems po
  USING dup_ids di
  WHERE po.v0_product_id = di.dup_id
    AND EXISTS (
      SELECT 1 FROM v0.products_oems existing
      WHERE existing.v0_product_id = di.keep_id
        AND existing.oem_no = po.oem_no
    )
),
reassign_oems AS (
  UPDATE v0.products_oems po
  SET v0_product_id = di.keep_id
  FROM dup_ids di
  WHERE po.v0_product_id = di.dup_id
)
DELETE FROM v0.products p
USING dup_ids di
WHERE p.id = di.dup_id;

-- ==========================================
-- 7. Add CHECK constraint on status
-- ==========================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'v0' AND constraint_name = 'products_status_check'
  ) THEN
    ALTER TABLE v0.products
    ADD CONSTRAINT products_status_check
    CHECK (status IN ('ACTIVE', 'INACTIVE'));
  END IF;
END $$;
