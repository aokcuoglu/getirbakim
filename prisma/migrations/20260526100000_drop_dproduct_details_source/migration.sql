-- dproduct_details is Dinamik-only; source column is redundant.

ALTER TABLE v0.dproduct_details
  DROP COLUMN IF EXISTS source;
