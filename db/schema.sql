-- Lock order for setup's view replacements and table changes (#1046). CREATE OR REPLACE VIEW and ALTER TABLE take ACCESS
-- EXCLUSIVE on their relation only; a reader takes ACCESS SHARE on the view it names first, then on the views and tables
-- inside it. Replacing an inner view and later an outer one (commerce_catalog_entries, then storefront_catalog_entries)
-- deadlocks with a reader that got the outer view in between: it waits for the inner view, setup for the outer one.
-- Called right before such a statement, and only when it really runs (a no-op setup run never calls it), this locks
-- every view that reads `rel` (directly or through other views), outermost first: ordered by the longest path from
-- `rel`, a view comes before every view it reads. So the views setup holds always include every view above them, and a
-- reader that needs one of them waits at the first view it names, holding none of the chain. That holds across
-- replacements: a later replace of an already locked outer view re-locks only what setup already holds. Not covered:
-- a statement or transaction that names an inner relation before an outer view (checkout reading commerce_orders, then
-- the catalog): there the reader, not setup, can be the 40P01 victim, and setup's retry handles the case where it is not.
-- ALTER VIEW ... OWNER TO its current owner takes ACCESS EXCLUSIVE on the view alone and changes nothing; LOCK TABLE
-- on a view would also lock its base tables (supplier_items). Materialized views stop the walk: reading one does not
-- open the views it was built from. Temporary views (the setup probes, other sessions') are skipped. So is a view the
-- current role cannot alter (not its owner or a member of the owner role: ALTER would fail with 42501), with a NOTICE:
-- setup still runs, without the lock order for that view.
CREATE OR REPLACE FUNCTION setup_lock_dependent_views(rel regclass) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v record;
BEGIN
 FOR v IN
  WITH RECURSIVE dependents(view,depth) AS (
   SELECT r.ev_class,1 FROM pg_depend d JOIN pg_rewrite r ON r.oid=d.objid JOIN pg_class c ON c.oid=r.ev_class
   WHERE d.classid='pg_rewrite'::regclass AND d.refclassid='pg_class'::regclass AND d.refobjid=rel AND r.ev_class<>rel
    AND c.relkind='v' AND c.relpersistence<>'t'
   UNION
   SELECT r.ev_class,s.depth+1 FROM dependents s JOIN pg_depend d ON d.refobjid=s.view
   JOIN pg_rewrite r ON r.oid=d.objid JOIN pg_class c ON c.oid=r.ev_class
   WHERE d.classid='pg_rewrite'::regclass AND d.refclassid='pg_class'::regclass AND r.ev_class<>s.view
    AND c.relkind='v' AND c.relpersistence<>'t'
  )
  SELECT s.view::regclass AS name,format('%I.%I',n.nspname,c.relname) AS qualified,pg_get_userbyid(c.relowner) AS owner,
   pg_has_role(current_user,c.relowner,'USAGE') AS alterable
  FROM dependents s JOIN pg_class c ON c.oid=s.view JOIN pg_namespace n ON n.oid=c.relnamespace
  GROUP BY s.view,c.relowner,n.nspname,c.relname ORDER BY max(s.depth) DESC,s.view
 LOOP
  IF v.alterable THEN
   EXECUTE format('ALTER VIEW %s OWNER TO %I',v.name,v.owner);
  ELSE
   RAISE NOTICE 'setup_lock_dependent_views: % is owned by %, not locked before changing %', v.qualified, v.owner, rel;
  END IF;
 END LOOP;
END $$;
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
-- Store-managed items (demo/manual, own price and stock). Formerly `products`; that name now belongs to the master
-- catalog (db/product-matching.sql). Index names move with the table so the master table can reuse them.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='products' AND column_name='supplier') THEN
  ALTER TABLE products RENAME TO store_products;
  ALTER INDEX IF EXISTS products_pkey RENAME TO store_products_pkey;
  ALTER INDEX IF EXISTS products_supplier_code_key RENAME TO store_products_supplier_code_key;
  ALTER INDEX IF EXISTS products_category_idx RENAME TO store_products_category_idx;
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS store_products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), supplier text NOT NULL CHECK (supplier IN ('dinamik','basbug','demo')),
 code text NOT NULL, name text NOT NULL, brand text NOT NULL, description text NOT NULL DEFAULT '',
 price_kurus integer NOT NULL CHECK (price_kurus > 0), stock integer NOT NULL CHECK (stock >= 0),
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (supplier,code)
);
CREATE TABLE IF NOT EXISTS cart_items (
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 product_id uuid NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
 quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 99), PRIMARY KEY (account_id,product_id)
);

