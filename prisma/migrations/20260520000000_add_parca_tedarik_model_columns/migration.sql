-- AlterTable: parcatedarik.product
-- Add model columns for CSV import

ALTER TABLE parcatedarik.product
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS normalized_model text,
  ADD COLUMN IF NOT EXISTS model_imported_at timestamp without time zone,
  ADD COLUMN IF NOT EXISTS model_source text;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_parcatedarik_products_model
  ON parcatedarik.product (model);

CREATE INDEX IF NOT EXISTS idx_parcatedarik_products_normalized_model
  ON parcatedarik.product (normalized_model);