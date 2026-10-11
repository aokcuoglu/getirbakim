-- Shared search engine: one normalisation for every searchable surface (vehicles, products, admin).
-- src/modules/search/query.ts mirrors search_normalize for the query side; keep both in step.
-- Index expressions depend on these IMMUTABLE functions: changing their output requires a REINDEX
-- of the *_search_* indexes below, otherwise the indexes silently disagree with the queries.
-- `SET search_path FROM CURRENT`: index builds run with a restricted search_path and must still find these helpers.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Turkish/Latin letters folded to ASCII, punctuation to spaces; a decimal point between digits ("1.6") survives.
CREATE OR REPLACE FUNCTION search_normalize(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path FROM CURRENT AS $$
 SELECT btrim(regexp_replace(regexp_replace(regexp_replace(lower(translate(normalize(value, NFC),
  'ÇĞİÖŞÜÂÎÛÊÄËÏÉÈÀÁÓÒÍÚÑçğıöşüâîûêäëïéèàáóòíúñ',
  'cgiosuaiueaeieeaaooiuncgiosuaiueaeieeaaooiun')),
  '([0-9]),([0-9])', '\1.\2', 'g'),
  '[^a-z0-9.]+|(?<![0-9])\.|\.(?![0-9])', ' ', 'g'),
  '\s+', ' ', 'g'))
$$;

-- Part and OEM numbers compared without spaces, dots or dashes: "0 986 494-104" = "0986494104".
CREATE OR REPLACE FUNCTION search_compact(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path FROM CURRENT AS $$ SELECT regexp_replace(search_normalize(value), '[^a-z0-9]', '', 'g') $$;

CREATE OR REPLACE FUNCTION supplier_item_search_text(code text, product_data jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path FROM CURRENT AS $$
 SELECT search_normalize(concat_ws(' ', product_data->>'ac', product_data->>'uk', code, product_data->>'oe', product_data->>'ac2'))
$$;
CREATE OR REPLACE FUNCTION supplier_item_search_codes(code text, product_data jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path FROM CURRENT AS $$
 SELECT concat_ws(' ', search_compact(code), NULLIF(search_compact(COALESCE(product_data->>'oe', '')), ''))
$$;

-- Relevance of one catalog row. Exact part/OEM numbers beat everything, then whole-word name hits,
-- then prefix hits; name and brand weigh more than code and description.
CREATE OR REPLACE FUNCTION catalog_search_rank(name text, brand text, code text, oem text, description text,
 prefix_query tsquery, exact_query tsquery, compact text) RETURNS real
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path FROM CURRENT AS $$
 WITH doc AS (SELECT setweight(to_tsvector('simple', search_normalize(COALESCE(name, ''))), 'A')
   || setweight(to_tsvector('simple', search_normalize(COALESCE(brand, ''))), 'B')
   || setweight(to_tsvector('simple', search_normalize(COALESCE(code, ''))), 'C')
   || setweight(to_tsvector('simple', search_normalize(concat_ws(' ', oem, description))), 'D') AS v),
 codes AS (SELECT search_compact(COALESCE(code, '')) AS c, search_compact(COALESCE(oem, '')) AS o)
 SELECT (CASE WHEN compact = '' THEN 0
   WHEN codes.c = compact OR codes.o = compact THEN 100
   -- Partial code hits count only for code-like queries: "yag" is a word, not part of "YAG5YZ9".
   WHEN compact !~ '[0-9]' THEN 0
   WHEN codes.c LIKE compact || '%' OR codes.o LIKE compact || '%' THEN 50
   WHEN length(compact) >= 3 AND (codes.c LIKE '%' || compact || '%' OR codes.o LIKE '%' || compact || '%') THEN 20
   ELSE 0 END
  + CASE WHEN exact_query IS NULL THEN 0 ELSE ts_rank(doc.v, exact_query) * 10 END
  + CASE WHEN prefix_query IS NULL THEN 0 ELSE ts_rank(doc.v, prefix_query) END)::real
 FROM doc, codes
$$;

CREATE INDEX IF NOT EXISTS supplier_items_search_tsv_idx ON supplier_items
 USING gin (to_tsvector('simple', supplier_item_search_text(code, product_data)));
CREATE INDEX IF NOT EXISTS supplier_items_search_codes_idx ON supplier_items
 USING gin (supplier_item_search_codes(code, product_data) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS vehicle_types_search_tsv_idx ON vehicle_types
 USING gin (to_tsvector('simple', search_normalize(search_text)));
-- Expression statistics only exist after ANALYZE; without them the planner guesses the search
-- matches thousands of rows and seq-scans supplier_items (~5 s instead of <1 ms).
ANALYZE supplier_items;
ANALYZE vehicle_types;

-- Words the catalogs actually contain, for "did you mean" corrections of mistyped queries
-- ("volksvagen pasat" → "volkswagen passat"). Rebuilt on every setup; refresh after large imports.
CREATE TABLE IF NOT EXISTS search_vocabulary (
 scope text NOT NULL CHECK (scope IN ('vehicle','product')),
 word text NOT NULL,
 frequency integer NOT NULL,
 PRIMARY KEY (scope, word)
);
CREATE INDEX IF NOT EXISTS search_vocabulary_trgm_idx ON search_vocabulary USING gin (word gin_trgm_ops);
CREATE INDEX IF NOT EXISTS search_vocabulary_prefix_idx ON search_vocabulary (scope, word text_pattern_ops);
-- Distinct supplier product names for type-ahead: a broad prefix ("fren") matches ~15k products, far
-- too many to rank per keystroke, but only a few hundred names. Refreshed with the vocabulary.
CREATE TABLE IF NOT EXISTS search_product_names (
 name text PRIMARY KEY,
 normalized text NOT NULL,
 products integer NOT NULL
);
CREATE INDEX IF NOT EXISTS search_product_names_tsv_idx ON search_product_names USING gin (to_tsvector('simple', normalized));
CREATE OR REPLACE FUNCTION refresh_search_vocabulary() RETURNS void LANGUAGE sql SET search_path FROM CURRENT AS $$
 DELETE FROM search_vocabulary;
 INSERT INTO search_vocabulary (scope, word, frequency)
 SELECT 'vehicle', word, ndoc FROM ts_stat($q$SELECT to_tsvector('simple', search_normalize(search_text)) FROM vehicle_types$q$)
 WHERE word ~ '^[a-z]{3,}$';
 INSERT INTO search_vocabulary (scope, word, frequency)
 SELECT 'product', word, ndoc FROM ts_stat($q$SELECT to_tsvector('simple', supplier_item_search_text(code, product_data))
  FROM supplier_items WHERE presence='present'$q$)
 WHERE word ~ '^[a-z]{3,}$';
 DELETE FROM search_product_names;
 INSERT INTO search_product_names (name, normalized, products)
 SELECT name, search_normalize(name), count(*) FROM (SELECT product_data->>'ac' AS name FROM supplier_items
  WHERE presence='present' AND NOT conflicting) items WHERE name ~ '[[:alpha:]]' GROUP BY name;
$$;
SELECT refresh_search_vocabulary();
