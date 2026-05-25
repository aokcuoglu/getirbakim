CREATE INDEX IF NOT EXISTS idx_dbrands_match_dbrands_id
  ON parcatedarik.dbrands_match (dbrands_id)
  WHERE dbrands_id IS NOT NULL;
