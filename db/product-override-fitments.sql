-- Admin decisions about the vehicles a product fits (#575, #583): an engine type added by hand (shown and searched like
-- an automatic fitment, also on a product without enrichment, and kept if the automatic source later drops it) and an
-- automatic fitment removed from the store; and source rows left out of the store (#661, product_override_fitment_hides
-- below). They belong to the master product (every supplier row follows them).
-- Supplier syncs, the matcher, enrichment imports, fitment rebuilds (rebuild-product-fitments.ts, fitment-sync.ts), the
-- vehicle catalog import and the storefront bundle never write these tables: they write product_vehicle_fitments, which
-- stays the automatic list. products.id differs between environments, so the bundle carries none of it.
-- vehicle_type_id is the TecDoc type id (vehicle_types.id), the same in every environment; the vehicle import upserts
-- types and never deletes them, so RESTRICT only stops a hand deletion of a decided type.
CREATE TABLE IF NOT EXISTS product_override_fitments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 vehicle_type_id integer NOT NULL REFERENCES vehicle_types(id) ON DELETE RESTRICT,
 -- add: the product fits the type (whatever the automatic sources say); remove: an automatic fitment the store leaves out.
 mode text NOT NULL CHECK (mode IN ('add','remove')),
 -- Copied by a merge from this product (product_override_fitments_carry); undoing the merge removes the row.
 carried_from uuid REFERENCES products(id) ON DELETE SET NULL,
 created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (product_id,vehicle_type_id)
);
-- The store's vehicle filter and search read the decisions of the selected types.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='product_override_fitments'::regclass AND c.relname='product_override_fitments_type_idx') THEN
  CREATE INDEX product_override_fitments_type_idx ON product_override_fitments(vehicle_type_id,product_id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='product_override_fitments'::regclass AND c.relname='product_override_fitments_carried_idx') THEN
  CREATE INDEX product_override_fitments_carried_idx ON product_override_fitments(carried_from) WHERE carried_from IS NOT NULL;
 END IF;
END $$;
-- Added only when missing: ADD COLUMN IF NOT EXISTS locks the table (ACCESS EXCLUSIVE) until setup commits even as a no-op.
-- One bulk change (#816, #817): the rows of one "Araç ekle" with several types, or of one copy from another product,
-- share an id in the decisions and in their history rows, so the history shows them as one line and "Geri al" takes
-- the batch back in one step (its fitment_unadded history rows get a new id of their own). Single decisions and the
-- rows a merge carries (product_override_fitments_carry) keep NULL; rows written before #816 have none (no backfill).
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='product_override_fitments'::regclass AND attname='batch_id' AND NOT attisdropped) THEN
  ALTER TABLE product_override_fitments ADD COLUMN batch_id uuid;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='product_override_changes'::regclass AND attname='batch_id' AND NOT attisdropped) THEN
  ALTER TABLE product_override_changes ADD COLUMN batch_id uuid;
 END IF;
END $$;

-- Source rows the admin leaves out of the store (#661), per master product like the decisions above:
--  source_vehicle    an enrichment vehicle (payload.vehicles) linked to no catalog type; source_key is the row's fields
--                    (sourceVehicleKey, src/modules/store/product-fitment-display.ts). Applied by the store in TS only.
--  source_model      an entry of the enrichment's model list (payload.vehicleModels); source_key is its text. TS only.
--  description_model a model read from the supplier's description (product_model_fitments, #393); applied in SQL by
--                    storefront_description_fits below.
-- The source may later word a row differently: the key then matches nothing and the admin list shows it as gone.
CREATE TABLE IF NOT EXISTS product_override_fitment_hides (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('source_vehicle','source_model','description_model')),
 model_id integer REFERENCES vehicle_models(id) ON DELETE CASCADE,
 source_key text CHECK (char_length(source_key) BETWEEN 1 AND 2000),
 -- What the admin saw ("VW GOLF IV 1.6 · 1997–2004"), for the history and a row the source no longer has.
 label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 500),
 carried_from uuid REFERENCES products(id) ON DELETE SET NULL,
 created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((kind='description_model')=(model_id IS NOT NULL)),
 CHECK ((kind='description_model')=(source_key IS NULL))
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='product_override_fitment_hides'::regclass AND c.relname='product_override_fitment_hides_model_key') THEN
  CREATE UNIQUE INDEX product_override_fitment_hides_model_key ON product_override_fitment_hides(product_id,model_id) WHERE kind='description_model';
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='product_override_fitment_hides'::regclass AND c.relname='product_override_fitment_hides_source_key') THEN
  CREATE UNIQUE INDEX product_override_fitment_hides_source_key ON product_override_fitment_hides(product_id,kind,md5(source_key)) WHERE source_key IS NOT NULL;
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='product_override_fitment_hides'::regclass AND c.relname='product_override_fitment_hides_carried_idx') THEN
  CREATE INDEX product_override_fitment_hides_carried_idx ON product_override_fitment_hides(carried_from) WHERE carried_from IS NOT NULL;
 END IF;
