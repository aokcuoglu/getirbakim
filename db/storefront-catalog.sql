-- Storefront catalog (#475): every saleable row of commerce_catalog plus the products no supplier sells right now.
-- Cart, checkout, partner API, maintenance kits and the admin keep reading commerce_catalog / commerce_supplier_items,
-- which hold saleable rows only; only the store's listing, search and product page read the views below.
-- A row is "unavailable" when it is a usable source (the commerce_supplier_items rules) that its supplier dropped
-- (presence pending_missing or inactive) and the same product is not sold anywhere else:
--  * no saleable row with the same supplier + code (Dinamik moved FALKON's codes to the "FALKON - AUTOKIT" scope),
--  * no saleable row in its product group (product_sources: the Başbuğ row of a product Dinamik still sells),
--  * one card per supplier + code (newest observation) and one per product group (the product's own row, then
--    Başbuğ, Dinamik, SETA, manual, then code).
-- NOT EXISTS keeps the view inlinable, so `id = ANY(...)` filters reach supplier_items by primary key.
CREATE INDEX IF NOT EXISTS supplier_items_saleable_code_idx ON supplier_items(supplier,code)
WHERE ((supplier='basbug' AND warehouse='MRK') OR supplier IN ('seta','manual') OR (supplier='dinamik' AND stock_data IS NOT NULL)) AND presence='present' AND NOT conflicting;
CREATE INDEX IF NOT EXISTS supplier_items_unavailable_idx ON supplier_items(supplier,code,last_seen_at DESC,id)
WHERE ((supplier='basbug' AND warehouse='MRK') OR supplier IN ('seta','manual') OR (supplier='dinamik' AND stock_data IS NOT NULL)) AND presence IN ('pending_missing','inactive') AND NOT conflicting;
CREATE OR REPLACE FUNCTION storefront_supplier_rank(supplier text) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT CASE supplier WHEN 'basbug' THEN 0 WHEN 'dinamik' THEN 1 WHEN 'seta' THEN 2 ELSE 3 END $$;
CREATE OR REPLACE VIEW commerce_unavailable_items AS
SELECT r.* FROM supplier_items r
WHERE ((r.supplier='basbug' AND r.warehouse='MRK') OR r.supplier IN ('seta','manual') OR (r.supplier='dinamik' AND r.stock_data IS NOT NULL))
 AND r.presence IN ('pending_missing','inactive') AND NOT r.conflicting
 AND NOT EXISTS (SELECT 1 FROM store_products p WHERE p.supplier=r.supplier AND p.code=r.code)
 -- Sold under the same code from another scope or list.
 AND NOT EXISTS (SELECT 1 FROM supplier_items c WHERE c.supplier=r.supplier AND c.code=r.code
  AND ((c.supplier='basbug' AND c.warehouse='MRK') OR c.supplier IN ('seta','manual') OR (c.supplier='dinamik' AND c.stock_data IS NOT NULL))
  AND c.presence='present' AND NOT c.conflicting)
 -- One card per supplier + code: the newest observation.
 AND NOT EXISTS (SELECT 1 FROM supplier_items d WHERE d.supplier=r.supplier AND d.code=r.code
  AND ((d.supplier='basbug' AND d.warehouse='MRK') OR d.supplier IN ('seta','manual') OR (d.supplier='dinamik' AND d.stock_data IS NOT NULL))
  AND d.presence IN ('pending_missing','inactive') AND NOT d.conflicting
  AND (d.last_seen_at>r.last_seen_at OR (d.last_seen_at=r.last_seen_at AND d.id<r.id)))
 -- The same product is sold by another row of its group.
 AND NOT EXISTS (SELECT 1 FROM product_sources s JOIN product_sources m ON m.product_id=s.product_id
  JOIN commerce_supplier_items c ON c.id=m.supplier_item_id WHERE s.supplier_item_id=r.id)
 -- One card per product group: a better unavailable member (itself the newest of its code) is listed instead.
 AND NOT EXISTS (SELECT 1 FROM product_sources s JOIN product_sources m ON m.product_id=s.product_id AND m.supplier_item_id<>s.supplier_item_id
  JOIN supplier_items d ON d.id=m.supplier_item_id
  WHERE s.supplier_item_id=r.id
  AND ((d.supplier='basbug' AND d.warehouse='MRK') OR d.supplier IN ('seta','manual') OR (d.supplier='dinamik' AND d.stock_data IS NOT NULL))
  AND d.presence IN ('pending_missing','inactive') AND NOT d.conflicting
  AND (CASE WHEN d.id=s.product_id THEN 0 ELSE 1 END,storefront_supplier_rank(d.supplier),d.code)
   <(CASE WHEN r.id=s.product_id THEN 0 ELSE 1 END,storefront_supplier_rank(r.supplier),r.code)
  AND NOT EXISTS (SELECT 1 FROM supplier_items n WHERE n.supplier=d.supplier AND n.code=d.code
   AND ((n.supplier='basbug' AND n.warehouse='MRK') OR n.supplier IN ('seta','manual') OR (n.supplier='dinamik' AND n.stock_data IS NOT NULL))
   AND n.presence IN ('pending_missing','inactive') AND NOT n.conflicting
   AND (n.last_seen_at>d.last_seen_at OR (n.last_seen_at=d.last_seen_at AND n.id<d.id))));
-- Columns are listed (not e.*): CREATE OR REPLACE VIEW cannot reorder or drop columns on a later run.
CREATE OR REPLACE VIEW storefront_catalog_entries AS
SELECT e.id,e.category,e.supplier,e.code,e.name,e.brand,e.description,e.updated_at,e.oem,e.source,e.company,false AS unavailable
FROM commerce_catalog_entries e
UNION ALL
SELECT u.id,NULLIF(u.product_data->>'category',''),u.supplier,u.code,
 COALESCE(NULLIF(u.product_data->>'ac',''),u.code),COALESCE(NULLIF(u.product_data->>'uk',''),'Belirtilmemiş'),
 COALESCE(u.product_data->>'ac2',''),u.last_seen_at,COALESCE(u.product_data->>'oe',''),'supplier'::text,u.company,true
FROM commerce_unavailable_items u;
CREATE OR REPLACE VIEW storefront_catalog AS
SELECT c.id,c.category,c.supplier,c.code,c.name,c.brand,c.description,c.price_kurus,c.stock,c.updated_at,c.oem,c.source,c.company,
 c.available,c.max_quantity,c.stock_label,c.pricing_snapshot,false AS unavailable
FROM commerce_catalog c
UNION ALL
SELECT u.id,NULLIF(u.product_data->>'category',''),u.supplier,u.code,
 COALESCE(NULLIF(u.product_data->>'ac',''),u.code),COALESCE(NULLIF(u.product_data->>'uk',''),'Belirtilmemiş'),
 COALESCE(u.product_data->>'ac2',''),NULL::integer,NULL::integer,u.last_seen_at,COALESCE(u.product_data->>'oe',''),'supplier'::text,u.company,
 false,0,'Şu an tedarik edilemiyor'::text,
 jsonb_build_object('source','unavailable','presence',u.presence,'observed_at',u.last_seen_at),true
FROM commerce_unavailable_items u;