-- Iteration 2: public storefront taxonomy and guest carts.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='store_products'::regclass AND attname='category' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('store_products');
  ALTER TABLE store_products ADD COLUMN category text NOT NULL DEFAULT 'yedek-parca';
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='store_products'::regclass AND c.relname='store_products_category_idx') THEN
  CREATE INDEX store_products_category_idx ON store_products(category);
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS guest_carts (
 token_hash text PRIMARY KEY,
 expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days'
);
CREATE TABLE IF NOT EXISTS guest_cart_items (
 token_hash text NOT NULL REFERENCES guest_carts(token_hash) ON DELETE CASCADE,
 product_id uuid NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
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
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='supplier_imports'::regclass AND c.relname='supplier_imports_latest_idx') THEN
  CREATE INDEX supplier_imports_latest_idx ON supplier_imports(supplier,list_group,warehouse,completed_at DESC);
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS supplier_import_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 import_id uuid NOT NULL REFERENCES supplier_imports(id) ON DELETE CASCADE,
 code text NOT NULL, product_data jsonb NOT NULL, price_data jsonb, stock_data jsonb,
 product_count integer NOT NULL, price_count integer NOT NULL, stock_count integer NOT NULL,
 conflicting boolean NOT NULL DEFAULT false,
 source_variants jsonb NOT NULL DEFAULT '{}'::jsonb,
 UNIQUE(import_id,code)
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='supplier_import_items'::regclass AND attname='source_variants' AND NOT attisdropped) THEN
  ALTER TABLE supplier_import_items ADD COLUMN source_variants jsonb NOT NULL DEFAULT '{}'::jsonb;
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='supplier_import_items'::regclass AND c.relname='supplier_import_items_import_idx') THEN
  CREATE INDEX supplier_import_items_import_idx ON supplier_import_items(import_id);
 END IF;
END $$;

-- Current supplier observations and bounded change history (not one full copy per run).
-- Replaced only when the validated constraint's quoted values differ from this list: DROP + ADD locks the table
-- (ACCESS EXCLUSIVE, re-validating every row) until setup commits. The guard's ARRAY must match the CHECK exactly, so
-- any change to the list (add, remove, rename, reorder) edits both. Inline, not a helper: tests load single files.
DO $$ BEGIN
 IF ARRAY(SELECT r.m[1] FROM pg_constraint k, regexp_matches(pg_get_constraintdef(k.oid),'''([^'']*)''','g') WITH ORDINALITY r(m,i)
   WHERE k.conrelid='supplier_imports'::regclass AND k.conname='supplier_imports_supplier_check' AND k.convalidated ORDER BY r.i)
  IS DISTINCT FROM ARRAY['basbug','dinamik','seta','manual'] THEN
  PERFORM setup_lock_dependent_views('supplier_imports');
  ALTER TABLE supplier_imports DROP CONSTRAINT IF EXISTS supplier_imports_supplier_check;
  ALTER TABLE supplier_imports ADD CONSTRAINT supplier_imports_supplier_check CHECK (supplier IN ('basbug','dinamik','seta','manual'));
 END IF;
END $$;
-- ALTER COLUMN locks the table even when nothing changes: only for tables created before running imports existed.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='supplier_imports'::regclass AND attname='completed_at' AND (attnotnull OR atthasdef)) THEN
  PERFORM setup_lock_dependent_views('supplier_imports');
  ALTER TABLE supplier_imports ALTER COLUMN completed_at DROP NOT NULL, ALTER COLUMN completed_at DROP DEFAULT;
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='supplier_imports'::regclass AND attname='status' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('supplier_imports');
  ALTER TABLE supplier_imports ADD COLUMN status text NOT NULL DEFAULT 'succeeded' CHECK (status IN ('running','succeeded','failed','rejected'));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='supplier_imports'::regclass AND attname='error_reason' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('supplier_imports');
  ALTER TABLE supplier_imports ADD COLUMN error_reason text;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='supplier_imports'::regclass AND attname='review_note' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('supplier_imports');
  ALTER TABLE supplier_imports ADD COLUMN review_note text;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='supplier_imports'::regclass AND attname='stats' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('supplier_imports');
  ALTER TABLE supplier_imports ADD COLUMN stats jsonb NOT NULL DEFAULT '{}'::jsonb;
 END IF;
