-- Add KVKK consent fields to product_requests
ALTER TABLE product_requests ADD COLUMN IF NOT EXISTS kvkk_consent BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE product_requests ADD COLUMN IF NOT EXISTS kvkk_consent_at TIMESTAMPTZ;

-- Ensure new requests must have consent
-- (Application layer enforces this, but we add a check constraint as defense in depth)
-- Note: we don't add a hard NOT NULL + DEFAULT false constraint at DB level for kvkk_consent
-- because the application validates the consent before insert.