-- Cross-supplier product matching (Başbuğ, Dinamik, SETA). Data only: the storefront does not read it yet.
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
  FROM part_pairs p GROUP BY p.brand_a, p.brand_b HAVING count(DISTINCT p.part_number)>=20
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
 INSERT INTO product_offers
 WITH saleable AS (
  SELECT m.supplier_item_id, m.supplier, m.brand, m.part_number, i.code FROM product_match_items m
  JOIN commerce_supplier_items i ON i.id=m.supplier_item_id
  WHERE m.supplier IN ('basbug','dinamik') AND NOT EXISTS (SELECT 1 FROM product_offer_exclusions x WHERE x.item_id=m.supplier_item_id)
 ), ranked AS (
  SELECT supplier_item_id, count(*) OVER (PARTITION BY brand,part_number) AS offers,
   first_value(supplier_item_id) OVER (PARTITION BY brand,part_number ORDER BY supplier='basbug' DESC,code,supplier_item_id) AS primary_id
  FROM saleable
 )
 SELECT supplier_item_id, primary_id FROM ranked WHERE offers>1;
 ANALYZE product_offers;
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
 SELECT jsonb_build_object(
  'offer_groups', (SELECT count(DISTINCT primary_id) FROM product_offers),
  'offer_items', (SELECT count(*) FROM product_offers),
  'basbug_dinamik_groups', (SELECT count(*) FROM (SELECT primary_id FROM product_offers o JOIN supplier_items i ON i.id=o.item_id
    GROUP BY primary_id HAVING count(*) FILTER (WHERE i.supplier='basbug')>0 AND count(*) FILTER (WHERE i.supplier='dinamik')>0) g),
  'dinamik_only', (SELECT count(*) FROM commerce_supplier_items i WHERE i.supplier='dinamik'
    AND NOT EXISTS (SELECT 1 FROM product_offers o WHERE o.item_id=i.id AND o.primary_id IN (SELECT o2.item_id FROM product_offers o2 JOIN supplier_items b ON b.id=o2.item_id AND b.supplier='basbug'))),
  'offer_exclusions', (SELECT count(*) FROM product_offer_exclusions),
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
