-- Dinamik-ParcaTedarik Brand Alias Table
-- Maps Dinamik brands to ParcaTedarik manufacturers for model match disambiguation

CREATE TABLE IF NOT EXISTS public.dinamik_parca_brand_aliases (
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
  ON public.dinamik_parca_brand_aliases (dinamik_brand, parcatedarik_manufacturer_id);

-- Performance indexes
CREATE INDEX IF NOT EXISTS dpba_normalized_dinamik_brand
  ON public.dinamik_parca_brand_aliases (normalized_dinamik_brand);
CREATE INDEX IF NOT EXISTS dpba_parcatedarik_manufacturer_id
  ON public.dinamik_parca_brand_aliases (parcatedarik_manufacturer_id);
CREATE INDEX IF NOT EXISTS dpba_mapping_status
  ON public.dinamik_parca_brand_aliases (mapping_status);
CREATE INDEX IF NOT EXISTS dpba_match_method
  ON public.dinamik_parca_brand_aliases (match_method);

-- Add check constraint for allowed status values
ALTER TABLE public.dinamik_parca_brand_aliases
  ADD CONSTRAINT dpba_status_check
  CHECK (mapping_status IN ('PENDING', 'APPROVED', 'REJECTED', 'IGNORED'));

-- Add check constraint for allowed match_method values
ALTER TABLE public.dinamik_parca_brand_aliases
  ADD CONSTRAINT dpba_match_method_check
  CHECK (match_method IS NULL OR match_method IN ('EXACT_NORMALIZED', 'CASE_INSENSITIVE', 'NORMALIZED_BRAND_NAME', 'MANUAL'));

-- Comments
COMMENT ON TABLE public.dinamik_parca_brand_aliases IS 'Maps Dinamik brands to ParcaTedarik manufacturers for model match disambiguation';
COMMENT ON COLUMN public.dinamik_parca_brand_aliases.dinamik_brand IS 'Original brand name from Dinamik (dinamik.products.brand or dinamik.brands.brand)';
COMMENT ON COLUMN public.dinamik_parca_brand_aliases.normalized_dinamik_brand IS 'Normalized Dinamik brand via normalizeModel() for lookup';
COMMENT ON COLUMN public.dinamik_parca_brand_aliases.parcatedarik_manufacturer_id IS 'References parcatedarik.manufacturer.id';
COMMENT ON COLUMN public.dinamik_parca_brand_aliases.normalized_pc_manufacturer IS 'Normalized ParcaTedarik manufacturer name via normalizeModel()';
COMMENT ON COLUMN public.dinamik_parca_brand_aliases.mapping_status IS 'APPROVED = manually confirmed, PENDING = auto-seeded, REJECTED = confirmed non-match, IGNORED = skip';
COMMENT ON COLUMN public.dinamik_parca_brand_aliases.confidence IS 'Match confidence score 0.0000-1.0000';
COMMENT ON COLUMN public.dinamik_parca_brand_aliases.match_method IS 'How the match was created: EXACT_NORMALIZED, CASE_INSENSITIVE, NORMALIZED_BRAND_NAME, MANUAL';