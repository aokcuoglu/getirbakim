-- Additive migration; existing accounts and approvals are retained.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS contact_name text NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS city text NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS applied_at timestamptz;
CREATE TABLE IF NOT EXISTS service_application_attempts (
 key text PRIMARY KEY, attempts integer NOT NULL, window_start timestamptz NOT NULL DEFAULT now()
);