END $$;

-- The description models the store lists (#392, #661): every reader (make and model pages, category counts, sitemaps,
-- the index signal, the product page, related suggestions) reads this view instead of product_model_fitments. A model
-- the admin hid leaves the product; a product with a vehicle decision (#583) lists none, as on its page (modelFallbacks).
-- Joined at read time, so a change needs only invalidateListings(). A view pins the columns it reads: dropping or
-- retyping one of them needs a DROP VIEW first. Replaced only when its definition changed (see db/commerce.sql).
DO $setup$ DECLARE def text := $view$
 SELECT f.supplier_item_id,f.model_id,f.year_from,f.year_to FROM product_model_fitments f
 WHERE NOT EXISTS (SELECT 1 FROM product_override_fitment_hides h JOIN product_sources ps ON ps.product_id=h.product_id
   WHERE h.kind='description_model' AND ps.supplier_item_id=f.supplier_item_id AND h.model_id=f.model_id)
  AND NOT EXISTS (SELECT 1 FROM product_override_fitments d JOIN product_sources ps ON ps.product_id=d.product_id
   WHERE ps.supplier_item_id=f.supplier_item_id);
$view$; cur regclass := (SELECT c.oid FROM pg_class c
  WHERE c.relname='storefront_description_fits' AND c.relnamespace=current_schema()::regnamespace AND c.relkind='v'); BEGIN
 EXECUTE 'CREATE VIEW pg_temp.setup_view_probe AS '||def;
 IF pg_get_viewdef('pg_temp.setup_view_probe'::regclass) IS DISTINCT FROM pg_get_viewdef(cur) THEN
  -- Views that read this one first (#1046, db/schema.sql); a new view has none.
  IF cur IS NOT NULL THEN PERFORM setup_lock_dependent_views(cur); END IF;
  EXECUTE 'CREATE OR REPLACE VIEW storefront_description_fits AS '||def;
 END IF;
 DROP VIEW pg_temp.setup_view_probe;
END $setup$;

-- "Aynı ürün" (product_merge): the kept product takes the merged product's decisions and hidden source rows (#661);
-- where both decided the same type or hid the same row, the kept product's row wins. Called by the merge actions next
-- to product_override_specs_carry. History values are the type id (decisions) and the label (hidden rows). Names are
-- qualified: the parameters would otherwise be read as columns of the same name (42702).
CREATE OR REPLACE FUNCTION product_override_fitments_carry(source uuid, target uuid, actor uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE added integer := 0; removed integer := 0; hidden integer := 0;
BEGIN
 IF product_override_fitments_carry.source IS NULL OR product_override_fitments_carry.target IS NULL
  OR product_override_fitments_carry.source=product_override_fitments_carry.target THEN
  RETURN jsonb_build_object('added',0,'removed',0,'hidden',0);
 END IF;
 -- Serializes with the admin's changes (product-fitment-store.ts locks the same row).
 PERFORM 1 FROM products p WHERE p.id=product_override_fitments_carry.target FOR UPDATE;
 WITH copied AS (
  -- The source's created_at keeps the admin's order (one statement would give every copy the same now()).
  INSERT INTO product_override_fitments(product_id,vehicle_type_id,mode,carried_from,created_by,created_at)
  SELECT product_override_fitments_carry.target,o.vehicle_type_id,o.mode,product_override_fitments_carry.source,product_override_fitments_carry.actor,o.created_at
  FROM product_override_fitments o WHERE o.product_id=product_override_fitments_carry.source
  ORDER BY o.created_at,o.id
  ON CONFLICT (product_id,vehicle_type_id) DO NOTHING
  RETURNING mode,vehicle_type_id), logged AS (
  INSERT INTO product_override_changes(product_id,field,old_value,new_value,changed_by,reason)
  SELECT product_override_fitments_carry.target,CASE c.mode WHEN 'add' THEN 'fitment_added' ELSE 'fitment_removed' END,
   NULL,c.vehicle_type_id::text,product_override_fitments_carry.actor,'carry' FROM copied c
  RETURNING field)
 SELECT count(*) FILTER (WHERE field='fitment_added'),count(*) FILTER (WHERE field='fitment_removed') INTO added,removed FROM logged;
 WITH copied AS (
  INSERT INTO product_override_fitment_hides(product_id,kind,model_id,source_key,label,carried_from,created_by,created_at)
  SELECT product_override_fitments_carry.target,h.kind,h.model_id,h.source_key,h.label,product_override_fitments_carry.source,product_override_fitments_carry.actor,h.created_at
  FROM product_override_fitment_hides h WHERE h.product_id=product_override_fitments_carry.source
  ORDER BY h.created_at,h.id
  ON CONFLICT DO NOTHING
  RETURNING kind,label), logged AS (
  INSERT INTO product_override_changes(product_id,field,old_value,new_value,changed_by,reason)
  SELECT product_override_fitments_carry.target,
   'fitment_'||CASE c.kind WHEN 'source_vehicle' THEN 'vehicle' WHEN 'source_model' THEN 'model' ELSE 'description' END||'_hidden',
   NULL,c.label,product_override_fitments_carry.actor,'carry' FROM copied c
  RETURNING 1)
 SELECT count(*) INTO hidden FROM logged;
 RETURN jsonb_build_object('added',added,'removed',removed,'hidden',hidden);
END $$;

-- A merged product revived (its merged_into cleared): the products it carried decisions and hidden rows into give them
-- back. A carried row the admin took back stays taken back; history says what left.
CREATE OR REPLACE FUNCTION product_override_fitments_uncarry(source_id uuid) RETURNS void LANGUAGE sql AS $$
 WITH removed AS (DELETE FROM product_override_fitments o WHERE o.carried_from=source_id RETURNING o.product_id,o.mode,o.vehicle_type_id)
 INSERT INTO product_override_changes(product_id,field,old_value,new_value,changed_by,reason)
 SELECT r.product_id,CASE r.mode WHEN 'add' THEN 'fitment_unadded' ELSE 'fitment_restored' END,
  r.vehicle_type_id::text,NULL,NULL,'uncarry' FROM removed r;
 WITH shown AS (DELETE FROM product_override_fitment_hides h WHERE h.carried_from=source_id RETURNING h.product_id,h.kind,h.label)
 INSERT INTO product_override_changes(product_id,field,old_value,new_value,changed_by,reason)
 SELECT s.product_id,'fitment_'||CASE s.kind WHEN 'source_vehicle' THEN 'vehicle' WHEN 'source_model' THEN 'model' ELSE 'description' END||'_shown',
  s.label,NULL,NULL,'uncarry' FROM shown s;
$$;
CREATE OR REPLACE FUNCTION product_override_fitments_restored() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM product_override_fitments WHERE carried_from=NEW.id)
  OR EXISTS (SELECT 1 FROM product_override_fitment_hides WHERE carried_from=NEW.id) THEN
  PERFORM product_override_fitments_uncarry(NEW.id);
 END IF;
 RETURN NULL;
END $$;
-- Created only when missing (no DROP/CREATE lock on products on every setup); a changed definition needs a DROP first.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='products'::regclass AND tgname='product_override_fitments_products_restored') THEN
  CREATE TRIGGER product_override_fitments_products_restored AFTER UPDATE OF merged_into ON products FOR EACH ROW
   WHEN (OLD.merged_into IS NOT NULL AND NEW.merged_into IS NULL) EXECUTE FUNCTION product_override_fitments_restored();
 END IF;
END $$;
