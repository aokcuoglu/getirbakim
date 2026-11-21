CREATE TABLE IF NOT EXISTS commerce_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 markup_percent numeric(7,2) NOT NULL DEFAULT 30 CHECK(markup_percent BETWEEN 0 AND 1000),
 vat_percent numeric(5,2) NOT NULL DEFAULT 20 CHECK(vat_percent BETWEEN 0 AND 100),
 max_age_hours integer NOT NULL DEFAULT 36 CHECK(max_age_hours BETWEEN 1 AND 168),
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES accounts(id)
);
INSERT INTO commerce_settings(id) VALUES(true) ON CONFLICT DO NOTHING;
-- Optional per-field supplier product rates. Missing values continue to follow commerce_settings.
CREATE TABLE IF NOT EXISTS commerce_product_pricing (
 supplier_item_id uuid PRIMARY KEY REFERENCES supplier_items(id) ON DELETE CASCADE,
 markup_percent numeric(7,2) CHECK(markup_percent BETWEEN 0 AND 1000),
 vat_percent numeric(5,2) CHECK(vat_percent BETWEEN 0 AND 100),
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid NOT NULL REFERENCES accounts(id),
 CHECK(markup_percent IS NOT NULL OR vat_percent IS NOT NULL)
);
-- Admin edits of the store card (#575), projected onto supplier rows by db/product-overrides.sql: the product-level
-- product_overrides table is the source of truth; this copy exists because the catalog views below are created
-- before the master catalog. NULL keeps the supplier's value; hidden takes the row off sale everywhere.
CREATE TABLE IF NOT EXISTS commerce_item_overrides (
 supplier_item_id uuid PRIMARY KEY REFERENCES supplier_items(id) ON DELETE CASCADE,
 -- No FK: products is created later (db/product-matching.sql).
 product_id uuid NOT NULL,
 name text, description text, hidden boolean NOT NULL DEFAULT false
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='commerce_item_overrides'::regclass AND c.relname='commerce_item_overrides_product_idx') THEN
  CREATE INDEX commerce_item_overrides_product_idx ON commerce_item_overrides(product_id);
 END IF;
END $$;
-- Added only when missing: ADD COLUMN IF NOT EXISTS locks the table (ACCESS EXCLUSIVE) until setup commits even as a no-op.
-- Hand-set prices (#580), VAT included, in kuruş. price_kurus replaces the formula's price; sale_price_kurus sells below
-- it between sale_from and sale_until (a NULL end is open). Neither opens a row the formula cannot price: missing cost,
-- rate or freshness keeps the row unpriced (commerce_catalog below).
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_item_overrides'::regclass AND attname='price_kurus' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('commerce_item_overrides');
  ALTER TABLE commerce_item_overrides ADD COLUMN price_kurus integer CHECK(price_kurus>0);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_item_overrides'::regclass AND attname='sale_price_kurus' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('commerce_item_overrides');
  ALTER TABLE commerce_item_overrides ADD COLUMN sale_price_kurus integer CHECK(sale_price_kurus>0);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_item_overrides'::regclass AND attname='sale_from' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('commerce_item_overrides');
  ALTER TABLE commerce_item_overrides ADD COLUMN sale_from timestamptz;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_item_overrides'::regclass AND attname='sale_until' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('commerce_item_overrides');
  ALTER TABLE commerce_item_overrides ADD COLUMN sale_until timestamptz;
 END IF;
 -- Store brand (a master brand's name) and manufacturer part number (#602), shown as display_brand / display_code.
 -- brand and code stay the supplier's values: order lines, enrichment lookups and matching read those.
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_item_overrides'::regclass AND attname='brand' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('commerce_item_overrides');
  ALTER TABLE commerce_item_overrides ADD COLUMN brand text;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_item_overrides'::regclass AND attname='part_number' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('commerce_item_overrides');
  ALTER TABLE commerce_item_overrides ADD COLUMN part_number text;
 END IF;
END $$;
-- Store brand pages and the brand filter read the overridden rows of a brand (#771).
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='commerce_item_overrides'::regclass AND c.relname='commerce_item_overrides_brand_idx') THEN
  CREATE INDEX commerce_item_overrides_brand_idx ON commerce_item_overrides(brand) WHERE brand IS NOT NULL;
 END IF;
END $$;
-- Supplier OEM field hidden on the store (#615): the views show an empty oem, so the product page, cards, cart,
-- partner API and reference links drop it; storefront search skips these rows' stored OEM (src/modules/store/catalog.ts).
-- supplier_items keeps the value: the admin's supplier searches still read it; enrichment matched through this OEM
-- is ignored (enrichment_valid_data, #865) and matching drops it (#631, db/product-overrides.sql).
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_item_overrides'::regclass AND attname='hide_oem' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('commerce_item_overrides');
  ALTER TABLE commerce_item_overrides ADD COLUMN hide_oem boolean NOT NULL DEFAULT false;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_settings'::regclass AND attname='basbug_checkout_mode' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('commerce_settings');
  ALTER TABLE commerce_settings ADD COLUMN basbug_checkout_mode text NOT NULL DEFAULT 'live'
   CHECK(basbug_checkout_mode IN ('live','snapshot'));
 END IF;
END $$;
-- Polymorphic catalog identifiers: store products and current supplier observations.
CREATE TABLE IF NOT EXISTS commerce_cart_items (
 owner_kind text NOT NULL CHECK(owner_kind IN ('account','guest')), owner_id text NOT NULL,
 product_id uuid NOT NULL, quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 99),
 PRIMARY KEY(owner_kind,owner_id,product_id)
);
CREATE TABLE IF NOT EXISTS commerce_migrations(name text PRIMARY KEY);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM commerce_migrations WHERE name='legacy-carts') THEN
  INSERT INTO commerce_cart_items SELECT 'account',account_id::text,product_id,quantity FROM cart_items ON CONFLICT DO NOTHING;
  INSERT INTO commerce_cart_items SELECT 'guest',token_hash,product_id,quantity FROM guest_cart_items ON CONFLICT DO NOTHING;
  INSERT INTO commerce_migrations VALUES('legacy-carts');
 END IF;
END $$;
-- #809: Dinamik's cost (price_data.nf) was its list price; it is the list price less the 45 % and 5 % dealer discounts
-- and the row's campaign rate (dinamikCost in src/modules/suppliers/dinamik-pricing.ts, same rounding). Imports write
-- it from now on; this recomputes the rows already stored, once. Only price_data changes, so no trigger fires.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM commerce_migrations WHERE name='dinamik-dealer-discount') THEN
  UPDATE supplier_items SET price_data=price_data||jsonb_build_object('nf',
   round((price_data->>'fiyat')::numeric*55*95*(100-CASE WHEN jsonb_typeof(price_data->'kampanyaOrani')='number'
    AND (price_data->>'kampanyaOrani')::numeric>0 AND (price_data->>'kampanyaOrani')::numeric<100
    THEN (price_data->>'kampanyaOrani')::numeric ELSE 0 END)/1000000,2))
  WHERE supplier='dinamik' AND jsonb_typeof(price_data->'fiyat')='number' AND (price_data->>'fiyat')::numeric>0;
  INSERT INTO commerce_migrations VALUES('dinamik-dealer-discount');
 END IF;
END $$;
CREATE OR REPLACE FUNCTION cleanup_commerce_cart() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_ARGV[0]='account' THEN
 DELETE FROM commerce_cart_items WHERE owner_kind='account' AND owner_id=OLD.id::text;
 ELSE
 DELETE FROM commerce_cart_items WHERE owner_kind='guest' AND owner_id=OLD.token_hash;
 END IF;
 RETURN OLD;
END $$;
-- Created only when missing: CREATE [OR REPLACE] TRIGGER locks the table against writers (SHARE ROW EXCLUSIVE) until setup
-- commits. A changed function body needs only its CREATE OR REPLACE FUNCTION; a changed trigger definition needs a
-- DROP TRIGGER in the same change.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='accounts'::regclass AND tgname='cleanup_commerce_account_cart') THEN
  CREATE TRIGGER cleanup_commerce_account_cart BEFORE DELETE ON accounts FOR EACH ROW EXECUTE FUNCTION cleanup_commerce_cart('account');
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='guest_carts'::regclass AND tgname='cleanup_commerce_guest_cart') THEN
  CREATE TRIGGER cleanup_commerce_guest_cart BEFORE DELETE ON guest_carts FOR EACH ROW EXECUTE FUNCTION cleanup_commerce_cart('guest');
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS commerce_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 owner_kind text NOT NULL CHECK(owner_kind IN ('account','guest')), owner_id text NOT NULL,
 request_key uuid NOT NULL, customer_name text NOT NULL, email text NOT NULL, phone text NOT NULL,
 address text NOT NULL, note text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','shipped','cancelled')),
 total_kurus bigint NOT NULL CHECK(total_kurus>0), discount_percent integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_kind,owner_id,request_key)
);
CREATE TABLE IF NOT EXISTS commerce_order_items (
 order_id uuid NOT NULL REFERENCES commerce_orders(id), product_id uuid NOT NULL,
 code text NOT NULL, name text NOT NULL, supplier text NOT NULL, quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 99),
 unit_price_kurus bigint NOT NULL CHECK(unit_price_kurus>0), pricing_snapshot jsonb NOT NULL,
 PRIMARY KEY(order_id,product_id)
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='commerce_orders'::regclass AND c.relname='commerce_orders_owner_idx') THEN
  CREATE INDEX commerce_orders_owner_idx ON commerce_orders(owner_kind,owner_id,created_at DESC);
 END IF;
