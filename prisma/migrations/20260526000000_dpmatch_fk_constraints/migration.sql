-- Add FK constraints from dpmatch → dproducts / ptproducts (nullable for dinamik-only / pt-only rows).
-- Idempotent: safe if constraints already exist.

ALTER TABLE v0.dpmatch
  DROP CONSTRAINT IF EXISTS fk_dpmatch_dproducts,
  DROP CONSTRAINT IF EXISTS fk_dpmatch_ptproducts;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_dpmatch_dproducts'
      AND conrelid = 'v0.dpmatch'::regclass
  ) THEN
    ALTER TABLE v0.dpmatch
      ADD CONSTRAINT fk_dpmatch_dproducts
      FOREIGN KEY (dproducts_id) REFERENCES v0.dproducts (id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_dpmatch_ptproducts'
      AND conrelid = 'v0.dpmatch'::regclass
  ) THEN
    ALTER TABLE v0.dpmatch
      ADD CONSTRAINT fk_dpmatch_ptproducts
      FOREIGN KEY (ptproducts_id) REFERENCES v0.ptproducts (id) ON DELETE CASCADE;
  END IF;
END $$;

COMMENT ON COLUMN v0.dpmatch.dproducts_id IS 'FK → v0.dproducts.id (Dinamik ürün; NULL = PT-only satır)';
COMMENT ON COLUMN v0.dpmatch.ptproducts_id IS 'FK → v0.ptproducts.id (ParcaTedarik ürün; NULL = Dinamik-only satır)';
