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
-- Hand-set prices (#580), VAT included, in kuruş: a fixed price replacing the formula's and a campaign price below it
-- between sale_from and sale_until (NULL ends are open). Both apply only where the formula prices the row
-- (commerce_catalog, db/commerce.sql): missing supplier data keeps the product off sale.
ALTER TABLE product_overrides ADD COLUMN IF NOT EXISTS price_kurus integer CHECK (price_kurus>0);
ALTER TABLE product_overrides ADD COLUMN IF NOT EXISTS sale_price_kurus integer CHECK (sale_price_kurus>0);
ALTER TABLE product_overrides ADD COLUMN IF NOT EXISTS sale_from timestamptz;
ALTER TABLE product_overrides ADD COLUMN IF NOT EXISTS sale_until timestamptz;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='product_overrides'::regclass AND conname='product_overrides_sale_below_price') THEN
  ALTER TABLE product_overrides ADD CONSTRAINT product_overrides_sale_below_price
   CHECK (sale_price_kurus IS NULL OR price_kurus IS NULL OR sale_price_kurus<price_kurus);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='product_overrides'::regclass AND conname='product_overrides_sale_window') THEN
  ALTER TABLE product_overrides ADD CONSTRAINT product_overrides_sale_window
   CHECK (sale_from IS NULL OR sale_until IS NULL OR sale_from<sale_until);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='product_overrides'::regclass AND conname='product_overrides_sale_dates') THEN
  ALTER TABLE product_overrides ADD CONSTRAINT product_overrides_sale_dates
   CHECK ((sale_from IS NULL AND sale_until IS NULL) OR sale_price_kurus IS NOT NULL);
 END IF;