END $$;
-- Shared eligibility, without calculating prices for every catalog row.
-- Saleable sources: Başbuğ's MRK warehouse, SETA's single list, Dinamik codes that have a stock-list row
-- (price-list-only codes carry no name) and manual xlsx lists. All store cost as nf and availability as stok.
-- Views are replaced only when their definition changed (#954): CREATE OR REPLACE VIEW takes ACCESS EXCLUSIVE on the
-- view even when nothing changes, queueing every reader behind setup. The body is created as a temporary probe view and
-- the two pg_get_viewdef outputs are compared, so editing a body (or a column added behind a `*`) still replaces the
-- view on the next run. Dropping, renaming or reordering columns still needs a DROP VIEW first. A replace (like an ALTER
-- TABLE of a table views read) first locks the views that read it, outermost first: setup_lock_dependent_views (#1046).
DO $setup$ DECLARE def text := $view$
SELECT i.* FROM supplier_items i
WHERE ((i.supplier='basbug' AND i.warehouse='MRK') OR i.supplier IN ('seta','manual') OR (i.supplier='dinamik' AND i.stock_data IS NOT NULL)) AND i.presence='present' AND NOT i.conflicting
AND NOT EXISTS(SELECT 1 FROM store_products p WHERE p.supplier=i.supplier AND p.code=i.code);
$view$; cur regclass := (SELECT c.oid FROM pg_class c
  WHERE c.relname='commerce_supplier_items' AND c.relnamespace=current_schema()::regnamespace AND c.relkind='v'); BEGIN
 EXECUTE 'CREATE VIEW pg_temp.setup_view_probe AS '||def;
 IF pg_get_viewdef('pg_temp.setup_view_probe'::regclass) IS DISTINCT FROM pg_get_viewdef(cur) THEN
  -- Views that read this one first (#1046, db/schema.sql); a new view has none.
  IF cur IS NOT NULL THEN PERFORM setup_lock_dependent_views(cur); END IF;
  EXECUTE 'CREATE OR REPLACE VIEW commerce_supplier_items AS '||def;
 END IF;
 DROP VIEW pg_temp.setup_view_probe;
END $setup$;
-- Master brands (#811): the store shows a product's master brand name (brands.name) instead of the supplier's raw
-- label. Declared here as well as in db/product-matching.sql (which documents them) because this file runs first
-- (scripts/setup.ts) and some tests load it without product-matching.sql (scripts/test-payments.ts) or the other way
-- round (scripts/match-products.ts); keep both copies identical (scripts/test-manufacturers.ts compares them).
CREATE OR REPLACE FUNCTION supplier_item_brand(supplier text, product_data jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE supplier WHEN 'dinamik' THEN product_data->>'marka' ELSE product_data->>'uk' END
$$;
-- Manufacturer pages and the brand filter (#771) reach a brand's rows through this index (brand_label of the catalog
-- views). It stores supplier_item_brand()'s result: a changed function body needs a new index name (DROP + CREATE).
-- On a new database the ANALYZE supplier_items after setup commits (scripts/setup-maintenance.ts) gives it statistics.
-- Only when missing (looked up in this schema): CREATE INDEX IF NOT EXISTS still takes SHARE on the write-hot
-- supplier_items on every setup run. scripts/setup.ts builds it CONCURRENTLY before its transaction
-- (scripts/setup-concurrent-indexes.ts, keep the definitions identical), so this only runs on a new database.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='supplier_items'::regclass AND c.relname='supplier_items_brand_label_idx') THEN
  CREATE INDEX supplier_items_brand_label_idx ON supplier_items(supplier_item_brand(supplier,product_data));
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS brands (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, key text NOT NULL UNIQUE, name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
-- Each supplier's own label and its master brand. auto: placed by the brand key when first seen (a new label joins
-- the brand its key already belongs to); manual: confirmed or moved by an admin. Neither is ever moved automatically.
-- `items` counts the label's present rows at the last sync.
CREATE TABLE IF NOT EXISTS supplier_brands (
 supplier text NOT NULL, label text NOT NULL, brand_id bigint NOT NULL REFERENCES brands(id),
 method text NOT NULL DEFAULT 'auto' CHECK (method IN ('auto','manual')), items integer NOT NULL DEFAULT 0,
 decided_by uuid REFERENCES accounts(id), decided_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (supplier,label)
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='supplier_brands'::regclass AND c.relname='supplier_brands_brand_idx') THEN
  CREATE INDEX supplier_brands_brand_idx ON supplier_brands(brand_id);
 END IF;
END $$;
DO $setup$ DECLARE def text := $view$
SELECT id,category,supplier,code,name,brand,description,updated_at,
 ''::text AS oem,'store'::text AS source,''::text AS company,brand AS display_brand,code AS display_code,
 false AS name_overridden,brand AS brand_label FROM store_products
UNION ALL
SELECT i.id,NULLIF(i.product_data->>'category',''),i.supplier,i.code,
 COALESCE(ov.name,NULLIF(i.product_data->>'ac',''),i.code),COALESCE(NULLIF(i.product_data->>'uk',''),'Belirtilmemiş'),
 COALESCE(ov.description,i.product_data->>'ac2',''),i.changed_at,CASE WHEN ov.hide_oem THEN '' ELSE COALESCE(i.product_data->>'oe','') END,'supplier',i.company,
 -- Shown brand: the admin's, else the label's master brand (a merge or rename shows at once), else the raw label.
 COALESCE(ov.brand,mb.name,NULLIF(i.product_data->>'uk',''),'Belirtilmemiş'),COALESCE(ov.part_number,i.code),
 -- An admin's name (#686) is shown as written; a supplier's is converted by readableProductName (#659).
 ov.name IS NOT NULL,
 -- The supplier's own label, indexed (supplier_items_brand_label_idx): manufacturer pages reach a brand's rows by it (#771).
 supplier_item_brand(i.supplier,i.product_data)
FROM commerce_supplier_items i CROSS JOIN commerce_settings s
LEFT JOIN commerce_item_overrides ov ON ov.supplier_item_id=i.id
-- Unique keys on both sides, so the planner drops these joins from queries that do not read display_brand.
LEFT JOIN supplier_brands sb ON sb.supplier=i.supplier AND sb.label=supplier_item_brand(i.supplier,i.product_data)
LEFT JOIN brands mb ON mb.id=sb.brand_id
-- Hidden by an admin (#575): not for sale anywhere.
WHERE ov.hidden IS NOT TRUE;
$view$; cur regclass := (SELECT c.oid FROM pg_class c
  WHERE c.relname='commerce_catalog_entries' AND c.relnamespace=current_schema()::regnamespace AND c.relkind='v'); BEGIN
 EXECUTE 'CREATE VIEW pg_temp.setup_view_probe AS '||def;
 IF pg_get_viewdef('pg_temp.setup_view_probe'::regclass) IS DISTINCT FROM pg_get_viewdef(cur) THEN
  -- Views that read this one first (#1046, db/schema.sql); a new view has none.
  IF cur IS NOT NULL THEN PERFORM setup_lock_dependent_views(cur); END IF;
  EXECUTE 'CREATE OR REPLACE VIEW commerce_catalog_entries AS '||def;
 END IF;
 DROP VIEW pg_temp.setup_view_probe;
END $setup$;
DROP INDEX IF EXISTS supplier_items_catalog_order_idx;
-- The predicate mirrors commerce_supplier_items; a changed predicate needs a new index name.
DROP INDEX IF EXISTS supplier_items_saleable_order_idx;
DROP INDEX IF EXISTS supplier_items_saleable_order_v2_idx;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='supplier_items'::regclass AND c.relname='supplier_items_saleable_order_v3_idx') THEN
  CREATE INDEX supplier_items_saleable_order_v3_idx ON supplier_items(company,changed_at DESC,id)
   WHERE ((supplier='basbug' AND warehouse='MRK') OR supplier IN ('seta','manual') OR (supplier='dinamik' AND stock_data IS NOT NULL)) AND presence='present' AND NOT conflicting;
 END IF;
END $$;
-- Few supplier items carry a legacy category; the catalog resolves a category to ids through this index.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='supplier_items'::regclass AND c.relname='supplier_items_legacy_category_idx') THEN
  CREATE INDEX supplier_items_legacy_category_idx ON supplier_items((product_data->>'category'))
   WHERE product_data->>'category'<>'';
 END IF;
END $$;
-- Part numbers compared on the product page (cross references, OEM numbers): upper case, letters and
-- digits only. Indexed so a reference lookup reads the matching rows instead of normalising every item.
CREATE OR REPLACE FUNCTION part_number_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path FROM CURRENT AS $$ SELECT regexp_replace(upper(value),'[^A-Z0-9]','','g') $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='supplier_items'::regclass AND c.relname='supplier_items_part_key_idx') THEN
  CREATE INDEX supplier_items_part_key_idx ON supplier_items(part_number_key(substring(code from position(' ' in code)+1)));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='supplier_items'::regclass AND c.relname='supplier_items_oem_key_idx') THEN
  CREATE INDEX supplier_items_oem_key_idx ON supplier_items(part_number_key(product_data->>'oe'))
   WHERE product_data->>'oe'<>'';
 END IF;
END $$;
-- The sale-price rules (#882), defined once and called by commerce_catalog and by livePriceChanges
-- (src/modules/store/supplier-checkout.ts). Plain SQL bodies without SET or STRICT so the planner can inline them
-- (as supplier_item_brand); PARALLEL SAFE so a call that is not inlined keeps reads of the view parallel. A SET or
-- STRICT clause, or an expensive argument used twice in a body, turns the inline into a per-row call (same result,
-- slower full scans; scripts/test-supplier-checkout.ts checks the plan). now() is the caller's `at` argument, so
-- the functions stay IMMUTABLE. A changed signature cannot be replaced while the view uses it: add a new name.
-- The formula price in kuruş: NULL unless it rounds into 1..integer max.
CREATE OR REPLACE FUNCTION commerce_formula_price(cost numeric,exchange_rate numeric,markup_percent numeric,vat_percent numeric) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE WHEN round(cost*exchange_rate*(1+markup_percent/100)*(1+vat_percent/100)*100) BETWEEN 1 AND 2147483647
 THEN round(cost*exchange_rate*(1+markup_percent/100)*(1+vat_percent/100)*100)::integer END
$$;
-- The campaign price only inside its window [sale_from, sale_until); a NULL end is open.
CREATE OR REPLACE FUNCTION commerce_campaign_price(sale_price integer,sale_from timestamptz,sale_until timestamptz,at timestamptz) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE WHEN (sale_from IS NULL OR sale_from<=at) AND (sale_until IS NULL OR at<sale_until) THEN sale_price END
$$;
-- The admin's fixed price over the formula; a row the formula cannot price is not sold at a fixed price either.
CREATE OR REPLACE FUNCTION commerce_regular_price(auto_price integer,fixed_price integer) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE WHEN auto_price IS NOT NULL THEN COALESCE(fixed_price,auto_price) END
$$;
-- A campaign at or above the regular price is ignored.
CREATE OR REPLACE FUNCTION commerce_final_price(regular_price integer,sale_price integer) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE WHEN sale_price<regular_price THEN sale_price ELSE regular_price END
$$;
-- Single-row price anomalies (#1030, #1050): a supplier row whose currency disagrees with the rest of its brand and whose
-- converted cost is far above the brand's median (Başbuğ once sent one KENTPAR row as EUR among 196 TRY rows: a 77k TL
-- cost for a ~1.5k TL part). src/modules/suppliers/price-anomalies.ts detects them after a full list import; an open row
-- keeps its offer unpriced in commerce_catalog below (the product stays listed, sold by another supplier or not at all)
-- until the supplier corrects it (the next refresh deletes it) or an admin marks it "Anomali değil" (dismissed, kept
-- through later refreshes). No foreign key to supplier_items on purpose: creating one locks supplier_items (SHARE ROW
-- EXCLUSIVE) for the rest of the setup transaction and blocks order-time writes (basbug-item-refresh.ts); the refresh
-- deletes rows whose item is gone. The accounts FK (decided_by) takes SHARE ROW EXCLUSIVE on accounts once, when the
-- table is first created; later runs skip CREATE TABLE IF NOT EXISTS without locking it.
-- kind (#1050): 'currency' covers both directions (evidence.direction: absent/'high' = converted cost far above the
-- brand's median, 'low' = a rare-currency row far below it); 'offer-outlier' = a row 10× away from the same product's
-- other-supplier offers whose value fits them when read in another currency its brand prices in. On an existing table
-- the kind list is widened by scripts/setup-constraint-swaps.ts before the schema transaction; keep both lists equal.
CREATE TABLE IF NOT EXISTS supplier_price_anomalies (
 supplier_item_id uuid PRIMARY KEY, supplier text NOT NULL,
 kind text NOT NULL DEFAULT 'currency' CHECK (kind IN ('currency','offer-outlier')),
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed')),
 evidence jsonb NOT NULL, detected_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
 decided_by uuid REFERENCES accounts(id), decided_at timestamptz
);
DO $setup$ DECLARE def text := $view$
-- The latest succeeded import per supplier and company (#1158): the pairs, then each pair's newest import, both read
-- through supplier_imports_latest_success_idx (db/schema.sql; an index-only scan, then one index probe per pair). A
-- DISTINCT ON over every succeeded import scanned and sorted their heap rows on each read of the view (6-9 ms, most of a
-- by-id read; now ~0.7 ms). Same order as that DISTINCT ON (completed_at DESC NULLS FIRST, id DESC). A recursive loose
-- index scan for the pairs is faster still (~0.25 ms) but carries no column statistics: full scans of the view
-- (storefront entries refresh, merchant feed) then planned merge joins and took ~12% longer.
WITH pairs AS (
 SELECT DISTINCT supplier,company FROM supplier_imports WHERE status='succeeded'
), latest AS (
 SELECT p.supplier,p.company,l.currencies_data,l.completed_at FROM pairs p CROSS JOIN LATERAL (SELECT currencies_data,completed_at
  FROM supplier_imports i WHERE i.status='succeeded' AND i.supplier=p.supplier AND i.company=p.company
  ORDER BY i.completed_at DESC,i.id DESC LIMIT 1) l
), rates AS (
 SELECT supplier,company,completed_at,r->>'dovizCinsi' AS currency,(r->>'satis')::numeric AS rate
 FROM latest CROSS JOIN LATERAL jsonb_array_elements(currencies_data->'dovizListesi') r
), supplier_prices AS (
 SELECT i.*,COALESCE(p.markup_percent,s.markup_percent) AS markup_percent,
 COALESCE(p.vat_percent,s.vat_percent) AS vat_percent,s.max_age_hours,s.basbug_checkout_mode,
 -- A manual list's prices and stock are what an admin entered; they do not age like an API observation.
 (i.supplier='manual' OR (i.last_seen_at>now()-make_interval(hours=>s.max_age_hours)
 AND (NOT COALESCE(sc.commerce_enabled,false) OR i.last_seen_at>now()-sc.commerce_stale_minutes*interval '1 minute')
 AND (sc.last_success_at IS NULL OR sc.last_success_at>now()-COALESCE(sc.stale_minutes,2160)*interval '1 minute'))) AS source_fresh,
 CASE WHEN i.product_data->>'dc' IN ('TL','TRY') THEN 1::numeric ELSE r.rate END AS exchange_rate,
 CASE WHEN i.product_data->>'dc' IN ('TL','TRY') THEN i.last_seen_at ELSE r.completed_at END AS rate_at,
 (i.price_data->>'nf')::numeric AS cost,ov.name AS override_name,ov.description AS override_description,
 ov.price_kurus AS override_price,ov.sale_until,ov.brand AS override_brand,ov.part_number AS override_part_number,
 ov.hide_oem AS override_hide_oem,mb.name AS master_brand,
 -- The campaign price only inside its window; a NULL end is open.
 commerce_campaign_price(ov.sale_price_kurus,ov.sale_from,ov.sale_until,now()) AS sale_price,
 -- Rows with an admin price are few; every other row takes the formula's branches below and pays for it once.
 (ov.price_kurus IS NOT NULL OR ov.sale_price_kurus IS NOT NULL) AS admin_priced,
 -- An open price anomaly (#1030, #1050, supplier_price_anomalies above) keeps the row unpriced.
 (pa.supplier_item_id IS NOT NULL) AS price_anomaly
 FROM commerce_supplier_items i CROSS JOIN commerce_settings s
 LEFT JOIN commerce_product_pricing p ON p.supplier_item_id=i.id
 LEFT JOIN commerce_item_overrides ov ON ov.supplier_item_id=i.id
 LEFT JOIN supplier_brands sb ON sb.supplier=i.supplier AND sb.label=supplier_item_brand(i.supplier,i.product_data)
 LEFT JOIN brands mb ON mb.id=sb.brand_id
 LEFT JOIN supplier_sync_scopes sc ON sc.supplier=i.supplier AND sc.company=i.company AND sc.list_group=i.list_group AND sc.warehouse=i.warehouse
 LEFT JOIN rates r ON r.supplier=i.supplier AND r.company=i.company AND r.currency=i.product_data->>'dc'
 LEFT JOIN supplier_price_anomalies pa ON pa.supplier_item_id=i.id AND pa.status='open'
 WHERE ov.hidden IS NOT TRUE
), priced AS (
 -- The formula price (auto_price) is the only gate: an admin price never sells a row the formula cannot price.
 SELECT *,CASE WHEN cost>0 AND exchange_rate>0 AND NOT price_anomaly
 AND (basbug_checkout_mode='snapshot' OR ((supplier='manual' OR rate_at>now()-make_interval(hours=>max_age_hours)) AND source_fresh))
 THEN commerce_formula_price(cost,exchange_rate,markup_percent,vat_percent) END AS auto_price
 FROM supplier_prices
), sold AS (
 -- The price rules live in the commerce_*_price functions above; livePriceChanges (src/modules/store/supplier-checkout.ts,
 -- #861) calls the same functions (#882). These CTEs are inlined, so each column below is its expression wherever it
 -- is used: auto_price is evaluated in CASE branches only, the formula's branch first, so a row without an admin
 -- price computes it exactly once (as before #580). Rows with one recompute it a few times. The NOT admin_priced
 -- branches only save time (the functions give the same result for a NULL fixed and campaign price); keep
 -- commerce_regular_price/commerce_final_price behind them: they are not inlined (auto_price is used twice), and
 -- calling them on every row made full scans ~15% slower when measured (#882).
 SELECT *,CASE WHEN NOT admin_priced THEN NULL ELSE commerce_regular_price(auto_price,override_price) END AS regular_price
 FROM priced
), final AS (
 SELECT *,CASE WHEN NOT admin_priced THEN auto_price ELSE commerce_final_price(regular_price,sale_price) END AS final_price,
 CASE WHEN NOT admin_priced THEN false ELSE COALESCE(regular_price IS NOT NULL AND sale_price<regular_price,false) END AS on_sale,
 CASE WHEN NOT admin_priced THEN false ELSE regular_price IS NOT NULL AND (override_price IS NOT NULL OR COALESCE(sale_price<regular_price,false)) END AS overridden,
 jsonb_build_object('source','supplier','nf',cost,'currency',product_data->>'dc','exchange_rate',exchange_rate,
 'rate_at',rate_at,'markup_percent',markup_percent,'vat_percent',vat_percent,'stock',stock_data,'observed_at',last_seen_at,
 'checkout_mode',basbug_checkout_mode,'source_fresh',source_fresh,'company',company,'list_group',list_group,'warehouse',warehouse,
 'cost_kurus',round(cost*exchange_rate*100)) AS formula_snapshot
 FROM sold
)
SELECT id,category,supplier,code,name,brand,description,price_kurus,stock,updated_at,
 ''::text AS oem,'store'::text AS source,''::text AS company,
 stock>0 AS available,LEAST(stock,99) AS max_quantity,
 CASE WHEN stock>0 THEN 'Stokta mevcut: '||stock||' adet' ELSE 'Stokta yok' END AS stock_label,
 jsonb_build_object('source','store','base_price_kurus',price_kurus) AS pricing_snapshot,
 brand AS display_brand,code AS display_code,false AS name_overridden,brand AS brand_label
FROM store_products
UNION ALL
SELECT id,NULLIF(product_data->>'category',''),supplier,code,
 COALESCE(override_name,NULLIF(product_data->>'ac',''),code),COALESCE(NULLIF(product_data->>'uk',''),'Belirtilmemiş'),
 COALESCE(override_description,product_data->>'ac2',''),
 final_price,
 NULL::integer,changed_at,CASE WHEN override_hide_oem THEN '' ELSE COALESCE(product_data->>'oe','') END,'supplier',company,
 (basbug_checkout_mode='snapshot' OR source_fresh) AND
 (COALESCE((stock_data->>'stok')::numeric,0)>0 OR COALESCE((stock_data->>'sFarkliDepo')::numeric,0)>0),
 99,
 CASE WHEN basbug_checkout_mode='snapshot' AND (COALESCE((stock_data->>'stok')::numeric,0)>0 OR COALESCE((stock_data->>'sFarkliDepo')::numeric,0)>0) THEN 'Stokta · Siparişten sonra teyit edilir'
 WHEN NOT source_fresh AND basbug_checkout_mode='live' THEN 'Stok bilgisi güncelleniyor'
 WHEN stock_data IS NULL THEN 'Stok bilgisi bulunamadı'
 WHEN (stock_data->>'stok')::numeric>0 THEN 'Tedarikçide mevcut'
 WHEN (stock_data->>'sFarkliDepo')::numeric>0 THEN 'Diğer depoda mevcut'
 WHEN (stock_data->>'sYol')::numeric>0 THEN 'Tedarikçiye sevkiyat bekleniyor'
 ELSE 'Stokta yok' END,
 -- docs/commerce.md: price_kind fixed (the admin's price) or sale (the campaign; list_price_kurus is the price it replaces).
 CASE WHEN NOT overridden THEN formula_snapshot ELSE formula_snapshot
  || jsonb_build_object('source','override','price_kind',CASE WHEN on_sale THEN 'sale' ELSE 'fixed' END,'auto_price_kurus',auto_price)
  || CASE WHEN override_price IS NOT NULL THEN jsonb_build_object('fixed_price_kurus',override_price) ELSE '{}'::jsonb END
  || CASE WHEN on_sale THEN jsonb_build_object('list_price_kurus',regular_price,'sale_until',sale_until) ELSE '{}'::jsonb END
 END,
 COALESCE(override_brand,master_brand,NULLIF(product_data->>'uk',''),'Belirtilmemiş'),COALESCE(override_part_number,code),
 override_name IS NOT NULL,supplier_item_brand(supplier,product_data)
FROM final;
$view$; cur regclass := (SELECT c.oid FROM pg_class c
  WHERE c.relname='commerce_catalog' AND c.relnamespace=current_schema()::regnamespace AND c.relkind='v'); BEGIN
 EXECUTE 'CREATE VIEW pg_temp.setup_view_probe AS '||def;
 IF pg_get_viewdef('pg_temp.setup_view_probe'::regclass) IS DISTINCT FROM pg_get_viewdef(cur) THEN
  -- Views that read this one first (#1046, db/schema.sql); a new view has none.
  IF cur IS NOT NULL THEN PERFORM setup_lock_dependent_views(cur); END IF;
  EXECUTE 'CREATE OR REPLACE VIEW commerce_catalog AS '||def;
 END IF;
 DROP VIEW pg_temp.setup_view_probe;
END $setup$;
-- Prepaid checkout: card payment is collected on TAMI's hosted page before operations confirm the order.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_settings'::regclass AND attname='shipping_fee_kurus' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('commerce_settings');
  ALTER TABLE commerce_settings ADD COLUMN shipping_fee_kurus integer NOT NULL DEFAULT 15000
   CHECK(shipping_fee_kurus BETWEEN 0 AND 10000000);
 END IF;
 -- Zero disables the free-shipping threshold.
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_settings'::regclass AND attname='free_shipping_threshold_kurus' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('commerce_settings');
  ALTER TABLE commerce_settings ADD COLUMN free_shipping_threshold_kurus integer NOT NULL DEFAULT 150000
   CHECK(free_shipping_threshold_kurus BETWEEN 0 AND 1000000000);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='subtotal_kurus' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN subtotal_kurus bigint;
 END IF;
END $$;
UPDATE commerce_orders SET subtotal_kurus=total_kurus WHERE subtotal_kurus IS NULL;
-- SET NOT NULL locks the table and scans it even when already set: only once.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='subtotal_kurus' AND NOT attnotnull) THEN
  ALTER TABLE commerce_orders ALTER COLUMN subtotal_kurus SET NOT NULL;
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='shipping_kurus' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN shipping_kurus bigint NOT NULL DEFAULT 0 CHECK(shipping_kurus>=0);
 END IF;
 -- 'none' marks orders placed before online payment existed.
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='payment_status' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN payment_status text NOT NULL DEFAULT 'none'
   CHECK(payment_status IN ('none','awaiting','paid','expired','refund_required','refunded'));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='payment_due_at' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN payment_due_at timestamptz;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='paid_at' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN paid_at timestamptz;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='payment_note' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN payment_note text NOT NULL DEFAULT '';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='refund_reference' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN refund_reference text;
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='commerce_orders'::regclass AND conname='commerce_orders_status_check'
  AND pg_get_constraintdef(oid) LIKE '%awaiting_payment%') THEN
  ALTER TABLE commerce_orders DROP CONSTRAINT IF EXISTS commerce_orders_status_check;
  ALTER TABLE commerce_orders ADD CONSTRAINT commerce_orders_status_check
   CHECK(status IN ('awaiting_payment','pending','confirmed','shipped','cancelled'));
 END IF;
END $$;
-- Shipment (#605): carrier is a code from src/modules/store/shipment.ts (validated there, no CHECK so the list can grow);
-- carrier_name is the free name for 'other'. tracking_url is resolved when written: the admin's link, else the carrier template.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='carrier' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN carrier text;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='carrier_name' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN carrier_name text;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='tracking_no' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN tracking_no text;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='tracking_url' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN tracking_url text;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='shipped_at' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN shipped_at timestamptz;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='delivered_at' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN delivered_at timestamptz;
 END IF;
END $$;
-- Widens the list above once. Its result still contains 'awaiting_payment', so the two blocks never undo each other.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='commerce_orders'::regclass AND conname='commerce_orders_status_check'
  AND pg_get_constraintdef(oid) LIKE '%delivered%') THEN
  ALTER TABLE commerce_orders DROP CONSTRAINT IF EXISTS commerce_orders_status_check;
  ALTER TABLE commerce_orders ADD CONSTRAINT commerce_orders_status_check
   CHECK(status IN ('awaiting_payment','pending','confirmed','shipped','delivered','cancelled'));
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='commerce_orders'::regclass AND c.relname='commerce_orders_payment_due_idx') THEN
  CREATE INDEX commerce_orders_payment_due_idx ON commerce_orders(payment_due_at) WHERE status='awaiting_payment';
 END IF;
END $$;
-- One row per hosted-page attempt. provider_order_id is the orderId sent to TAMI and must never be reused.
CREATE TABLE IF NOT EXISTS commerce_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES commerce_orders(id),
 provider text NOT NULL DEFAULT 'tami' CHECK(provider='tami'),
 provider_order_id text NOT NULL UNIQUE,
 amount_kurus bigint NOT NULL CHECK(amount_kurus>0),
 status text NOT NULL DEFAULT 'initiated' CHECK(status IN ('initiated','pending','succeeded','abandoned')),
 hosted_url text, failure_reason text, provider_result jsonb,
 bank_reference text, bank_auth_code text, installment_count integer,
 created_at timestamptz NOT NULL DEFAULT now(), checked_at timestamptz, paid_at timestamptz
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='commerce_payments'::regclass AND c.relname='commerce_payments_order_idx') THEN
  CREATE INDEX commerce_payments_order_idx ON commerce_payments(order_id,created_at DESC);
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='commerce_payments'::regclass AND c.relname='commerce_payments_open_idx') THEN
  CREATE INDEX commerce_payments_open_idx ON commerce_payments(checked_at NULLS FIRST) WHERE status IN ('initiated','pending');
 END IF;
END $$;
-- TAMI void/refund calls made from /yonetim (#619). One row per provider call, each with its own correlation id.
-- A row is committed as 'requested' before TAMI is called, so a crash or a lost reply leaves evidence. 'unknown' means
-- TAMI may have reversed the payment; it blocks a new call until a signed query or operations settles it.
-- Full reversals only: at most one active (requested/unknown/succeeded) row per payment attempt.
CREATE TABLE IF NOT EXISTS commerce_payment_refunds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 payment_id uuid NOT NULL REFERENCES commerce_payments(id),
 order_id uuid NOT NULL REFERENCES commerce_orders(id),
 kind text NOT NULL CHECK(kind IN ('void','refund')),
 amount_kurus bigint NOT NULL CHECK(amount_kurus>0),
 status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','succeeded','failed','unknown')),
 correlation_id text NOT NULL UNIQUE,
 bank_reference text, bank_auth_code text, provider_transaction_at text,
 error_code text, error_message text, provider_result jsonb,
 requested_by uuid REFERENCES accounts(id),
 requested_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, checked_at timestamptz
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='commerce_payment_refunds'::regclass AND c.relname='commerce_payment_refunds_active_idx') THEN
  CREATE UNIQUE INDEX commerce_payment_refunds_active_idx ON commerce_payment_refunds(payment_id)
    WHERE status IN ('requested','unknown','succeeded');
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='commerce_payment_refunds'::regclass AND c.relname='commerce_payment_refunds_order_idx') THEN
  CREATE INDEX commerce_payment_refunds_order_idx ON commerce_payment_refunds(order_id,requested_at);
 END IF;
END $$;
-- When the order's money went back to the customer (TAMI API or a manually recorded reference).
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='refunded_at' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN refunded_at timestamptz;
 END IF;
 -- Fitment guarantee, phase 0: measure compatibility before promising it.
 -- The garage vehicle is captured when a product is added and copied to the order line together
 -- with the compatibility level computed at checkout. No FK: orders outlive vehicle catalog reloads.
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_cart_items'::regclass AND attname='vehicle' AND NOT attisdropped) THEN
  ALTER TABLE commerce_cart_items ADD COLUMN vehicle jsonb
   CHECK(vehicle IS NULL OR jsonb_typeof(vehicle)='object');
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_order_items'::regclass AND attname='vehicle' AND NOT attisdropped) THEN
  ALTER TABLE commerce_order_items ADD COLUMN vehicle jsonb
   CHECK(vehicle IS NULL OR jsonb_typeof(vehicle)='object');
 END IF;
 -- NULL only on lines created before levels were recorded.
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_order_items'::regclass AND attname='fitment_level' AND NOT attisdropped) THEN
  ALTER TABLE commerce_order_items ADD COLUMN fitment_level text
   CHECK(fitment_level IN ('guaranteed','likely','mismatch','unknown','no_vehicle'));
 END IF;
END $$;
-- Returns are recorded by operations per order line; several partial returns may add up to the ordered quantity.
CREATE TABLE IF NOT EXISTS commerce_returns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL, product_id uuid NOT NULL,
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 99),
 reason text NOT NULL CHECK(reason IN ('not_fit','wrong_item','damaged','defective','changed_mind','other')),
 note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES accounts(id),
 FOREIGN KEY(order_id,product_id) REFERENCES commerce_order_items(order_id,product_id)
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='commerce_returns'::regclass AND c.relname='commerce_returns_line_idx') THEN
  CREATE INDEX commerce_returns_line_idx ON commerce_returns(order_id,product_id);
 END IF;
END $$;
-- Store stock actually taken for a line (#516). Cancelling or expiring an order returns exactly this and sets it to 0,
-- so a line that a late payment could not reserve, or a second cancel, never inflates stock.
-- NULL marks lines written by code without the column (orders before this change, or written by the previous release
-- while a deployment runs): the release falls back to the old rule (full quantity of a store product).
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_order_items'::regclass AND attname='reserved_quantity' AND NOT attisdropped) THEN
  ALTER TABLE commerce_order_items ADD COLUMN reserved_quantity integer;
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='commerce_order_items'::regclass AND conname='commerce_order_items_reserved_check') THEN
  ALTER TABLE commerce_order_items ADD CONSTRAINT commerce_order_items_reserved_check
   CHECK(reserved_quantity IS NULL OR reserved_quantity BETWEEN 0 AND quantity);
 END IF;
END $$;
-- Backfill from what the old code did: checkout took the full quantity of every store product line; expiry and
-- cancellation gave it back. A late payment that found stock short says so in the payment note without naming
-- the line, so none of that order's lines count as reserved (stock is never inflated; operations decide by hand).
UPDATE commerce_order_items i SET reserved_quantity=CASE
  WHEN o.status<>'cancelled' AND position('mağaza stoku yetersiz' in o.payment_note)=0
   AND EXISTS(SELECT 1 FROM store_products p WHERE p.id=i.product_id) THEN i.quantity ELSE 0 END
FROM commerce_orders o WHERE o.id=i.order_id AND i.reserved_quantity IS NULL;
-- Admin list order and the dashboard's 14-day chart (a created_at range per Istanbul day).
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='commerce_orders'::regclass AND c.relname='commerce_orders_created_idx') THEN
  CREATE INDEX commerce_orders_created_idx ON commerce_orders(created_at DESC,id DESC);
 END IF;
END $$;
-- Checkout consent evidence and the order-specific pre-contract text (#604). One row per order, written in the
-- order's transaction; orders placed before this change have none. The row is never updated (trigger below):
-- `document` is the full Ön Bilgilendirme Formu + Mesafeli Satış Sözleşmesi as shown for that order, so later
-- edits to the site's legal pages do not change it. Deleting the order removes it.
CREATE TABLE IF NOT EXISTS commerce_order_agreements (
 order_id uuid PRIMARY KEY REFERENCES commerce_orders(id) ON DELETE CASCADE,
 accepted_at timestamptz NOT NULL DEFAULT now(),
 ip text, forwarded_for text, user_agent text,
 consent_text text NOT NULL, legal_version text NOT NULL,
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object')
);
CREATE OR REPLACE FUNCTION commerce_order_agreement_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'commerce_order_agreements rows are immutable';
END $$;
-- Created only when missing (#965): CREATE [OR REPLACE] TRIGGER locks the table against writers until setup commits.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='commerce_order_agreements'::regclass AND tgname='commerce_order_agreement_immutable') THEN
  CREATE TRIGGER commerce_order_agreement_immutable BEFORE UPDATE ON commerce_order_agreements FOR EACH ROW EXECUTE FUNCTION commerce_order_agreement_immutable();
 END IF;
END $$;
-- Procurement of order lines (#606): operations mark each supplier line as ordered from the supplier (with an optional
-- reference) and then procured. Store-stock lines (pricing_snapshot.source='store') need none and keep 'pending'.
-- Existing lines start as 'pending'; the admin list shows no badge for shipped, delivered or cancelled orders.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_order_items'::regclass AND attname='procurement_status' AND NOT attisdropped) THEN
  ALTER TABLE commerce_order_items ADD COLUMN procurement_status text NOT NULL DEFAULT 'pending'
   CHECK(procurement_status IN ('pending','ordered','procured'));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_order_items'::regclass AND attname='procurement_ref' AND NOT attisdropped) THEN
  ALTER TABLE commerce_order_items ADD COLUMN procurement_ref text;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_order_items'::regclass AND attname='procurement_ordered_at' AND NOT attisdropped) THEN
  ALTER TABLE commerce_order_items ADD COLUMN procurement_ordered_at timestamptz;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_order_items'::regclass AND attname='procured_at' AND NOT attisdropped) THEN
  ALTER TABLE commerce_order_items ADD COLUMN procured_at timestamptz;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_order_items'::regclass AND attname='procurement_by' AND NOT attisdropped) THEN
  ALTER TABLE commerce_order_items ADD COLUMN procurement_by uuid REFERENCES accounts(id);
 END IF;
 -- Customer cancellation (#607). Who cancelled and when; orders cancelled before this change keep NULL.
 -- payment_status 'cancelled': the customer cancelled before paying (not 'expired', which a late payment may revive).
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='cancelled_by' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN cancelled_by text CHECK(cancelled_by IN ('customer','admin','expiry'));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='cancelled_at' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN cancelled_at timestamptz;
 END IF;
END $$;
-- Widens the payment_status list above once. The inline CHECK's generated name is not relied on: it is found by definition.
DO $$ DECLARE c text; BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='commerce_orders'::regclass AND contype='c'
  AND pg_get_constraintdef(oid) LIKE '%payment_status%' AND pg_get_constraintdef(oid) LIKE '%''cancelled''%') THEN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='commerce_orders'::regclass AND contype='c'
   AND pg_get_constraintdef(oid) LIKE '%payment_status%' LOOP
   EXECUTE format('ALTER TABLE commerce_orders DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE commerce_orders ADD CONSTRAINT commerce_orders_payment_status_check
   CHECK(payment_status IN ('none','awaiting','paid','expired','cancelled','refund_required','refunded'));
 END IF;
END $$;
-- GA4 purchase measurement (#675). Set once by the order's own customer when the purchase event is handed to the browser;
-- NULL = not sent yet. No backfill: orders paid before this change can still be measured within the 7-day window.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='purchase_tracked_at' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN purchase_tracked_at timestamptz;
  COMMENT ON COLUMN commerce_orders.purchase_tracked_at IS 'GA4 purchase sent for this order (#675); claimed once by the order''s own customer';
 END IF;
 -- GA4 refund measurement (#750). Set once by the order's own customer when the refund event is handed to the browser, only for
 -- orders whose purchase was measured; NULL = not sent yet. No backfill.
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='refund_tracked_at' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN refund_tracked_at timestamptz;
  COMMENT ON COLUMN commerce_orders.refund_tracked_at IS 'GA4 refund sent for this order (#750); claimed once by the order''s own customer, only after purchase_tracked_at';
 END IF;
 -- Payment options with an installment fee (#886). Off by default: checkout then behaves as before (single payment).
 -- Rates are the merchant commission percentages of the TAMI portal; the customer total of an n-installment order is
 -- cash × (1 − single rate) / (1 − n rate). installment_rates keys are "2".."12"; a missing key hides that option.
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_settings'::regclass AND attname='installments_enabled' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('commerce_settings');
  ALTER TABLE commerce_settings ADD COLUMN installments_enabled boolean NOT NULL DEFAULT false;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_settings'::regclass AND attname='installment_max' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('commerce_settings');
  ALTER TABLE commerce_settings ADD COLUMN installment_max integer NOT NULL DEFAULT 6 CHECK(installment_max BETWEEN 2 AND 12);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_settings'::regclass AND attname='installment_min_basket_kurus' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('commerce_settings');
  ALTER TABLE commerce_settings ADD COLUMN installment_min_basket_kurus integer NOT NULL DEFAULT 0 CHECK(installment_min_basket_kurus BETWEEN 0 AND 1000000000);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_settings'::regclass AND attname='installment_single_rate' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('commerce_settings');
  ALTER TABLE commerce_settings ADD COLUMN installment_single_rate numeric(5,2) NOT NULL DEFAULT 2.85 CHECK(installment_single_rate BETWEEN 0 AND 50);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_settings'::regclass AND attname='installment_rates' AND NOT attisdropped) THEN
  PERFORM setup_lock_dependent_views('commerce_settings');
  ALTER TABLE commerce_settings ADD COLUMN installment_rates jsonb NOT NULL
   DEFAULT '{"2":5.89,"3":7.95,"4":9.88,"5":11.72,"6":13.47,"7":15.39,"8":17.23,"9":18.97,"10":20.85,"11":22.71,"12":24.32}';
 END IF;
 -- The installment count chosen at checkout and its fee. total_kurus includes the fee; the cash price is
 -- total_kurus − installment_fee_kurus. Orders placed before this change are single payments without a fee.
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='installment_count' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN installment_count integer NOT NULL DEFAULT 1 CHECK(installment_count BETWEEN 1 AND 12);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='installment_fee_kurus' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN installment_fee_kurus bigint NOT NULL DEFAULT 0 CHECK(installment_fee_kurus>=0);
 END IF;
 -- Structured delivery address and invoice details (#881); NULL on orders placed before it. `address` keeps the combined text.
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='delivery_province' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN delivery_province text;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='delivery_district' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN delivery_district text;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='delivery_address_line' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN delivery_address_line text;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='delivery_postal_code' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN delivery_postal_code text;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='invoice_type' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN invoice_type text CHECK(invoice_type IN ('individual','corporate'));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='invoice_company' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN invoice_company text;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='invoice_tax_no' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN invoice_tax_no text;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='invoice_tax_office' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN invoice_tax_office text;
 END IF;
 -- Separate invoice address (#916); all NULL when the invoice goes to the delivery address.
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='invoice_province' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN invoice_province text;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='invoice_district' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN invoice_district text;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='invoice_address_line' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN invoice_address_line text;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='invoice_postal_code' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN invoice_postal_code text;
 END IF;
END $$;
-- Geliver shipping labels (#960). Each label purchase is its own row, committed as 'requested' before the Geliver call,
-- so a lost reply is never forgotten: 'unknown' (and a still 'requested' row) blocks a new label until "Geliver'de kontrol
-- et" settles it. 'failed' = Geliver refused it, a new attempt is allowed. The tracking_* columns follow the
-- TRACK_UPDATED webhook. test = a free Geliver test label (GELIVER_MODE other than live), no real parcel moves.
CREATE TABLE IF NOT EXISTS commerce_geliver_shipments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES commerce_orders(id),
 status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','purchased','failed','unknown')),
 test boolean NOT NULL,
 service_code text NOT NULL,
 order_number text NOT NULL,
 parcel jsonb NOT NULL,
 geliver_shipment_id text, geliver_transaction_id text, barcode text, label_url text,
 tracking_number text, tracking_url text, tracking_status_code text, tracking_sub_status_code text, tracking_status_details text,
 tracking_location text,
 -- tracking_status_at: the carrier's time of the status (statusDate, else Geliver's), shown to operations;
 -- tracking_updated_at: Geliver's record time (updatedAt), the one clock webhook events are ordered by.
 tracking_status_at timestamptz, tracking_updated_at timestamptz,
 error_code text, error_message text,
 requested_by uuid REFERENCES accounts(id),
 requested_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, checked_at timestamptz
);
-- At most one label per order that is bought or may have been bought.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='commerce_geliver_shipments'::regclass AND c.relname='commerce_geliver_shipments_active_idx') THEN
  CREATE UNIQUE INDEX commerce_geliver_shipments_active_idx ON commerce_geliver_shipments(order_id)
    WHERE status IN ('requested','unknown','purchased');
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='commerce_geliver_shipments'::regclass AND c.relname='commerce_geliver_shipments_remote_idx') THEN
  CREATE UNIQUE INDEX commerce_geliver_shipments_remote_idx ON commerce_geliver_shipments(geliver_shipment_id)
    WHERE geliver_shipment_id IS NOT NULL;
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='commerce_geliver_shipments'::regclass AND c.relname='commerce_geliver_shipments_order_idx') THEN
  CREATE INDEX commerce_geliver_shipments_order_idx ON commerce_geliver_shipments(order_id,requested_at DESC);
 END IF;
END $$;
-- Partner orders (#426). A partner (BakımX) orders through /api/partner/v1 as owner_kind='partner', owner_id=<partner
-- code from PARTNER_API_KEYS>. It pays on account: the order opens without a payment (payment_status 'on_account'), is
-- invoiced to the partner later and never enters the TAMI payment window or its expiry. partner_fingerprint is the hash
-- of the request body sent with the order's Idempotency-Key (request_key): the same key with another body is refused.
-- Both CHECKs are found by definition (the inline owner_kind CHECK's generated name is not relied on) and widened once.
DO $$ DECLARE c text; BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='commerce_orders'::regclass AND contype='c'
  AND pg_get_constraintdef(oid) LIKE '%owner_kind%' AND pg_get_constraintdef(oid) LIKE '%''partner''%') THEN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='commerce_orders'::regclass AND contype='c'
   AND pg_get_constraintdef(oid) LIKE '%owner_kind%' LOOP
   EXECUTE format('ALTER TABLE commerce_orders DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE commerce_orders ADD CONSTRAINT commerce_orders_owner_kind_check CHECK(owner_kind IN ('account','guest','partner'));
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='commerce_orders'::regclass AND contype='c'
  AND pg_get_constraintdef(oid) LIKE '%payment_status%' AND pg_get_constraintdef(oid) LIKE '%''on_account''%') THEN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='commerce_orders'::regclass AND contype='c'
   AND pg_get_constraintdef(oid) LIKE '%payment_status%' LOOP
   EXECUTE format('ALTER TABLE commerce_orders DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE commerce_orders ADD CONSTRAINT commerce_orders_payment_status_check
   CHECK(payment_status IN ('none','awaiting','paid','expired','cancelled','refund_required','refunded','on_account'));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='partner_fingerprint' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN partner_fingerprint text;
  COMMENT ON COLUMN commerce_orders.partner_fingerprint IS 'Partner orders (#426): SHA-256 of the request body sent with the Idempotency-Key (request_key)';
 END IF;
 -- Partner cancel request (#426): a partner's DELETE on a confirmed order asks operations instead of cancelling. Open =
 -- requested and not rejected; approving it cancels the order (cancelled_by 'customer'), rejecting it is final.
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='cancel_requested_at' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN cancel_requested_at timestamptz;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='cancel_request_rejected_at' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN cancel_request_rejected_at timestamptz;
 END IF;
 -- Partner invoicing (#426): operations mark a delivered partner order invoiced (invoice number + date); from then on it
 -- no longer counts against the partner's open-order limit (src/modules/partner/limits.ts). Collection is not tracked.
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='partner_invoiced_at' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN partner_invoiced_at timestamptz;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='partner_invoice_ref' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN partner_invoice_ref text;
 END IF;
 -- Who marked it (audit). The FK takes SHARE ROW EXCLUSIVE on accounts once, on the first deploy that adds the column.
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_orders'::regclass AND attname='partner_invoiced_by' AND NOT attisdropped) THEN
  ALTER TABLE commerce_orders ADD COLUMN partner_invoiced_by uuid REFERENCES accounts(id);
 END IF;
END $$;
-- Per-partner settings set in /yonetim/partnerler (#426). Partner identities still come from PARTNER_API_KEYS; a row here
-- only overrides the PARTNER_ORDER_LIMIT_KURUS fallback. A partner with neither cannot order (503 ORDER_LIMIT_UNAVAILABLE).
-- order_intake_paused_at (#1009) pauses the partner's new quotes and orders (503 ORDER_INTAKE_PAUSED) until it is cleared;
-- reads, cancels and replays of existing orders keep working. NULL = open. discount_bps (#1130) is the partner's B2B discount.
CREATE TABLE IF NOT EXISTS partner_settings(
 partner_code text PRIMARY KEY,
 order_limit_kurus bigint CHECK(order_limit_kurus > 0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES accounts(id)
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='partner_settings'::regclass AND attname='order_intake_paused_at' AND NOT attisdropped) THEN
  ALTER TABLE partner_settings ADD COLUMN order_intake_paused_at timestamptz;
 END IF;
 -- Who paused it (audit). The FK takes SHARE ROW EXCLUSIVE on accounts once, on the first deploy that adds the column.
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='partner_settings'::regclass AND attname='order_intake_paused_by' AND NOT attisdropped) THEN
  ALTER TABLE partner_settings ADD COLUMN order_intake_paused_by uuid REFERENCES accounts(id);
 END IF;
 -- The partner's B2B discount in basis points (#1130), applied to its product prices, quotes and orders; never below
 -- cost (src/modules/partner/pricing.ts). NULL = the PARTNER_B2B_DISCOUNT_BPS fallback, then no discount.
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='partner_settings'::regclass AND attname='discount_bps' AND NOT attisdropped) THEN
  ALTER TABLE partner_settings ADD COLUMN discount_bps integer CHECK(discount_bps BETWEEN 0 AND 9000);
 END IF;
END $$;
-- Every change of a partner's panel discount (#1130): old and new value (NULL = fallback), who and when.
CREATE TABLE IF NOT EXISTS partner_discount_changes(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 partner_code text NOT NULL,
 old_discount_bps integer,
 new_discount_bps integer,
 changed_by uuid REFERENCES accounts(id),
 changed_at timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='partner_discount_changes'::regclass AND c.relname='partner_discount_changes_partner_idx') THEN
  CREATE INDEX partner_discount_changes_partner_idx ON partner_discount_changes(partner_code,changed_at DESC);
 END IF;
END $$;
-- Corrections of a partner invoiced mark (#1018): one row per order, the rows of one change share change_id. 'undo'
-- clears the mark (the order counts against the partner's limit again), 'correct' rewrites the invoice number/date;
-- the old values and the reason stay here for audit.
CREATE TABLE IF NOT EXISTS partner_invoice_changes(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 change_id uuid NOT NULL,
 order_id uuid NOT NULL REFERENCES commerce_orders(id) ON DELETE CASCADE,
 partner_code text NOT NULL,
 action text NOT NULL CHECK(action IN ('undo','correct')),
 old_invoice_ref text NOT NULL, old_invoiced_at timestamptz NOT NULL, old_invoiced_by uuid REFERENCES accounts(id),
 new_invoice_ref text, new_invoiced_at timestamptz,
 reason text NOT NULL CHECK(length(btrim(reason))>=5),
 changed_by uuid REFERENCES accounts(id),
 changed_at timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='partner_invoice_changes'::regclass AND c.relname='partner_invoice_changes_partner_idx') THEN
  CREATE INDEX partner_invoice_changes_partner_idx ON partner_invoice_changes(partner_code,changed_at DESC);
 END IF;
END $$;
-- Partner return requests (#1007): POST /api/partner/v1/orders/:id/returns on a shipped or delivered order. Operations
-- decide them in /yonetim/siparisler; only an approval writes commerce_returns (one row per line, linked back here), so
-- the store's return readers see accepted returns only. Pending requests hold their quantity: accepted + pending never
-- exceeds the ordered quantity (src/modules/partner/returns.ts, recordOrderReturn). request_key = the Idempotency-Key.
CREATE TABLE IF NOT EXISTS partner_return_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES commerce_orders(id) ON DELETE CASCADE,
 partner_code text NOT NULL,
 request_key uuid NOT NULL,
 fingerprint text NOT NULL,
 status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','rejected')),
 note text NOT NULL DEFAULT '',
 requested_at timestamptz NOT NULL DEFAULT now(),
 decided_at timestamptz,
 decided_by uuid REFERENCES accounts(id),
 UNIQUE(partner_code,request_key),
 -- Target of the lines' (request_id,order_id) key: a line always belongs to its request's order.
 UNIQUE(id,order_id),
 CHECK((status='requested')=(decided_at IS NULL))
);
CREATE TABLE IF NOT EXISTS partner_return_request_lines(
 request_id uuid NOT NULL,
 order_id uuid NOT NULL,
 product_id uuid NOT NULL,
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 99),
 reason text NOT NULL CHECK(reason IN ('not_fit','wrong_item','damaged','defective','changed_mind','other')),
 PRIMARY KEY(request_id,product_id),
 FOREIGN KEY(request_id,order_id) REFERENCES partner_return_requests(id,order_id) ON DELETE CASCADE,
 FOREIGN KEY(order_id,product_id) REFERENCES commerce_order_items(order_id,product_id)
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='partner_return_requests'::regclass AND c.relname='partner_return_requests_order_idx') THEN
  CREATE INDEX partner_return_requests_order_idx ON partner_return_requests(order_id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='partner_return_request_lines'::regclass AND c.relname='partner_return_request_lines_line_idx') THEN
  CREATE INDEX partner_return_request_lines_line_idx ON partner_return_request_lines(order_id,product_id);
 END IF;
 -- The partner request an accepted return came from. The first deploy that creates these tables and the column takes,
 -- for that run only, SHARE ROW EXCLUSIVE on commerce_orders, accounts and commerce_order_items (the new tables' FKs)
 -- and on partner_return_requests, and ACCESS EXCLUSIVE on commerce_returns (a small table) for ADD COLUMN.
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_returns'::regclass AND attname='partner_return_request_id' AND NOT attisdropped) THEN
  ALTER TABLE commerce_returns ADD COLUMN partner_return_request_id uuid REFERENCES partner_return_requests(id) ON DELETE SET NULL;
 END IF;
END $$;

-- Order emails (#951): one row per order and kind, written in the payment transaction that settles the order
-- (src/modules/payments/checkout.ts recordPaid); delivery (src/modules/store/order-email.ts) claims pending rows with a
-- lease, so concurrent reconcilers send each email once. 'skipped' = no mail transport configured or too old to send.
-- requeued_at: an admin's resend (#1035); staleness counts from it.
-- kind: status emails (#1036); an existing table gets the list from scripts/setup-constraint-swaps.ts, which must match.
CREATE TABLE IF NOT EXISTS commerce_order_emails (
 order_id uuid NOT NULL REFERENCES commerce_orders(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('confirmation','shipped','cancelled','refunded')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','skipped','failed')),
 attempts integer NOT NULL DEFAULT 0, claimed_at timestamptz, sent_at timestamptz,
 message_id text, last_error text, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(order_id,kind)
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='commerce_order_emails'::regclass AND c.relname='commerce_order_emails_pending_idx') THEN
  CREATE INDEX commerce_order_emails_pending_idx ON commerce_order_emails(created_at) WHERE status='pending';
 END IF;
END $$;
-- An admin's resend from /yonetim/siparisler (#1035): when and by whom a row was put back in the queue. Added only when
-- missing (ADD COLUMN IF NOT EXISTS locks the table even as a no-op); no view reads this table. The FK takes SHARE ROW
-- EXCLUSIVE on accounts once, on the first deploy that adds the column.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_order_emails'::regclass AND attname='requeued_at' AND NOT attisdropped) THEN
  ALTER TABLE commerce_order_emails ADD COLUMN requeued_at timestamptz;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='commerce_order_emails'::regclass AND attname='requeued_by' AND NOT attisdropped) THEN
  ALTER TABLE commerce_order_emails ADD COLUMN requeued_by uuid REFERENCES accounts(id);
 END IF;
END $$;
