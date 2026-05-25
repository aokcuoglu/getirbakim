-- Drop denormalized model metadata from v0.ptproducts; matching uses model + dpmatch.normalized.

DROP INDEX IF EXISTS v0.idx_ptproducts_normalized_model;

ALTER TABLE v0.ptproducts
  DROP COLUMN IF EXISTS normalized_model,
  DROP COLUMN IF EXISTS model_imported_at,
  DROP COLUMN IF EXISTS model_source;
