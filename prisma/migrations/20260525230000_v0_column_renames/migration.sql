-- Align v0 FK column names with renamed tables (ptbrands, ptproducts).

-- 1) dbrands_match.manufacturer_id → ptbrands_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'v0' AND table_name = 'dbrands_match' AND column_name = 'manufacturer_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'v0' AND table_name = 'dbrands_match' AND column_name = 'ptbrands_id'
  ) THEN
    ALTER TABLE v0.dbrands_match RENAME COLUMN manufacturer_id TO ptbrands_id;
  END IF;
END $$;

-- 2) dpmatch.product_id → ptproducts_id (FK to ptproducts.id)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'v0' AND table_name = 'dpmatch' AND column_name = 'product_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'v0' AND table_name = 'dpmatch' AND column_name = 'ptproducts_id'
  ) THEN
    ALTER TABLE v0.dpmatch RENAME COLUMN product_id TO ptproducts_id;
  END IF;
END $$;

-- 3) ptproducts.manufacturer_id → ptbrands_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'v0' AND table_name = 'ptproducts' AND column_name = 'manufacturer_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'v0' AND table_name = 'ptproducts' AND column_name = 'ptbrands_id'
  ) THEN
    ALTER TABLE v0.ptproducts RENAME COLUMN manufacturer_id TO ptbrands_id;
  END IF;
END $$;

-- 4) Rename indexes (no-ops if already renamed)
ALTER INDEX IF EXISTS v0.idx_dbrands_match_manufacturer RENAME TO idx_dbrands_match_ptbrands;
ALTER INDEX IF EXISTS v0.idx_dbrands_match_manufacturer_status RENAME TO idx_dbrands_match_ptbrands_status;
ALTER INDEX IF EXISTS v0.idx_dpmatch_product RENAME TO idx_dpmatch_ptproducts;
ALTER INDEX IF EXISTS v0.uq_dpmatch_product_id RENAME TO uq_dpmatch_ptproducts_id;
ALTER INDEX IF EXISTS v0.manufacturer_name_trgm RENAME TO ptbrands_name_trgm;
ALTER INDEX IF EXISTS v0.product_title_trgm RENAME TO ptproducts_title_trgm;
ALTER INDEX IF EXISTS v0.idx_parcatedarik_products_model RENAME TO idx_ptproducts_model;
ALTER INDEX IF EXISTS v0.idx_parcatedarik_products_normalized_model RENAME TO idx_ptproducts_normalized_model;
ALTER INDEX IF EXISTS v0.ptproducts_manufacturer_id_idx RENAME TO idx_ptproducts_ptbrands_id;
ALTER INDEX IF EXISTS v0.product_manufacturer_id_idx RENAME TO idx_ptproducts_ptbrands_id;

-- 5) Rename unique constraints
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_dbrands_match_brand_mfr'
      AND conrelid = 'v0.dbrands_match'::regclass
  ) THEN
    ALTER TABLE v0.dbrands_match
      RENAME CONSTRAINT uq_dbrands_match_brand_mfr TO uq_dbrands_match_brand_ptbrands;
  END IF;
END $$;

-- 6) Rename FK constraints for clarity
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dbrands_match_manufacturer_id_fkey') THEN
    ALTER TABLE v0.dbrands_match
      RENAME CONSTRAINT dbrands_match_manufacturer_id_fkey TO dbrands_match_ptbrands_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dpmatch_product_id_fkey') THEN
    ALTER TABLE v0.dpmatch
      RENAME CONSTRAINT dpmatch_product_id_fkey TO dpmatch_ptproducts_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ptproducts_manufacturer_id_fkey') THEN
    ALTER TABLE v0.ptproducts
      RENAME CONSTRAINT ptproducts_manufacturer_id_fkey TO ptproducts_ptbrands_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_manufacturer_id_fkey') THEN
    ALTER TABLE v0.ptproducts
      RENAME CONSTRAINT product_manufacturer_id_fkey TO ptproducts_ptbrands_id_fkey;
  END IF;
END $$;

COMMENT ON COLUMN v0.dbrands_match.ptbrands_id IS 'FK → v0.ptbrands.id (ParcaTedarik marka)';
COMMENT ON COLUMN v0.dpmatch.ptproducts_id IS 'FK → v0.ptproducts.id (ParcaTedarik ürün)';
COMMENT ON COLUMN v0.ptproducts.ptbrands_id IS 'FK → v0.ptbrands.id (ParcaTedarik marka)';
