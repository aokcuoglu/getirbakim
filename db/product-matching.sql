-- Cross-supplier product matching (Başbuğ, Dinamik, SETA) and the master catalog (products) built from it.
-- Identity of a physical product = (canonical brand, part number). Codes are "BRAND-PREFIX PART-NO" in Başbuğ and
-- Dinamik with supplier-specific prefixes (SCH = SACHS), so the prefix is dropped and the brand comes from the
-- brand field instead. Başbuğ original parts (OE-*) and SETA codes carry no prefix.
CREATE OR REPLACE FUNCTION supplier_item_brand(supplier text, product_data jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE supplier WHEN 'dinamik' THEN product_data->>'marka' ELSE product_data->>'uk' END
$$;
CREATE OR REPLACE FUNCTION supplier_item_name(supplier text, product_data jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT NULLIF(CASE supplier WHEN 'dinamik' THEN product_data->>'stokAdi' ELSE product_data->>'ac' END,'')
$$;
CREATE OR REPLACE FUNCTION supplier_item_part_number(supplier text, code text, product_data jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT regexp_replace(upper(CASE WHEN supplier='seta' OR (supplier='basbug' AND product_data->>'uk' LIKE 'OE-%') THEN code
  ELSE regexp_replace(code,'^\S+\s+','') END),'[^A-Z0-9]','','g')
$$;
-- OEM numbers a supplier states for its item. Başbuğ's `oe` may list several separated by , ; or /; spaces belong to
-- the number itself (Ford: "6C11 2282 EB"). Fragments shorter than 5 characters ("/SET") are noise.
CREATE OR REPLACE FUNCTION supplier_item_oem_numbers(supplier text, product_data jsonb) RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT COALESCE(array_agg(DISTINCT n ORDER BY n) FILTER (WHERE length(n)>=5),'{}') FROM (
  SELECT regexp_replace(upper(v),'[^A-Z0-9]','','g') AS n FROM (
   SELECT jsonb_array_elements_text(product_data->'oems') WHERE supplier='seta' AND jsonb_typeof(product_data->'oems')='array'
   UNION ALL SELECT regexp_split_to_table(product_data->>'oe','[,;/]+') WHERE supplier='basbug'
  ) s(v)) x
$$;
-- GTIN-8/12/13/14 with a valid check digit. Dinamik's barcode fields also hold its own stock codes and OEM numbers.
CREATE OR REPLACE FUNCTION gtin_valid(code text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT code ~ '^([0-9]{8}|[0-9]{12,14})$' AND code !~ '^0+$' AND (10-(
  SELECT sum(substr(lpad(code,14,'0'),i,1)::int*CASE WHEN i%2=1 THEN 3 ELSE 1 END) FROM generate_series(1,13) i)%10)%10
  =substr(lpad(code,14,'0'),14,1)::int
$$;
-- Default brand key before reviewed aliases: spelling-insensitive, "-AV" (aftermarket list) suffix dropped, and every
-- original-equipment label (OE-PSA, PSA ORIJINAL, OPAR, GM…) folded into one ORIJINAL family keyed by OEM number.
CREATE OR REPLACE FUNCTION product_brand_key(brand text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE WHEN b ~ '^I?OE-' OR b ~ '(^|[^A-Z])(ORIJINAL|ORJINAL)([^A-Z]|$)' OR b IN ('GM','OPAR','MOPAR') THEN 'ORIJINAL'
  ELSE NULLIF(regexp_replace(regexp_replace(b,'-AV$',''),'[^A-Z0-9]','','g'),'') END
 FROM (SELECT upper(trim(brand)) AS b) x
$$;

-- Reviewed brand decisions; the review unit is the brand pair, not individual rows.
-- same: both labels sell the same physical parts (MAGNETI MARELLI / M.MARELLI, MAHLE / MAHLE FILTRE); `alias` then
--   maps to `canonical` and their items group together.
-- equivalent: same numbering, different product (CONTITECH / DAYCO belt sizes, EUROREPAR / ORIJINAL OEM numbers).
-- unrelated: the shared numbers are coincidences. Decided pairs are not suggested again.
CREATE TABLE IF NOT EXISTS product_brand_aliases (
 alias text PRIMARY KEY, canonical text NOT NULL CHECK (canonical<>alias),
 decided_by uuid REFERENCES accounts(id), decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS product_brand_pair_decisions (
 brand_a text NOT NULL, brand_b text NOT NULL, status text NOT NULL CHECK (status IN ('same','equivalent','unrelated')),
 decided_by uuid REFERENCES accounts(id), decided_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (brand_a,brand_b), CHECK (brand_a<brand_b)
);
-- Rebuilt by refresh_product_matches(): one row per present supplier item.
CREATE TABLE IF NOT EXISTS product_match_items (
 supplier_item_id uuid PRIMARY KEY REFERENCES supplier_items(id) ON DELETE CASCADE,
 supplier text NOT NULL, brand text NOT NULL, part_number text NOT NULL, name text
);
CREATE INDEX IF NOT EXISTS product_match_items_key_idx ON product_match_items(brand,part_number);
CREATE INDEX IF NOT EXISTS product_match_items_part_idx ON product_match_items(part_number);
-- Keys shared by two or more items (same supplier or not).
CREATE TABLE IF NOT EXISTS product_match_groups (
 brand text NOT NULL, part_number text NOT NULL, members integer NOT NULL, suppliers text[] NOT NULL,
 PRIMARY KEY (brand,part_number)
);
-- Same part number under different brand keys in different suppliers: pending brand-pair review.
-- Also suggested when both brands carry the same barcodes (Dinamik is the only supplier with EANs).
CREATE TABLE IF NOT EXISTS product_brand_pair_suggestions (
 brand_a text NOT NULL, brand_b text NOT NULL, shared_parts integer NOT NULL, avg_name_similarity real,
 samples jsonb NOT NULL, PRIMARY KEY (brand_a,brand_b)
);
ALTER TABLE product_brand_pair_suggestions ADD COLUMN IF NOT EXISTS shared_eans integer NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS ean_samples jsonb NOT NULL DEFAULT '[]';
-- Equivalents (muadil), not the same product: SETA's competitor references and OEM numbers from SETA and Başbuğ.
CREATE TABLE IF NOT EXISTS product_references (
 supplier_item_id uuid NOT NULL REFERENCES supplier_items(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('cross','oem')), brand text NOT NULL, part_number text NOT NULL,
 PRIMARY KEY (supplier_item_id,kind,brand,part_number)
);
CREATE INDEX IF NOT EXISTS product_references_key_idx ON product_references(brand,part_number);
-- Reference keys (ORIJINAL + OEM number, or a competitor's brand + part number) that tie at least two different
-- products together: items whose own key is the reference (direct) plus items that state it (referencing).
CREATE TABLE IF NOT EXISTS product_equivalence_groups (
 brand text NOT NULL, part_number text NOT NULL, direct integer NOT NULL, referencing integer NOT NULL,
 products integer NOT NULL, members integer NOT NULL, suppliers text[] NOT NULL, PRIMARY KEY (brand,part_number)
);
-- Storefront offers. Saleable Başbuğ/Dinamik items that are the same product (brand key + part number) share one
-- listing: the primary (Başbuğ first, then the lowest code) is what the store lists, and every item of the group,
-- primary included, is an offer competing on price and stock. SETA is a brand of its own and never joins.
CREATE TABLE IF NOT EXISTS product_offers (
 item_id uuid PRIMARY KEY REFERENCES supplier_items(id) ON DELETE CASCADE,
 primary_id uuid NOT NULL REFERENCES supplier_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS product_offers_primary_idx ON product_offers(primary_id);
-- Items an admin split off a group ("Ayır"); they stay separate listings across refreshes.
CREATE TABLE IF NOT EXISTS product_offer_exclusions (
 item_id uuid PRIMARY KEY REFERENCES supplier_items(id) ON DELETE CASCADE,
 decided_by uuid REFERENCES accounts(id), decided_at timestamptz NOT NULL DEFAULT now()
);
-- SETA equivalents of a Başbuğ/Dinamik item: SETA items stating one of its OEM numbers or its own brand + number.
CREATE TABLE IF NOT EXISTS product_seta_references (
 item_id uuid NOT NULL REFERENCES supplier_items(id) ON DELETE CASCADE,
 seta_item_id uuid NOT NULL REFERENCES supplier_items(id) ON DELETE CASCADE,
 brand text NOT NULL, part_number text NOT NULL, PRIMARY KEY (item_id,seta_item_id)
);
CREATE INDEX IF NOT EXISTS product_seta_references_seta_idx ON product_seta_references(seta_item_id);
-- Master catalog: one row per physical product, persistent across refreshes. Supplier rows attach through
-- product_sources; price and stock stay on the supplier rows (the store sells the cheapest available source).
-- Identity is (brand key, part number); variant 0 is the automatic product of that key, variants above 0 were split
-- off by an admin. A new product takes the id of its first item (Başbuğ first), so listing ids stay what they were.
CREATE TABLE IF NOT EXISTS products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 brand text NOT NULL, part_number text NOT NULL, variant integer NOT NULL DEFAULT 0 CHECK (variant>=0),
 name text, brand_label text NOT NULL, code text NOT NULL,
 -- Set when every source moved to another product (brand alias decided later); old links can redirect there.
 merged_into uuid REFERENCES products(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (brand,part_number,variant)
);
CREATE INDEX IF NOT EXISTS products_part_idx ON products(part_number);
-- Suppliers currently selling the product (saleable sources), kept by the refresh and by split/undo for list filters.
ALTER TABLE products ADD COLUMN IF NOT EXISTS suppliers text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS products_suppliers_idx ON products USING gin(suppliers);
-- Which supplier row is which product. auto rows follow the brand key + part number on every refresh; manual rows
-- are admin decisions and are never moved by a refresh.
CREATE TABLE IF NOT EXISTS product_sources (
 supplier_item_id uuid PRIMARY KEY REFERENCES supplier_items(id) ON DELETE CASCADE,
 product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 method text NOT NULL DEFAULT 'auto' CHECK (method IN ('auto','manual')),
 decided_by uuid REFERENCES accounts(id), linked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_sources_product_idx ON product_sources(product_id);
-- Equivalent (muadil) products, both directions; rebuilt by every refresh. `brand`/`part_number` is the shared
-- reference: ORIJINAL + OEM number (oem), a competitor's number stated by a supplier (cross), or the shared part
-- number of a brand pair decided as equivalent (brand).
CREATE TABLE IF NOT EXISTS product_equivalents (
 product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 equivalent_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('oem','cross','brand')), brand text NOT NULL, part_number text NOT NULL,
 PRIMARY KEY (product_id,equivalent_id), CHECK (product_id<>equivalent_id)
);
-- manual: an admin linked the pair as equivalent (product_equivalent_decisions).
ALTER TABLE product_equivalents DROP CONSTRAINT IF EXISTS product_equivalents_kind_check;
ALTER TABLE product_equivalents ADD CONSTRAINT product_equivalents_kind_check CHECK (kind IN ('oem','cross','brand','manual'));
-- Admin decisions on a product pair, kept across refreshes: equivalent adds the link the rules missed (different
-- brands are never merged), unrelated suppresses a wrong automatic one.
CREATE TABLE IF NOT EXISTS product_equivalent_decisions (
 product_a uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 product_b uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 status text NOT NULL CHECK (status IN ('equivalent','unrelated')),
 decided_by uuid REFERENCES accounts(id), decided_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (product_a,product_b), CHECK (product_a<product_b)
);

-- Products the automatic key missed but that look the same (same brand, part numbers differing only in a supplier
-- prefix, leading zeros or a short suffix): a Başbuğ-only product (a, kept) and a Dinamik-only product (b). Rebuilt
-- by every refresh; decided pairs are never suggested again.
CREATE TABLE IF NOT EXISTS product_match_candidates (
 product_a uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 product_b uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 reason text NOT NULL CHECK (reason IN ('prefix','leading_zero','suffix')), name_similarity real,
 PRIMARY KEY (product_a,product_b)
);
CREATE TABLE IF NOT EXISTS product_match_decisions (
 product_a uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 product_b uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 status text NOT NULL CHECK (status IN ('same','different')),
 decided_by uuid REFERENCES accounts(id), decided_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (product_a,product_b)
);
CREATE OR REPLACE FUNCTION product_refresh_suppliers(ids uuid[]) RETURNS void LANGUAGE sql AS $$
 UPDATE products p SET suppliers=x.suppliers, updated_at=now()
 FROM (SELECT p.id, COALESCE((SELECT array_agg(DISTINCT i.supplier ORDER BY i.supplier) FROM product_sources s
   JOIN commerce_supplier_items i ON i.id=s.supplier_item_id WHERE s.product_id=p.id),'{}') AS suppliers
  FROM products p WHERE p.id=ANY(ids)) x
 WHERE p.id=x.id AND p.suppliers IS DISTINCT FROM x.suppliers
$$;
-- Split a supplier row off into a product of its own (a new variant of its key) and lock the link.
CREATE OR REPLACE FUNCTION product_split_item(item uuid, actor uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE k record; old_id uuid; pid uuid;
BEGIN
 SELECT COALESCE(a.canonical,product_brand_key(supplier_item_brand(i.supplier,i.product_data))) AS brand,
  supplier_item_part_number(i.supplier,i.code,i.product_data) AS part_number, supplier_item_name(i.supplier,i.product_data) AS name,
  COALESCE(supplier_item_brand(i.supplier,i.product_data),'') AS label, i.code
 INTO k FROM supplier_items i LEFT JOIN product_brand_aliases a ON a.alias=product_brand_key(supplier_item_brand(i.supplier,i.product_data))
 WHERE i.id=item;
 IF NOT FOUND OR k.brand IS NULL THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(20261001,6);
 SELECT product_id INTO old_id FROM product_sources WHERE supplier_item_id=item;
 INSERT INTO products(id,brand,part_number,variant,name,brand_label,code)
 VALUES (CASE WHEN EXISTS (SELECT 1 FROM products WHERE id=item) THEN gen_random_uuid() ELSE item END, k.brand, k.part_number,
  (SELECT COALESCE(max(variant),0)+1 FROM products WHERE brand=k.brand AND part_number=k.part_number), k.name, k.label, k.code)
 RETURNING id INTO pid;
 INSERT INTO product_sources(supplier_item_id,product_id,method,decided_by) VALUES (item,pid,'manual',actor)
 ON CONFLICT (supplier_item_id) DO UPDATE SET product_id=pid, method='manual', decided_by=actor, linked_at=now();
 PERFORM product_refresh_suppliers(ARRAY[pid,old_id]);
 RETURN pid;
END $$;
DROP FUNCTION IF EXISTS product_unsplit_item(uuid);
-- Recompute the storefront projection (product_offers) for a few products after a manual decision.
CREATE OR REPLACE FUNCTION product_refresh_offers(ids uuid[]) RETURNS void LANGUAGE sql AS $$
 DELETE FROM product_offers o USING product_sources s
 WHERE s.product_id=ANY(ids) AND (o.item_id=s.supplier_item_id OR o.primary_id=s.supplier_item_id);
 INSERT INTO product_offers
 WITH offers AS (
  SELECT s.product_id, i.id AS item_id, CASE i.supplier WHEN 'basbug' THEN 0 ELSE 1 END AS supplier_rank, i.code
  FROM product_sources s JOIN commerce_supplier_items i ON i.id=s.supplier_item_id
  WHERE s.product_id=ANY(ids) AND i.supplier IN ('basbug','dinamik')
   AND EXISTS (SELECT 1 FROM product_match_items m WHERE m.supplier_item_id=i.id)
 ), ranked AS (
  SELECT item_id, count(*) OVER (PARTITION BY product_id) AS offers,
   first_value(item_id) OVER (PARTITION BY product_id ORDER BY item_id=product_id DESC,supplier_rank,code,item_id) AS primary_id
  FROM offers
 )
 SELECT item_id, primary_id FROM ranked WHERE offers>1 ON CONFLICT (item_id) DO UPDATE SET primary_id=excluded.primary_id
$$;
-- "Aynı ürün": every row of `source` joins `target` as a locked manual link; `source` redirects to `target`.
CREATE OR REPLACE FUNCTION product_merge(source uuid, target uuid, actor uuid) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(20261001,6);
 -- A target merged earlier stands for the product it was merged into.
 SELECT COALESCE(merged_into,id) INTO target FROM products WHERE id=target;
 IF target IS NULL OR source IS NULL OR source=target OR NOT EXISTS (SELECT 1 FROM products WHERE id=source) THEN RETURN NULL; END IF;
 UPDATE product_sources SET product_id=target, method='manual', decided_by=actor, linked_at=now() WHERE product_id=source;
 UPDATE products SET merged_into=target, updated_at=now() WHERE id=source OR merged_into=source;
 UPDATE products SET merged_into=NULL, updated_at=now() WHERE id=target AND merged_into IS NOT NULL;
 PERFORM product_refresh_suppliers(ARRAY[source,target]);
 PERFORM product_refresh_offers(ARRAY[source,target]);
 RETURN target;
END $$;
-- Undo a manual decision (split or merge) for one row: it rejoins the automatic product of its own key, which is
-- created or revived when needed; a product left without rows redirects there. A merge undone this way is recorded
-- as "different" so the pair is not suggested again.
CREATE OR REPLACE FUNCTION product_reset_item(item uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE k record; old_id uuid; pid uuid;
BEGIN
 SELECT s.product_id INTO old_id FROM product_sources s WHERE s.supplier_item_id=item AND s.method='manual';
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT COALESCE(a.canonical,product_brand_key(supplier_item_brand(i.supplier,i.product_data))) AS brand,
  supplier_item_part_number(i.supplier,i.code,i.product_data) AS part_number, supplier_item_name(i.supplier,i.product_data) AS name,
  COALESCE(supplier_item_brand(i.supplier,i.product_data),'') AS label, i.code
 INTO k FROM supplier_items i LEFT JOIN product_brand_aliases a ON a.alias=product_brand_key(supplier_item_brand(i.supplier,i.product_data))
 WHERE i.id=item;
 IF k.brand IS NULL THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(20261001,6);
 SELECT id INTO pid FROM products WHERE brand=k.brand AND part_number=k.part_number AND variant=0;
 IF pid IS NULL THEN
  INSERT INTO products(id,brand,part_number,name,brand_label,code)
  VALUES (CASE WHEN EXISTS (SELECT 1 FROM products WHERE id=item) THEN gen_random_uuid() ELSE item END, k.brand, k.part_number, k.name, k.label, k.code)
  RETURNING id INTO pid;
 END IF;
 UPDATE products SET merged_into=NULL, updated_at=now() WHERE id=pid AND merged_into IS NOT NULL;
 UPDATE product_sources SET product_id=pid, method='auto', decided_by=NULL, linked_at=now() WHERE supplier_item_id=item;
 IF old_id<>pid THEN
  UPDATE products SET merged_into=pid, updated_at=now() WHERE id=old_id AND NOT EXISTS (SELECT 1 FROM product_sources WHERE product_id=old_id);
  UPDATE product_match_decisions SET status='different', decided_at=now() WHERE status='same' AND product_a=old_id AND product_b=pid;
 END IF;
 PERFORM product_refresh_suppliers(ARRAY[pid,old_id]);
 PERFORM product_refresh_offers(ARRAY[pid,old_id]);
 RETURN pid;
END $$;
CREATE TABLE IF NOT EXISTS product_match_runs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, started_at timestamptz NOT NULL, completed_at timestamptz NOT NULL,
 stats jsonb NOT NULL
);

-- Short part numbers ("1", "12") collide across unrelated brands; they never form groups or suggestions.
CREATE OR REPLACE FUNCTION refresh_product_matches() RETURNS jsonb LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE started timestamptz := clock_timestamp(); result jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(20261001,5);
 -- DELETE, not TRUNCATE: readers (admin screen) keep seeing the previous results until this transaction commits.
 DELETE FROM product_match_groups; DELETE FROM product_brand_pair_suggestions; DELETE FROM product_equivalence_groups;
 DELETE FROM product_references; DELETE FROM product_offers; DELETE FROM product_seta_references;
 DELETE FROM product_match_items;
 INSERT INTO product_match_items
 SELECT i.id, i.supplier, COALESCE(a.canonical,k.key), supplier_item_part_number(i.supplier,i.code,i.product_data),
  supplier_item_name(i.supplier,i.product_data)
 FROM supplier_items i
 CROSS JOIN LATERAL (SELECT product_brand_key(supplier_item_brand(i.supplier,i.product_data)) AS key) k
 LEFT JOIN product_brand_aliases a ON a.alias=k.key
 WHERE i.presence='present' AND k.key IS NOT NULL;
 DELETE FROM product_match_items WHERE length(part_number)<4;
 ANALYZE product_match_items;
 INSERT INTO product_match_groups
 SELECT brand, part_number, count(*), array_agg(DISTINCT supplier ORDER BY supplier)
 FROM product_match_items GROUP BY brand, part_number HAVING count(*)>1;
 -- One representative per (supplier, key) keeps duplicate rows from inflating pair counts.
 DROP TABLE IF EXISTS part_pairs, barcodes, ean_items, ean_pairs;
 CREATE TEMP TABLE part_pairs ON COMMIT DROP AS
 WITH reps AS (
  SELECT DISTINCT ON (supplier,brand,part_number) supplier,brand,part_number,name FROM product_match_items
  WHERE length(part_number)>=5 ORDER BY supplier,brand,part_number,name NULLS LAST
 )
 SELECT least(x.brand,y.brand) AS brand_a, greatest(x.brand,y.brand) AS brand_b, x.part_number,
  CASE WHEN x.brand<y.brand THEN x.name ELSE y.name END AS name_a, CASE WHEN x.brand<y.brand THEN y.name ELSE x.name END AS name_b
 FROM reps x JOIN reps y ON y.part_number=x.part_number AND y.supplier<>x.supplier AND y.brand<>x.brand AND x.supplier<y.supplier;
 -- Dinamik barcode fields, split into real GTINs and other codes (stock codes, OEM numbers).
 CREATE TEMP TABLE barcodes ON COMMIT DROP AS
 SELECT m.supplier_item_id, m.brand, m.part_number, m.name, b.code, gtin_valid(b.code) AS gtin
 FROM product_match_items m JOIN supplier_items i ON i.id=m.supplier_item_id
 CROSS JOIN LATERAL (SELECT DISTINCT regexp_replace(upper(v),'[^A-Z0-9]','','g') FROM unnest(ARRAY[i.product_data->>'barkod1',
  i.product_data->>'barkod2',i.product_data->>'barkod3']) v) b(code)
 WHERE m.supplier='dinamik' AND length(b.code)>=7;
 -- GTINs shared by different brand keys. One spread over more than three brands is a generic label (ITHAL, TAIWAN,
 -- MUHTELIF…) or a placeholder and is not evidence.
 CREATE TEMP TABLE ean_items ON COMMIT DROP AS SELECT DISTINCT brand, part_number, name, code AS ean FROM barcodes WHERE gtin;
 DELETE FROM ean_items WHERE ean IN (SELECT ean FROM ean_items GROUP BY ean HAVING count(DISTINCT brand)=1 OR count(DISTINCT brand)>3);
 CREATE TEMP TABLE ean_pairs ON COMMIT DROP AS
 SELECT DISTINCT ON (brand_a,brand_b,ean) * FROM (
  SELECT least(x.brand,y.brand) AS brand_a, greatest(x.brand,y.brand) AS brand_b, x.ean,
   CASE WHEN x.brand<y.brand THEN x.part_number ELSE y.part_number END AS part_a, CASE WHEN x.brand<y.brand THEN x.name ELSE y.name END AS name_a,
   CASE WHEN x.brand<y.brand THEN y.part_number ELSE x.part_number END AS part_b, CASE WHEN x.brand<y.brand THEN y.name ELSE x.name END AS name_b
  FROM ean_items x JOIN ean_items y ON y.ean=x.ean AND y.brand<>x.brand) p
 ORDER BY brand_a,brand_b,ean,part_a,part_b;
 INSERT INTO product_brand_pair_suggestions(brand_a,brand_b,shared_parts,avg_name_similarity,samples,shared_eans,ean_samples)
 WITH parts AS (
  SELECT p.brand_a, p.brand_b, count(DISTINCT p.part_number)::int AS shared_parts,
   avg(similarity(lower(p.name_a),lower(p.name_b))) FILTER (WHERE p.name_a IS NOT NULL AND p.name_b IS NOT NULL) AS similarity,
   (SELECT jsonb_agg(s ORDER BY named DESC,part) FROM (SELECT * FROM (SELECT DISTINCT ON (q.part_number) q.part_number AS part,
     (q.name_a IS NOT NULL)::int+(q.name_b IS NOT NULL)::int AS named, jsonb_build_object('part',q.part_number,'a',q.name_a,'b',q.name_b) s
     FROM part_pairs q WHERE q.brand_a=p.brand_a AND q.brand_b=p.brand_b
     ORDER BY q.part_number, q.name_a IS NULL, q.name_b IS NULL) d ORDER BY named DESC,part LIMIT 4) t) AS samples
  FROM part_pairs p GROUP BY p.brand_a, p.brand_b
  -- A few shared numbers are enough when one label extends the other (VALEO / VALEO FTE).
  HAVING count(DISTINCT p.part_number)>=20 OR (count(DISTINCT p.part_number)>=3
   AND (starts_with(p.brand_a,p.brand_b) OR starts_with(p.brand_b,p.brand_a)))
 ), eans AS (
  SELECT e.brand_a, e.brand_b, count(*)::int AS shared_eans,
   avg(similarity(lower(e.name_a),lower(e.name_b))) FILTER (WHERE e.name_a IS NOT NULL AND e.name_b IS NOT NULL) AS similarity,
   (SELECT jsonb_agg(jsonb_build_object('ean',q.ean,'part_a',q.part_a,'a',q.name_a,'part_b',q.part_b,'b',q.name_b) ORDER BY q.ean)
    FROM (SELECT * FROM ean_pairs q WHERE q.brand_a=e.brand_a AND q.brand_b=e.brand_b ORDER BY q.ean LIMIT 4) q) AS samples
  FROM ean_pairs e GROUP BY e.brand_a, e.brand_b HAVING count(*)>=5
 )
 SELECT * FROM (
  SELECT brand_a, brand_b, COALESCE(p.shared_parts,0), COALESCE(p.similarity,e.similarity), COALESCE(p.samples,'[]'::jsonb),
   COALESCE(e.shared_eans,0), COALESCE(e.samples,'[]'::jsonb)
  FROM parts p FULL JOIN eans e USING (brand_a,brand_b)
 ) s(brand_a,brand_b,shared_parts,similarity,samples,shared_eans,ean_samples)
 WHERE NOT EXISTS (SELECT 1 FROM product_brand_pair_decisions d WHERE d.brand_a=s.brand_a AND d.brand_b=s.brand_b);
 INSERT INTO product_references
 SELECT DISTINCT i.id, 'cross', COALESCE(a.canonical,product_brand_key(x.key)), regexp_replace(upper(x.value),'[^A-Z0-9]','','g')
 FROM supplier_items i CROSS JOIN LATERAL jsonb_each_text(COALESCE(i.product_data->'cross','{}')) x
 LEFT JOIN product_brand_aliases a ON a.alias=product_brand_key(x.key)
 WHERE i.supplier='seta' AND i.presence='present' AND product_brand_key(x.key) IS NOT NULL
  AND length(regexp_replace(x.value,'[^A-Za-z0-9]','','g'))>=4
 UNION
 -- An original part's own number is its key already; any other number it lists is a superseded/alternative OEM.
 SELECT m.supplier_item_id, 'oem', 'ORIJINAL', o
 FROM product_match_items m JOIN supplier_items i ON i.id=m.supplier_item_id
 CROSS JOIN LATERAL unnest(supplier_item_oem_numbers(i.supplier,i.product_data)) o
 WHERE m.supplier IN ('seta','basbug') AND NOT (m.brand='ORIJINAL' AND m.part_number=o);
 -- A non-GTIN Dinamik barcode counts as an OEM number only when the catalog already knows that number as one.
 INSERT INTO product_references
 SELECT DISTINCT b.supplier_item_id, 'oem', 'ORIJINAL', b.code FROM barcodes b
 WHERE NOT b.gtin AND NOT (b.brand='ORIJINAL' AND b.part_number=b.code)
  AND (EXISTS (SELECT 1 FROM product_match_items m WHERE m.brand='ORIJINAL' AND m.part_number=b.code)
   OR EXISTS (SELECT 1 FROM product_references r WHERE r.kind='oem' AND r.part_number=b.code))
 ON CONFLICT DO NOTHING;
 ANALYZE product_references;
 INSERT INTO product_equivalence_groups
 WITH links AS (
  SELECT r.brand AS ref_brand, r.part_number AS ref_part, r.supplier_item_id, false AS direct FROM product_references r
  UNION
  SELECT m.brand, m.part_number, m.supplier_item_id, true FROM product_match_items m
  WHERE EXISTS (SELECT 1 FROM product_references r WHERE r.brand=m.brand AND r.part_number=m.part_number)
 ), members AS (
  -- An item both owning and stating the key counts once, as direct.
  SELECT DISTINCT ON (l.ref_brand,l.ref_part,l.supplier_item_id) l.*, m.supplier, m.brand, m.part_number
  FROM links l JOIN product_match_items m ON m.supplier_item_id=l.supplier_item_id
  ORDER BY l.ref_brand,l.ref_part,l.supplier_item_id,l.direct DESC
 )
 SELECT ref_brand, ref_part, count(*) FILTER (WHERE direct), count(*) FILTER (WHERE NOT direct),
  count(DISTINCT (brand,part_number)), count(*), array_agg(DISTINCT supplier ORDER BY supplier)
 FROM members GROUP BY ref_brand, ref_part HAVING count(DISTINCT (brand,part_number))>1;
 -- Master catalog. Splits decided before product_sources existed become manual products once.
 PERFORM product_split_item(x.item_id,x.decided_by) FROM product_offer_exclusions x
 WHERE NOT EXISTS (SELECT 1 FROM product_sources s WHERE s.supplier_item_id=x.item_id AND s.method='manual');
 DELETE FROM product_offer_exclusions;
 DROP TABLE IF EXISTS linkable, auto_items, old_links;
 -- Saleable rows with a brand key and part number; the first per key (Başbuğ, then Dinamik, then code) names it.
 CREATE TEMP TABLE linkable ON COMMIT DROP AS
 SELECT m.supplier_item_id AS item_id, m.supplier, m.brand, m.part_number, m.name, i.code,
  COALESCE(supplier_item_brand(i.supplier,i.product_data),'') AS label,
  CASE m.supplier WHEN 'basbug' THEN 0 WHEN 'dinamik' THEN 1 ELSE 2 END AS supplier_rank
 FROM product_match_items m JOIN commerce_supplier_items i ON i.id=m.supplier_item_id;
 CREATE INDEX ON linkable(item_id);
 CREATE TEMP TABLE old_links ON COMMIT DROP AS SELECT supplier_item_id, product_id FROM product_sources;
 CREATE TEMP TABLE auto_items ON COMMIT DROP AS
 SELECT l.* FROM linkable l WHERE NOT EXISTS (SELECT 1 FROM product_sources s WHERE s.supplier_item_id=l.item_id AND s.method='manual');
 ANALYZE linkable; ANALYZE auto_items;
 INSERT INTO products(id,brand,part_number,name,brand_label,code)
 SELECT CASE WHEN EXISTS (SELECT 1 FROM products p WHERE p.id=f.item_id) THEN gen_random_uuid() ELSE f.item_id END,
  f.brand, f.part_number, f.name, f.label, f.code
 FROM (SELECT DISTINCT ON (brand,part_number) * FROM auto_items ORDER BY brand,part_number,supplier_rank,code,item_id) f
 WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.brand=f.brand AND p.part_number=f.part_number AND p.variant=0)
 ON CONFLICT DO NOTHING;
 INSERT INTO product_sources(supplier_item_id,product_id)
 SELECT a.item_id, p.id FROM auto_items a JOIN products p ON p.brand=a.brand AND p.part_number=a.part_number AND p.variant=0
 ON CONFLICT (supplier_item_id) DO UPDATE SET product_id=excluded.product_id, linked_at=now()
 WHERE product_sources.method='auto' AND product_sources.product_id<>excluded.product_id;
 -- Display fields follow the product's own row (its id), else Başbuğ, Dinamik, SETA.
 UPDATE products p SET name=r.name, brand_label=r.label, code=r.code, updated_at=now()
 FROM (SELECT DISTINCT ON (s.product_id) s.product_id, l.name, l.label, l.code FROM product_sources s JOIN linkable l ON l.item_id=s.supplier_item_id
  ORDER BY s.product_id, l.item_id=s.product_id DESC, l.supplier_rank, l.code, l.item_id) r
 WHERE p.id=r.product_id AND (p.name,p.brand_label,p.code) IS DISTINCT FROM (r.name,r.label,r.code);
 UPDATE products p SET suppliers=COALESCE(x.suppliers,'{}'), updated_at=now()
 FROM products q LEFT JOIN (SELECT s.product_id, array_agg(DISTINCT l.supplier ORDER BY l.supplier) AS suppliers
  FROM product_sources s JOIN linkable l ON l.item_id=s.supplier_item_id GROUP BY s.product_id) x ON x.product_id=q.id
 WHERE p.id=q.id AND p.suppliers IS DISTINCT FROM COALESCE(x.suppliers,'{}');
 -- A product whose rows all moved elsewhere (a brand alias decided since) points to where most of them went.
 UPDATE products p SET merged_into=t.target, updated_at=now()
 FROM (SELECT DISTINCT ON (o.product_id) o.product_id, s.product_id AS target FROM old_links o
  JOIN product_sources s ON s.supplier_item_id=o.supplier_item_id AND s.product_id<>o.product_id
  GROUP BY o.product_id, s.product_id ORDER BY o.product_id, count(*) DESC, s.product_id) t
 WHERE p.id=t.product_id AND p.merged_into IS DISTINCT FROM t.target AND NOT EXISTS (SELECT 1 FROM product_sources s WHERE s.product_id=p.id);
 UPDATE products p SET merged_into=NULL, updated_at=now()
 WHERE p.merged_into IS NOT NULL AND EXISTS (SELECT 1 FROM product_sources s WHERE s.product_id=p.id);
 ANALYZE products; ANALYZE product_sources;
 -- Storefront projection until the store reads products directly: the listed row is the product's own row (else
 -- Başbuğ first, then the lowest code); every Başbuğ/Dinamik row of the product competes on price and stock.
 INSERT INTO product_offers
 WITH offers AS (
  SELECT s.product_id, l.item_id, l.supplier_rank, l.code FROM product_sources s JOIN linkable l ON l.item_id=s.supplier_item_id
  WHERE l.supplier IN ('basbug','dinamik')
 ), ranked AS (
  SELECT item_id, count(*) OVER (PARTITION BY product_id) AS offers,
   first_value(item_id) OVER (PARTITION BY product_id ORDER BY item_id=product_id DESC,supplier_rank,code,item_id) AS primary_id
  FROM offers
 )
 SELECT item_id, primary_id FROM ranked WHERE offers>1;
 ANALYZE product_offers;
 DELETE FROM product_match_candidates;
 DROP TABLE IF EXISTS cand_a, cand_b;
 CREATE TEMP TABLE cand_a ON COMMIT DROP AS SELECT id, brand, part_number, name, regexp_replace(upper(code),'[^A-Z0-9]','','g') AS full_code
 FROM products WHERE suppliers='{basbug}' AND merged_into IS NULL;
 CREATE TEMP TABLE cand_b ON COMMIT DROP AS SELECT id, brand, part_number, name, regexp_replace(upper(code),'[^A-Z0-9]','','g') AS full_code
 FROM products WHERE suppliers='{dinamik}' AND merged_into IS NULL;
 ANALYZE cand_a; ANALYZE cand_b;
 INSERT INTO product_match_candidates
 SELECT DISTINCT ON (a,b) a, b, reason, similarity(lower(name_a),lower(name_b)) FROM (
  SELECT a.id AS a, b.id AS b, 'prefix' AS reason, a.name AS name_a, b.name AS name_b, 1 AS priority FROM cand_a a JOIN cand_b b ON b.brand=a.brand AND b.part_number=a.full_code
  UNION ALL SELECT a.id, b.id, 'prefix', a.name, b.name, 1 FROM cand_a a JOIN cand_b b ON b.brand=a.brand AND a.part_number=b.full_code
  UNION ALL SELECT a.id, b.id, 'leading_zero', a.name, b.name, 2 FROM cand_a a JOIN cand_b b
   ON b.brand=a.brand AND ltrim(b.part_number,'0')=ltrim(a.part_number,'0') AND b.part_number<>a.part_number
  UNION ALL SELECT a.id, b.id, 'suffix', a.name, b.name, 3 FROM cand_a a JOIN cand_b b ON b.brand=a.brand AND left(b.part_number,5)=left(a.part_number,5)
   AND b.part_number<>a.part_number AND length(a.part_number)>=6 AND length(b.part_number)>=6 AND abs(length(a.part_number)-length(b.part_number))<=3
   AND (starts_with(a.part_number,b.part_number) OR starts_with(b.part_number,a.part_number))
 ) c WHERE NOT EXISTS (SELECT 1 FROM product_match_decisions d WHERE d.product_a=c.a AND d.product_b=c.b)
 ORDER BY a, b, priority;
 INSERT INTO product_seta_references
 SELECT DISTINCT ON (k.item_id,r.supplier_item_id) k.item_id, r.supplier_item_id, k.brand, k.part_number
 FROM (
  SELECT supplier_item_id AS item_id, brand, part_number FROM product_match_items WHERE supplier IN ('basbug','dinamik')
  UNION SELECT r.supplier_item_id, r.brand, r.part_number FROM product_references r
  JOIN product_match_items m ON m.supplier_item_id=r.supplier_item_id AND m.supplier IN ('basbug','dinamik')
 ) k JOIN product_references r ON r.brand=k.brand AND r.part_number=k.part_number
 JOIN product_match_items s ON s.supplier_item_id=r.supplier_item_id AND s.supplier='seta'
 ORDER BY k.item_id, r.supplier_item_id, k.brand, k.part_number;
 ANALYZE product_seta_references;
 DELETE FROM product_equivalents;
 INSERT INTO product_equivalents
 WITH item_products AS (
  SELECT s.supplier_item_id AS item_id, s.product_id FROM product_sources s JOIN linkable l ON l.item_id=s.supplier_item_id
 ), refs AS (
  -- Products tied by a reference key: those owning it and those stating it. The largest real groups are ~40 products
  -- (timing belt kits, cabin filters); a key shared by more than 100 would be a generic placeholder.
  SELECT DISTINCT r.brand, r.part_number, ip.product_id FROM product_references r JOIN item_products ip ON ip.item_id=r.supplier_item_id
  JOIN product_equivalence_groups g ON g.brand=r.brand AND g.part_number=r.part_number
  UNION
  SELECT m.brand, m.part_number, ip.product_id FROM product_match_items m JOIN item_products ip ON ip.item_id=m.supplier_item_id
  JOIN product_equivalence_groups g ON g.brand=m.brand AND g.part_number=m.part_number
 ), keyed AS (
  SELECT *, count(*) OVER (PARTITION BY brand,part_number) AS n FROM refs
 ), pairs AS (
  SELECT x.product_id, y.product_id AS equivalent_id, CASE WHEN x.brand='ORIJINAL' THEN 'oem' ELSE 'cross' END AS kind,
   x.brand, x.part_number, 1 AS priority
  FROM keyed x JOIN keyed y ON y.brand=x.brand AND y.part_number=x.part_number AND y.product_id<>x.product_id WHERE x.n<=100
  UNION ALL
  -- SETA equivalents regardless of group size (the store shows them on the product page).
  SELECT ip.product_id, sp.product_id, CASE WHEN r.brand='ORIJINAL' THEN 'oem' ELSE 'cross' END, r.brand, r.part_number, 0
  FROM product_seta_references r JOIN item_products ip ON ip.item_id=r.item_id JOIN item_products sp ON sp.item_id=r.seta_item_id
  UNION ALL
  SELECT sp.product_id, ip.product_id, CASE WHEN r.brand='ORIJINAL' THEN 'oem' ELSE 'cross' END, r.brand, r.part_number, 0
  FROM product_seta_references r JOIN item_products ip ON ip.item_id=r.item_id JOIN item_products sp ON sp.item_id=r.seta_item_id
  UNION ALL
  -- Brand pairs decided as equivalent (same numbering, different product): every shared part number. A trailing HD
  -- (DAYCO's heavy-duty line of the same size: 10PK1725HD) is not part of the numbering.
  SELECT a.id, b.id, 'brand', b.brand, b.part_number, 2
  FROM product_brand_pair_decisions d
  JOIN products a ON a.brand IN (d.brand_a,d.brand_b) AND a.variant=0
  JOIN products b ON b.brand IN (d.brand_a,d.brand_b) AND b.brand<>a.brand AND b.variant=0
   AND regexp_replace(b.part_number,'HD$','')=regexp_replace(a.part_number,'HD$','')
  WHERE d.status='equivalent' AND length(regexp_replace(a.part_number,'HD$',''))>=5
  UNION ALL
  -- Pairs an admin linked by hand; only used when no rule ties them.
  SELECT product_a, product_b, 'manual', p.brand_label, p.part_number, 3 FROM product_equivalent_decisions JOIN products p ON p.id=product_b
  WHERE status='equivalent'
  UNION ALL
  SELECT product_b, product_a, 'manual', p.brand_label, p.part_number, 3 FROM product_equivalent_decisions JOIN products p ON p.id=product_a
  WHERE status='equivalent'
 )
 SELECT DISTINCT ON (product_id,equivalent_id) product_id, equivalent_id, kind, brand, part_number FROM pairs
 WHERE product_id<>equivalent_id AND NOT EXISTS (SELECT 1 FROM product_equivalent_decisions d WHERE d.status='unrelated'
  AND d.product_a=LEAST(product_id,equivalent_id) AND d.product_b=GREATEST(product_id,equivalent_id))
 ORDER BY product_id, equivalent_id, priority, brand, part_number;
 ANALYZE product_equivalents;
 SELECT jsonb_build_object(
  'offer_groups', (SELECT count(DISTINCT primary_id) FROM product_offers),
  'offer_items', (SELECT count(*) FROM product_offers),
  'basbug_dinamik_groups', (SELECT count(*) FROM (SELECT primary_id FROM product_offers o JOIN supplier_items i ON i.id=o.item_id
    GROUP BY primary_id HAVING count(*) FILTER (WHERE i.supplier='basbug')>0 AND count(*) FILTER (WHERE i.supplier='dinamik')>0) g),
  'dinamik_only', (SELECT count(*) FROM commerce_supplier_items i WHERE i.supplier='dinamik'
    AND NOT EXISTS (SELECT 1 FROM product_offers o WHERE o.item_id=i.id AND o.primary_id IN (SELECT o2.item_id FROM product_offers o2 JOIN supplier_items b ON b.id=o2.item_id AND b.supplier='basbug'))),
  'products', (SELECT count(*) FROM products),
  'listed_products', (SELECT count(DISTINCT product_id) FROM product_sources s JOIN linkable l ON l.item_id=s.supplier_item_id),
  'multi_source_products', (SELECT count(*) FROM (SELECT product_id FROM product_sources s JOIN linkable l ON l.item_id=s.supplier_item_id
    GROUP BY product_id HAVING count(*)>1) x),
  'manual_sources', (SELECT count(*) FROM product_sources WHERE method='manual'),
  'merged_products', (SELECT count(*) FROM products WHERE merged_into IS NOT NULL),
  'product_equivalents', (SELECT count(*) FROM product_equivalents),
  'match_candidates', (SELECT count(*) FROM product_match_candidates),
  'seta_linked_items', (SELECT count(DISTINCT seta_item_id) FROM product_seta_references),
  'seta_linked_products', (SELECT count(DISTINCT item_id) FROM product_seta_references),
  'items', (SELECT count(*) FROM product_match_items),
  'groups', (SELECT count(*) FROM product_match_groups),
  'cross_supplier_groups', (SELECT count(*) FROM product_match_groups WHERE cardinality(suppliers)>1),
  'duplicate_groups', (SELECT count(*) FROM product_match_groups WHERE cardinality(suppliers)=1),
  'grouped_items', (SELECT COALESCE(sum(members),0) FROM product_match_groups),
  'pair_suggestions', (SELECT count(*) FROM product_brand_pair_suggestions),
  'ean_pair_suggestions', (SELECT count(*) FROM product_brand_pair_suggestions WHERE shared_eans>0),
  'references', (SELECT count(*) FROM product_references),
  'oem_references', (SELECT count(*) FROM product_references WHERE kind='oem'),
  'referenced_items', (SELECT count(DISTINCT r.supplier_item_id) FROM product_references r
    JOIN product_match_items m ON m.brand=r.brand AND m.part_number=r.part_number),
  'equivalence_groups', (SELECT count(*) FROM product_equivalence_groups),
  'cross_supplier_equivalence_groups', (SELECT count(*) FROM product_equivalence_groups WHERE cardinality(suppliers)>1),
  'equivalent_items', (SELECT count(DISTINCT supplier_item_id) FROM (
    SELECT r.supplier_item_id FROM product_references r JOIN product_equivalence_groups g USING(brand,part_number)
    UNION ALL SELECT m.supplier_item_id FROM product_match_items m JOIN product_equivalence_groups g USING(brand,part_number)) x)
 ) INTO result;
 INSERT INTO product_match_runs(started_at,completed_at,stats) VALUES(started,clock_timestamp(),result);
 RETURN result;
END $$;