END $$;
-- A campaign time as the admin entered it (Istanbul wall clock, minutes): the form, the history and the merge record.
CREATE OR REPLACE FUNCTION product_override_time_text(value timestamptz) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT to_char(value AT TIME ZONE 'Europe/Istanbul','YYYY-MM-DD"T"HH24:MI')
$$;
-- Store brand and manufacturer part number (#602), shown instead of the supplier's (display_brand / display_code).
-- brand is a master brand's name (brands.name), checked on save; no FK: brand_merge deletes the merged brand and the
-- edit keeps its text. Supplier codes, order lines and matching keep the supplier's values.
ALTER TABLE product_overrides ADD COLUMN IF NOT EXISTS brand text CHECK (char_length(brand) BETWEEN 1 AND 80);
ALTER TABLE product_overrides ADD COLUMN IF NOT EXISTS part_number text CHECK (char_length(part_number) BETWEEN 1 AND 60);
-- Supplier OEM field hidden on the store (#615), for every source row of the product: the catalog views show an
-- empty oem and storefront search skips the stored OEM (commerce_item_overrides.hide_oem, db/commerce.sql).
-- Matching, enrichment and the admin's supplier searches keep reading supplier_items.
ALTER TABLE product_overrides ADD COLUMN IF NOT EXISTS hide_supplier_oem boolean NOT NULL DEFAULT false;
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
 INSERT INTO commerce_item_overrides(supplier_item_id,product_id,name,description,hidden,price_kurus,sale_price_kurus,sale_from,sale_until,
  brand,part_number,hide_oem)
 SELECT s.supplier_item_id,o.product_id,o.name,o.description,o.hidden,o.price_kurus,o.sale_price_kurus,o.sale_from,o.sale_until,
  o.brand,o.part_number,o.hide_supplier_oem
 FROM product_overrides o JOIN product_sources s ON s.product_id=o.product_id
 WHERE o.product_id=ANY(ids) AND (o.name IS NOT NULL OR o.description IS NOT NULL OR o.hidden
  OR o.price_kurus IS NOT NULL OR o.sale_price_kurus IS NOT NULL OR o.brand IS NOT NULL OR o.part_number IS NOT NULL
  OR o.hide_supplier_oem)
 ON CONFLICT (supplier_item_id) DO UPDATE SET product_id=excluded.product_id,name=excluded.name,
  description=excluded.description,hidden=excluded.hidden,price_kurus=excluded.price_kurus,
  sale_price_kurus=excluded.sale_price_kurus,sale_from=excluded.sale_from,sale_until=excluded.sale_until,
  brand=excluded.brand,part_number=excluded.part_number,hide_oem=excluded.hide_oem;
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
 IF NOT FOUND THEN t.product_id := target; t.hidden := false; t.hide_supplier_oem := false; END IF;
 IF t.name IS NULL AND s.name IS NOT NULL THEN t.name := s.name; carried := array_append(carried,'name'); END IF;
 IF t.description IS NULL AND s.description IS NOT NULL THEN t.description := s.description; carried := array_append(carried,'description'); END IF;
 IF t.seo_title IS NULL AND s.seo_title IS NOT NULL THEN t.seo_title := s.seo_title; carried := array_append(carried,'seo_title'); END IF;
 IF t.seo_description IS NULL AND s.seo_description IS NOT NULL THEN t.seo_description := s.seo_description; carried := array_append(carried,'seo_description'); END IF;
 IF t.category_id IS NULL AND s.category_id IS NOT NULL THEN t.category_id := s.category_id; carried := array_append(carried,'category_id'); END IF;
 IF t.brand IS NULL AND s.brand IS NOT NULL THEN t.brand := s.brand; carried := array_append(carried,'brand'); END IF;
 IF t.part_number IS NULL AND s.part_number IS NOT NULL THEN t.part_number := s.part_number; carried := array_append(carried,'part_number'); END IF;
 IF s.hidden AND NOT t.hidden THEN t.hidden := true; carried := array_append(carried,'hidden'); END IF;
 -- Like hidden (#615): the same physical product, so the supplier OEM the admin hid stays hidden on the target.
 IF s.hide_supplier_oem AND NOT t.hide_supplier_oem THEN
  t.hide_supplier_oem := true; carried := array_append(carried,'hide_supplier_oem');
 END IF;
 -- Prices (#580) by the same rule while the pair stays valid (a campaign below the fixed price). The campaign moves as
 -- one (price and its window); an ended one is not carried. A target without a campaign price has no dates (CHECK).
 IF t.price_kurus IS NULL AND s.price_kurus IS NOT NULL AND (t.sale_price_kurus IS NULL OR t.sale_price_kurus<s.price_kurus) THEN
  t.price_kurus := s.price_kurus; carried := array_append(carried,'price_kurus');
 END IF;
 IF t.sale_price_kurus IS NULL AND s.sale_price_kurus IS NOT NULL AND (s.sale_until IS NULL OR s.sale_until>now())
  AND (t.price_kurus IS NULL OR s.sale_price_kurus<t.price_kurus) THEN
  t.sale_price_kurus := s.sale_price_kurus; t.sale_from := s.sale_from; t.sale_until := s.sale_until;
  carried := array_append(carried,'sale_price_kurus');
  IF s.sale_from IS NOT NULL THEN carried := array_append(carried,'sale_from'); END IF;
  IF s.sale_until IS NOT NULL THEN carried := array_append(carried,'sale_until'); END IF;
 END IF;
 IF cardinality(carried)=0 THEN RETURN jsonb_build_object('fields','[]'::jsonb,'hidden',false); END IF;
 INSERT INTO product_overrides(product_id,name,description,seo_title,seo_description,category_id,hidden,
  price_kurus,sale_price_kurus,sale_from,sale_until,brand,part_number,hide_supplier_oem,updated_by)
 VALUES (target,t.name,t.description,t.seo_title,t.seo_description,t.category_id,t.hidden,
  t.price_kurus,t.sale_price_kurus,t.sale_from,t.sale_until,t.brand,t.part_number,t.hide_supplier_oem,actor)
 ON CONFLICT (product_id) DO UPDATE SET name=excluded.name,description=excluded.description,seo_title=excluded.seo_title,
  seo_description=excluded.seo_description,category_id=excluded.category_id,hidden=excluded.hidden,
  price_kurus=excluded.price_kurus,sale_price_kurus=excluded.sale_price_kurus,sale_from=excluded.sale_from,sale_until=excluded.sale_until,
  brand=excluded.brand,part_number=excluded.part_number,hide_supplier_oem=excluded.hide_supplier_oem,
  updated_by=excluded.updated_by,updated_at=now();
 -- Every carried field was automatic (NULL; hidden false) on the target before.
 INSERT INTO product_override_changes(product_id,field,old_value,new_value,changed_by,reason)
 SELECT target,f.field,NULL,f.value,actor,'carry'
 FROM (VALUES ('name',t.name),('description',t.description),('seo_title',t.seo_title),('seo_description',t.seo_description),
  ('category_id',t.category_id::text),('hidden','true'),('price_kurus',t.price_kurus::text),('sale_price_kurus',t.sale_price_kurus::text),
  ('sale_from',product_override_time_text(t.sale_from)),('sale_until',product_override_time_text(t.sale_until)),
  ('brand',t.brand),('part_number',t.part_number),('hide_supplier_oem','true')) f(field,value)
 WHERE f.field=ANY(carried);
 -- Qualified: the parameters share the table's column names.
 INSERT INTO product_override_carries(target,source,fields)
 SELECT product_overrides_carry.target,product_overrides_carry.source,jsonb_object_agg(f.field,f.value)
 FROM (VALUES ('name',t.name),('description',t.description),('seo_title',t.seo_title),('seo_description',t.seo_description),
  ('category_id',t.category_id::text),('hidden','true'),('price_kurus',t.price_kurus::text),('sale_price_kurus',t.sale_price_kurus::text),
  ('sale_from',product_override_time_text(t.sale_from)),('sale_until',product_override_time_text(t.sale_until)),
  ('brand',t.brand),('part_number',t.part_number),('hide_supplier_oem','true')) f(field,value)
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
     WHEN 'hidden' THEN CASE WHEN t.hidden THEN 'true' END
     WHEN 'price_kurus' THEN t.price_kurus::text WHEN 'sale_price_kurus' THEN t.sale_price_kurus::text
     WHEN 'sale_from' THEN product_override_time_text(t.sale_from) WHEN 'sale_until' THEN product_override_time_text(t.sale_until)
     WHEN 'brand' THEN t.brand WHEN 'part_number' THEN t.part_number
     WHEN 'hide_supplier_oem' THEN CASE WHEN t.hide_supplier_oem THEN 'true' END END);
   -- The campaign is one unit: its window goes back only with its price (a window alone would leave the admin's
   -- price running without an end), and a price taken back takes its window with it (dates without a price break
   -- the CHECK). The admin's save drops the whole campaign from the record when any part of it changes.
   IF 'sale_price_kurus'=ANY(reverted) THEN
    IF t.sale_from IS NOT NULL AND NOT 'sale_from'=ANY(reverted) THEN reverted := array_append(reverted,'sale_from'); END IF;
    IF t.sale_until IS NOT NULL AND NOT 'sale_until'=ANY(reverted) THEN reverted := array_append(reverted,'sale_until'); END IF;
   ELSE
    reverted := array_remove(array_remove(reverted,'sale_from'),'sale_until');
   END IF;
   IF cardinality(reverted)>0 THEN
    INSERT INTO product_override_changes(product_id,field,old_value,new_value,changed_by,reason)
    SELECT c.target,f.field,f.value,NULL,NULL,'uncarry'
    FROM (VALUES ('name',t.name),('description',t.description),('seo_title',t.seo_title),('seo_description',t.seo_description),
     ('category_id',t.category_id::text),('hidden','true'),('price_kurus',t.price_kurus::text),('sale_price_kurus',t.sale_price_kurus::text),
     ('sale_from',product_override_time_text(t.sale_from)),('sale_until',product_override_time_text(t.sale_until)),
     ('brand',t.brand),('part_number',t.part_number),('hide_supplier_oem','true')) f(field,value)
    WHERE f.field=ANY(reverted);
    UPDATE product_overrides SET name=CASE WHEN 'name'=ANY(reverted) THEN NULL ELSE name END,
     description=CASE WHEN 'description'=ANY(reverted) THEN NULL ELSE description END,
     seo_title=CASE WHEN 'seo_title'=ANY(reverted) THEN NULL ELSE seo_title END,
     seo_description=CASE WHEN 'seo_description'=ANY(reverted) THEN NULL ELSE seo_description END,
     category_id=CASE WHEN 'category_id'=ANY(reverted) THEN NULL ELSE category_id END,
     hidden=CASE WHEN 'hidden'=ANY(reverted) THEN false ELSE hidden END,
     price_kurus=CASE WHEN 'price_kurus'=ANY(reverted) THEN NULL ELSE price_kurus END,
     sale_price_kurus=CASE WHEN 'sale_price_kurus'=ANY(reverted) THEN NULL ELSE sale_price_kurus END,
     sale_from=CASE WHEN 'sale_from'=ANY(reverted) THEN NULL ELSE sale_from END,
     sale_until=CASE WHEN 'sale_until'=ANY(reverted) THEN NULL ELSE sale_until END,
     brand=CASE WHEN 'brand'=ANY(reverted) THEN NULL ELSE brand END,
     part_number=CASE WHEN 'part_number'=ANY(reverted) THEN NULL ELSE part_number END,
     hide_supplier_oem=CASE WHEN 'hide_supplier_oem'=ANY(reverted) THEN false ELSE hide_supplier_oem END,
     updated_by=NULL,updated_at=now()
    WHERE product_id=c.target;
    DELETE FROM product_overrides WHERE product_id=c.target AND name IS NULL AND description IS NULL AND seo_title IS NULL
     AND seo_description IS NULL AND category_id IS NULL AND NOT hidden AND price_kurus IS NULL AND sale_price_kurus IS NULL
     AND brand IS NULL AND part_number IS NULL AND NOT hide_supplier_oem;
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

-- Storefront listing cache epoch (#585): the app keeps listing counts, page ids, facets and plain searches in a
-- per-process stale-while-revalidate cache. An admin edit that changes what a listing shows (name, category, hidden,
-- brand, part number, references, supplier OEM hiding, merge/split) bumps this one-row counter; every app process reads it at most once a
-- second and drops cached entries loaded under an older epoch (src/modules/store/listing-epoch.ts).
CREATE TABLE IF NOT EXISTS storefront_listing_epoch (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 epoch bigint NOT NULL DEFAULT 0,
 bumped_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO storefront_listing_epoch DEFAULT VALUES ON CONFLICT DO NOTHING;
