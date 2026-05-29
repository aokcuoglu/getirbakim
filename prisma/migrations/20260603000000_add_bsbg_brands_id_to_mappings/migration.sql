-- Add bsbg_brands_id column to brand mappings
ALTER TABLE v0.dnmk_ptdrk_brand_mappings
  ADD COLUMN IF NOT EXISTS bsbg_brands_id BIGINT;

-- Add missing foreign key constraints for dnmk_brands_id and ptdrk_brands_id
ALTER TABLE v0.dnmk_ptdrk_brand_mappings
  ADD CONSTRAINT fk_dpbrm_dnmk
  FOREIGN KEY (dnmk_brands_id) REFERENCES v0.dnmk_brands(id)
  ON DELETE CASCADE;
-- (fk_dpbrm_dnmk already exists → ignore duplicate error)
ALTER TABLE v0.dnmk_ptdrk_brand_mappings
  ADD CONSTRAINT fk_dpbrm_ptdrk
  FOREIGN KEY (ptdrk_brands_id) REFERENCES v0.ptdrk_brands(id)
  ON DELETE CASCADE;
-- (fk_dpbrm_ptdrk already exists → ignore duplicate error)

-- Add foreign key constraint for bsbg_brands_id
ALTER TABLE v0.dnmk_ptdrk_brand_mappings
  ADD CONSTRAINT fk_dpbrm_bsbg
  FOREIGN KEY (bsbg_brands_id) REFERENCES v0.bsbg_brands(id)
  ON DELETE CASCADE;
-- (fk_dpbrm_bsbg already exists → ignore duplicate error)

-- Drop old unique constraint, recreate with bsbg_brands_id included
ALTER TABLE v0.dnmk_ptdrk_brand_mappings
  DROP CONSTRAINT IF EXISTS uq_dpbrm_brands;

ALTER TABLE v0.dnmk_ptdrk_brand_mappings
  ADD CONSTRAINT uq_dpbrm_brands
  UNIQUE (dnmk_ptdrk_brands_id, dnmk_brands_id, ptdrk_brands_id, bsbg_brands_id);

-- Add unique partial index for BSBG-only mappings (dnmk+ptdrk both NULL)
CREATE UNIQUE INDEX IF NOT EXISTS uq_dpbrm_bsbg_mapping
  ON v0.dnmk_ptdrk_brand_mappings (dnmk_ptdrk_brands_id, bsbg_brands_id)
  WHERE dnmk_brands_id IS NULL AND ptdrk_brands_id IS NULL AND bsbg_brands_id IS NOT NULL;

-- Add index for bsbg lookup
CREATE INDEX IF NOT EXISTS idx_dpbrm_bsbg
  ON v0.dnmk_ptdrk_brand_mappings (bsbg_brands_id)
  WHERE bsbg_brands_id IS NOT NULL;
