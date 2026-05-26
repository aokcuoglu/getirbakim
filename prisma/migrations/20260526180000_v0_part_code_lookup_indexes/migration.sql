-- Fast exact part-number lookups (e.g. KN-034 → KN034) for v0 global search.
CREATE INDEX IF NOT EXISTS idx_dproducts_part_no_norm
  ON v0.dproducts (
    REPLACE(REPLACE(REPLACE(REPLACE(UPPER(COALESCE(part_no, '')), '-', ''), '.', ''), ' ', ''), '/', '')
  )
  WHERE part_no IS NOT NULL AND BTRIM(part_no) <> '';

CREATE INDEX IF NOT EXISTS idx_dproducts_stock_code_norm
  ON v0.dproducts (
    REPLACE(REPLACE(REPLACE(REPLACE(UPPER(COALESCE(stock_code, '')), '-', ''), '.', ''), ' ', ''), '/', '')
  )
  WHERE stock_code IS NOT NULL AND BTRIM(stock_code) <> '';

CREATE INDEX IF NOT EXISTS idx_ptproducts_model_norm
  ON v0.ptproducts (
    REPLACE(REPLACE(REPLACE(REPLACE(UPPER(COALESCE(model, '')), '-', ''), '.', ''), ' ', ''), '/', '')
  )
  WHERE model IS NOT NULL AND BTRIM(model) <> '';
