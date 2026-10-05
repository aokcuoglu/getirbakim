CREATE TABLE IF NOT EXISTS accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
 email text UNIQUE NOT NULL, password_hash text NOT NULL,
 role text NOT NULL CHECK (role IN ('admin','service')),
 approved boolean NOT NULL DEFAULT false,
 discount_percent integer NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 50)
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
 email text PRIMARY KEY, attempts integer NOT NULL DEFAULT 1, window_start timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), supplier text NOT NULL CHECK (supplier IN ('dinamik','basbug','demo')),
 code text NOT NULL, name text NOT NULL, brand text NOT NULL, description text NOT NULL DEFAULT '',
 price_kurus integer NOT NULL CHECK (price_kurus > 0), stock integer NOT NULL CHECK (stock >= 0),
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (supplier,code)
);
CREATE TABLE IF NOT EXISTS cart_items (
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 99), PRIMARY KEY (account_id,product_id)
);

-- Iteration 2: public storefront taxonomy and guest carts.
ALTER TABLE products ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'yedek-parca';
CREATE INDEX IF NOT EXISTS products_category_idx ON products(category);
CREATE TABLE IF NOT EXISTS guest_carts (
 token_hash text PRIMARY KEY,
 expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days'
);
CREATE TABLE IF NOT EXISTS guest_cart_items (
 token_hash text NOT NULL REFERENCES guest_carts(token_hash) ON DELETE CASCADE,
 product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
 PRIMARY KEY (token_hash, product_id)
);

CREATE TABLE IF NOT EXISTS media_assets (
 id text PRIMARY KEY,
 name text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('image','font')),
 source_url text UNIQUE NOT NULL,
 local_path text NOT NULL,
 content_type text NOT NULL,
 sha256 text NOT NULL,
 size_bytes integer NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now()
);

-- Supplier observations are separate from saleable storefront products.
CREATE TABLE IF NOT EXISTS supplier_imports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 supplier text NOT NULL CHECK (supplier = 'basbug'),
 company text NOT NULL, list_group text NOT NULL, warehouse text NOT NULL,
 started_at timestamptz NOT NULL, completed_at timestamptz NOT NULL DEFAULT now(),
 observations jsonb NOT NULL, quality jsonb NOT NULL,
 groups_data jsonb NOT NULL, currencies_data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS supplier_imports_latest_idx ON supplier_imports(supplier,list_group,warehouse,completed_at DESC);
CREATE TABLE IF NOT EXISTS supplier_import_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 import_id uuid NOT NULL REFERENCES supplier_imports(id) ON DELETE CASCADE,
 code text NOT NULL, product_data jsonb NOT NULL, price_data jsonb, stock_data jsonb,
 product_count integer NOT NULL, price_count integer NOT NULL, stock_count integer NOT NULL,
 conflicting boolean NOT NULL DEFAULT false,
 source_variants jsonb NOT NULL DEFAULT '{}'::jsonb,
 UNIQUE(import_id,code)
);
ALTER TABLE supplier_import_items ADD COLUMN IF NOT EXISTS source_variants jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS supplier_import_items_import_idx ON supplier_import_items(import_id);

