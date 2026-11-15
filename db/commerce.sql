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
CREATE INDEX IF NOT EXISTS commerce_item_overrides_product_idx ON commerce_item_overrides(product_id);
-- Hand-set prices (#580), VAT included, in kuruş. price_kurus replaces the formula's price; sale_price_kurus sells below
-- it between sale_from and sale_until (a NULL end is open). Neither opens a row the formula cannot price: missing cost,
-- rate or freshness keeps the row unpriced (commerce_catalog below).
ALTER TABLE commerce_item_overrides ADD COLUMN IF NOT EXISTS price_kurus integer CHECK(price_kurus>0);
ALTER TABLE commerce_item_overrides ADD COLUMN IF NOT EXISTS sale_price_kurus integer CHECK(sale_price_kurus>0);
ALTER TABLE commerce_item_overrides ADD COLUMN IF NOT EXISTS sale_from timestamptz;
ALTER TABLE commerce_item_overrides ADD COLUMN IF NOT EXISTS sale_until timestamptz;
-- Store brand (a master brand's name) and manufacturer part number (#602), shown as display_brand / display_code.
-- brand and code stay the supplier's values: order lines, enrichment lookups and matching read those.
ALTER TABLE commerce_item_overrides ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE commerce_item_overrides ADD COLUMN IF NOT EXISTS part_number text;
-- Supplier OEM field hidden on the store (#615): the views show an empty oem, so the product page, cards, cart,
-- partner API and reference links drop it; storefront search skips these rows' stored OEM (src/modules/store/catalog.ts).
-- supplier_items keeps the value: matching, enrichment and the admin's supplier searches still read it.
ALTER TABLE commerce_item_overrides ADD COLUMN IF NOT EXISTS hide_oem boolean NOT NULL DEFAULT false;
ALTER TABLE commerce_settings ADD COLUMN IF NOT EXISTS basbug_checkout_mode text NOT NULL DEFAULT 'live'
 CHECK(basbug_checkout_mode IN ('live','snapshot'));
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
CREATE OR REPLACE FUNCTION cleanup_commerce_cart() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_ARGV[0]='account' THEN
 DELETE FROM commerce_cart_items WHERE owner_kind='account' AND owner_id=OLD.id::text;
 ELSE
 DELETE FROM commerce_cart_items WHERE owner_kind='guest' AND owner_id=OLD.token_hash;
 END IF;
 RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS cleanup_commerce_account_cart ON accounts;
CREATE TRIGGER cleanup_commerce_account_cart BEFORE DELETE ON accounts FOR EACH ROW EXECUTE FUNCTION cleanup_commerce_cart('account');
DROP TRIGGER IF EXISTS cleanup_commerce_guest_cart ON guest_carts;
CREATE TRIGGER cleanup_commerce_guest_cart BEFORE DELETE ON guest_carts FOR EACH ROW EXECUTE FUNCTION cleanup_commerce_cart('guest');
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
CREATE INDEX IF NOT EXISTS commerce_orders_owner_idx ON commerce_orders(owner_kind,owner_id,created_at DESC);
-- Shared eligibility, without calculating prices for every catalog row.
-- Saleable sources: Başbuğ's MRK warehouse, SETA's single list, Dinamik codes that have a stock-list row
-- (price-list-only codes carry no name) and manual xlsx lists. All store cost as nf and availability as stok.
CREATE OR REPLACE VIEW commerce_supplier_items AS
SELECT i.* FROM supplier_items i
WHERE ((i.supplier='basbug' AND i.warehouse='MRK') OR i.supplier IN ('seta','manual') OR (i.supplier='dinamik' AND i.stock_data IS NOT NULL)) AND i.presence='present' AND NOT i.conflicting
AND NOT EXISTS(SELECT 1 FROM store_products p WHERE p.supplier=i.supplier AND p.code=i.code);
CREATE OR REPLACE VIEW commerce_catalog_entries AS
SELECT id,category,supplier,code,name,brand,description,updated_at,
 ''::text AS oem,'store'::text AS source,''::text AS company,brand AS display_brand,code AS display_code FROM store_products
UNION ALL
SELECT i.id,NULLIF(i.product_data->>'category',''),i.supplier,i.code,
 COALESCE(ov.name,NULLIF(i.product_data->>'ac',''),i.code),COALESCE(NULLIF(i.product_data->>'uk',''),'Belirtilmemiş'),
 COALESCE(ov.description,i.product_data->>'ac2',''),i.changed_at,CASE WHEN ov.hide_oem THEN '' ELSE COALESCE(i.product_data->>'oe','') END,'supplier',i.company,
 COALESCE(ov.brand,NULLIF(i.product_data->>'uk',''),'Belirtilmemiş'),COALESCE(ov.part_number,i.code)
FROM commerce_supplier_items i CROSS JOIN commerce_settings s
LEFT JOIN commerce_item_overrides ov ON ov.supplier_item_id=i.id
-- Hidden by an admin (#575): not for sale anywhere.
WHERE ov.hidden IS NOT TRUE;
DROP INDEX IF EXISTS supplier_items_catalog_order_idx;
-- The predicate mirrors commerce_supplier_items; a changed predicate needs a new index name.
DROP INDEX IF EXISTS supplier_items_saleable_order_idx;
DROP INDEX IF EXISTS supplier_items_saleable_order_v2_idx;
CREATE INDEX IF NOT EXISTS supplier_items_saleable_order_v3_idx ON supplier_items(company,changed_at DESC,id)
WHERE ((supplier='basbug' AND warehouse='MRK') OR supplier IN ('seta','manual') OR (supplier='dinamik' AND stock_data IS NOT NULL)) AND presence='present' AND NOT conflicting;
-- Few supplier items carry a legacy category; the catalog resolves a category to ids through this index.
CREATE INDEX IF NOT EXISTS supplier_items_legacy_category_idx ON supplier_items((product_data->>'category'))
WHERE product_data->>'category'<>'';
-- Part numbers compared on the product page (cross references, OEM numbers): upper case, letters and
-- digits only. Indexed so a reference lookup reads the matching rows instead of normalising every item.
CREATE OR REPLACE FUNCTION part_number_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path FROM CURRENT AS $$ SELECT regexp_replace(upper(value),'[^A-Z0-9]','','g') $$;
CREATE INDEX IF NOT EXISTS supplier_items_part_key_idx ON supplier_items(part_number_key(substring(code from position(' ' in code)+1)));
CREATE INDEX IF NOT EXISTS supplier_items_oem_key_idx ON supplier_items(part_number_key(product_data->>'oe'))
WHERE product_data->>'oe'<>'';
CREATE OR REPLACE VIEW commerce_catalog AS
WITH latest AS (
 SELECT DISTINCT ON (supplier,company) supplier,company,currencies_data,completed_at
 FROM supplier_imports WHERE status='succeeded'
 ORDER BY supplier,company,completed_at DESC,id DESC
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
 ov.hide_oem AS override_hide_oem,
 -- The campaign price only inside its window; a NULL end is open.
 CASE WHEN (ov.sale_from IS NULL OR ov.sale_from<=now()) AND (ov.sale_until IS NULL OR now()<ov.sale_until) THEN ov.sale_price_kurus END AS sale_price,
 -- Rows with an admin price are few; every other row takes the formula's branches below and pays for it once.
 (ov.price_kurus IS NOT NULL OR ov.sale_price_kurus IS NOT NULL) AS admin_priced
 FROM commerce_supplier_items i CROSS JOIN commerce_settings s
 LEFT JOIN commerce_product_pricing p ON p.supplier_item_id=i.id
 LEFT JOIN commerce_item_overrides ov ON ov.supplier_item_id=i.id
 LEFT JOIN supplier_sync_scopes sc ON sc.supplier=i.supplier AND sc.company=i.company AND sc.list_group=i.list_group AND sc.warehouse=i.warehouse
 LEFT JOIN rates r ON r.supplier=i.supplier AND r.company=i.company AND r.currency=i.product_data->>'dc'
 WHERE ov.hidden IS NOT TRUE
), priced AS (
 -- The formula price (auto_price) is the only gate: an admin price never sells a row the formula cannot price.
 SELECT *,CASE WHEN cost>0 AND exchange_rate>0
 AND (basbug_checkout_mode='snapshot' OR ((supplier='manual' OR rate_at>now()-make_interval(hours=>max_age_hours)) AND source_fresh))
 AND round(cost*exchange_rate*(1+markup_percent/100)*(1+vat_percent/100)*100) BETWEEN 1 AND 2147483647
 THEN round(cost*exchange_rate*(1+markup_percent/100)*(1+vat_percent/100)*100)::integer ELSE NULL END AS auto_price
 FROM supplier_prices
), sold AS (
 -- These CTEs are inlined, so each column below is its expression wherever it is used: auto_price is evaluated in
 -- CASE branches only, the formula's branch first, so a row without an admin price computes it exactly once (as
 -- before #580). Rows with one recompute it a few times. A campaign at or above the regular price is ignored.
 SELECT *,CASE WHEN NOT admin_priced THEN NULL WHEN auto_price IS NOT NULL THEN COALESCE(override_price,auto_price) END AS regular_price
 FROM priced
), final AS (
 SELECT *,CASE WHEN NOT admin_priced THEN auto_price WHEN sale_price<regular_price THEN sale_price ELSE regular_price END AS final_price,
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
 brand AS display_brand,code AS display_code
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
 CASE WHEN basbug_checkout_mode='snapshot' AND (COALESCE((stock_data->>'stok')::numeric,0)>0 OR COALESCE((stock_data->>'sFarkliDepo')::numeric,0)>0) THEN 'Kayıtlı stokta mevcut · Teyit bekliyor'
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
 COALESCE(override_brand,NULLIF(product_data->>'uk',''),'Belirtilmemiş'),COALESCE(override_part_number,code)
FROM final;
-- Prepaid checkout: card payment is collected on TAMI's hosted page before operations confirm the order.
ALTER TABLE commerce_settings ADD COLUMN IF NOT EXISTS shipping_fee_kurus integer NOT NULL DEFAULT 15000
 CHECK(shipping_fee_kurus BETWEEN 0 AND 10000000);
-- Zero disables the free-shipping threshold.
ALTER TABLE commerce_settings ADD COLUMN IF NOT EXISTS free_shipping_threshold_kurus integer NOT NULL DEFAULT 150000
 CHECK(free_shipping_threshold_kurus BETWEEN 0 AND 1000000000);
ALTER TABLE commerce_orders ADD COLUMN IF NOT EXISTS subtotal_kurus bigint;
UPDATE commerce_orders SET subtotal_kurus=total_kurus WHERE subtotal_kurus IS NULL;
ALTER TABLE commerce_orders ALTER COLUMN subtotal_kurus SET NOT NULL;
ALTER TABLE commerce_orders ADD COLUMN IF NOT EXISTS shipping_kurus bigint NOT NULL DEFAULT 0 CHECK(shipping_kurus>=0);
-- 'none' marks orders placed before online payment existed.
ALTER TABLE commerce_orders ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'none'
 CHECK(payment_status IN ('none','awaiting','paid','expired','refund_required','refunded'));
ALTER TABLE commerce_orders ADD COLUMN IF NOT EXISTS payment_due_at timestamptz;
ALTER TABLE commerce_orders ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE commerce_orders ADD COLUMN IF NOT EXISTS payment_note text NOT NULL DEFAULT '';
ALTER TABLE commerce_orders ADD COLUMN IF NOT EXISTS refund_reference text;
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
ALTER TABLE commerce_orders ADD COLUMN IF NOT EXISTS carrier text;
ALTER TABLE commerce_orders ADD COLUMN IF NOT EXISTS carrier_name text;
ALTER TABLE commerce_orders ADD COLUMN IF NOT EXISTS tracking_no text;
ALTER TABLE commerce_orders ADD COLUMN IF NOT EXISTS tracking_url text;
ALTER TABLE commerce_orders ADD COLUMN IF NOT EXISTS shipped_at timestamptz;
ALTER TABLE commerce_orders ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
-- Widens the list above once. Its result still contains 'awaiting_payment', so the two blocks never undo each other.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='commerce_orders'::regclass AND conname='commerce_orders_status_check'
  AND pg_get_constraintdef(oid) LIKE '%delivered%') THEN
  ALTER TABLE commerce_orders DROP CONSTRAINT IF EXISTS commerce_orders_status_check;
  ALTER TABLE commerce_orders ADD CONSTRAINT commerce_orders_status_check
   CHECK(status IN ('awaiting_payment','pending','confirmed','shipped','delivered','cancelled'));
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS commerce_orders_payment_due_idx ON commerce_orders(payment_due_at) WHERE status='awaiting_payment';
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
CREATE INDEX IF NOT EXISTS commerce_payments_order_idx ON commerce_payments(order_id,created_at DESC);
CREATE INDEX IF NOT EXISTS commerce_payments_open_idx ON commerce_payments(checked_at NULLS FIRST) WHERE status IN ('initiated','pending');
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
CREATE UNIQUE INDEX IF NOT EXISTS commerce_payment_refunds_active_idx ON commerce_payment_refunds(payment_id)
 WHERE status IN ('requested','unknown','succeeded');
CREATE INDEX IF NOT EXISTS commerce_payment_refunds_order_idx ON commerce_payment_refunds(order_id,requested_at);
-- When the order's money went back to the customer (TAMI API or a manually recorded reference).
ALTER TABLE commerce_orders ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
-- Fitment guarantee, phase 0: measure compatibility before promising it.
-- The garage vehicle is captured when a product is added and copied to the order line together
-- with the compatibility level computed at checkout. No FK: orders outlive vehicle catalog reloads.
ALTER TABLE commerce_cart_items ADD COLUMN IF NOT EXISTS vehicle jsonb
 CHECK(vehicle IS NULL OR jsonb_typeof(vehicle)='object');
ALTER TABLE commerce_order_items ADD COLUMN IF NOT EXISTS vehicle jsonb
 CHECK(vehicle IS NULL OR jsonb_typeof(vehicle)='object');
-- NULL only on lines created before levels were recorded.
ALTER TABLE commerce_order_items ADD COLUMN IF NOT EXISTS fitment_level text
 CHECK(fitment_level IN ('guaranteed','likely','mismatch','unknown','no_vehicle'));
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
CREATE INDEX IF NOT EXISTS commerce_returns_line_idx ON commerce_returns(order_id,product_id);
-- Store stock actually taken for a line (#516). Cancelling or expiring an order returns exactly this and sets it to 0,
-- so a line that a late payment could not reserve, or a second cancel, never inflates stock.
-- NULL marks lines written by code without the column (orders before this change, or written by the previous release
-- while a deployment runs): the release falls back to the old rule (full quantity of a store product).
ALTER TABLE commerce_order_items ADD COLUMN IF NOT EXISTS reserved_quantity integer;
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
CREATE INDEX IF NOT EXISTS commerce_orders_created_idx ON commerce_orders(created_at DESC,id DESC);
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
CREATE OR REPLACE TRIGGER commerce_order_agreement_immutable BEFORE UPDATE ON commerce_order_agreements FOR EACH ROW EXECUTE FUNCTION commerce_order_agreement_immutable();
-- Procurement of order lines (#606): operations mark each supplier line as ordered from the supplier (with an optional
-- reference) and then procured. Store-stock lines (pricing_snapshot.source='store') need none and keep 'pending'.
-- Existing lines start as 'pending'; the admin list shows no badge for shipped, delivered or cancelled orders.
ALTER TABLE commerce_order_items ADD COLUMN IF NOT EXISTS procurement_status text NOT NULL DEFAULT 'pending'
 CHECK(procurement_status IN ('pending','ordered','procured'));
ALTER TABLE commerce_order_items ADD COLUMN IF NOT EXISTS procurement_ref text;
ALTER TABLE commerce_order_items ADD COLUMN IF NOT EXISTS procurement_ordered_at timestamptz;
ALTER TABLE commerce_order_items ADD COLUMN IF NOT EXISTS procured_at timestamptz;
ALTER TABLE commerce_order_items ADD COLUMN IF NOT EXISTS procurement_by uuid REFERENCES accounts(id);
