-- Simplify dproducts: dbrands_id FK, drop query_brand/brand/price/english_name.
-- Idempotent + batched backfill to avoid Supabase statement_timeout (~120s).

SET statement_timeout = 0;
SET lock_timeout = 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'parcatedarik'
      AND table_name = 'dproducts'
      AND column_name = 'query_brand'
  ) THEN
    RETURN;
  END IF;

  -- Ensure every product row can resolve a dbrands parent.
  INSERT INTO parcatedarik.dbrands (brand)
  SELECT DISTINCT BTRIM(p.query_brand)
  FROM parcatedarik.dproducts p
  WHERE p.query_brand IS NOT NULL
    AND BTRIM(p.query_brand) <> ''
    AND NOT EXISTS (
      SELECT 1 FROM parcatedarik.dbrands b WHERE b.brand = BTRIM(p.query_brand)
    )
  ON CONFLICT (brand) DO NOTHING;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'parcatedarik'
      AND table_name = 'dproducts'
      AND column_name = 'brand'
  ) THEN
    INSERT INTO parcatedarik.dbrands (brand)
    SELECT DISTINCT BTRIM(p.brand)
    FROM parcatedarik.dproducts p
    WHERE p.brand IS NOT NULL
      AND BTRIM(p.brand) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM parcatedarik.dbrands b WHERE b.brand = BTRIM(p.brand)
      )
    ON CONFLICT (brand) DO NOTHING;
  END IF;
END $$;

ALTER TABLE parcatedarik.dproducts
  ADD COLUMN IF NOT EXISTS dbrands_id BIGINT;

-- Batched backfill: query_brand → dbrands_id
DO $$
DECLARE
  batch_size int := 50000;
  rows_updated int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'parcatedarik'
      AND table_name = 'dproducts'
      AND column_name = 'query_brand'
  ) THEN
    RETURN;
  END IF;

  LOOP
    WITH batch AS (
      SELECT p.ctid
      FROM parcatedarik.dproducts p
      INNER JOIN parcatedarik.dbrands b ON b.brand = BTRIM(p.query_brand)
      WHERE p.dbrands_id IS NULL
        AND p.query_brand IS NOT NULL
        AND BTRIM(p.query_brand) <> ''
      LIMIT batch_size
    )
    UPDATE parcatedarik.dproducts p
    SET dbrands_id = b.id
    FROM parcatedarik.dbrands b, batch
    WHERE p.ctid = batch.ctid
      AND b.brand = BTRIM(p.query_brand);

    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    EXIT WHEN rows_updated = 0;
  END LOOP;
END $$;

-- Batched backfill: legacy brand string → dbrands_id
DO $$
DECLARE
  batch_size int := 50000;
  rows_updated int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'parcatedarik'
      AND table_name = 'dproducts'
      AND column_name = 'brand'
  ) THEN
    RETURN;
  END IF;

  LOOP
    WITH batch AS (
      SELECT p.ctid
      FROM parcatedarik.dproducts p
      INNER JOIN parcatedarik.dbrands b ON b.brand = BTRIM(p.brand)
      WHERE p.dbrands_id IS NULL
        AND p.brand IS NOT NULL
        AND BTRIM(p.brand) <> ''
      LIMIT batch_size
    )
    UPDATE parcatedarik.dproducts p
    SET dbrands_id = b.id
    FROM parcatedarik.dbrands b, batch
    WHERE p.ctid = batch.ctid
      AND b.brand = BTRIM(p.brand);

    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    EXIT WHEN rows_updated = 0;
  END LOOP;
END $$;

DELETE FROM parcatedarik.dproducts WHERE dbrands_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'parcatedarik'
      AND table_name = 'dproducts'
      AND column_name = 'dbrands_id'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE parcatedarik.dproducts
      ALTER COLUMN dbrands_id SET NOT NULL;
  END IF;
END $$;

ALTER TABLE parcatedarik.dproducts
  DROP CONSTRAINT IF EXISTS products_query_brand_stock_code_key;

DROP INDEX IF EXISTS parcatedarik.products_query_brand_stock_code_key;
DROP INDEX IF EXISTS parcatedarik.idx_dinamik_products_query_brand_updated_at;
DROP INDEX IF EXISTS parcatedarik.idx_products_query_brand;
DROP INDEX IF EXISTS parcatedarik.idx_dinamik_products_search_trgm;
DROP INDEX IF EXISTS parcatedarik.dproducts_brand_trgm;
DROP INDEX IF EXISTS parcatedarik.idx_products_brand;

ALTER TABLE parcatedarik.dproducts
  DROP COLUMN IF EXISTS query_brand,
  DROP COLUMN IF EXISTS brand,
  DROP COLUMN IF EXISTS price,
  DROP COLUMN IF EXISTS english_name;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dproducts_dbrands_stock_code
  ON parcatedarik.dproducts (dbrands_id, stock_code);

CREATE INDEX IF NOT EXISTS idx_dproducts_dbrands_id
  ON parcatedarik.dproducts (dbrands_id);

ALTER TABLE parcatedarik.dproducts
  DROP CONSTRAINT IF EXISTS dproducts_dbrands_id_fkey;

ALTER TABLE parcatedarik.dproducts
  ADD CONSTRAINT dproducts_dbrands_id_fkey
  FOREIGN KEY (dbrands_id) REFERENCES parcatedarik.dbrands (id) ON DELETE RESTRICT;

DROP INDEX IF EXISTS parcatedarik.idx_dproducts_query_brand_passive;
CREATE INDEX IF NOT EXISTS idx_dproducts_dbrands_id_passive
  ON parcatedarik.dproducts (dbrands_id, is_passive);
