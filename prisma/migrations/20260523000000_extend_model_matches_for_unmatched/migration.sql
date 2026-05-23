-- Extend dinamik_parcatedarik_model_matches for PT_UNMATCHED and manual matching

-- Make dinamik_product_id nullable (for PT_UNMATCHED rows)
ALTER TABLE public.dinamik_parcatedarik_model_matches
  ALTER COLUMN dinamik_product_id DROP NOT NULL;

-- Add denormalized Dinamik product fields for manual matching
ALTER TABLE public.dinamik_parcatedarik_model_matches
  ADD COLUMN IF NOT EXISTS dinamik_stock_code TEXT NULL,
  ADD COLUMN IF NOT EXISTS dinamik_brand TEXT NULL,
  ADD COLUMN IF NOT EXISTS dinamik_product_name TEXT NULL;

-- Update default values for PT_UNMATCHED rows
ALTER TABLE public.dinamik_parcatedarik_model_matches
  ALTER COLUMN dinamik_barcode_field SET DEFAULT 'none',
  ALTER COLUMN dinamik_barcode_value SET DEFAULT '',
  ALTER COLUMN normalized_barcode_value SET DEFAULT '';

-- Update status CHECK constraint
ALTER TABLE public.dinamik_parcatedarik_model_matches
  DROP CONSTRAINT dpmm_status_check;
ALTER TABLE public.dinamik_parcatedarik_model_matches
  ADD CONSTRAINT dpmm_status_check
  CHECK (status IN ('CANDIDATE', 'APPROVED', 'REJECTED', 'NEEDS_REVIEW', 'IGNORED', 'PT_UNMATCHED', 'MANUAL_MATCH'));

-- Add match_reason CHECK constraint
ALTER TABLE public.dinamik_parcatedarik_model_matches
  ADD CONSTRAINT dpmm_match_reason_check
  CHECK (match_reason IN ('BARCODE_1_MODEL_EXACT', 'BARCODE_2_MODEL_EXACT', 'BARCODE_3_MODEL_EXACT', 'MULTIPLE_PARCA_MODEL_MATCHES', 'PT_UNMATCHED', 'MANUAL_MATCH', 'BRAND_ALIAS_DISAMBIGUATED'));

-- Add indexes for new columns
CREATE INDEX IF NOT EXISTS dpmm_dinamik_brand
  ON public.dinamik_parcatedarik_model_matches (dinamik_brand);
CREATE INDEX IF NOT EXISTS dpmm_dinamik_stock_code
  ON public.dinamik_parcatedarik_model_matches (dinamik_stock_code);

-- Partial unique index: prevent duplicate PT_UNMATCHED rows for same parcatedarik_product_id
CREATE UNIQUE INDEX IF NOT EXISTS dpmm_pt_unmatched_unique
  ON public.dinamik_parcatedarik_model_matches (parcatedarik_product_id)
  WHERE dinamik_product_id IS NULL;

-- Comments
COMMENT ON COLUMN public.dinamik_parcatedarik_model_matches.dinamik_product_id IS 'References dinamik.products.id (NULL for PT_UNMATCHED rows)';
COMMENT ON COLUMN public.dinamik_parcatedarik_model_matches.dinamik_stock_code IS 'Dinamik stock_code / SKU (denormalized for manual matching)';
COMMENT ON COLUMN public.dinamik_parcatedarik_model_matches.dinamik_brand IS 'Dinamik brand (denormalized for manual matching)';
COMMENT ON COLUMN public.dinamik_parcatedarik_model_matches.dinamik_product_name IS 'Dinamik product name (denormalized for manual matching)';