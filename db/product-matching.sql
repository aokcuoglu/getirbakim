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
CREATE TABLE IF NOT EXISTS product_brand_pair_suggestions (
 brand_a text NOT NULL, brand_b text NOT NULL, shared_parts integer NOT NULL, avg_name_similarity real,
 samples jsonb NOT NULL, PRIMARY KEY (brand_a,brand_b)
);
-- Equivalents (muadil), not the same product: SETA's competitor references and OEM numbers.
CREATE TABLE IF NOT EXISTS product_references (
 supplier_item_id uuid NOT NULL REFERENCES supplier_items(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('cross','oem')), brand text NOT NULL, part_number text NOT NULL,
 PRIMARY KEY (supplier_item_id,kind,brand,part_number)
);
CREATE INDEX IF NOT EXISTS product_references_key_idx ON product_references(brand,part_number);
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
 DELETE FROM product_match_groups; DELETE FROM product_brand_pair_suggestions; DELETE FROM product_references;
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
 INSERT INTO product_brand_pair_suggestions
 WITH reps AS (
  SELECT DISTINCT ON (supplier,brand,part_number) supplier,brand,part_number,name FROM product_match_items
  WHERE length(part_number)>=5 ORDER BY supplier,brand,part_number,name NULLS LAST
 ), pairs AS (
  SELECT least(x.brand,y.brand) AS brand_a, greatest(x.brand,y.brand) AS brand_b, x.part_number,
   CASE WHEN x.brand<y.brand THEN x.name ELSE y.name END AS name_a, CASE WHEN x.brand<y.brand THEN y.name ELSE x.name END AS name_b
  FROM reps x JOIN reps y ON y.part_number=x.part_number AND y.supplier<>x.supplier AND y.brand<>x.brand AND x.supplier<y.supplier
 )
 SELECT p.brand_a, p.brand_b, count(DISTINCT p.part_number),
  avg(similarity(lower(p.name_a),lower(p.name_b))) FILTER (WHERE p.name_a IS NOT NULL AND p.name_b IS NOT NULL),
  (SELECT jsonb_agg(s ORDER BY named DESC,part) FROM (SELECT * FROM (SELECT DISTINCT ON (q.part_number) q.part_number AS part,
    (q.name_a IS NOT NULL)::int+(q.name_b IS NOT NULL)::int AS named, jsonb_build_object('part',q.part_number,'a',q.name_a,'b',q.name_b) s
    FROM pairs q WHERE q.brand_a=p.brand_a AND q.brand_b=p.brand_b
    ORDER BY q.part_number, q.name_a IS NULL, q.name_b IS NULL) d ORDER BY named DESC,part LIMIT 4) t)
 FROM pairs p
 WHERE NOT EXISTS (SELECT 1 FROM product_brand_pair_decisions d WHERE d.brand_a=p.brand_a AND d.brand_b=p.brand_b)
 GROUP BY p.brand_a, p.brand_b HAVING count(DISTINCT p.part_number)>=20;
 INSERT INTO product_references
 SELECT DISTINCT i.id, 'cross', COALESCE(a.canonical,product_brand_key(x.key)), regexp_replace(upper(x.value),'[^A-Z0-9]','','g')
 FROM supplier_items i CROSS JOIN LATERAL jsonb_each_text(COALESCE(i.product_data->'cross','{}')) x
 LEFT JOIN product_brand_aliases a ON a.alias=product_brand_key(x.key)
 WHERE i.supplier='seta' AND i.presence='present' AND product_brand_key(x.key) IS NOT NULL
  AND length(regexp_replace(x.value,'[^A-Za-z0-9]','','g'))>=4
 UNION
 SELECT i.id, 'oem', 'ORIJINAL', regexp_replace(upper(o),'[^A-Z0-9]','','g')
 FROM supplier_items i CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(i.product_data->'oems','[]')) o
 WHERE i.supplier='seta' AND i.presence='present' AND length(regexp_replace(o,'[^A-Za-z0-9]','','g'))>=5;
 SELECT jsonb_build_object(
  'items', (SELECT count(*) FROM product_match_items),
  'groups', (SELECT count(*) FROM product_match_groups),
  'cross_supplier_groups', (SELECT count(*) FROM product_match_groups WHERE cardinality(suppliers)>1),
  'duplicate_groups', (SELECT count(*) FROM product_match_groups WHERE cardinality(suppliers)=1),
  'grouped_items', (SELECT COALESCE(sum(members),0) FROM product_match_groups),
  'pair_suggestions', (SELECT count(*) FROM product_brand_pair_suggestions),
  'references', (SELECT count(*) FROM product_references),
  'referenced_items', (SELECT count(DISTINCT r.supplier_item_id) FROM product_references r
    JOIN product_match_items m ON m.brand=r.brand AND m.part_number=r.part_number)
 ) INTO result;
 INSERT INTO product_match_runs(started_at,completed_at,stats) VALUES(started,clock_timestamp(),result);
 RETURN result;
END $$;
