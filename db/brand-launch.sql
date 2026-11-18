-- Additive migration; existing accounts and approvals are retained. Each column is added only when missing: every
-- request's session check reads accounts, and ADD COLUMN IF NOT EXISTS locks it (ACCESS EXCLUSIVE) until setup commits.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='accounts'::regclass AND attname='contact_name' AND NOT attisdropped) THEN
  ALTER TABLE accounts ADD COLUMN contact_name text NOT NULL DEFAULT '';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='accounts'::regclass AND attname='phone' AND NOT attisdropped) THEN
  ALTER TABLE accounts ADD COLUMN phone text NOT NULL DEFAULT '';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='accounts'::regclass AND attname='city' AND NOT attisdropped) THEN
  ALTER TABLE accounts ADD COLUMN city text NOT NULL DEFAULT '';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='accounts'::regclass AND attname='applied_at' AND NOT attisdropped) THEN
  ALTER TABLE accounts ADD COLUMN applied_at timestamptz;
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS service_application_attempts (
 key text PRIMARY KEY, attempts integer NOT NULL, window_start timestamptz NOT NULL DEFAULT now()
);
