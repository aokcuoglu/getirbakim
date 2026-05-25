-- dbrands_match.dbrands_id: marka adı (text) → dbrands.id (bigint)

DROP INDEX IF EXISTS parcatedarik.idx_dbrands_match_dbrands_id_trgm;
DROP INDEX IF EXISTS parcatedarik.uq_dbrands_match_dbrand_only;
DROP INDEX IF EXISTS parcatedarik.uq_dbrands_match_pt_only_mfr;

ALTER TABLE parcatedarik.dbrands_match
  DROP CONSTRAINT IF EXISTS fk_dbrands_match_brand;

ALTER TABLE parcatedarik.dbrands_match
  ADD COLUMN IF NOT EXISTS dbrands_fk bigint;

UPDATE parcatedarik.dbrands_match m
SET dbrands_fk = d.id
FROM parcatedarik.dbrands d
WHERE m.dbrands_id IS NOT NULL
  AND d.brand = m.dbrands_id;

DELETE FROM parcatedarik.dbrands_match
WHERE dbrands_id IS NOT NULL
  AND dbrands_fk IS NULL;

ALTER TABLE parcatedarik.dbrands_match
  DROP COLUMN dbrands_id;

ALTER TABLE parcatedarik.dbrands_match
  RENAME COLUMN dbrands_fk TO dbrands_id;

ALTER TABLE parcatedarik.dbrands_match
  ADD CONSTRAINT fk_dbrands_match_brand
  FOREIGN KEY (dbrands_id) REFERENCES parcatedarik.dbrands (id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dbrands_match_dbrand_only
  ON parcatedarik.dbrands_match (dbrands_id)
  WHERE manufacturer_id IS NULL AND dbrands_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dbrands_match_pt_only_mfr
  ON parcatedarik.dbrands_match (manufacturer_id)
  WHERE dbrands_id IS NULL AND manufacturer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dbrands_brand_trgm
  ON parcatedarik.dbrands USING GIN (brand gin_trgm_ops);
