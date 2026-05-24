-- ==========================================
-- Consolidate dinamik + parcatedarik schemas
-- Move raw dinamik.* tables into parcatedarik schema
-- Create dinami̇k_parca_brand_aliases directly in parcatedarik
-- Move existing dinami̇k_parcatedarik_model_matches from public to parcatedarik
-- ==========================================

-- ------------------------------------------
-- 1. Move dinamik.products → parcatedarik.dinamik_products
-- ------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'dinamik' AND table_name = 'products'
  ) THEN
    ALTER TABLE dinamik.products SET SCHEMA parcatedarik;
    ALTER TABLE parcatedarik.products RENAME TO dinamik_products;
  END IF;
END $$;

-- ------------------------------------------
-- 2. Move dinamik.brands → parcatedarik.dinamik_brands
-- ------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'dinamik' AND table_name = 'brands'
  ) THEN
    ALTER TABLE dinamik.brands SET SCHEMA parcatedarik;
    ALTER TABLE parcatedarik.brands RENAME TO dinamik_brands;
  END IF;
END $$;

-- ------------------------------------------
-- 3. Move public.dinamik_parcatedarik_model_matches → parcatedarik
--    (this table already exists in public from migration 20260521000000)
-- ------------------------------------------
ALTER TABLE IF EXISTS public.dinamik_parcatedarik_model_matches
  SET SCHEMA parcatedarik;

-- ------------------------------------------
-- 4. Create dinamik_parca_brand_aliases directly in parcatedarik
--    (this table was never created in public, so we skip the move)
-- ------------------------------------------

-- Dinamik-ParcaTedarik Brand Alias Table
-- Maps Dinamik brands to ParcaTedarik manufacturers for model match disambiguation

CREATE TABLE IF NOT EXISTS parcatedarik.dinamik_parca_brand_aliases (
  id SERIAL PRIMARY KEY,
  dinamik_brand TEXT NOT NULL,
  normalized_dinamik_brand TEXT NOT NULL,
  parcatedarik_manufacturer_id INTEGER NOT NULL,
  normalized_pc_manufacturer TEXT NOT NULL,
  mapping_status TEXT NOT NULL DEFAULT 'PENDING',
  confidence NUMERIC(5,4) NOT NULL DEFAULT 0.8000,
  match_method TEXT NULL,
  approved_by TEXT NULL,
  approved_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Unique constraint: one alias per dinamik_brand + manufacturer pair
CREATE UNIQUE INDEX IF NOT EXISTS dpba_unique_brand_manufacturer
  ON parcatedarik.dinamik_parca_brand_aliases (dinamik_brand, parcatedarik_manufacturer_id);

-- Performance indexes
CREATE INDEX IF NOT EXISTS dpba_normalized_dinamik_brand
  ON parcatedarik.dinamik_parca_brand_aliases (normalized_dinamik_brand);
CREATE INDEX IF NOT EXISTS dpba_parcatedarik_manufacturer_id
  ON parcatedarik.dinamik_parca_brand_aliases (parcatedarik_manufacturer_id);
CREATE INDEX IF NOT EXISTS dpba_mapping_status
  ON parcatedarik.dinamik_parca_brand_aliases (mapping_status);
CREATE INDEX IF NOT EXISTS dpba_match_method
  ON parcatedarik.dinamik_parca_brand_aliases (match_method);

-- Add check constraint for allowed status values
ALTER TABLE parcatedarik.dinamik_parca_brand_aliases
  ADD CONSTRAINT dpba_status_check
  CHECK (mapping_status IN ('PENDING', 'APPROVED', 'REJECTED', 'IGNORED'));

-- Add check constraint for allowed match_method values
ALTER TABLE parcatedarik.dinamik_parca_brand_aliases
  ADD CONSTRAINT dpba_match_method_check
  CHECK (match_method IS NULL OR match_method IN ('EXACT_NORMALIZED', 'CASE_INSENSITIVE', 'NORMALIZED_BRAND_NAME', 'MANUAL'));

-- ------------------------------------------
-- 5. Update comments to reflect new schema
-- ------------------------------------------

-- dinamik_products and dinamik_brands
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'parcatedarik' AND table_name = 'dinamik_products'
  ) THEN
    COMMENT ON TABLE parcatedarik.dinamik_products IS 'Raw Dinamik supplier products (moved from dinamik.products)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'parcatedarik' AND table_name = 'dinamik_brands'
  ) THEN
    COMMENT ON TABLE parcatedarik.dinamik_brands IS 'Distinct Dinamik brand names (moved from dinamik.brands)';
  END IF;
END $$;

-- dinamik_parcatedarik_model_matches
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'parcatedarik' AND table_name = 'dinamik_parcatedarik_model_matches'
  ) THEN
    COMMENT ON TABLE parcatedarik.dinamik_parcatedarik_model_matches IS 'Maps Dinamik supplier products to ParcaTedarik products via barcode-to-normalized_model matching (moved from public)';
  END IF;
END $$;

-- dinamik_parca_brand_aliases comments
COMMENT ON TABLE parcatedarik.dinamik_parca_brand_aliases IS 'Maps Dinamik brands to ParcaTedarik manufacturers for model match disambiguation';
COMMENT ON COLUMN parcatedarik.dinamik_parca_brand_aliases.dinamik_brand IS 'Original brand name from Dinamik (dinamik.products.brand or dinamik.brands.brand)';
COMMENT ON COLUMN parcatedarik.dinamik_parca_brand_aliases.normalized_dinamik_brand IS 'Normalized Dinamik brand via normalizeModel() for lookup';
COMMENT ON COLUMN parcatedarik.dinamik_parca_brand_aliases.parcatedarik_manufacturer_id IS 'References parcatedarik.manufacturer.id';
COMMENT ON COLUMN parcatedarik.dinamik_parca_brand_aliases.normalized_pc_manufacturer IS 'Normalized ParcaTedarik manufacturer name via normalizeModel()';
COMMENT ON COLUMN parcatedarik.dinamik_parca_brand_aliases.mapping_status IS 'APPROVED = manually confirmed, PENDING = auto-seeded, REJECTED = confirmed non-match, IGNORED = skip';
COMMENT ON COLUMN parcatedarik.dinamik_parca_brand_aliases.confidence IS 'Match confidence score 0.0000-1.0000';
COMMENT ON COLUMN parcatedarik.dinamik_parca_brand_aliases.match_method IS 'How the match was created: EXACT_NORMALIZED, CASE_INSENSITIVE, NORMALIZED_BRAND_NAME, MANUAL';
