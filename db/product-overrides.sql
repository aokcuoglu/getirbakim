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
-- NULL: an admin's save. carry: copied from a product merged into this one; uncarry: that merge was undone.
ALTER TABLE product_override_changes ADD COLUMN IF NOT EXISTS reason text;
-- What a merge copied onto the kept product (product_overrides_carry): field → carried value as history text. Undoing
-- the merge (the merged product revived) takes back the fields that still hold the carried value; an admin's later
-- change of a field on the target removes it from here (the admin owns it then).
CREATE TABLE IF NOT EXISTS product_override_carries (
 target uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 source uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 fields jsonb NOT NULL,
 carried_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (target,source)
);
CREATE INDEX IF NOT EXISTS product_override_carries_source_idx ON product_override_carries(source);

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

-- "Aynı ürün" (product_merge): the merged product's rows now sell as `target`, so `target` takes the merged product's
-- edits where it has none: each NULL field gets the merged product's value, and hidden is carried whenever the merged
-- product was hidden (it is the same physical product the admin took off sale). The edits stay on the merged product's
-- id as well. Called by the merge actions right after product_merge; returns the carried fields and whether hidden was
-- carried, so the actions can say so. The first version returned boolean.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('product_overrides_carry(uuid,uuid,uuid)') AND prorettype='boolean'::regtype) THEN
  DROP FUNCTION product_overrides_carry(uuid, uuid, uuid);
 END IF;