END $$;

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
-- Indexes on write-hot and order tables are created only when missing (#964): CREATE INDEX IF NOT EXISTS takes SHARE
-- on the table, blocking its writers until setup commits, even when the index exists. Looked up per table (indrelid):
-- to_regclass would find a same-named index in public from an isolated test schema. A changed definition needs a new
-- index name (or a DROP INDEX in the same change).
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='supplier_items'::regclass AND c.relname='supplier_items_scope_idx') THEN
  CREATE INDEX supplier_items_scope_idx ON supplier_items(supplier,company,list_group,warehouse,presence,code);
 END IF;
END $$;
-- Precomputed ranking inputs (filled by a trigger defined in db/search.sql, next to the functions it uses).
-- Added only when missing: ADD COLUMN IF NOT EXISTS locks the table (ACCESS EXCLUSIVE) until setup commits even as a no-op.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='supplier_items'::regclass AND attname='search_doc' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('supplier_items');
  ALTER TABLE supplier_items ADD COLUMN search_doc tsvector;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='supplier_items'::regclass AND attname='search_code' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('supplier_items');
  ALTER TABLE supplier_items ADD COLUMN search_code text;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='supplier_items'::regclass AND attname='search_oem' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('supplier_items');
  ALTER TABLE supplier_items ADD COLUMN search_oem text;
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS supplier_item_changes (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 item_id uuid NOT NULL REFERENCES supplier_items(id) ON DELETE CASCADE,
 import_id uuid REFERENCES supplier_imports(id) ON DELETE SET NULL,
 changed_at timestamptz NOT NULL,
 kind text NOT NULL CHECK (kind IN ('added','changed','missing','inactive','restored')),
 before_data jsonb, after_data jsonb NOT NULL
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='supplier_item_changes'::regclass AND c.relname='supplier_item_changes_item_idx') THEN
  CREATE INDEX supplier_item_changes_item_idx ON supplier_item_changes(item_id,changed_at DESC,id DESC);
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='supplier_item_changes'::regclass AND c.relname='supplier_item_changes_date_idx') THEN
  CREATE INDEX supplier_item_changes_date_idx ON supplier_item_changes(changed_at);
 END IF;
END $$;
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
-- SETA (single published list) and manual xlsx lists (db/manual-supplier.sql). The inline checks above only apply
-- to new databases. Manual lists have no sync scope: nothing fetches them on a schedule.
-- Replaced only when the validated constraint's quoted values differ from this list: DROP + ADD locks the table
-- (ACCESS EXCLUSIVE, re-validating every row) until setup commits. The guard's ARRAY must match the CHECK exactly, so
-- any change to the list (add, remove, rename, reorder) edits both. Inline, not a helper: tests load single files.
DO $$ BEGIN
 IF ARRAY(SELECT r.m[1] FROM pg_constraint k, regexp_matches(pg_get_constraintdef(k.oid),'''([^'']*)''','g') WITH ORDINALITY r(m,i)
   WHERE k.conrelid='supplier_items'::regclass AND k.conname='supplier_items_supplier_check' AND k.convalidated ORDER BY r.i)
  IS DISTINCT FROM ARRAY['basbug','dinamik','seta','manual'] THEN
  PERFORM setup_lock_dependent_views('supplier_items');
  ALTER TABLE supplier_items DROP CONSTRAINT IF EXISTS supplier_items_supplier_check;
  ALTER TABLE supplier_items ADD CONSTRAINT supplier_items_supplier_check CHECK (supplier IN ('basbug','dinamik','seta','manual'));
 END IF;
