-- The vehicle makes each storefront offer fits (#455), for /yedek-parca/<make>. A fitment counts only while it agrees
-- with the vehicle at the same index of the donor's current, trusted enrichment payload. Computed per make on each
-- read, that comparison ran over every fitment of the make (VW: 788k) and took 20-57 s on RDS for the large makes.
-- product_enrichment_shared_refresh() recomputes the offers in its scope right after their links (no queue of its
-- own); fitment and vehicle catalog changes reach it through product_enrichment_shared_queue (triggers below).
-- storefront_model_fits (#639) holds the same engine-level fits per vehicle model, for /yedek-parca/<make>/<model>;
-- the refresh computes both from one pass. Model pages add the description fitments (product_model_fitments) on read.
-- storefront_make_description_fits (#956) holds the makes of the description fitments (storefront_description_fits) per
-- fitted supplier row, written by the same refresh; make pages resolve a secondary offer to its primary on read.
CREATE TABLE IF NOT EXISTS storefront_make_fits (
 brand_id integer NOT NULL REFERENCES vehicle_brands(id) ON DELETE CASCADE,
 -- Any supplier row: a vehicle an admin added (db/product-override-fitments.sql, #583) lists a product without an
 -- enrichment link too. The refresh removes the rows of the offers in its scope, so a dropped link leaves none behind.
 supplier_item_id uuid NOT NULL REFERENCES supplier_items(id) ON DELETE CASCADE,
 PRIMARY KEY (brand_id, supplier_item_id)
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='storefront_make_fits'::regclass AND c.relname='storefront_make_fits_item_idx') THEN
  CREATE INDEX storefront_make_fits_item_idx ON storefront_make_fits(supplier_item_id);
 END IF;
END $$;
-- Tables created before #583 point the key at product_enrichment_shared_links: moved once, found by its columns and
-- target rather than its name. Setup runs in one transaction, so the brief ACCESS EXCLUSIVE lock on the table (and the
-- check of its ~200k rows against supplier_items) lasts until setup commits.
DO $$
DECLARE old_key name;
BEGIN
 SELECT c.conname INTO old_key FROM pg_constraint c
  WHERE c.contype='f' AND c.conrelid='storefront_make_fits'::regclass AND c.confrelid='product_enrichment_shared_links'::regclass;
 IF old_key IS NOT NULL THEN
  EXECUTE format('ALTER TABLE storefront_make_fits DROP CONSTRAINT %I',old_key);
  ALTER TABLE storefront_make_fits ADD CONSTRAINT storefront_make_fits_supplier_item_id_fkey
   FOREIGN KEY (supplier_item_id) REFERENCES supplier_items(id) ON DELETE CASCADE;
 END IF;
END $$;
-- Like the make table it keys any supplier row: a type an admin adds (#583) lists the model for an unlinked offer too.
CREATE TABLE IF NOT EXISTS storefront_model_fits (
 model_id integer NOT NULL REFERENCES vehicle_models(id) ON DELETE CASCADE,
 supplier_item_id uuid NOT NULL REFERENCES supplier_items(id) ON DELETE CASCADE,
 PRIMARY KEY (model_id, supplier_item_id)
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='storefront_model_fits'::regclass AND c.relname='storefront_model_fits_item_idx') THEN
  CREATE INDEX storefront_model_fits_item_idx ON storefront_model_fits(supplier_item_id);
 END IF;
END $$;
-- The makes of the models read from supplier descriptions (#392, #661), per fitted row: the make page listed them by
-- hashing every description fit against the make's series on each read (VW: ~60 ms warm). A row of its own table, not of
-- storefront_make_fits: the make page resolves these rows (not the engine-level ones) to their primary offer on read,
-- as it did, so a regrouping of offers (product_offers) needs no refresh.
CREATE TABLE IF NOT EXISTS storefront_make_description_fits (
 brand_id integer NOT NULL REFERENCES vehicle_brands(id) ON DELETE CASCADE,
 supplier_item_id uuid NOT NULL REFERENCES supplier_items(id) ON DELETE CASCADE,
 PRIMARY KEY (brand_id, supplier_item_id)
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='storefront_make_description_fits'::regclass AND c.relname='storefront_make_description_fits_item_idx') THEN
  CREATE INDEX storefront_make_description_fits_item_idx ON storefront_make_description_fits(supplier_item_id);
 END IF;
END $$;
-- The description makes of the given rows (NULL: all), from the view every storefront reader shares, so a hidden model
-- or a vehicle decision of the product (db/product-override-fitments.sql) leaves them out. EXECUTE plans each call afresh.
CREATE OR REPLACE FUNCTION storefront_make_description_fits_compute(item_ids uuid[] DEFAULT NULL)
RETURNS TABLE(brand_id integer, supplier_item_id uuid) LANGUAGE plpgsql AS $$
BEGIN
 RETURN QUERY EXECUTE $sql$SELECT DISTINCT m.brand_id,f.supplier_item_id FROM storefront_description_fits f
  JOIN vehicle_models m ON m.id=f.model_id WHERE $1::uuid[] IS NULL OR f.supplier_item_id=ANY($1)$sql$ USING item_ids;
END $$;

-- NULL recomputes every offer. The payload's vehicles are read once per offer (MATERIALIZED), not per fitment.
-- EXECUTE plans each call afresh: a scoped plan is never reused for the whole catalog.
-- An admin's decisions (product_override_fitments, #583) apply per offer and type, to the make and the model tables alike: a removed type leaves out that
-- automatic fitment only (another type of the same make still lists the offer), an added type lists every offer of
-- the product, enriched or not.
CREATE OR REPLACE FUNCTION storefront_make_fits_refresh(item_ids uuid[] DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE changed integer; model_changed integer; description_changed integer;
BEGIN
 -- The whole catalog hashes ~1M fitment rows with their vehicle objects; 4 MB (the default) spills to disk.
 PERFORM set_config('work_mem','64MB',true);
 EXECUTE $sql$CREATE TEMP TABLE make_fits_computed ON COMMIT DROP AS
  WITH removed AS MATERIALIZED (
   SELECT ps.supplier_item_id,o.vehicle_type_id FROM product_override_fitments o JOIN product_sources ps ON ps.product_id=o.product_id
   WHERE o.mode='remove' AND ($1::uuid[] IS NULL OR ps.supplier_item_id=ANY($1))),
  -- has_removed is decided once per offer: the whole catalog joins ~9M fitments, and a lookup per fitment row cost
  -- seconds; only the offers with a removed type look their fitments up.
  vehicles AS MATERIALIZED (
   SELECT l.supplier_item_id,l.donor_item_id,e.payload->'vehicles' AS vehicles,
    l.supplier_item_id IN (SELECT supplier_item_id FROM removed) AS has_removed
   FROM product_enrichment_shared_links l
   JOIN product_enrichments e ON e.supplier_item_id=l.donor_item_id
   JOIN supplier_items s ON s.id=l.supplier_item_id AND s.code=l.supplier_code AND s.product_data->>'uk'=l.supplier_brand
   WHERE ($1::uuid[] IS NULL OR l.supplier_item_id=ANY($1))
    AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=l.donor_oem))
  SELECT DISTINCT m.brand_id,v.model_id,t.supplier_item_id
  FROM vehicles t
  JOIN product_vehicle_fitments f ON f.supplier_item_id=t.donor_item_id AND f.vehicle_type_id IS NOT NULL
  JOIN vehicle_types v ON v.id=f.vehicle_type_id
  JOIN vehicle_models m ON m.id=v.model_id
  WHERE f.source_vehicle=t.vehicles->f.source_index
   AND (NOT t.has_removed OR NOT EXISTS (SELECT 1 FROM removed r WHERE r.supplier_item_id=t.supplier_item_id AND r.vehicle_type_id=f.vehicle_type_id))
  -- UNION ALL keeps the automatic branch's plan (a UNION sorted its ~9M rows); a pair both give is inserted once
  -- (ON CONFLICT DO NOTHING) and the delete below only asks whether it exists.
  UNION ALL
  SELECT DISTINCT m.brand_id,v.model_id,ps.supplier_item_id
  FROM product_override_fitments o
  JOIN product_sources ps ON ps.product_id=o.product_id
  JOIN vehicle_types v ON v.id=o.vehicle_type_id
  JOIN vehicle_models m ON m.id=v.model_id
  WHERE o.mode='add' AND ($1::uuid[] IS NULL OR ps.supplier_item_id=ANY($1))$sql$ USING item_ids;
 WITH inserted AS (
  INSERT INTO storefront_make_fits(brand_id,supplier_item_id) SELECT DISTINCT brand_id,supplier_item_id FROM make_fits_computed
  ON CONFLICT DO NOTHING RETURNING 1
 ), removed AS (
  DELETE FROM storefront_make_fits f WHERE (item_ids IS NULL OR f.supplier_item_id=ANY(item_ids))
   AND NOT EXISTS (SELECT 1 FROM make_fits_computed c WHERE c.brand_id=f.brand_id AND c.supplier_item_id=f.supplier_item_id)
  RETURNING 1
 )
 SELECT (SELECT count(*) FROM inserted)+(SELECT count(*) FROM removed) INTO changed;
 WITH inserted AS (
  INSERT INTO storefront_model_fits(model_id,supplier_item_id) SELECT DISTINCT model_id,supplier_item_id FROM make_fits_computed
  ON CONFLICT DO NOTHING RETURNING 1
 ), removed AS (
  DELETE FROM storefront_model_fits f WHERE (item_ids IS NULL OR f.supplier_item_id=ANY(item_ids))
   AND NOT EXISTS (SELECT 1 FROM make_fits_computed c WHERE c.model_id=f.model_id AND c.supplier_item_id=f.supplier_item_id)
  RETURNING 1
 )
 SELECT (SELECT count(*) FROM inserted)+(SELECT count(*) FROM removed) INTO model_changed;
 DROP TABLE make_fits_computed;
 -- The description makes of the same rows (#956). EXECUTE: a cached generic plan would scan the table for a scoped call.
 EXECUTE $sql$WITH computed AS MATERIALIZED (SELECT c.brand_id,c.supplier_item_id FROM storefront_make_description_fits_compute($1) c),
  inserted AS (
   INSERT INTO storefront_make_description_fits(brand_id,supplier_item_id) SELECT brand_id,supplier_item_id FROM computed
   ON CONFLICT DO NOTHING RETURNING 1
  ), removed AS (
   DELETE FROM storefront_make_description_fits f WHERE ($1::uuid[] IS NULL OR f.supplier_item_id=ANY($1))
    AND NOT EXISTS (SELECT 1 FROM computed c WHERE c.brand_id=f.brand_id AND c.supplier_item_id=f.supplier_item_id)
   RETURNING 1
  )
  SELECT (SELECT count(*) FROM inserted)+(SELECT count(*) FROM removed)$sql$ INTO description_changed USING item_ids;
 IF item_ids IS NULL THEN ANALYZE storefront_make_fits; ANALYZE storefront_model_fits; ANALYZE storefront_make_description_fits; END IF;
 -- Summed per transaction for storefront_fits_sync(): the callers in between (product_enrichment_shared_refresh) discard it.
 PERFORM set_config('getirbakim.storefront_fits_changed',
  (COALESCE(NULLIF(current_setting('getirbakim.storefront_fits_changed',true),''),'0')::bigint+changed+model_changed+description_changed)::text,true);
 RETURN changed+model_changed+description_changed;
END $$;

-- product_enrichment_shared_sync() and how many make, description make and model fit rows it changed. The app's
-- background sync (src/modules/store/enrichment-links.server.ts) moves the listing epoch when they changed (#956):
-- listings cache their fits per process, and an admin's edit bumps the epoch before this sync rebuilt the tables.
CREATE OR REPLACE FUNCTION storefront_fits_sync(batch integer DEFAULT 20000) RETURNS TABLE(written integer, fits_changed bigint)
LANGUAGE plpgsql AS $$
BEGIN
 PERFORM set_config('getirbakim.storefront_fits_changed','0',true);
 written := product_enrichment_shared_sync(batch);
 fits_changed := COALESCE(NULLIF(current_setting('getirbakim.storefront_fits_changed',true),''),'0')::bigint;
 RETURN NEXT;
END $$;

-- A fitment belongs to its donor item: the refresh resolves the item to its product and every offer sharing it.
-- Created only when missing: CREATE [OR REPLACE] TRIGGER locks the table against writers (SHARE ROW EXCLUSIVE) until setup
-- commits. A changed function body needs only its CREATE OR REPLACE FUNCTION; a changed trigger definition needs a
-- DROP TRIGGER in the same change.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='product_vehicle_fitments'::regclass AND tgname='enrichment_shared_fitments_insert') THEN
  CREATE TRIGGER enrichment_shared_fitments_insert AFTER INSERT ON product_vehicle_fitments
   REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION product_enrichment_shared_queue_items();
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='product_vehicle_fitments'::regclass AND tgname='enrichment_shared_fitments_update') THEN
  CREATE TRIGGER enrichment_shared_fitments_update AFTER UPDATE ON product_vehicle_fitments
   REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION product_enrichment_shared_queue_items();
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='product_vehicle_fitments'::regclass AND tgname='enrichment_shared_fitments_delete') THEN
  CREATE TRIGGER enrichment_shared_fitments_delete AFTER DELETE ON product_vehicle_fitments
   REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION product_enrichment_shared_queue_items();
 END IF;
END $$;

-- An admin's fitment decision (#583) belongs to a product: the refresh recomputes every offer of it. A small table;
-- merges carry rows through the same triggers.
CREATE OR REPLACE FUNCTION product_override_fitments_queue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('INSERT','UPDATE') THEN
  INSERT INTO product_enrichment_shared_queue(kind,id) SELECT DISTINCT 'p',product_id FROM new_rows ON CONFLICT DO NOTHING;
 END IF;
 IF TG_OP IN ('UPDATE','DELETE') THEN
  INSERT INTO product_enrichment_shared_queue(kind,id) SELECT DISTINCT 'p',product_id FROM old_rows ON CONFLICT DO NOTHING;
 END IF;
 RETURN NULL;
END $$;
-- Created only when missing (#965): CREATE [OR REPLACE] TRIGGER locks the table against writers until setup commits.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='product_override_fitments'::regclass AND tgname='product_override_fitments_insert') THEN
  CREATE TRIGGER product_override_fitments_insert AFTER INSERT ON product_override_fitments
   REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION product_override_fitments_queue();
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='product_override_fitments'::regclass AND tgname='product_override_fitments_update') THEN
  CREATE TRIGGER product_override_fitments_update AFTER UPDATE ON product_override_fitments
   REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION product_override_fitments_queue();
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='product_override_fitments'::regclass AND tgname='product_override_fitments_delete') THEN
  CREATE TRIGGER product_override_fitments_delete AFTER DELETE ON product_override_fitments
   REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION product_override_fitments_queue();
 END IF;
END $$;

-- A description fitment (#956) belongs to its row, like an engine-level one; the sync (description-fitment-sync.ts) never
-- moves a row to another model (an UPDATE changes years and text only), so inserts and deletes are enough. A model the
-- admin hides belongs to the product, like the decisions above; the other hidden rows (source_vehicle, source_model)
-- apply in TS only and queue nothing. Created only when missing (#965).
CREATE OR REPLACE FUNCTION product_override_fitment_hides_queue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('INSERT','UPDATE') THEN
  INSERT INTO product_enrichment_shared_queue(kind,id) SELECT DISTINCT 'p',product_id FROM new_rows
   WHERE kind='description_model' ON CONFLICT DO NOTHING;
 END IF;
 IF TG_OP IN ('UPDATE','DELETE') THEN
  INSERT INTO product_enrichment_shared_queue(kind,id) SELECT DISTINCT 'p',product_id FROM old_rows
   WHERE kind='description_model' ON CONFLICT DO NOTHING;
 END IF;
 RETURN NULL;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='product_model_fitments'::regclass AND tgname='enrichment_shared_model_fitments_insert') THEN
  CREATE TRIGGER enrichment_shared_model_fitments_insert AFTER INSERT ON product_model_fitments
   REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION product_enrichment_shared_queue_items();
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='product_model_fitments'::regclass AND tgname='enrichment_shared_model_fitments_delete') THEN
  CREATE TRIGGER enrichment_shared_model_fitments_delete AFTER DELETE ON product_model_fitments
   REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION product_enrichment_shared_queue_items();
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='product_override_fitment_hides'::regclass AND tgname='product_override_fitment_hides_insert') THEN
  CREATE TRIGGER product_override_fitment_hides_insert AFTER INSERT ON product_override_fitment_hides
   REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION product_override_fitment_hides_queue();
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='product_override_fitment_hides'::regclass AND tgname='product_override_fitment_hides_update') THEN
  CREATE TRIGGER product_override_fitment_hides_update AFTER UPDATE ON product_override_fitment_hides
   REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION product_override_fitment_hides_queue();
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='product_override_fitment_hides'::regclass AND tgname='product_override_fitment_hides_delete') THEN
  CREATE TRIGGER product_override_fitment_hides_delete AFTER DELETE ON product_override_fitment_hides
   REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION product_override_fitment_hides_queue();
 END IF;
END $$;

-- A type or model moving to another make touches every offer fitted to it: rebuild (rare, catalog imports).
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='vehicle_types'::regclass AND tgname='enrichment_shared_vehicle_types_update') THEN
  CREATE TRIGGER enrichment_shared_vehicle_types_update AFTER UPDATE OF model_id ON vehicle_types FOR EACH ROW
   WHEN (OLD.model_id IS DISTINCT FROM NEW.model_id) EXECUTE FUNCTION product_enrichment_shared_queue_all();
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='vehicle_models'::regclass AND tgname='enrichment_shared_vehicle_models_update') THEN
  CREATE TRIGGER enrichment_shared_vehicle_models_update AFTER UPDATE OF brand_id ON vehicle_models FOR EACH ROW
   WHEN (OLD.brand_id IS DISTINCT FROM NEW.brand_id) EXECUTE FUNCTION product_enrichment_shared_queue_all();
 END IF;
END $$;

-- The first deployment fills the tables: an empty one asks for a rebuild (scripts/setup.ts syncs after the schema).
INSERT INTO product_enrichment_shared_queue(kind,id) SELECT 'p','00000000-0000-0000-0000-000000000000'
 WHERE NOT EXISTS (SELECT 1 FROM storefront_make_fits) OR NOT EXISTS (SELECT 1 FROM storefront_model_fits) ON CONFLICT DO NOTHING;
-- The description table is filled here once (~0.5 s locally for ~400k rows), so make pages keep their description fits
-- between this setup and the next sync; later changes reach it through the queue.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM storefront_make_description_fits) THEN
  INSERT INTO storefront_make_description_fits(brand_id,supplier_item_id)
   SELECT brand_id,supplier_item_id FROM storefront_make_description_fits_compute() ON CONFLICT DO NOTHING;
  ANALYZE storefront_make_description_fits;
 END IF;
END $$;
