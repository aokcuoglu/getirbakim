-- Rename parcatedarik schema to v0 and align table names with v0 catalog semantics.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'parcatedarik')
     AND NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'v0')
  THEN
    ALTER SCHEMA parcatedarik RENAME TO v0;
  END IF;
END $$;

-- price_history is deprecated; data will be fetched via API later.
DROP TABLE IF EXISTS v0.price_history;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'v0' AND table_name = 'dproduct_offer_history'
  ) THEN
    ALTER TABLE v0.dproduct_offer_history RENAME TO dproduct_history;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'v0' AND table_name = 'dproduct_offers'
  ) THEN
    ALTER TABLE v0.dproduct_offers RENAME TO dproduct_details;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'v0' AND table_name = 'manufacturer'
  ) THEN
    ALTER TABLE v0.manufacturer RENAME TO ptbrands;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'v0' AND table_name = 'product'
  ) THEN
    ALTER TABLE v0.product RENAME TO ptproducts;
  END IF;
END $$;

-- Rename indexes/constraints for clarity (no-ops if already renamed).
ALTER INDEX IF EXISTS v0.idx_dproduct_offers_last_seen RENAME TO idx_dproduct_details_last_seen;
ALTER INDEX IF EXISTS v0.idx_dproduct_offers_price RENAME TO idx_dproduct_details_price;
ALTER INDEX IF EXISTS v0.uq_dproduct_offers_dproduct_id RENAME TO uq_dproduct_details_dproduct_id;
ALTER INDEX IF EXISTS v0.idx_dproduct_offer_history_product_time RENAME TO idx_dproduct_history_product_time;

COMMENT ON TABLE v0.ptbrands IS 'ParcaTedarik manufacturers (v0 catalog)';
COMMENT ON TABLE v0.ptproducts IS 'ParcaTedarik products (v0 catalog)';
COMMENT ON TABLE v0.dproduct_details IS 'Volatile Dinamik offer snapshot per dproduct (price/stock/raw)';
COMMENT ON TABLE v0.dproduct_history IS 'Append-only price/stock change log for dproduct_details';
