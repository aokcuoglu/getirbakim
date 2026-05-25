-- Extract stock_code suffix from raw.stokKodu (brand + code) on dproduct_details.

ALTER TABLE v0.dproduct_details
  ADD COLUMN IF NOT EXISTS stock_code TEXT;

-- Backfill: first token = brand, remainder = stock_code (matches deriveDproductsPartNo).
UPDATE v0.dproduct_details
SET stock_code = CASE
  WHEN trim(coalesce(raw ->> 'stokKodu', '')) = '' THEN NULL
  WHEN position(' ' IN trim(raw ->> 'stokKodu')) > 0 THEN
    CASE
      WHEN trim(substring(trim(raw ->> 'stokKodu') FROM position(' ' IN trim(raw ->> 'stokKodu')) + 1)) = ''
        THEN trim(raw ->> 'stokKodu')
      ELSE trim(substring(trim(raw ->> 'stokKodu') FROM position(' ' IN trim(raw ->> 'stokKodu')) + 1))
    END
  ELSE trim(raw ->> 'stokKodu')
END
WHERE stock_code IS NULL;

CREATE INDEX IF NOT EXISTS idx_dproduct_details_stock_code
  ON v0.dproduct_details (stock_code)
  WHERE stock_code IS NOT NULL;
