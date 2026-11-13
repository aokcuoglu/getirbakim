-- product_enrichment_shared, materialized for the storefront (#446). The view re-sorts every valid enrichment
-- (DISTINCT ON product) on each read, so a filter cannot reach it: 1-2 s for a page of 24 products, and the planner,
-- expecting one row, nests it against a make's fitments for minutes. This table keeps its result as links from each
-- target offer to the donor enrichment it shows; the donor's payload is read from product_enrichments, not copied.
-- Writers queue what they touched (triggers below); product_enrichment_shared_sync() recomputes only those products.
CREATE TABLE IF NOT EXISTS product_enrichment_shared_links (
 supplier_item_id uuid PRIMARY KEY REFERENCES supplier_items(id) ON DELETE CASCADE,
 supplier_code text NOT NULL, supplier_brand text NOT NULL,
 donor_item_id uuid NOT NULL REFERENCES product_enrichments(supplier_item_id) ON DELETE CASCADE,
 donor_oem text NOT NULL, status text NOT NULL, donor_master_brand text,
 image_id uuid, imported_at timestamptz NOT NULL,
 refreshed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_enrichment_shared_links_donor_idx ON product_enrichment_shared_links(donor_item_id);
CREATE INDEX IF NOT EXISTS product_enrichment_shared_links_image_idx ON product_enrichment_shared_links(image_id) WHERE image_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_enrichment_shared_links_imported_idx ON product_enrichment_shared_links(imported_at DESC, supplier_item_id);

-- Same columns, in the same order, as product_enrichment_shared: storefront queries swap one name for the other.
CREATE OR REPLACE VIEW storefront_enrichments AS
 SELECT l.supplier_item_id,l.supplier_code,l.supplier_brand,e.source_url,e.source_method,e.manufacturer,
 e.manufacturer_part_number,l.image_id,e.payload,l.imported_at,e.match_basis,l.donor_item_id,
 e.supplier_code AS donor_code,e.supplier_brand AS donor_brand,l.donor_oem,l.status,l.donor_master_brand
 FROM product_enrichment_shared_links l JOIN product_enrichments e ON e.supplier_item_id=l.donor_item_id;

-- Stale scope: products ('p') and supplier items ('i'). Items without a product link have their own view branch.
-- The all-zero product id asks for a full rebuild (brand mapping and schema changes touch everything).
CREATE TABLE IF NOT EXISTS product_enrichment_shared_queue (
 kind char(1) NOT NULL CHECK (kind IN ('p','i')), id uuid NOT NULL, queued_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (kind,id)
);

-- The view's rows for the given products and unlinked items; NULL computes everything. The filter sits inside the
-- DISTINCT ON, which the view cannot do. The whole catalog runs with nested loops off (the planner expects one
-- enrichment_valid_data row; hash joins finish in seconds), the same as enrichment_product_states_compute_all.
-- EXECUTE plans each call afresh, so a plan cached under one setting is never reused under the other.
CREATE OR REPLACE FUNCTION product_enrichment_shared_compute(product_ids uuid[], item_ids uuid[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
 PERFORM set_config('enable_nestloop',CASE WHEN product_ids IS NULL THEN 'off' ELSE 'on' END,true);
 EXECUTE $sql$CREATE TEMP TABLE enrichment_shared_computed ON COMMIT DROP AS
  SELECT target.id AS supplier_item_id,target.code AS supplier_code,
   COALESCE(NULLIF(target.product_data->>'uk',''),supplier_item_brand(target.supplier,target.product_data),'') AS supplier_brand,
   e.supplier_item_id AS donor_item_id,e.donor_oem,e.status,e.donor_master_brand,e.image_id,e.imported_at
  FROM (
   SELECT DISTINCT ON (donor.product_id) donor.product_id,e.*
   FROM enrichment_valid_data e JOIN enrichment_current_sources donor ON donor.supplier_item_id=e.supplier_item_id
   WHERE $1 IS NULL OR donor.product_id=ANY($1)
   ORDER BY donor.product_id,e.status='complete' DESC,e.imported_at DESC,e.supplier_item_id
  ) e
  JOIN products p ON p.id=e.product_id AND p.merged_into IS NULL
  JOIN enrichment_current_sources ps ON ps.product_id=e.product_id
  JOIN supplier_items target ON target.id=ps.supplier_item_id
  UNION ALL
  SELECT e.supplier_item_id,e.supplier_code,e.supplier_brand,e.supplier_item_id,e.donor_oem,e.status,e.donor_master_brand,e.image_id,e.imported_at
  FROM enrichment_valid_data e
  WHERE ($2 IS NULL OR e.supplier_item_id=ANY($2))
   AND NOT EXISTS(SELECT 1 FROM product_sources ps WHERE ps.supplier_item_id=e.supplier_item_id)$sql$ USING product_ids,item_ids;
 PERFORM set_config('enable_nestloop','on',true);
END $$;

-- Recomputes the links of the given products and items (NULL: all) and writes only what changed. A product's scope
-- is every offer linked to it, so links that left the result (merged products, broken identity) are removed.
CREATE OR REPLACE FUNCTION product_enrichment_shared_refresh(product_ids uuid[] DEFAULT NULL, item_ids uuid[] DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE changed integer; scope uuid[];
BEGIN
 IF product_ids IS NULL THEN
  PERFORM product_enrichment_shared_compute(NULL,NULL);
 ELSE
  -- Items reach the view through their product; their own branch covers the ones without a link.
  product_ids := ARRAY(SELECT unnest(product_ids) UNION SELECT ps.product_id FROM product_sources ps WHERE ps.supplier_item_id=ANY(item_ids));
  scope := ARRAY(SELECT unnest(item_ids) UNION SELECT ps.supplier_item_id FROM product_sources ps WHERE ps.product_id=ANY(product_ids));
  PERFORM product_enrichment_shared_compute(product_ids,scope);
 END IF;
 WITH upserted AS (
  INSERT INTO product_enrichment_shared_links AS l
   (supplier_item_id,supplier_code,supplier_brand,donor_item_id,donor_oem,status,donor_master_brand,image_id,imported_at)
  SELECT supplier_item_id,supplier_code,supplier_brand,donor_item_id,donor_oem,status,donor_master_brand,image_id,imported_at
  FROM enrichment_shared_computed
  ON CONFLICT (supplier_item_id) DO UPDATE SET
   supplier_code=EXCLUDED.supplier_code,supplier_brand=EXCLUDED.supplier_brand,donor_item_id=EXCLUDED.donor_item_id,
   donor_oem=EXCLUDED.donor_oem,status=EXCLUDED.status,donor_master_brand=EXCLUDED.donor_master_brand,
   image_id=EXCLUDED.image_id,imported_at=EXCLUDED.imported_at,refreshed_at=now()
  WHERE ROW(l.supplier_code,l.supplier_brand,l.donor_item_id,l.donor_oem,l.status,l.donor_master_brand,l.image_id,l.imported_at)
   IS DISTINCT FROM ROW(EXCLUDED.supplier_code,EXCLUDED.supplier_brand,EXCLUDED.donor_item_id,EXCLUDED.donor_oem,
    EXCLUDED.status,EXCLUDED.donor_master_brand,EXCLUDED.image_id,EXCLUDED.imported_at)
  RETURNING 1
 ), removed AS (
  DELETE FROM product_enrichment_shared_links l WHERE (product_ids IS NULL OR l.supplier_item_id=ANY(scope))
   AND NOT EXISTS (SELECT 1 FROM enrichment_shared_computed c WHERE c.supplier_item_id=l.supplier_item_id) RETURNING 1
 )
 SELECT (SELECT count(*) FROM upserted)+(SELECT count(*) FROM removed) INTO changed;
 DROP TABLE enrichment_shared_computed;
 IF product_ids IS NULL THEN ANALYZE product_enrichment_shared_links; END IF;
 -- The make lists of the same offers (db/storefront-make-fits.sql, #455), now that their links are current. Schemas
 -- without the vehicle catalog (some tests) do not define it.
 IF to_regprocedure('storefront_make_fits_refresh(uuid[])') IS NOT NULL THEN
  PERFORM storefront_make_fits_refresh(CASE WHEN product_ids IS NULL THEN NULL ELSE scope END);
 END IF;
 RETURN changed;
END $$;

-- Drains the queue: a small one is refreshed by scope, a large one (or the rebuild marker) rebuilds everything.
-- Concurrent callers do not wait for each other. A row is taken in the statement before the recomputation, which
-- therefore sees the write that queued it (both commit together).
CREATE OR REPLACE FUNCTION product_enrichment_shared_sync(batch integer DEFAULT 20000) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE product_ids uuid[]; item_ids uuid[]; queued integer; everything boolean;
BEGIN
 IF NOT pg_try_advisory_xact_lock(20261001,9) THEN RETURN 0; END IF;
 SELECT count(*),COALESCE(bool_or(kind='p' AND id='00000000-0000-0000-0000-000000000000'),false) INTO queued,everything
  FROM (SELECT kind,id FROM product_enrichment_shared_queue LIMIT batch+1) q;
 IF queued=0 THEN RETURN 0; END IF;
 IF everything OR queued>batch THEN
  DELETE FROM product_enrichment_shared_queue;
  RETURN product_enrichment_shared_refresh(NULL,NULL);
 END IF;
 WITH taken AS (DELETE FROM product_enrichment_shared_queue RETURNING kind,id)
 SELECT COALESCE(array_agg(id) FILTER (WHERE kind='p'),'{}'),COALESCE(array_agg(id) FILTER (WHERE kind='i'),'{}')
  INTO product_ids,item_ids FROM taken;
 RETURN product_enrichment_shared_refresh(product_ids,item_ids);
END $$;

-- Statement-level triggers with transition tables: one statement per batch, so bulk upserts stay cheap.
CREATE OR REPLACE FUNCTION product_enrichment_shared_queue_products() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('INSERT','UPDATE') THEN
  INSERT INTO product_enrichment_shared_queue(kind,id) SELECT DISTINCT 'p',id FROM new_rows ON CONFLICT DO NOTHING;
 END IF;
 IF TG_OP IN ('UPDATE','DELETE') THEN
  INSERT INTO product_enrichment_shared_queue(kind,id) SELECT DISTINCT 'p',id FROM old_rows ON CONFLICT DO NOTHING;
 END IF;
 RETURN NULL;
END $$;
-- A changed link moves an offer between products, or in and out of the unlinked branch: queue both sides.
CREATE OR REPLACE FUNCTION product_enrichment_shared_queue_sources() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('INSERT','UPDATE') THEN
  INSERT INTO product_enrichment_shared_queue(kind,id)
   SELECT DISTINCT 'p'::char(1),product_id FROM new_rows UNION SELECT 'i',supplier_item_id FROM new_rows ON CONFLICT DO NOTHING;
 END IF;
 IF TG_OP IN ('UPDATE','DELETE') THEN
  INSERT INTO product_enrichment_shared_queue(kind,id)
   SELECT DISTINCT 'p'::char(1),product_id FROM old_rows UNION SELECT 'i',supplier_item_id FROM old_rows ON CONFLICT DO NOTHING;
 END IF;
 RETURN NULL;
END $$;
-- Rows keyed by supplier_item_id (jobs, enrichments); the refresh resolves their product.
CREATE OR REPLACE FUNCTION product_enrichment_shared_queue_items() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('INSERT','UPDATE') THEN
  INSERT INTO product_enrichment_shared_queue(kind,id) SELECT DISTINCT 'i',supplier_item_id FROM new_rows ON CONFLICT DO NOTHING;
 END IF;
 IF TG_OP IN ('UPDATE','DELETE') THEN
  INSERT INTO product_enrichment_shared_queue(kind,id) SELECT DISTINCT 'i',supplier_item_id FROM old_rows ON CONFLICT DO NOTHING;
 END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION product_enrichment_shared_queue_supplier_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO product_enrichment_shared_queue(kind,id) VALUES ('i',NEW.id) ON CONFLICT DO NOTHING;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION product_enrichment_shared_queue_all() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO product_enrichment_shared_queue(kind,id) VALUES ('p','00000000-0000-0000-0000-000000000000') ON CONFLICT DO NOTHING;
 RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS enrichment_shared_products_insert ON products;
CREATE TRIGGER enrichment_shared_products_insert AFTER INSERT ON products
 REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION product_enrichment_shared_queue_products();
DROP TRIGGER IF EXISTS enrichment_shared_products_update ON products;
CREATE TRIGGER enrichment_shared_products_update AFTER UPDATE ON products
 REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION product_enrichment_shared_queue_products();
DROP TRIGGER IF EXISTS enrichment_shared_products_delete ON products;
CREATE TRIGGER enrichment_shared_products_delete AFTER DELETE ON products
 REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION product_enrichment_shared_queue_products();

DROP TRIGGER IF EXISTS enrichment_shared_sources_insert ON product_sources;
CREATE TRIGGER enrichment_shared_sources_insert AFTER INSERT ON product_sources
 REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION product_enrichment_shared_queue_sources();
DROP TRIGGER IF EXISTS enrichment_shared_sources_update ON product_sources;
CREATE TRIGGER enrichment_shared_sources_update AFTER UPDATE ON product_sources
 REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION product_enrichment_shared_queue_sources();
DROP TRIGGER IF EXISTS enrichment_shared_sources_delete ON product_sources;
CREATE TRIGGER enrichment_shared_sources_delete AFTER DELETE ON product_sources
 REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION product_enrichment_shared_queue_sources();

DROP TRIGGER IF EXISTS enrichment_shared_jobs_insert ON product_enrichment_jobs;
CREATE TRIGGER enrichment_shared_jobs_insert AFTER INSERT ON product_enrichment_jobs
 REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION product_enrichment_shared_queue_items();
DROP TRIGGER IF EXISTS enrichment_shared_jobs_update ON product_enrichment_jobs;
CREATE TRIGGER enrichment_shared_jobs_update AFTER UPDATE ON product_enrichment_jobs
 REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION product_enrichment_shared_queue_items();
DROP TRIGGER IF EXISTS enrichment_shared_jobs_delete ON product_enrichment_jobs;
CREATE TRIGGER enrichment_shared_jobs_delete AFTER DELETE ON product_enrichment_jobs
 REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION product_enrichment_shared_queue_items();

DROP TRIGGER IF EXISTS enrichment_shared_enrichments_insert ON product_enrichments;
CREATE TRIGGER enrichment_shared_enrichments_insert AFTER INSERT ON product_enrichments
 REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION product_enrichment_shared_queue_items();
DROP TRIGGER IF EXISTS enrichment_shared_enrichments_update ON product_enrichments;
CREATE TRIGGER enrichment_shared_enrichments_update AFTER UPDATE ON product_enrichments
 REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION product_enrichment_shared_queue_items();
DROP TRIGGER IF EXISTS enrichment_shared_enrichments_delete ON product_enrichments;
CREATE TRIGGER enrichment_shared_enrichments_delete AFTER DELETE ON product_enrichments
 REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION product_enrichment_shared_queue_items();

-- Price and stock syncs rewrite supplier rows constantly; only identity matters here. Deleted rows cascade.
DROP TRIGGER IF EXISTS enrichment_shared_supplier_items_update ON supplier_items;
CREATE TRIGGER enrichment_shared_supplier_items_update AFTER UPDATE OF code, product_data ON supplier_items FOR EACH ROW
 WHEN (OLD.code IS DISTINCT FROM NEW.code
  OR OLD.product_data->>'uk' IS DISTINCT FROM NEW.product_data->>'uk'
  OR OLD.product_data->>'marka' IS DISTINCT FROM NEW.product_data->>'marka'
  OR OLD.product_data->>'oe' IS DISTINCT FROM NEW.product_data->>'oe')
 EXECUTE FUNCTION product_enrichment_shared_queue_supplier_item();

DROP TRIGGER IF EXISTS enrichment_shared_supplier_brands_update ON supplier_brands;
CREATE TRIGGER enrichment_shared_supplier_brands_update AFTER UPDATE OF brand_id ON supplier_brands FOR EACH ROW
 WHEN (OLD.brand_id IS DISTINCT FROM NEW.brand_id) EXECUTE FUNCTION product_enrichment_shared_queue_all();
DROP TRIGGER IF EXISTS enrichment_shared_supplier_brands_delete ON supplier_brands;
CREATE TRIGGER enrichment_shared_supplier_brands_delete AFTER DELETE ON supplier_brands FOR EACH ROW EXECUTE FUNCTION product_enrichment_shared_queue_all();
DROP TRIGGER IF EXISTS enrichment_shared_supplier_brands_insert ON supplier_brands;
CREATE TRIGGER enrichment_shared_supplier_brands_insert AFTER INSERT ON supplier_brands FOR EACH ROW EXECUTE FUNCTION product_enrichment_shared_queue_all();
DROP TRIGGER IF EXISTS enrichment_shared_brands_update ON brands;
CREATE TRIGGER enrichment_shared_brands_update AFTER UPDATE OF key, name ON brands FOR EACH ROW
 WHEN (OLD.key IS DISTINCT FROM NEW.key OR OLD.name IS DISTINCT FROM NEW.name) EXECUTE FUNCTION product_enrichment_shared_queue_all();
DROP TRIGGER IF EXISTS enrichment_shared_brands_delete ON brands;
CREATE TRIGGER enrichment_shared_brands_delete AFTER DELETE ON brands FOR EACH ROW EXECUTE FUNCTION product_enrichment_shared_queue_all();

-- Every schema run may change the view logic it mirrors: the next sync (scripts/setup.ts runs one) rebuilds it.
INSERT INTO product_enrichment_shared_queue(kind,id) VALUES ('p','00000000-0000-0000-0000-000000000000') ON CONFLICT DO NOTHING;
