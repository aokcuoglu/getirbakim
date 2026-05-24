-- Simplify dpmatch to match dbrands_match pattern
-- Old table had 16+ complex columns (dinamik_barcode_field, confidence, etc.)
-- New table has only: id, dproducts_id, product_id, normalized, mapping_status, match_method
-- 
-- WARNING: This drops ALL existing dpmatch data. Re-run populate script after migration.

DROP TABLE IF EXISTS parcatedarik.dpmatch CASCADE;

CREATE TABLE parcatedarik.dpmatch (
  id              SERIAL PRIMARY KEY,
  dproducts_id    BIGINT NOT NULL,
  product_id      INTEGER NOT NULL,
  normalized      TEXT,
  mapping_status  TEXT NOT NULL DEFAULT 'PENDING',
  match_method    TEXT
);

ALTER TABLE parcatedarik.dpmatch
  ADD CONSTRAINT uq_dpmatch_dproduct_product UNIQUE (dproducts_id, product_id);

CREATE INDEX idx_dpmatch_product ON parcatedarik.dpmatch (product_id);
CREATE INDEX idx_dpmatch_dproduct ON parcatedarik.dpmatch (dproducts_id);
CREATE INDEX idx_dpmatch_status ON parcatedarik.dpmatch (mapping_status);
CREATE INDEX idx_dpmatch_method ON parcatedarik.dpmatch (match_method);
CREATE INDEX idx_dpmatch_normalized ON parcatedarik.dpmatch (normalized);

ALTER TABLE parcatedarik.dpmatch
  ADD CONSTRAINT dpmatch_status_check
  CHECK (mapping_status IN ('PENDING', 'APPROVED', 'REJECTED', 'IGNORED'));
