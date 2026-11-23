-- Single-use account links sent by e-mail: password reset (#1257) and e-mail verification (#1258). Only the
-- sha256 of the token is stored; the raw token exists only in the e-mail. Issuing a new token for an account and
-- purpose replaces the earlier one; scripts/prune-attempt-rows.ts deletes rows a day after they expire.
CREATE TABLE IF NOT EXISTS account_tokens (
 token_hash text PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 purpose text NOT NULL CHECK (purpose IN ('password_reset','email_verification')),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL
);
-- Indexes only when missing: CREATE INDEX IF NOT EXISTS still takes SHARE on the table on every setup run.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='account_tokens'::regclass AND c.relname='account_tokens_account_idx') THEN
  CREATE INDEX account_tokens_account_idx ON account_tokens(account_id,purpose);
 END IF;
END $$;
-- E-mail verification (#1258): where to go after verifying (a safe same-origin path) and the sha256 of the signup
-- browser's nonce, so only that browser is logged in by the link. Added only when missing: ADD COLUMN IF NOT EXISTS
-- locks the table on every setup run.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='account_tokens'::regclass AND attname='return_to' AND NOT attisdropped) THEN
  ALTER TABLE account_tokens ADD COLUMN return_to text;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='account_tokens'::regclass AND attname='origin_hash' AND NOT attisdropped) THEN
  ALTER TABLE account_tokens ADD COLUMN origin_hash text;
 END IF;
END $$;
