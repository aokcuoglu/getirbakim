-- Saved delivery and invoice addresses of approved B2B service and admin accounts (#950). Guests type theirs at
-- checkout. At most one default delivery and one default invoice address per account; one row may carry both.
CREATE TABLE IF NOT EXISTS account_addresses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 60),
 recipient_name text NOT NULL CHECK(length(recipient_name) BETWEEN 2 AND 150),
 phone text NOT NULL CHECK(length(phone) BETWEEN 10 AND 20),
 province text NOT NULL,
 district text NOT NULL,
 address_line text NOT NULL CHECK(length(address_line) BETWEEN 10 AND 500),
 postal_code text CHECK(postal_code ~ '^\d{5}$'),
 default_delivery boolean NOT NULL DEFAULT false,
 default_invoice boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- Indexes only when missing: CREATE INDEX IF NOT EXISTS still takes SHARE on the table on every setup run.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='account_addresses'::regclass AND c.relname='account_addresses_account_idx') THEN
  CREATE INDEX account_addresses_account_idx ON account_addresses(account_id,created_at);
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='account_addresses'::regclass AND c.relname='account_addresses_default_delivery_idx') THEN
  CREATE UNIQUE INDEX account_addresses_default_delivery_idx ON account_addresses(account_id) WHERE default_delivery;
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='account_addresses'::regclass AND c.relname='account_addresses_default_invoice_idx') THEN
  CREATE UNIQUE INDEX account_addresses_default_invoice_idx ON account_addresses(account_id) WHERE default_invoice;
 END IF;
END $$;
