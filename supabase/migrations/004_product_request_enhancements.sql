-- v0.3.2: Enhance product_requests for product-specific request flow
-- Additive only — no destructive changes

-- Add supplier_product_id to reference the catalog product
ALTER TABLE product_requests ADD COLUMN IF NOT EXISTS supplier_product_id INTEGER;

-- Add product_snapshot JSONB to store product info at request time
ALTER TABLE product_requests ADD COLUMN IF NOT EXISTS product_snapshot JSONB;

-- Add request_type to distinguish quote vs compatibility check
ALTER TABLE product_requests ADD COLUMN IF NOT EXISTS request_type TEXT NOT NULL DEFAULT 'quote'
  CHECK (request_type IN ('quote', 'compatibility'));

-- Add phone as required (was optional before) — no constraint change needed since it's already nullable
-- Add new status values: reviewing, converted
ALTER TABLE product_requests DROP CONSTRAINT IF EXISTS product_requests_status_check;
ALTER TABLE product_requests ADD CONSTRAINT product_requests_status_check
  CHECK (status IN ('new', 'reviewing', 'contacted', 'quoted', 'converted', 'cancelled'));

-- Index for supplier_product_id lookups
CREATE INDEX IF NOT EXISTS idx_product_requests_supplier_product_id ON product_requests(supplier_product_id);

-- Index for request_type
CREATE INDEX IF NOT EXISTS idx_product_requests_request_type ON product_requests(request_type);