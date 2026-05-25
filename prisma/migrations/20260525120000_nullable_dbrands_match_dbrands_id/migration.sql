-- PT-only eşleştirme satırları: manufacturer_id dolu, dbrands_id NULL (dbrands kataloğu kirlenmez)

ALTER TABLE parcatedarik.dbrands_match
  ALTER COLUMN dbrands_id DROP NOT NULL;

-- Dinamik marka başına en fazla bir "henüz PT eşleşmedi" satırı
CREATE UNIQUE INDEX IF NOT EXISTS uq_dbrands_match_dbrand_only
  ON parcatedarik.dbrands_match (dbrands_id)
  WHERE manufacturer_id IS NULL AND dbrands_id IS NOT NULL;

-- PT üretici başına en fazla bir "Dinamik eşleşmesi yok" satırı
CREATE UNIQUE INDEX IF NOT EXISTS uq_dbrands_match_pt_only_mfr
  ON parcatedarik.dbrands_match (manufacturer_id)
  WHERE dbrands_id IS NULL AND manufacturer_id IS NOT NULL;