END $$;
-- Replaced only when the validated constraint's quoted values differ from this list: DROP + ADD locks the table
-- (ACCESS EXCLUSIVE, re-validating every row) until setup commits. The guard's ARRAY must match the CHECK exactly, so
-- any change to the list (add, remove, rename, reorder) edits both. Inline, not a helper: tests load single files.
DO $$ BEGIN
 IF ARRAY(SELECT r.m[1] FROM pg_constraint k, regexp_matches(pg_get_constraintdef(k.oid),'''([^'']*)''','g') WITH ORDINALITY r(m,i)
   WHERE k.conrelid='supplier_sync_scopes'::regclass AND k.conname='supplier_sync_scopes_supplier_check' AND k.convalidated ORDER BY r.i)
  IS DISTINCT FROM ARRAY['basbug','dinamik','seta'] THEN
  PERFORM setup_lock_dependent_views('supplier_sync_scopes');
  ALTER TABLE supplier_sync_scopes DROP CONSTRAINT IF EXISTS supplier_sync_scopes_supplier_check;
  ALTER TABLE supplier_sync_scopes ADD CONSTRAINT supplier_sync_scopes_supplier_check CHECK (supplier IN ('basbug','dinamik','seta'));
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS supplier_sync_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='supplier_sync_scopes'::regclass AND attname='daily_at' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('supplier_sync_scopes');
  ALTER TABLE supplier_sync_scopes ADD COLUMN daily_at time NOT NULL DEFAULT '03:00';
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='supplier_imports'::regclass AND c.relname='supplier_imports_success_idx') THEN
  CREATE INDEX supplier_imports_success_idx ON supplier_imports(supplier,company,list_group,warehouse,completed_at DESC,id DESC) WHERE status='succeeded';
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='supplier_imports'::regclass AND c.relname='supplier_imports_scope_runs_idx') THEN
  CREATE INDEX supplier_imports_scope_runs_idx ON supplier_imports(supplier,company,list_group,warehouse,started_at DESC,id DESC);
 END IF;
END $$;

-- Separate catalog discovery from recurring commercial observations.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='supplier_imports'::regclass AND attname='run_kind' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('supplier_imports');
  ALTER TABLE supplier_imports ADD COLUMN run_kind text NOT NULL DEFAULT 'full' CHECK (run_kind IN ('full','commerce'));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='supplier_sync_scopes'::regclass AND attname='commerce_enabled' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('supplier_sync_scopes');
  ALTER TABLE supplier_sync_scopes ADD COLUMN commerce_enabled boolean NOT NULL DEFAULT false;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='supplier_sync_scopes'::regclass AND attname='commerce_interval_minutes' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('supplier_sync_scopes');
  ALTER TABLE supplier_sync_scopes ADD COLUMN commerce_interval_minutes integer NOT NULL DEFAULT 60 CHECK (commerce_interval_minutes BETWEEN 15 AND 1440);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='supplier_sync_scopes'::regclass AND attname='commerce_stale_minutes' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('supplier_sync_scopes');
  ALTER TABLE supplier_sync_scopes ADD COLUMN commerce_stale_minutes integer NOT NULL DEFAULT 120 CHECK (commerce_stale_minutes > commerce_interval_minutes);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='supplier_sync_scopes'::regclass AND attname='commerce_next_run_at' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('supplier_sync_scopes');
  ALTER TABLE supplier_sync_scopes ADD COLUMN commerce_next_run_at timestamptz NOT NULL DEFAULT now();
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='supplier_sync_scopes'::regclass AND attname='commerce_last_success_at' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('supplier_sync_scopes');
  ALTER TABLE supplier_sync_scopes ADD COLUMN commerce_last_success_at timestamptz;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='supplier_sync_scopes'::regclass AND attname='commerce_failures' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('supplier_sync_scopes');
  ALTER TABLE supplier_sync_scopes ADD COLUMN commerce_failures integer NOT NULL DEFAULT 0;
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS supplier_scheduler_health (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 started_at timestamptz NOT NULL, finished_at timestamptz, succeeded boolean,
 CHECK (finished_at IS NULL OR finished_at >= started_at)
);
-- Suppliers whose scopes come from a published list (Dinamik brands): when the list was last read.
CREATE TABLE IF NOT EXISTS supplier_discovery (
 supplier text PRIMARY KEY CHECK (supplier IN ('dinamik')),
 checked_at timestamptz NOT NULL, listed integer NOT NULL CHECK (listed >= 0)
);
