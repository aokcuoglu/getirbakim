-- Storefront catalog (#475): every saleable row of commerce_catalog plus the products no supplier sells right now.
-- Cart, checkout, partner API, maintenance kits and the admin keep reading commerce_catalog / commerce_supplier_items,
-- which hold saleable rows only; only the store's listing, search and product page read the views below.
-- A row is "unavailable" when it is a usable source (the commerce_supplier_items rules) that its supplier dropped
-- (presence pending_missing or inactive) and the same product is not sold anywhere else:
--  * no saleable row with the same supplier + code (Dinamik moved FALKON's codes to the "FALKON - AUTOKIT" scope),
--  * no saleable row in its product group (product_sources: the Başbuğ row of a product Dinamik still sells),
--  * one card per supplier + code (newest observation) and one per product group (the product's own row, then
--    Başbuğ, Dinamik, SETA, manual, then code).
-- A second branch lists Dinamik price-list-only codes that carry content (storefront_price_only_items below, #1068): still
-- in the price list (present) but never saleable without a stock-list row. The first kind is commerce_dropped_items.
-- NOT EXISTS keeps the view inlinable, so `id = ANY(...)` filters reach supplier_items by primary key.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='supplier_items'::regclass AND c.relname='supplier_items_saleable_code_idx') THEN
  CREATE INDEX supplier_items_saleable_code_idx ON supplier_items(supplier,code)
   WHERE ((supplier='basbug' AND warehouse='MRK') OR supplier IN ('seta','manual') OR (supplier='dinamik' AND stock_data IS NOT NULL)) AND presence='present' AND NOT conflicting;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='supplier_items'::regclass AND c.relname='supplier_items_unavailable_idx') THEN
  CREATE INDEX supplier_items_unavailable_idx ON supplier_items(supplier,code,last_seen_at DESC,id)
   WHERE ((supplier='basbug' AND warehouse='MRK') OR supplier IN ('seta','manual') OR (supplier='dinamik' AND stock_data IS NOT NULL)) AND presence IN ('pending_missing','inactive') AND NOT conflicting;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION storefront_supplier_rank(supplier text) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT CASE supplier WHEN 'basbug' THEN 0 WHEN 'dinamik' THEN 1 WHEN 'seta' THEN 2 ELSE 3 END $$;
-- Dinamik price-list-only codes with content (#1068). Dinamik's price list names every code it sells, its stock list
-- (names, regional stock) only part of them; a code without a stock-list row (stock_data IS NULL) is never saleable.
-- Such a code becomes an unavailable card ("Gelince haber ver") only when it carries real content: a shared enrichment
-- (product_enrichment_shared_links) matched to its own code and brand, whose donor has at least one category with a
-- Turkish label. The card is named after the deepest such category; bare brand + code rows get no page. The list is kept
-- here by storefront_price_only_refresh() (written after each enrichment-link sync) instead of a predicate on the
-- 1M-row supplier_items, whose partial indexes stay as they are; commerce_unavailable_items re-checks every row condition
-- live, so a row that gains a stock row, leaves the price list or is sold elsewhere drops out at once.
CREATE TABLE IF NOT EXISTS storefront_price_only_items (
 supplier_item_id uuid PRIMARY KEY REFERENCES supplier_items(id) ON DELETE CASCADE,
 name text NOT NULL,
 qualified_at timestamptz NOT NULL DEFAULT now()
);
-- The card's own search fields (#1081), written by the refresh: the storefront search reads this table through its own
-- indexes instead of computing the view's price-only branch for every match (16.7 ms at 105 rows, 128 ms at 100k).
-- Built like supplier_items' stored fields (db/search.sql) from the fields the card shows: the Turkish category label as
-- the name (the row itself has none), the brand, code, OEM and description. search_codes is
-- supplier_item_search_codes(). search_source holds the inputs search_doc was built from, so a refresh rebuilds only the
-- documents whose inputs changed (~33 µs a row: 3.3 s of every refresh at 100k rows). Only as fresh as the last
-- refresh: the readers of the hits read them back through the storefront views (src/modules/store/catalog.ts).
-- search_source holds the inputs, not the functions: a change to catalog_search_doc or search_normalize (db/search.sql)
-- needs `UPDATE storefront_price_only_items SET search_source=NULL` so the next refresh rebuilds every document.
-- Added only when missing: ADD COLUMN locks the table (ACCESS EXCLUSIVE) even as a no-op.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='storefront_price_only_items'::regclass AND attname='search_doc' AND NOT attisdropped) THEN
  -- Views that read the table first (#1046, db/schema.sql).
  PERFORM setup_lock_dependent_views('storefront_price_only_items');
  ALTER TABLE storefront_price_only_items ADD COLUMN search_doc tsvector, ADD COLUMN search_code text, ADD COLUMN search_oem text,
   ADD COLUMN search_codes text, ADD COLUMN search_source text;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='storefront_price_only_items'::regclass AND c.relname='storefront_price_only_items_search_doc_idx') THEN
  CREATE INDEX storefront_price_only_items_search_doc_idx ON storefront_price_only_items USING gin (search_doc);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='storefront_price_only_items'::regclass AND c.relname='storefront_price_only_items_search_codes_idx') THEN
  CREATE INDEX storefront_price_only_items_search_codes_idx ON storefront_price_only_items USING gin (search_codes gin_trgm_ops);
 END IF;