-- Current supplier observations and bounded change history (not one full copy per run).
ALTER TABLE supplier_imports DROP CONSTRAINT IF EXISTS supplier_imports_supplier_check;
ALTER TABLE supplier_imports ADD CONSTRAINT supplier_imports_supplier_check CHECK (supplier IN ('basbug','dinamik'));
ALTER TABLE supplier_imports ALTER COLUMN completed_at DROP NOT NULL;
ALTER TABLE supplier_imports ALTER COLUMN completed_at DROP DEFAULT;
ALTER TABLE supplier_imports ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'succeeded' CHECK (status IN ('running','succeeded','failed','rejected'));
ALTER TABLE supplier_imports ADD COLUMN IF NOT EXISTS error_reason text;
ALTER TABLE supplier_imports ADD COLUMN IF NOT EXISTS review_note text;
ALTER TABLE supplier_imports ADD COLUMN IF NOT EXISTS stats jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS supplier_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 supplier text NOT NULL CHECK (supplier IN ('basbug','dinamik')),
 company text NOT NULL, list_group text NOT NULL, warehouse text NOT NULL, code text NOT NULL,
 product_data jsonb NOT NULL, price_data jsonb, stock_data jsonb,
 product_count integer NOT NULL, price_count integer NOT NULL, stock_count integer NOT NULL,
 conflicting boolean NOT NULL DEFAULT false, source_variants jsonb NOT NULL DEFAULT '{}'::jsonb,
 presence text NOT NULL DEFAULT 'present' CHECK (presence IN ('present','pending_missing','inactive')),
 missing_count integer NOT NULL DEFAULT 0 CHECK (missing_count >= 0),
 first_seen_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL, changed_at timestamptz NOT NULL,
 last_import_id uuid REFERENCES supplier_imports(id) ON DELETE SET NULL,
 UNIQUE(supplier,company,list_group,warehouse,code)
);
CREATE INDEX IF NOT EXISTS supplier_items_scope_idx ON supplier_items(supplier,company,list_group,warehouse,presence,code);
CREATE TABLE IF NOT EXISTS supplier_item_changes (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 item_id uuid NOT NULL REFERENCES supplier_items(id) ON DELETE CASCADE,
 import_id uuid REFERENCES supplier_imports(id) ON DELETE SET NULL,
 changed_at timestamptz NOT NULL,
 kind text NOT NULL CHECK (kind IN ('added','changed','missing','inactive','restored')),
 before_data jsonb, after_data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS supplier_item_changes_item_idx ON supplier_item_changes(item_id,changed_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS supplier_item_changes_date_idx ON supplier_item_changes(changed_at);
CREATE TABLE IF NOT EXISTS supplier_sync_scopes (
 supplier text NOT NULL CHECK (supplier IN ('basbug','dinamik')),
 company text NOT NULL, list_group text NOT NULL, warehouse text NOT NULL,
 enabled boolean NOT NULL DEFAULT false,
 interval_minutes integer NOT NULL DEFAULT 1440 CHECK (interval_minutes BETWEEN 15 AND 10080),
 daily_at time NOT NULL DEFAULT '03:00',
 stale_minutes integer NOT NULL DEFAULT 2160 CHECK (stale_minutes >= 15),
 next_run_at timestamptz NOT NULL DEFAULT now(),
 last_success_at timestamptz, consecutive_failures integer NOT NULL DEFAULT 0,
 PRIMARY KEY(supplier,company,list_group,warehouse)
);
CREATE TABLE IF NOT EXISTS supplier_sync_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());

ALTER TABLE supplier_sync_scopes ADD COLUMN IF NOT EXISTS daily_at time NOT NULL DEFAULT '03:00';

CREATE INDEX IF NOT EXISTS supplier_imports_success_idx ON supplier_imports(supplier,company,list_group,warehouse,completed_at DESC,id DESC) WHERE status='succeeded';
CREATE INDEX IF NOT EXISTS supplier_imports_scope_runs_idx ON supplier_imports(supplier,company,list_group,warehouse,started_at DESC,id DESC);

-- Separate catalog discovery from recurring commercial observations.
ALTER TABLE supplier_imports ADD COLUMN IF NOT EXISTS run_kind text NOT NULL DEFAULT 'full' CHECK (run_kind IN ('full','commerce'));
ALTER TABLE supplier_sync_scopes ADD COLUMN IF NOT EXISTS commerce_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE supplier_sync_scopes ADD COLUMN IF NOT EXISTS commerce_interval_minutes integer NOT NULL DEFAULT 60 CHECK (commerce_interval_minutes BETWEEN 15 AND 1440);
ALTER TABLE supplier_sync_scopes ADD COLUMN IF NOT EXISTS commerce_stale_minutes integer NOT NULL DEFAULT 120 CHECK (commerce_stale_minutes > commerce_interval_minutes);
ALTER TABLE supplier_sync_scopes ADD COLUMN IF NOT EXISTS commerce_next_run_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE supplier_sync_scopes ADD COLUMN IF NOT EXISTS commerce_last_success_at timestamptz;
ALTER TABLE supplier_sync_scopes ADD COLUMN IF NOT EXISTS commerce_failures integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS supplier_scheduler_health (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 started_at timestamptz NOT NULL, finished_at timestamptz, succeeded boolean,
 CHECK (finished_at IS NULL OR finished_at >= started_at)
);
