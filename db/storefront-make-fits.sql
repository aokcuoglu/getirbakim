-- The vehicle makes each storefront offer fits (#455), for /car-parts/<make>. A fitment counts only while it agrees
-- with the vehicle at the same index of the donor's current, trusted enrichment payload. Computed per make on each
-- read, that comparison ran over every fitment of the make (VW: 788k) and took 20-57 s on RDS for the large makes.
-- product_enrichment_shared_refresh() recomputes the offers in its scope right after their links (no queue of its
-- own); fitment and vehicle catalog changes reach it through product_enrichment_shared_queue (triggers below).
CREATE TABLE IF NOT EXISTS storefront_make_fits (
 brand_id integer NOT NULL REFERENCES vehicle_brands(id) ON DELETE CASCADE,
 supplier_item_id uuid NOT NULL REFERENCES product_enrichment_shared_links(supplier_item_id) ON DELETE CASCADE,
 PRIMARY KEY (brand_id, supplier_item_id)
);
CREATE INDEX IF NOT EXISTS storefront_make_fits_item_idx ON storefront_make_fits(supplier_item_id);

-- NULL recomputes every offer. The payload's vehicles are read once per offer (MATERIALIZED), not per fitment.
-- EXECUTE plans each call afresh: a scoped plan is never reused for the whole catalog.
CREATE OR REPLACE FUNCTION storefront_make_fits_refresh(item_ids uuid[] DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE changed integer;
BEGIN
 -- The whole catalog hashes ~1M fitment rows with their vehicle objects; 4 MB (the default) spills to disk.
 PERFORM set_config('work_mem','64MB',true);
 EXECUTE $sql$CREATE TEMP TABLE make_fits_computed ON COMMIT DROP AS
  WITH vehicles AS MATERIALIZED (
   SELECT l.supplier_item_id,l.donor_item_id,e.payload->'vehicles' AS vehicles
   FROM product_enrichment_shared_links l
   JOIN product_enrichments e ON e.supplier_item_id=l.donor_item_id
   JOIN supplier_items s ON s.id=l.supplier_item_id AND s.code=l.supplier_code AND s.product_data->>'uk'=l.supplier_brand
   WHERE ($1::uuid[] IS NULL OR l.supplier_item_id=ANY($1))
    AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=l.donor_oem))
  SELECT DISTINCT m.brand_id,t.supplier_item_id
  FROM vehicles t
  JOIN product_vehicle_fitments f ON f.supplier_item_id=t.donor_item_id AND f.vehicle_type_id IS NOT NULL
  JOIN vehicle_types v ON v.id=f.vehicle_type_id
  JOIN vehicle_models m ON m.id=v.model_id
  WHERE f.source_vehicle=t.vehicles->f.source_index$sql$ USING item_ids;
 WITH inserted AS (
  INSERT INTO storefront_make_fits(brand_id,supplier_item_id) SELECT brand_id,supplier_item_id FROM make_fits_computed
  ON CONFLICT DO NOTHING RETURNING 1
 ), removed AS (
  DELETE FROM storefront_make_fits f WHERE (item_ids IS NULL OR f.supplier_item_id=ANY(item_ids))
   AND NOT EXISTS (SELECT 1 FROM make_fits_computed c WHERE c.brand_id=f.brand_id AND c.supplier_item_id=f.supplier_item_id)
  RETURNING 1
 )
 SELECT (SELECT count(*) FROM inserted)+(SELECT count(*) FROM removed) INTO changed;
 DROP TABLE make_fits_computed;
 IF item_ids IS NULL THEN ANALYZE storefront_make_fits; END IF;
 RETURN changed;
END $$;

-- A fitment belongs to its donor item: the refresh resolves the item to its product and every offer sharing it.
DROP TRIGGER IF EXISTS enrichment_shared_fitments_insert ON product_vehicle_fitments;
CREATE TRIGGER enrichment_shared_fitments_insert AFTER INSERT ON product_vehicle_fitments
 REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION product_enrichment_shared_queue_items();
DROP TRIGGER IF EXISTS enrichment_shared_fitments_update ON product_vehicle_fitments;
CREATE TRIGGER enrichment_shared_fitments_update AFTER UPDATE ON product_vehicle_fitments
 REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION product_enrichment_shared_queue_items();
DROP TRIGGER IF EXISTS enrichment_shared_fitments_delete ON product_vehicle_fitments;
CREATE TRIGGER enrichment_shared_fitments_delete AFTER DELETE ON product_vehicle_fitments
 REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION product_enrichment_shared_queue_items();

-- A type or model moving to another make touches every offer fitted to it: rebuild (rare, catalog imports).
DROP TRIGGER IF EXISTS enrichment_shared_vehicle_types_update ON vehicle_types;
CREATE TRIGGER enrichment_shared_vehicle_types_update AFTER UPDATE OF model_id ON vehicle_types FOR EACH ROW
 WHEN (OLD.model_id IS DISTINCT FROM NEW.model_id) EXECUTE FUNCTION product_enrichment_shared_queue_all();
DROP TRIGGER IF EXISTS enrichment_shared_vehicle_models_update ON vehicle_models;
CREATE TRIGGER enrichment_shared_vehicle_models_update AFTER UPDATE OF brand_id ON vehicle_models FOR EACH ROW
 WHEN (OLD.brand_id IS DISTINCT FROM NEW.brand_id) EXECUTE FUNCTION product_enrichment_shared_queue_all();

-- The first deployment fills the table: an empty one asks for a rebuild (scripts/setup.ts syncs after the schema).
INSERT INTO product_enrichment_shared_queue(kind,id) SELECT 'p','00000000-0000-0000-0000-000000000000'
 WHERE NOT EXISTS (SELECT 1 FROM storefront_make_fits) ON CONFLICT DO NOTHING;
