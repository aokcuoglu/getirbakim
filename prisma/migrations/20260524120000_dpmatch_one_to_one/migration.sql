-- Enforce one dpmatch row per dproducts_id and per product_id.
-- Removes duplicate placeholder + matched pairs (e.g. dproducts_id=840 twice).

ALTER TABLE parcatedarik.dpmatch
  ALTER COLUMN dproducts_id DROP NOT NULL,
  ALTER COLUMN product_id DROP NOT NULL;

-- Drop composite unique; NULL product_id rows made duplicates possible.
ALTER TABLE parcatedarik.dpmatch
  DROP CONSTRAINT IF EXISTS uq_dpmatch_dproduct_product;

-- Keep best row per dproducts_id (matched > placeholder, APPROVED > PENDING).
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY dproducts_id
      ORDER BY
        CASE WHEN product_id IS NOT NULL THEN 0 ELSE 1 END,
        CASE mapping_status
          WHEN 'APPROVED' THEN 0
          WHEN 'PENDING' THEN 1
          WHEN 'REJECTED' THEN 2
          WHEN 'IGNORED' THEN 3
          ELSE 4
        END,
        id DESC
    ) AS rn
  FROM parcatedarik.dpmatch
  WHERE dproducts_id IS NOT NULL
)
DELETE FROM parcatedarik.dpmatch d
USING ranked r
WHERE d.id = r.id
  AND r.rn > 1;

-- Keep best row per product_id (matched > orphan PT row).
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY product_id
      ORDER BY
        CASE WHEN dproducts_id IS NOT NULL THEN 0 ELSE 1 END,
        CASE mapping_status
          WHEN 'APPROVED' THEN 0
          WHEN 'PENDING' THEN 1
          WHEN 'REJECTED' THEN 2
          WHEN 'IGNORED' THEN 3
          ELSE 4
        END,
        id DESC
    ) AS rn
  FROM parcatedarik.dpmatch
  WHERE product_id IS NOT NULL
)
DELETE FROM parcatedarik.dpmatch d
USING ranked r
WHERE d.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dpmatch_dproducts_id
  ON parcatedarik.dpmatch (dproducts_id)
  WHERE dproducts_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dpmatch_product_id
  ON parcatedarik.dpmatch (product_id)
  WHERE product_id IS NOT NULL;
