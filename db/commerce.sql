CREATE TABLE IF NOT EXISTS commerce_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 markup_percent numeric(7,2) NOT NULL DEFAULT 30 CHECK(markup_percent BETWEEN 0 AND 1000),
 vat_percent numeric(5,2) NOT NULL DEFAULT 20 CHECK(vat_percent BETWEEN 0 AND 100),
 max_age_hours integer NOT NULL DEFAULT 36 CHECK(max_age_hours BETWEEN 1 AND 168),
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES accounts(id)
);
INSERT INTO commerce_settings(id) VALUES(true) ON CONFLICT DO NOTHING;
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
CREATE OR REPLACE VIEW commerce_supplier_items AS
SELECT i.* FROM supplier_items i
WHERE i.supplier='basbug' AND i.warehouse='MRK' AND i.presence='present' AND NOT i.conflicting
AND NOT EXISTS(SELECT 1 FROM products p WHERE p.supplier=i.supplier AND p.code=i.code);
CREATE OR REPLACE VIEW commerce_catalog_entries AS
SELECT id,category,supplier,code,name,brand,description,updated_at,
 ''::text AS oem,'store'::text AS source,''::text AS company FROM products
UNION ALL
SELECT i.id,NULLIF(i.product_data->>'category',''),i.supplier,i.code,
 COALESCE(NULLIF(i.product_data->>'ac',''),i.code),COALESCE(NULLIF(i.product_data->>'uk',''),'Belirtilmemiş'),
 COALESCE(i.product_data->>'ac2',''),i.changed_at,COALESCE(i.product_data->>'oe',''),'supplier',i.company
FROM commerce_supplier_items i CROSS JOIN commerce_settings s;
CREATE INDEX IF NOT EXISTS supplier_items_catalog_order_idx ON supplier_items(company,changed_at DESC,id)
WHERE supplier='basbug' AND warehouse='MRK' AND presence='present' AND NOT conflicting;
CREATE OR REPLACE VIEW commerce_catalog AS
WITH latest AS (
 SELECT DISTINCT ON (supplier,company) supplier,company,currencies_data,completed_at
 FROM supplier_imports WHERE status='succeeded'
 ORDER BY supplier,company,completed_at DESC,id DESC
), rates AS (
 SELECT supplier,company,completed_at,r->>'dovizCinsi' AS currency,(r->>'satis')::numeric AS rate
 FROM latest CROSS JOIN LATERAL jsonb_array_elements(currencies_data->'dovizListesi') r
), supplier_prices AS (
 SELECT i.*,s.markup_percent,s.vat_percent,s.max_age_hours,
 (i.last_seen_at>now()-make_interval(hours=>s.max_age_hours)
 AND (NOT COALESCE(sc.commerce_enabled,false) OR i.last_seen_at>now()-sc.commerce_stale_minutes*interval '1 minute')
 AND (sc.last_success_at IS NULL OR sc.last_success_at>now()-COALESCE(sc.stale_minutes,2160)*interval '1 minute')) AS source_fresh,
 CASE WHEN i.product_data->>'dc' IN ('TL','TRY') THEN 1::numeric ELSE r.rate END AS exchange_rate,
 CASE WHEN i.product_data->>'dc' IN ('TL','TRY') THEN i.last_seen_at ELSE r.completed_at END AS rate_at,
 (i.price_data->>'nf')::numeric AS cost
 FROM commerce_supplier_items i CROSS JOIN commerce_settings s
 LEFT JOIN supplier_sync_scopes sc ON sc.supplier=i.supplier AND sc.company=i.company AND sc.list_group=i.list_group AND sc.warehouse=i.warehouse
 LEFT JOIN rates r ON r.supplier=i.supplier AND r.company=i.company AND r.currency=i.product_data->>'dc'
)
SELECT id,category,supplier,code,name,brand,description,price_kurus,stock,updated_at,
 ''::text AS oem,'store'::text AS source,''::text AS company,
 stock>0 AS available,LEAST(stock,99) AS max_quantity,
 CASE WHEN stock>0 THEN 'Stokta mevcut: '||stock||' adet' ELSE 'Stokta yok' END AS stock_label,
 jsonb_build_object('source','store','base_price_kurus',price_kurus) AS pricing_snapshot
FROM products
UNION ALL
SELECT id,NULLIF(product_data->>'category',''),supplier,code,
 COALESCE(NULLIF(product_data->>'ac',''),code),COALESCE(NULLIF(product_data->>'uk',''),'Belirtilmemiş'),
 COALESCE(product_data->>'ac2',''),
 CASE WHEN cost>0 AND exchange_rate>0 AND rate_at>now()-make_interval(hours=>max_age_hours)
 AND source_fresh
 AND round(cost*exchange_rate*(1+markup_percent/100)*(1+vat_percent/100)*100) BETWEEN 1 AND 2147483647
 THEN round(cost*exchange_rate*(1+markup_percent/100)*(1+vat_percent/100)*100)::integer ELSE NULL END,
 NULL::integer,changed_at,COALESCE(product_data->>'oe',''),'supplier',company,
 source_fresh AND
 (COALESCE((stock_data->>'stok')::numeric,0)>0 OR COALESCE((stock_data->>'sFarkliDepo')::numeric,0)>0),
 99,
 CASE WHEN NOT source_fresh THEN 'Stok bilgisi güncelleniyor'
 WHEN stock_data IS NULL THEN 'Stok bilgisi bulunamadı'
 WHEN (stock_data->>'stok')::numeric>0 THEN 'Tedarikçide mevcut'
 WHEN (stock_data->>'sFarkliDepo')::numeric>0 THEN 'Diğer depoda mevcut'
 WHEN (stock_data->>'sYol')::numeric>0 THEN 'Tedarikçiye sevkiyat bekleniyor'
 ELSE 'Stokta yok' END,
 jsonb_build_object('source','supplier','nf',cost,'currency',product_data->>'dc','exchange_rate',exchange_rate,
 'rate_at',rate_at,'markup_percent',markup_percent,'vat_percent',vat_percent,'stock',stock_data,'observed_at',last_seen_at)
FROM supplier_prices;
