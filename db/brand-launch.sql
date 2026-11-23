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
 -- E-mail verification (#1258): NULL = a self-service signup whose address is not verified yet; such an account cannot
 -- log in and goes after 7 days (scripts/prune-attempt-rows.ts). The default keeps every other insert path (admin,
 -- service application, seeds) verified; a future self-service insert must write NULL explicitly. now() is stable, so
 -- existing rows get the setup time without a table rewrite.
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='accounts'::regclass AND attname='email_verified_at' AND NOT attisdropped) THEN
  ALTER TABLE accounts ADD COLUMN email_verified_at timestamptz DEFAULT now();
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS service_application_attempts (
 key text PRIMARY KEY, attempts integer NOT NULL, window_start timestamptz NOT NULL DEFAULT now()
);
-- Membership terms acceptance (#1256): proof that an individual customer accepted the Üyelik ve Kullanım Koşulları at
-- signup — the accepted terms version, the KVKK notice version shown with it, the consent text and the request's
-- client evidence. Rows are never updated; deleting the account removes them.
CREATE TABLE IF NOT EXISTS account_term_acceptances (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 document text NOT NULL, terms_version text NOT NULL, privacy_notice_version text NOT NULL, consent_text text NOT NULL,
 accepted_at timestamptz NOT NULL DEFAULT now(),
 ip text, forwarded_for text, user_agent text,
 UNIQUE (account_id, document, terms_version)
);
CREATE OR REPLACE FUNCTION account_term_acceptance_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'account_term_acceptances rows are immutable';
END $$;
-- Created only when missing: CREATE [OR REPLACE] TRIGGER locks the table against writers until setup commits.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='account_term_acceptances'::regclass AND tgname='account_term_acceptance_immutable') THEN
  CREATE TRIGGER account_term_acceptance_immutable BEFORE UPDATE ON account_term_acceptances FOR EACH ROW EXECUTE FUNCTION account_term_acceptance_immutable();
 END IF;
END $$;
-- Individual customers applying for a service account (#1259). One open request per account; the row is removed when
-- an admin approves (the same account becomes a service account) or rejects it (it stays a customer). On the first
-- deploy the foreign key takes SHARE ROW EXCLUSIVE on accounts once; later runs find the table and take no lock.
CREATE TABLE IF NOT EXISTS service_upgrade_requests (
 account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
 service_name text NOT NULL, contact_name text NOT NULL, phone text NOT NULL, city text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
