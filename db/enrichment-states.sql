-- One materialized row per master product for the enrichment dashboard (#238). Reading enrichment_product_catalog
-- directly re-evaluates ~54k point lookups through supplier_items on every page view; this table is kept current by
-- triggers that queue the affected product ids, and readers drain the queue before they select.
CREATE TABLE IF NOT EXISTS enrichment_product_states (
 product_id uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
 product_brand text, part_number text, product_name text,
 supplier_item_id uuid, supplier_code text, supplier_brand text, oem text,
 status text NOT NULL, enriched boolean NOT NULL DEFAULT false,
 attempts integer NOT NULL DEFAULT 0, last_error text,
 updated_at timestamptz NOT NULL, imported_at timestamptz,
 sorted_at timestamptz NOT NULL,
 source_url text, manufacturer text, manufacturer_part_number text, image_id uuid,
 match_type text, reference text,
 oem_count integer NOT NULL DEFAULT 0, vehicle_count integer NOT NULL DEFAULT 0, specification_count integer NOT NULL DEFAULT 0,
 refreshed_at timestamptz NOT NULL DEFAULT now()
);
-- Both sort directions walk one index: ORDER BY sorted_at, supplier_item_id with the same direction on both keys.
CREATE INDEX IF NOT EXISTS enrichment_product_states_status_idx ON enrichment_product_states(status, sorted_at, supplier_item_id);
CREATE INDEX IF NOT EXISTS enrichment_product_states_enriched_idx ON enrichment_product_states(sorted_at, supplier_item_id) WHERE enriched;
CREATE INDEX IF NOT EXISTS enrichment_product_states_item_idx ON enrichment_product_states(supplier_item_id);

-- Product ids whose state row is stale. The all-zero id asks for a full rebuild (brand mapping changes touch everything).
CREATE TABLE IF NOT EXISTS enrichment_product_state_queue (
 product_id uuid PRIMARY KEY, queued_at timestamptz NOT NULL DEFAULT now()
);

-- Same column order as the table so a rebuild is INSERT ... SELECT *.
CREATE OR REPLACE VIEW enrichment_product_state_rows AS
 SELECT c.product_id,c.product_brand,c.part_number,c.product_name,c.supplier_item_id,c.supplier_code,c.supplier_brand,c.oem,
  c.status,c.payload IS NOT NULL AS enriched,c.attempts,c.last_error,c.updated_at,c.imported_at,
  COALESCE(c.imported_at,c.updated_at) AS sorted_at,
  c.source_url,c.manufacturer,c.manufacturer_part_number,c.image_id,
  c.match_basis->>'type' AS match_type,c.match_basis->>'reference' AS reference,
  COALESCE((SELECT sum(jsonb_array_length(value)) FROM jsonb_each(c.payload->'oemNumbers')),0)::int AS oem_count,
  COALESCE(jsonb_array_length(c.payload->'vehicles'),0) AS vehicle_count,
  COALESCE(jsonb_array_length(c.payload->'specifications'),0) AS specification_count,
  now() AS refreshed_at
 FROM enrichment_product_catalog c;

-- Over the whole catalog the planner expects one enrichment_valid_data row and nests it per source row (minutes);
-- hash joins finish in seconds, so the full computation runs with nested loops disabled.
CREATE OR REPLACE FUNCTION enrichment_product_states_compute_all() RETURNS void
LANGUAGE plpgsql SET enable_nestloop = off AS $$
BEGIN
 CREATE TEMP TABLE enrichment_state_computed ON COMMIT DROP AS SELECT * FROM enrichment_product_state_rows;
END $$;

-- NULL rebuilds every product; otherwise only the given ids are recomputed (point lookups) and rows that left the
-- catalog (merged products) are removed. Unchanged rows are not rewritten. Returns the number of rows written.
CREATE OR REPLACE FUNCTION enrichment_product_states_refresh(ids uuid[] DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE changed integer;
BEGIN
 IF ids IS NULL THEN
  PERFORM enrichment_product_states_compute_all();
 ELSE
  -- OFFSET 0 keeps each product a point lookup; inlined, the view is evaluated for the whole catalog.
  CREATE TEMP TABLE enrichment_state_computed ON COMMIT DROP AS
   SELECT r.* FROM (SELECT DISTINCT unnest(ids) AS product_id) t
   CROSS JOIN LATERAL (SELECT * FROM enrichment_product_state_rows r WHERE r.product_id=t.product_id OFFSET 0) r;
 END IF;
 WITH upserted AS (
  INSERT INTO enrichment_product_states SELECT * FROM enrichment_state_computed
  ON CONFLICT (product_id) DO UPDATE SET
   product_brand=EXCLUDED.product_brand,part_number=EXCLUDED.part_number,product_name=EXCLUDED.product_name,
   supplier_item_id=EXCLUDED.supplier_item_id,supplier_code=EXCLUDED.supplier_code,supplier_brand=EXCLUDED.supplier_brand,oem=EXCLUDED.oem,
   status=EXCLUDED.status,enriched=EXCLUDED.enriched,attempts=EXCLUDED.attempts,last_error=EXCLUDED.last_error,
   updated_at=EXCLUDED.updated_at,imported_at=EXCLUDED.imported_at,sorted_at=EXCLUDED.sorted_at,
   source_url=EXCLUDED.source_url,manufacturer=EXCLUDED.manufacturer,manufacturer_part_number=EXCLUDED.manufacturer_part_number,
   image_id=EXCLUDED.image_id,match_type=EXCLUDED.match_type,reference=EXCLUDED.reference,
   oem_count=EXCLUDED.oem_count,vehicle_count=EXCLUDED.vehicle_count,specification_count=EXCLUDED.specification_count,
   refreshed_at=EXCLUDED.refreshed_at
  WHERE ROW(enrichment_product_states.product_brand,enrichment_product_states.part_number,enrichment_product_states.product_name,
    enrichment_product_states.supplier_item_id,enrichment_product_states.supplier_code,enrichment_product_states.supplier_brand,
    enrichment_product_states.oem,enrichment_product_states.status,enrichment_product_states.enriched,enrichment_product_states.attempts,
    enrichment_product_states.last_error,enrichment_product_states.updated_at,enrichment_product_states.imported_at,
    enrichment_product_states.sorted_at,enrichment_product_states.source_url,enrichment_product_states.manufacturer,
    enrichment_product_states.manufacturer_part_number,enrichment_product_states.image_id,enrichment_product_states.match_type,
    enrichment_product_states.reference,enrichment_product_states.oem_count,enrichment_product_states.vehicle_count,
    enrichment_product_states.specification_count)
   IS DISTINCT FROM ROW(EXCLUDED.product_brand,EXCLUDED.part_number,EXCLUDED.product_name,EXCLUDED.supplier_item_id,
    EXCLUDED.supplier_code,EXCLUDED.supplier_brand,EXCLUDED.oem,EXCLUDED.status,EXCLUDED.enriched,EXCLUDED.attempts,
    EXCLUDED.last_error,EXCLUDED.updated_at,EXCLUDED.imported_at,EXCLUDED.sorted_at,EXCLUDED.source_url,EXCLUDED.manufacturer,
    EXCLUDED.manufacturer_part_number,EXCLUDED.image_id,EXCLUDED.match_type,EXCLUDED.reference,EXCLUDED.oem_count,
    EXCLUDED.vehicle_count,EXCLUDED.specification_count)
  RETURNING 1
 ), removed AS (
  DELETE FROM enrichment_product_states s WHERE (ids IS NULL OR s.product_id=ANY(ids))
   AND NOT EXISTS (SELECT 1 FROM enrichment_state_computed c WHERE c.product_id=s.product_id) RETURNING 1
 )
 SELECT (SELECT count(*) FROM upserted)+(SELECT count(*) FROM removed) INTO changed;
 DROP TABLE enrichment_state_computed;
 IF ids IS NULL THEN ANALYZE enrichment_product_states; END IF;
 RETURN changed;
END $$;

-- Drains the queue: a small queue is refreshed by id, a large one (or the rebuild marker) rebuilds everything.
-- Concurrent callers do not wait for each other; the second one reads what the first one leaves.
CREATE OR REPLACE FUNCTION enrichment_product_states_sync(batch integer DEFAULT 20000) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE ids uuid[]; queued integer; everything boolean;
BEGIN
 IF NOT pg_try_advisory_xact_lock(20261001,5) THEN RETURN 0; END IF;
 SELECT count(*),COALESCE(bool_or(product_id='00000000-0000-0000-0000-000000000000'),false) INTO queued,everything
  FROM (SELECT product_id FROM enrichment_product_state_queue LIMIT batch+1) q;
 IF queued=0 THEN RETURN 0; END IF;
 IF everything OR queued>batch THEN
  DELETE FROM enrichment_product_state_queue;
  RETURN enrichment_product_states_refresh(NULL);
 END IF;
 WITH taken AS (DELETE FROM enrichment_product_state_queue RETURNING product_id) SELECT array_agg(product_id) INTO ids FROM taken;
 RETURN enrichment_product_states_refresh(ids);
END $$;

-- Writers queue the products they touched. Statement-level triggers with transition tables cost one statement per
-- batch, so the matcher's and the supplier syncs' bulk upserts stay cheap. A change that cannot be attributed to
-- single products (brand mapping) queues the rebuild marker instead.
CREATE OR REPLACE FUNCTION enrichment_product_states_queue_products() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('INSERT','UPDATE') THEN
  INSERT INTO enrichment_product_state_queue(product_id) SELECT DISTINCT id FROM new_rows ON CONFLICT DO NOTHING;
 END IF;
 IF TG_OP IN ('UPDATE','DELETE') THEN
  INSERT INTO enrichment_product_state_queue(product_id) SELECT DISTINCT id FROM old_rows ON CONFLICT DO NOTHING;
 END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION enrichment_product_states_queue_sources() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('INSERT','UPDATE') THEN
  INSERT INTO enrichment_product_state_queue(product_id) SELECT DISTINCT product_id FROM new_rows ON CONFLICT DO NOTHING;
 END IF;
 IF TG_OP IN ('UPDATE','DELETE') THEN
  INSERT INTO enrichment_product_state_queue(product_id) SELECT DISTINCT product_id FROM old_rows ON CONFLICT DO NOTHING;
 END IF;
 RETURN NULL;
END $$;
-- Rows keyed by supplier_item_id (jobs, enrichments) reach the product through its current link.
CREATE OR REPLACE FUNCTION enrichment_product_states_queue_items() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('INSERT','UPDATE') THEN
  INSERT INTO enrichment_product_state_queue(product_id) SELECT DISTINCT ps.product_id FROM new_rows n
   JOIN product_sources ps ON ps.supplier_item_id=n.supplier_item_id ON CONFLICT DO NOTHING;
 END IF;
 IF TG_OP IN ('UPDATE','DELETE') THEN
  INSERT INTO enrichment_product_state_queue(product_id) SELECT DISTINCT ps.product_id FROM old_rows o
   JOIN product_sources ps ON ps.supplier_item_id=o.supplier_item_id ON CONFLICT DO NOTHING;
 END IF;
 RETURN NULL;
END $$;
-- Supplier syncs rewrite price and stock far more often than identity; only identity and presence matter here.
-- Row-level with a column list: the sync's metadata-only UPDATE over every observed row never fires it.
CREATE OR REPLACE FUNCTION enrichment_product_states_queue_supplier_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO enrichment_product_state_queue(product_id) SELECT ps.product_id FROM product_sources ps WHERE ps.supplier_item_id=NEW.id
  ON CONFLICT DO NOTHING;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION enrichment_product_states_queue_all() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO enrichment_product_state_queue(product_id) VALUES ('00000000-0000-0000-0000-000000000000') ON CONFLICT DO NOTHING;
 RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS enrichment_states_products_insert ON products;
CREATE TRIGGER enrichment_states_products_insert AFTER INSERT ON products
 REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION enrichment_product_states_queue_products();
DROP TRIGGER IF EXISTS enrichment_states_products_update ON products;
CREATE TRIGGER enrichment_states_products_update AFTER UPDATE ON products
 REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION enrichment_product_states_queue_products();
DROP TRIGGER IF EXISTS enrichment_states_products_delete ON products;
CREATE TRIGGER enrichment_states_products_delete AFTER DELETE ON products
 REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION enrichment_product_states_queue_products();

DROP TRIGGER IF EXISTS enrichment_states_sources_insert ON product_sources;
CREATE TRIGGER enrichment_states_sources_insert AFTER INSERT ON product_sources
 REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION enrichment_product_states_queue_sources();
DROP TRIGGER IF EXISTS enrichment_states_sources_update ON product_sources;
CREATE TRIGGER enrichment_states_sources_update AFTER UPDATE ON product_sources
 REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION enrichment_product_states_queue_sources();
DROP TRIGGER IF EXISTS enrichment_states_sources_delete ON product_sources;
CREATE TRIGGER enrichment_states_sources_delete AFTER DELETE ON product_sources
 REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION enrichment_product_states_queue_sources();

DROP TRIGGER IF EXISTS enrichment_states_jobs_insert ON product_enrichment_jobs;
CREATE TRIGGER enrichment_states_jobs_insert AFTER INSERT ON product_enrichment_jobs
 REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION enrichment_product_states_queue_items();
DROP TRIGGER IF EXISTS enrichment_states_jobs_update ON product_enrichment_jobs;
CREATE TRIGGER enrichment_states_jobs_update AFTER UPDATE ON product_enrichment_jobs
 REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION enrichment_product_states_queue_items();
DROP TRIGGER IF EXISTS enrichment_states_jobs_delete ON product_enrichment_jobs;
CREATE TRIGGER enrichment_states_jobs_delete AFTER DELETE ON product_enrichment_jobs
 REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION enrichment_product_states_queue_items();

DROP TRIGGER IF EXISTS enrichment_states_enrichments_insert ON product_enrichments;
CREATE TRIGGER enrichment_states_enrichments_insert AFTER INSERT ON product_enrichments
 REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION enrichment_product_states_queue_items();
DROP TRIGGER IF EXISTS enrichment_states_enrichments_update ON product_enrichments;
CREATE TRIGGER enrichment_states_enrichments_update AFTER UPDATE ON product_enrichments
 REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION enrichment_product_states_queue_items();
DROP TRIGGER IF EXISTS enrichment_states_enrichments_delete ON product_enrichments;
CREATE TRIGGER enrichment_states_enrichments_delete AFTER DELETE ON product_enrichments
 REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION enrichment_product_states_queue_items();

-- Deleted supplier rows cascade into product_sources, whose own trigger queues the product.
DROP TRIGGER IF EXISTS enrichment_states_supplier_items_update ON supplier_items;
CREATE TRIGGER enrichment_states_supplier_items_update AFTER UPDATE OF code, product_data, presence ON supplier_items FOR EACH ROW
 WHEN (OLD.code IS DISTINCT FROM NEW.code OR OLD.product_data IS DISTINCT FROM NEW.product_data OR OLD.presence IS DISTINCT FROM NEW.presence)
 EXECUTE FUNCTION enrichment_product_states_queue_supplier_item();

-- Brand mapping decides coherence for every product of that label; the small tables take row triggers.
DROP TRIGGER IF EXISTS enrichment_states_supplier_brands_update ON supplier_brands;
CREATE TRIGGER enrichment_states_supplier_brands_update AFTER UPDATE OF brand_id ON supplier_brands FOR EACH ROW
 WHEN (OLD.brand_id IS DISTINCT FROM NEW.brand_id) EXECUTE FUNCTION enrichment_product_states_queue_all();
DROP TRIGGER IF EXISTS enrichment_states_supplier_brands_delete ON supplier_brands;
CREATE TRIGGER enrichment_states_supplier_brands_delete AFTER DELETE ON supplier_brands FOR EACH ROW EXECUTE FUNCTION enrichment_product_states_queue_all();
DROP TRIGGER IF EXISTS enrichment_states_brands_update ON brands;
CREATE TRIGGER enrichment_states_brands_update AFTER UPDATE OF key ON brands FOR EACH ROW
 WHEN (OLD.key IS DISTINCT FROM NEW.key) EXECUTE FUNCTION enrichment_product_states_queue_all();
DROP TRIGGER IF EXISTS enrichment_states_brands_delete ON brands;
CREATE TRIGGER enrichment_states_brands_delete AFTER DELETE ON brands FOR EACH ROW EXECUTE FUNCTION enrichment_product_states_queue_all();

-- First deployment: the table is filled by the next sync (scripts/setup.ts runs one after the schema commits).
INSERT INTO enrichment_product_state_queue(product_id) SELECT '00000000-0000-0000-0000-000000000000'
 WHERE NOT EXISTS (SELECT 1 FROM enrichment_product_states) ON CONFLICT DO NOTHING;