END $$;
-- When the list was last rebuilt: every app task asks on its own timer, the database lets one of them rebuild per interval.
CREATE TABLE IF NOT EXISTS storefront_price_only_runs (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 refreshed_at timestamptz NOT NULL
);
-- Recomputes the list and writes only what changed: one row per Dinamik code (the newest observation), per product
-- group and per product identity (master brand key + part number, as the matcher keys products: product_match_items).
-- A code whose identity another usable row already carries (sold, or dropped and so an unavailable card) is left out,
-- linked or not (#1081): an unlinked row has no product group, and would otherwise give the same part a second page.
-- That row is found through supplier_items_part_key_idx (the code after its first word) and compared on the matcher's
-- full identity; a SETA, manual or Başbuğ OE row whose code holds a space is keyed differently there and not seen.
-- Unlike the row conditions, this identity rule lives here only: commerce_unavailable_items does not re-check it.
-- Driven by the enrichment links (~165k rows locally), each reaching supplier_items by primary key: hash and merge
-- joins are off inside the call, otherwise the planner reads the whole supplier_items table for them. One caller at a
-- time; `min_interval` skips the rebuild when one finished within it (setup and imports pass NULL: always). A skipped
-- call (lock busy or too soon) returns NULL, a rebuild the number of rows written. A renamed row moves qualified_at (its
-- address changes; the sitemap's lastmod follows); a row whose search fields alone change (its supplier data) is
-- rewritten without moving it. PL/pgSQL: product_enrichment_shared_links is created by a later setup file.
CREATE OR REPLACE FUNCTION storefront_price_only_refresh(min_interval interval DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE changed integer; hash_join text := current_setting('enable_hashjoin'); merge_join text := current_setting('enable_mergejoin');
BEGIN
 IF NOT pg_try_advisory_xact_lock(20261001,schema_lock_key(12)) THEN RETURN NULL; END IF;
 IF min_interval IS NOT NULL AND EXISTS (SELECT 1 FROM storefront_price_only_runs WHERE refreshed_at>clock_timestamp()-min_interval) THEN
  RETURN NULL;
 END IF;
 PERFORM set_config('enable_hashjoin','off',true);
 PERFORM set_config('enable_mergejoin','off',true);
 CREATE TEMP TABLE storefront_price_only_computed ON COMMIT DROP AS
  SELECT y.id,y.name,f.source AS search_source,
   -- The stored search fields of db/search.sql's trigger, with the card's name and brand (storefront_catalog); the
   -- document is built again only when its inputs changed. The supplier row's search_code/search_oem come from the same
   -- trigger, and search_codes is supplier_item_search_codes() from them.
   CASE WHEN q.search_source=f.source THEN q.search_doc ELSE
    catalog_search_doc(y.name,shown.brand,s.code,COALESCE(s.product_data->>'oe',''),COALESCE(s.product_data->>'ac2','')) END AS search_doc,
   s.search_code,s.search_oem,concat_ws(' ',s.search_code,NULLIF(s.search_oem,'')) AS search_codes
  -- Byte order (COLLATE "C") for the identity: only equal keys matter, and a collated sort of 100k keys took ~0.2 s.
  FROM (SELECT DISTINCT ON (COALESCE(x.identity,x.id::text) COLLATE "C") x.id,x.name FROM (
   SELECT DISTINCT ON (x.grp) x.id,x.code,x.name,x.identity FROM (
    SELECT DISTINCT ON (r.code) r.id,r.code,COALESCE(ps.product_id,r.id) AS grp,cat.name,
     -- Rows without a full identity (no brand key, a part number under four characters, as the matcher drops) stand alone.
     CASE WHEN length(k.part_number)>=4 THEN k.brand_key||' '||k.part_number END AS identity
    FROM product_enrichment_shared_links l
    JOIN supplier_items r ON r.id=l.supplier_item_id
    JOIN product_enrichments e ON e.supplier_item_id=l.donor_item_id
    CROSS JOIN LATERAL (SELECT sl.name FROM product_source_categories pc
      JOIN source_categories c ON c.source=pc.source AND c.category_id=pc.category_id
      JOIN source_category_labels sl ON sl.source=pc.source AND sl.category_id=pc.category_id AND sl.locale='tr'
      WHERE pc.supplier_item_id=l.donor_item_id ORDER BY cardinality(c.path_ids) DESC,pc.source,pc.category_id LIMIT 1) cat
    LEFT JOIN product_sources ps ON ps.supplier_item_id=r.id
    -- The matcher's identity (refresh_product_matches): master brand key of the label, else its plain key.
    LEFT JOIN supplier_brands sb ON sb.supplier=r.supplier AND sb.label=supplier_item_brand(r.supplier,r.product_data)
    LEFT JOIN brands b ON b.id=sb.brand_id
    CROSS JOIN LATERAL (SELECT COALESCE(b.key,product_brand_key(supplier_item_brand(r.supplier,r.product_data))) AS brand_key,
      supplier_item_part_number(r.supplier,r.code,r.product_data) AS part_number) k
    WHERE r.supplier='dinamik' AND r.stock_data IS NULL AND r.presence='present' AND NOT r.conflicting
     -- The enrichment the product page shows (getProductEnrichment): the link's code and brand are the row's, and its basis
     -- is one the category listing trusts.
     AND l.supplier_code=r.code AND l.supplier_brand=supplier_item_brand(r.supplier,r.product_data)
     AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=l.donor_oem)
     -- Another usable row (the view's source rules, sold or dropped) is the same product.
     AND NOT EXISTS (SELECT 1 FROM supplier_items d
      WHERE length(k.part_number)>=4
       AND part_number_key(substring(d.code from position(' ' in d.code)+1))=part_number_key(substring(r.code from position(' ' in r.code)+1))
       AND d.id<>r.id
       AND ((d.supplier='basbug' AND d.warehouse='MRK') OR d.supplier IN ('seta','manual') OR (d.supplier='dinamik' AND d.stock_data IS NOT NULL))
       AND d.presence IN ('present','pending_missing','inactive') AND NOT d.conflicting
       AND supplier_item_part_number(d.supplier,d.code,d.product_data)=k.part_number
       AND supplier_item_brand_key(d.supplier,d.product_data)=k.brand_key)
    ORDER BY r.code,r.last_seen_at DESC,r.id) x
   ORDER BY x.grp,x.code,x.id) x
  ORDER BY COALESCE(x.identity,x.id::text) COLLATE "C",x.code,x.id) y
  JOIN supplier_items s ON s.id=y.id
  CROSS JOIN LATERAL (SELECT COALESCE(NULLIF(s.product_data->>'uk',''),supplier_item_brand(s.supplier,s.product_data),'Belirtilmemiş') AS brand) shown
  CROSS JOIN LATERAL (SELECT concat_ws(E'\x1f',y.name,shown.brand,s.code,COALESCE(s.product_data->>'oe',''),COALESCE(s.product_data->>'ac2','')) AS source) f
  LEFT JOIN storefront_price_only_items q ON q.supplier_item_id=y.id;
 PERFORM set_config('enable_hashjoin',hash_join,true);
 PERFORM set_config('enable_mergejoin',merge_join,true);
 WITH upserted AS (
  INSERT INTO storefront_price_only_items AS q(supplier_item_id,name,search_doc,search_code,search_oem,search_codes,search_source)
  SELECT id,name,search_doc,search_code,search_oem,search_codes,search_source FROM storefront_price_only_computed
  ON CONFLICT (supplier_item_id) DO UPDATE SET name=EXCLUDED.name,search_doc=EXCLUDED.search_doc,search_code=EXCLUDED.search_code,
   search_oem=EXCLUDED.search_oem,search_codes=EXCLUDED.search_codes,search_source=EXCLUDED.search_source,
   qualified_at=CASE WHEN q.name IS DISTINCT FROM EXCLUDED.name THEN now() ELSE q.qualified_at END
  WHERE (q.name,q.search_source,q.search_code,q.search_oem)
   IS DISTINCT FROM (EXCLUDED.name,EXCLUDED.search_source,EXCLUDED.search_code,EXCLUDED.search_oem)
  RETURNING 1
 ), removed AS (
  DELETE FROM storefront_price_only_items q
  WHERE NOT EXISTS (SELECT 1 FROM storefront_price_only_computed c WHERE c.id=q.supplier_item_id) RETURNING 1
 )
 SELECT (SELECT count(*) FROM upserted)+(SELECT count(*) FROM removed) INTO changed;
 DROP TABLE storefront_price_only_computed;
 INSERT INTO storefront_price_only_runs(refreshed_at) VALUES (clock_timestamp())
  ON CONFLICT (singleton) DO UPDATE SET refreshed_at=EXCLUDED.refreshed_at;
 RETURN changed;
END $$;
-- The unavailable cards of rows their supplier dropped (the first kind above). A view of its own so the storefront
-- search reads it without the price-only cards, which it finds through their own indexes (#1081).
DO $setup$ DECLARE def text := $view$
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
   AND (n.last_seen_at>d.last_seen_at OR (n.last_seen_at=d.last_seen_at AND n.id<d.id))))
 -- Hidden by an admin (#575).
 AND NOT EXISTS (SELECT 1 FROM commerce_item_overrides h WHERE h.supplier_item_id=r.id AND h.hidden);
$view$; cur regclass := (SELECT c.oid FROM pg_class c
  WHERE c.relname='commerce_dropped_items' AND c.relnamespace=current_schema()::regnamespace AND c.relkind='v'); BEGIN
 EXECUTE 'CREATE VIEW pg_temp.setup_view_probe AS '||def;
 IF pg_get_viewdef('pg_temp.setup_view_probe'::regclass) IS DISTINCT FROM pg_get_viewdef(cur) THEN
  -- Views that read this one first (#1046, db/schema.sql); a new view has none.
  IF cur IS NOT NULL THEN PERFORM setup_lock_dependent_views(cur); END IF;
  EXECUTE 'CREATE OR REPLACE VIEW commerce_dropped_items AS '||def;
 END IF;
 DROP VIEW pg_temp.setup_view_probe;
END $setup$;
DO $setup$ DECLARE def text := $view$
SELECT d.* FROM commerce_dropped_items d
UNION ALL
-- Dinamik price-list-only codes with content (storefront_price_only_items, #1068), still listed and not sold anywhere.
-- They yield to every other card: a usable row of the same code (sold or dropped) and a usable member of the product
-- group (sold, or the group's unavailable card above).
SELECT r.* FROM storefront_price_only_items q JOIN supplier_items r ON r.id=q.supplier_item_id
WHERE r.supplier='dinamik' AND r.stock_data IS NULL AND r.presence='present' AND NOT r.conflicting
 AND NOT EXISTS (SELECT 1 FROM store_products p WHERE p.supplier=r.supplier AND p.code=r.code)
 AND NOT EXISTS (SELECT 1 FROM supplier_items c WHERE c.supplier=r.supplier AND c.code=r.code
  AND ((c.supplier='basbug' AND c.warehouse='MRK') OR c.supplier IN ('seta','manual') OR (c.supplier='dinamik' AND c.stock_data IS NOT NULL))
  AND c.presence='present' AND NOT c.conflicting)
 AND NOT EXISTS (SELECT 1 FROM supplier_items d WHERE d.supplier=r.supplier AND d.code=r.code
  AND ((d.supplier='basbug' AND d.warehouse='MRK') OR d.supplier IN ('seta','manual') OR (d.supplier='dinamik' AND d.stock_data IS NOT NULL))
  AND d.presence IN ('pending_missing','inactive') AND NOT d.conflicting)
 AND NOT EXISTS (SELECT 1 FROM product_sources s JOIN product_sources m ON m.product_id=s.product_id AND m.supplier_item_id<>s.supplier_item_id
  JOIN supplier_items d ON d.id=m.supplier_item_id
  WHERE s.supplier_item_id=r.id
  AND ((d.supplier='basbug' AND d.warehouse='MRK') OR d.supplier IN ('seta','manual') OR (d.supplier='dinamik' AND d.stock_data IS NOT NULL))
  AND d.presence IN ('present','pending_missing','inactive') AND NOT d.conflicting)
 AND NOT EXISTS (SELECT 1 FROM commerce_item_overrides h WHERE h.supplier_item_id=r.id AND h.hidden);
$view$; cur regclass := (SELECT c.oid FROM pg_class c
  WHERE c.relname='commerce_unavailable_items' AND c.relnamespace=current_schema()::regnamespace AND c.relkind='v'); BEGIN
 EXECUTE 'CREATE VIEW pg_temp.setup_view_probe AS '||def;
 IF pg_get_viewdef('pg_temp.setup_view_probe'::regclass) IS DISTINCT FROM pg_get_viewdef(cur) THEN
  -- Views that read this one first (#1046, db/schema.sql); a new view has none.
  IF cur IS NOT NULL THEN PERFORM setup_lock_dependent_views(cur); END IF;
  EXECUTE 'CREATE OR REPLACE VIEW commerce_unavailable_items AS '||def;
 END IF;
 DROP VIEW pg_temp.setup_view_probe;
END $setup$;
-- Columns are listed (not e.*): the replace below (CREATE OR REPLACE VIEW, see db/commerce.sql) cannot reorder or drop
-- columns on a later run.
-- display_brand follows db/commerce.sql: override, master brand name (#811), raw label; for the unavailable cards the raw
-- label falls back to Dinamik's `marka` (price-list-only rows, #1068), as displayBrandSql (src/modules/store/display-brand-sql.ts).
DO $setup$ DECLARE def text := $view$
SELECT e.id,e.category,e.supplier,e.code,e.name,e.brand,e.description,e.updated_at,e.oem,e.source,e.company,false AS unavailable,
 e.display_brand,e.display_code,e.name_overridden,e.brand_label,false AS price_only
FROM commerce_catalog_entries e
UNION ALL
SELECT u.id,NULLIF(u.product_data->>'category',''),u.supplier,u.code,
 COALESCE(ov.name,q.name,NULLIF(u.product_data->>'ac',''),u.code),
 COALESCE(NULLIF(u.product_data->>'uk',''),supplier_item_brand(u.supplier,u.product_data),'Belirtilmemiş'),
 COALESCE(ov.description,u.product_data->>'ac2',''),u.last_seen_at,CASE WHEN ov.hide_oem THEN '' ELSE COALESCE(u.product_data->>'oe','') END,'supplier'::text,u.company,true,
 COALESCE(ov.brand,mb.name,NULLIF(u.product_data->>'uk',''),supplier_item_brand(u.supplier,u.product_data),'Belirtilmemiş'),COALESCE(ov.part_number,u.code),ov.name IS NOT NULL,
 supplier_item_brand(u.supplier,u.product_data),q.supplier_item_id IS NOT NULL
FROM commerce_unavailable_items u LEFT JOIN commerce_item_overrides ov ON ov.supplier_item_id=u.id
LEFT JOIN storefront_price_only_items q ON q.supplier_item_id=u.id
LEFT JOIN supplier_brands sb ON sb.supplier=u.supplier AND sb.label=supplier_item_brand(u.supplier,u.product_data)
LEFT JOIN brands mb ON mb.id=sb.brand_id;
$view$; cur regclass := (SELECT c.oid FROM pg_class c
  WHERE c.relname='storefront_catalog_entries' AND c.relnamespace=current_schema()::regnamespace AND c.relkind='v'); BEGIN
 EXECUTE 'CREATE VIEW pg_temp.setup_view_probe AS '||def;
 IF pg_get_viewdef('pg_temp.setup_view_probe'::regclass) IS DISTINCT FROM pg_get_viewdef(cur) THEN
  -- Views that read this one first (#1046, db/schema.sql); a new view has none.
  IF cur IS NOT NULL THEN PERFORM setup_lock_dependent_views(cur); END IF;
  EXECUTE 'CREATE OR REPLACE VIEW storefront_catalog_entries AS '||def;
 END IF;
 DROP VIEW pg_temp.setup_view_probe;
END $setup$;
DO $setup$ DECLARE def text := $view$
SELECT c.id,c.category,c.supplier,c.code,c.name,c.brand,c.description,c.price_kurus,c.stock,c.updated_at,c.oem,c.source,c.company,
 c.available,c.max_quantity,c.stock_label,c.pricing_snapshot,false AS unavailable,c.display_brand,c.display_code,c.name_overridden,
 c.brand_label,false AS price_only
FROM commerce_catalog c
UNION ALL
SELECT u.id,NULLIF(u.product_data->>'category',''),u.supplier,u.code,
 COALESCE(ov.name,q.name,NULLIF(u.product_data->>'ac',''),u.code),
 COALESCE(NULLIF(u.product_data->>'uk',''),supplier_item_brand(u.supplier,u.product_data),'Belirtilmemiş'),
 COALESCE(ov.description,u.product_data->>'ac2',''),NULL::integer,NULL::integer,u.last_seen_at,CASE WHEN ov.hide_oem THEN '' ELSE COALESCE(u.product_data->>'oe','') END,'supplier'::text,u.company,
 false,0,CASE WHEN q.supplier_item_id IS NULL THEN 'Şu an tedarik edilemiyor' ELSE 'Stok bilgisi bekleniyor' END,
 jsonb_build_object('source','unavailable','presence',u.presence,'observed_at',u.last_seen_at),true,
 COALESCE(ov.brand,mb.name,NULLIF(u.product_data->>'uk',''),supplier_item_brand(u.supplier,u.product_data),'Belirtilmemiş'),COALESCE(ov.part_number,u.code),ov.name IS NOT NULL,
 supplier_item_brand(u.supplier,u.product_data),q.supplier_item_id IS NOT NULL
FROM commerce_unavailable_items u LEFT JOIN commerce_item_overrides ov ON ov.supplier_item_id=u.id
LEFT JOIN storefront_price_only_items q ON q.supplier_item_id=u.id
LEFT JOIN supplier_brands sb ON sb.supplier=u.supplier AND sb.label=supplier_item_brand(u.supplier,u.product_data)
LEFT JOIN brands mb ON mb.id=sb.brand_id;
$view$; cur regclass := (SELECT c.oid FROM pg_class c
  WHERE c.relname='storefront_catalog' AND c.relnamespace=current_schema()::regnamespace AND c.relkind='v'); BEGIN
 EXECUTE 'CREATE VIEW pg_temp.setup_view_probe AS '||def;
 IF pg_get_viewdef('pg_temp.setup_view_probe'::regclass) IS DISTINCT FROM pg_get_viewdef(cur) THEN
  -- Views that read this one first (#1046, db/schema.sql); a new view has none.
  IF cur IS NOT NULL THEN PERFORM setup_lock_dependent_views(cur); END IF;
  EXECUTE 'CREATE OR REPLACE VIEW storefront_catalog AS '||def;
 END IF;
 DROP VIEW pg_temp.setup_view_probe;
END $setup$;

-- Storefront listing cache, persisted level (#957): listing counts, page ids and facets of the plain listings (no search,
-- brand, property, availability or vehicle filter) that the per-process stale-while-revalidate caches computed, so a new
-- or restarted app container reads them instead of scanning the catalog again (src/modules/store/listing-cache-store.ts).
-- Each row keeps the storefront_listing_epoch value it was loaded under, the one its key follows (#1368: a listing of a
-- make epoch+fits_epoch, the others `epoch`): rows of an older value are not served and never replace a newer row.
-- UNLOGGED: a crash empties it and the caches load again. The app prunes rows older than two days.
CREATE UNLOGGED TABLE IF NOT EXISTS storefront_listing_cache (
 namespace text NOT NULL,
 key_hash text NOT NULL,
 epoch bigint NOT NULL,
 computed_at timestamptz NOT NULL DEFAULT now(),
 value jsonb NOT NULL,
 PRIMARY KEY (namespace,key_hash)
);
-- Whole price orders of the plain listings (#1369): one row per listing and price sort (the listings
-- storefront_listing_cache keeps, a model listing excepted), holding every listed id in the page order. Pages 1-20 keep
-- their 480 ids in storefront_listing_cache; a deeper page slices this array (ids[a:b]) and reads its cards live by id, so
-- prices and stock stay current while the order follows the prices of the last build (src/modules/store/listing-price-order.ts).
-- One statement prices, sorts and stores a listing (INSERT … SELECT): its ids never pass through the app (#1262). `epoch`
-- is the storefront_listing_epoch value the build ran under, the one its key follows (as storefront_listing_cache's,
-- #1368); the app rebuilds a row of an older value, and an older build never replaces a newer row. UNLOGGED: a crash
-- empties it and deep pages read live until the next build. The app prunes rows older than two days. No index but the
-- primary key: every read and write names one key_hash. The array is read whole to slice it (~16 bytes an id: 900k ids
-- ~14 MB, stored out of line).
CREATE UNLOGGED TABLE IF NOT EXISTS storefront_listing_price_orders (
 key_hash text NOT NULL,
 epoch bigint NOT NULL,
 computed_at timestamptz NOT NULL DEFAULT now(),
 total integer NOT NULL,
 ids uuid[] NOT NULL,
 PRIMARY KEY (key_hash)
);
