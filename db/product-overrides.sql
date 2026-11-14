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
-- Created only when missing: DROP/CREATE TRIGGER would lock product_sources (and the product pages reading it) for the
-- rest of the setup transaction on every deploy. A changed definition needs a DROP TRIGGER here first.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='product_sources'::regclass AND tgname='product_overrides_sources_insert') THEN
  CREATE TRIGGER product_overrides_sources_insert AFTER INSERT ON product_sources
   REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION product_overrides_follow_sources();
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='product_sources'::regclass AND tgname='product_overrides_sources_update') THEN
  CREATE TRIGGER product_overrides_sources_update AFTER UPDATE ON product_sources
   REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION product_overrides_follow_sources();
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='product_sources'::regclass AND tgname='product_overrides_sources_delete') THEN
  CREATE TRIGGER product_overrides_sources_delete AFTER DELETE ON product_sources
   REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION product_overrides_follow_sources();
 END IF;
END $$;

-- "Aynı ürün" (product_merge): the merged product's rows now sell as `target`. When `target` has no edits of its own it
-- takes the merged product's (hidden included, so a hidden product does not reappear through a merge); the edits stay
-- on the merged product's id as well. Called by the merge actions right after product_merge; true when carried.
CREATE OR REPLACE FUNCTION product_overrides_carry(source uuid, target uuid, actor uuid) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
 IF source IS NULL OR target IS NULL OR source=target
  OR NOT EXISTS (SELECT 1 FROM product_overrides WHERE product_id=source)
  OR EXISTS (SELECT 1 FROM product_overrides WHERE product_id=target) THEN RETURN false; END IF;
 INSERT INTO product_overrides(product_id,name,description,seo_title,seo_description,category_id,hidden,updated_by)
 SELECT target,name,description,seo_title,seo_description,category_id,hidden,actor FROM product_overrides WHERE product_id=source;
 INSERT INTO product_override_changes(product_id,field,old_value,new_value,changed_by)
 SELECT target,f.field,NULL,f.value,actor FROM product_overrides o
 CROSS JOIN LATERAL (VALUES ('name',o.name),('description',o.description),('seo_title',o.seo_title),('seo_description',o.seo_description),
  ('category_id',o.category_id::text),('hidden',CASE WHEN o.hidden THEN 'true' END)) f(field,value)
 WHERE o.product_id=source AND f.value IS NOT NULL;
 PERFORM product_overrides_project(ARRAY[target]);
 RETURN true;
END $$;

-- Reconcile the copy on every setup (a changed projection rule applies to existing edits; a deleted product's edits go).
DELETE FROM commerce_item_overrides c WHERE NOT EXISTS (SELECT 1 FROM product_overrides o WHERE o.product_id=c.product_id);
SELECT product_overrides_project(ARRAY(SELECT product_id FROM product_overrides));