END $$;
CREATE OR REPLACE FUNCTION product_overrides_carry(source uuid, target uuid, actor uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE s product_overrides; t product_overrides; carried text[] := '{}';
BEGIN
 IF source IS NULL OR target IS NULL OR source=target THEN RETURN jsonb_build_object('fields','[]'::jsonb,'hidden',false); END IF;
 SELECT * INTO s FROM product_overrides WHERE product_id=source;
 IF NOT FOUND THEN RETURN jsonb_build_object('fields','[]'::jsonb,'hidden',false); END IF;
 SELECT * INTO t FROM product_overrides WHERE product_id=target FOR UPDATE;
 IF NOT FOUND THEN t.product_id := target; t.hidden := false; END IF;
 IF t.name IS NULL AND s.name IS NOT NULL THEN t.name := s.name; carried := array_append(carried,'name'); END IF;
 IF t.description IS NULL AND s.description IS NOT NULL THEN t.description := s.description; carried := array_append(carried,'description'); END IF;
 IF t.seo_title IS NULL AND s.seo_title IS NOT NULL THEN t.seo_title := s.seo_title; carried := array_append(carried,'seo_title'); END IF;
 IF t.seo_description IS NULL AND s.seo_description IS NOT NULL THEN t.seo_description := s.seo_description; carried := array_append(carried,'seo_description'); END IF;
 IF t.category_id IS NULL AND s.category_id IS NOT NULL THEN t.category_id := s.category_id; carried := array_append(carried,'category_id'); END IF;
 IF s.hidden AND NOT t.hidden THEN t.hidden := true; carried := array_append(carried,'hidden'); END IF;
 IF cardinality(carried)=0 THEN RETURN jsonb_build_object('fields','[]'::jsonb,'hidden',false); END IF;
 INSERT INTO product_overrides(product_id,name,description,seo_title,seo_description,category_id,hidden,updated_by)
 VALUES (target,t.name,t.description,t.seo_title,t.seo_description,t.category_id,t.hidden,actor)
 ON CONFLICT (product_id) DO UPDATE SET name=excluded.name,description=excluded.description,seo_title=excluded.seo_title,
  seo_description=excluded.seo_description,category_id=excluded.category_id,hidden=excluded.hidden,updated_by=excluded.updated_by,updated_at=now();
 -- Every carried field was automatic (NULL; hidden false) on the target before.
 INSERT INTO product_override_changes(product_id,field,old_value,new_value,changed_by,reason)
 SELECT target,f.field,NULL,f.value,actor,'carry'
 FROM (VALUES ('name',t.name),('description',t.description),('seo_title',t.seo_title),('seo_description',t.seo_description),
  ('category_id',t.category_id::text),('hidden','true')) f(field,value)
 WHERE f.field=ANY(carried);
 -- Qualified: the parameters share the table's column names.
 INSERT INTO product_override_carries(target,source,fields)
 SELECT product_overrides_carry.target,product_overrides_carry.source,jsonb_object_agg(f.field,f.value)
 FROM (VALUES ('name',t.name),('description',t.description),('seo_title',t.seo_title),('seo_description',t.seo_description),
  ('category_id',t.category_id::text),('hidden','true')) f(field,value)
 WHERE f.field=ANY(carried)
 ON CONFLICT ON CONSTRAINT product_override_carries_pkey DO UPDATE SET fields=product_override_carries.fields||excluded.fields,carried_at=now();
 PERFORM product_overrides_project(ARRAY[target]);
 RETURN jsonb_build_object('fields',to_jsonb(carried),'hidden','hidden'=ANY(carried));
END $$;

-- A merged product revived (its merged_into cleared: "Geri al" through product_reset_item, or a matching refresh giving
-- it rows again): every product it carried edits into gives back the fields still holding the carried value. Fields an
-- admin changed since were dropped from the record by the save and stay. Each reverted field is recorded (reason uncarry).
CREATE OR REPLACE FUNCTION product_overrides_uncarry(source_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c record; t product_overrides; reverted text[];
BEGIN
 FOR c IN SELECT * FROM product_override_carries WHERE source=source_id FOR UPDATE LOOP
  SELECT * INTO t FROM product_overrides WHERE product_id=c.target FOR UPDATE;
  IF FOUND THEN
   reverted := ARRAY(SELECT f.key FROM jsonb_each_text(c.fields) f WHERE f.value IS NOT DISTINCT FROM CASE f.key
     WHEN 'name' THEN t.name WHEN 'description' THEN t.description WHEN 'seo_title' THEN t.seo_title
     WHEN 'seo_description' THEN t.seo_description WHEN 'category_id' THEN t.category_id::text
     WHEN 'hidden' THEN CASE WHEN t.hidden THEN 'true' END END);
   IF cardinality(reverted)>0 THEN
    INSERT INTO product_override_changes(product_id,field,old_value,new_value,changed_by,reason)
    SELECT c.target,f.key,f.value,NULL,NULL,'uncarry' FROM jsonb_each_text(c.fields) f WHERE f.key=ANY(reverted);
    UPDATE product_overrides SET name=CASE WHEN 'name'=ANY(reverted) THEN NULL ELSE name END,
     description=CASE WHEN 'description'=ANY(reverted) THEN NULL ELSE description END,
     seo_title=CASE WHEN 'seo_title'=ANY(reverted) THEN NULL ELSE seo_title END,
     seo_description=CASE WHEN 'seo_description'=ANY(reverted) THEN NULL ELSE seo_description END,
     category_id=CASE WHEN 'category_id'=ANY(reverted) THEN NULL ELSE category_id END,
     hidden=CASE WHEN 'hidden'=ANY(reverted) THEN false ELSE hidden END,
     updated_by=NULL,updated_at=now()
    WHERE product_id=c.target;
    DELETE FROM product_overrides WHERE product_id=c.target AND name IS NULL AND description IS NULL AND seo_title IS NULL
     AND seo_description IS NULL AND category_id IS NULL AND NOT hidden;
    PERFORM product_overrides_project(ARRAY[c.target]);
   END IF;
  END IF;
  DELETE FROM product_override_carries WHERE target=c.target AND source=c.source;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION product_overrides_restored() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM product_override_carries WHERE source=NEW.id) THEN PERFORM product_overrides_uncarry(NEW.id); END IF;
 RETURN NULL;
END $$;
-- Created only when missing, like the source triggers (no DROP/CREATE lock on products per setup).
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='products'::regclass AND tgname='product_overrides_products_restored') THEN
  CREATE TRIGGER product_overrides_products_restored AFTER UPDATE OF merged_into ON products FOR EACH ROW
   WHEN (OLD.merged_into IS NOT NULL AND NEW.merged_into IS NULL) EXECUTE FUNCTION product_overrides_restored();
 END IF;
END $$;

-- Reconcile the copy on every setup (a changed projection rule applies to existing edits; a deleted product's edits go).
DELETE FROM commerce_item_overrides c WHERE NOT EXISTS (SELECT 1 FROM product_overrides o WHERE o.product_id=c.product_id);
SELECT product_overrides_project(ARRAY(SELECT product_id FROM product_overrides));
