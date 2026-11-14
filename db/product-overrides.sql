-- Admin edits of a product's store card (#575). A column left NULL follows the automatic sources (supplier rows,
-- enrichment); a value wins over them. Supplier syncs, the matcher, enrichment imports, fitment rebuilds and the
-- storefront bundle never write these tables, so refreshes cannot overwrite an edit.
CREATE TABLE IF NOT EXISTS product_overrides (
 product_id uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
 name text CHECK (char_length(name)<=300),
 description text CHECK (char_length(description)<=5000),
 seo_title text CHECK (char_length(seo_title)<=120),
 seo_description text CHECK (char_length(seo_description)<=300),
 -- A Trodo category (source_categories, source='trodo'); no FK: the category tree is reloaded as a whole.
 category_id integer,
 -- Off sale everywhere: storefront, cart, partner API, maintenance kits (commerce_catalog drops the rows).
 hidden boolean NOT NULL DEFAULT false,
 updated_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- One row per changed field and save; NULL is "automatic".
CREATE TABLE IF NOT EXISTS product_override_changes (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 field text NOT NULL, old_value text, new_value text,
 changed_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_override_changes_product_idx ON product_override_changes(product_id,changed_at DESC,id DESC);

-- The catalog views read edits per supplier row (commerce_item_overrides, db/commerce.sql): rewrite that copy for
-- the given products from their current sources. Rows that left those products lose the edit.
CREATE OR REPLACE FUNCTION product_overrides_project(ids uuid[]) RETURNS void LANGUAGE sql AS $$
 DELETE FROM commerce_item_overrides c WHERE c.product_id=ANY(ids)
  OR c.supplier_item_id IN (SELECT s.supplier_item_id FROM product_sources s WHERE s.product_id=ANY(ids));
 INSERT INTO commerce_item_overrides(supplier_item_id,product_id,name,description,hidden)
 SELECT s.supplier_item_id,o.product_id,o.name,o.description,o.hidden
 FROM product_overrides o JOIN product_sources s ON s.product_id=o.product_id
 WHERE o.product_id=ANY(ids) AND (o.name IS NOT NULL OR o.description IS NOT NULL OR o.hidden)
 ON CONFLICT (supplier_item_id) DO UPDATE SET product_id=excluded.product_id,name=excluded.name,
  description=excluded.description,hidden=excluded.hidden;
$$;

-- A supplier row moving between products (matcher refresh, merge, split, undo) takes the new product's edits.
-- Without any edit (the usual case) this returns at once; otherwise only the moved rows of edited products count.
CREATE OR REPLACE FUNCTION product_overrides_follow_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids uuid[] := '{}';
BEGIN
 IF NOT EXISTS (SELECT 1 FROM product_overrides) AND NOT EXISTS (SELECT 1 FROM commerce_item_overrides) THEN RETURN NULL; END IF;
 IF TG_OP IN ('INSERT','UPDATE') THEN
  ids := ids || ARRAY(SELECT DISTINCT n.product_id FROM new_rows n
   WHERE EXISTS (SELECT 1 FROM product_overrides o WHERE o.product_id=n.product_id)
    OR EXISTS (SELECT 1 FROM commerce_item_overrides c WHERE c.supplier_item_id=n.supplier_item_id OR c.product_id=n.product_id));
 END IF;
 IF TG_OP IN ('UPDATE','DELETE') THEN
  ids := ids || ARRAY(SELECT DISTINCT n.product_id FROM old_rows n
   WHERE EXISTS (SELECT 1 FROM product_overrides o WHERE o.product_id=n.product_id)
    OR EXISTS (SELECT 1 FROM commerce_item_overrides c WHERE c.supplier_item_id=n.supplier_item_id OR c.product_id=n.product_id));
 END IF;
 IF cardinality(ids)>0 THEN PERFORM product_overrides_project(ids); END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS product_overrides_sources_insert ON product_sources;
CREATE TRIGGER product_overrides_sources_insert AFTER INSERT ON product_sources
 REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION product_overrides_follow_sources();
DROP TRIGGER IF EXISTS product_overrides_sources_update ON product_sources;
CREATE TRIGGER product_overrides_sources_update AFTER UPDATE ON product_sources
 REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION product_overrides_follow_sources();
DROP TRIGGER IF EXISTS product_overrides_sources_delete ON product_sources;
CREATE TRIGGER product_overrides_sources_delete AFTER DELETE ON product_sources
 REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION product_overrides_follow_sources();

-- Reconcile the copy on every setup (a changed projection rule applies to existing edits; a deleted product's edits go).
DELETE FROM commerce_item_overrides c WHERE NOT EXISTS (SELECT 1 FROM product_overrides o WHERE o.product_id=c.product_id);
SELECT product_overrides_project(ARRAY(SELECT product_id FROM product_overrides));
