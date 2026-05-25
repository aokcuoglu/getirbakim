-- Track Dinamik catalog rows that disappeared from the latest API snapshot (do not delete).
ALTER TABLE parcatedarik.dproducts
  ADD COLUMN IF NOT EXISTS is_passive BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE parcatedarik.dproducts
  ADD COLUMN IF NOT EXISTS passive_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_dproducts_query_brand_passive
  ON parcatedarik.dproducts (query_brand, is_passive);
