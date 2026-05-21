-- Dinamik-ParcaTedarik Model Match Table
-- Maps Dinamik supplier products to ParcaTedarik products via barcode-to-model matching

CREATE TABLE IF NOT EXISTS public.dinamik_parcatedarik_model_matches (
  id BIGSERIAL PRIMARY KEY,
  dinamik_product_id BIGINT NOT NULL,
  parcatedarik_product_id BIGINT NOT NULL,
  dinamik_barcode_field TEXT NOT NULL,
  dinamik_barcode_value TEXT NOT NULL,
  normalized_barcode_value TEXT NOT NULL,
  parcatedarik_model TEXT NOT NULL,
  normalized_model TEXT NOT NULL,
  match_reason TEXT NOT NULL,
  confidence NUMERIC(5,4) NOT NULL DEFAULT 0.9500,
  status TEXT NOT NULL DEFAULT 'CANDIDATE',
  review_note TEXT NULL,
  approved_by TEXT NULL,
  approved_at TIMESTAMP NULL,
  rejected_by TEXT NULL,
  rejected_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Unique constraint: prevent duplicate matches for same dinamik-parca-barcode combination
CREATE UNIQUE INDEX IF NOT EXISTS dpmm_unique_match
  ON public.dinamik_parcatedarik_model_matches (
    dinamik_product_id,
    parcatedarik_product_id,
    dinamik_barcode_field,
    normalized_barcode_value
  );

-- Performance indexes
CREATE INDEX IF NOT EXISTS dpmm_status
  ON public.dinamik_parcatedarik_model_matches (status);
CREATE INDEX IF NOT EXISTS dpmm_dinamik_product_id
  ON public.dinamik_parcatedarik_model_matches (dinamik_product_id);
CREATE INDEX IF NOT EXISTS dpmm_parcatedarik_product_id
  ON public.dinamik_parcatedarik_model_matches (parcatedarik_product_id);
CREATE INDEX IF NOT EXISTS dpmm_normalized_barcode_value
  ON public.dinamik_parcatedarik_model_matches (normalized_barcode_value);
CREATE INDEX IF NOT EXISTS dpmm_normalized_model
  ON public.dinamik_parcatedarik_model_matches (normalized_model);
CREATE INDEX IF NOT EXISTS dpmm_match_reason
  ON public.dinamik_parcatedarik_model_matches (match_reason);
CREATE INDEX IF NOT EXISTS dpmm_confidence
  ON public.dinamik_parcatedarik_model_matches (confidence);

-- Add check constraint for allowed status values
ALTER TABLE public.dinamik_parcatedarik_model_matches
  ADD CONSTRAINT dpmm_status_check
  CHECK (status IN ('CANDIDATE', 'APPROVED', 'REJECTED', 'NEEDS_REVIEW', 'IGNORED'));

-- Add foreign key comment to parcatedarik.product
COMMENT ON TABLE public.dinamik_parcatedarik_model_matches IS 'Maps Dinamik supplier products to ParcaTedarik products via barcode-to-normalized_model matching';
COMMENT ON COLUMN public.dinamik_parcatedarik_model_matches.dinamik_product_id IS 'References dinamik.products.id (raw SQL schema, not Prisma)';
COMMENT ON COLUMN public.dinamik_parcatedarik_model_matches.parcatedarik_product_id IS 'References parcatedarik.product.id';
COMMENT ON COLUMN public.dinamik_parcatedarik_model_matches.dinamik_barcode_field IS 'Which barcode field matched: barcode_1, barcode_2, or barcode_3';
COMMENT ON COLUMN public.dinamik_parcatedarik_model_matches.dinamik_barcode_value IS 'Original barcode value from Dinamik product';
COMMENT ON COLUMN public.dinamik_parcatedarik_model_matches.normalized_barcode_value IS 'Normalized barcode value (uppercase, non-alphanumeric stripped)';
COMMENT ON COLUMN public.dinamik_parcatedarik_model_matches.parcatedarik_model IS 'Original model value from ParcaTedarik product';
COMMENT ON COLUMN public.dinamik_parcatedarik_model_matches.normalized_model IS 'Normalized model value matched against';
COMMENT ON COLUMN public.dinamik_parcatedarik_model_matches.match_reason IS 'Match reason: BARCODE_1_MODEL_EXACT, BARCODE_2_MODEL_EXACT, BARCODE_3_MODEL_EXACT, MULTIPLE_PARCA_MODEL_MATCHES';
COMMENT ON COLUMN public.dinamik_parcatedarik_model_matches.confidence IS 'Match confidence score 0.0000-1.0000';
COMMENT ON COLUMN public.dinamik_parcatedarik_model_matches.status IS 'Match status: CANDIDATE, APPROVED, REJECTED, NEEDS_REVIEW, IGNORED';