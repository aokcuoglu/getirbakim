-- Deleted and invalidated enrichments (#564). The storefront sync (scripts/sync-storefront-production.ts) carries
-- enrichments by imported_at, so a row deleted here, or one whose job left complete/partial, would never reach the
-- target. Every such change is logged with the supplier item's natural key (ids differ between environments, see
-- scripts/storefront-bundle-items.ts); scripts/storefront-bundle-tombstones.ts exports and applies the log.
-- No foreign key: the log must outlive the supplier item. Rows older than the retention are pruned by the sync.
CREATE TABLE IF NOT EXISTS product_enrichment_tombstones (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 supplier_item_id uuid NOT NULL,
 supplier text NOT NULL, company text NOT NULL, list_group text NOT NULL, warehouse text NOT NULL, code text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('enrichment_deleted','job_invalidated')),
 source_method text,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_enrichment_tombstones_recorded_idx ON product_enrichment_tombstones(recorded_at);

-- A supplier item deleted with its enrichment (ON DELETE CASCADE) is no longer visible here, so nothing is logged:
-- the target's supplier sync owns the item's existence, not the storefront sync.
CREATE OR REPLACE FUNCTION product_enrichment_tombstone_log() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 item record;
 method text;
BEGIN
 SELECT s.supplier,s.company,s.list_group,s.warehouse,s.code INTO item FROM supplier_items s WHERE s.id=OLD.supplier_item_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF TG_TABLE_NAME='product_enrichments' THEN
  INSERT INTO product_enrichment_tombstones(supplier_item_id,supplier,company,list_group,warehouse,code,kind,source_method)
  VALUES (OLD.supplier_item_id,item.supplier,item.company,item.list_group,item.warehouse,item.code,'enrichment_deleted',OLD.source_method);
 ELSE
  SELECT e.source_method INTO method FROM product_enrichments e WHERE e.supplier_item_id=OLD.supplier_item_id;
  INSERT INTO product_enrichment_tombstones(supplier_item_id,supplier,company,list_group,warehouse,code,kind,source_method)
  VALUES (OLD.supplier_item_id,item.supplier,item.company,item.list_group,item.warehouse,item.code,'job_invalidated',method);
 END IF;
 RETURN NULL;
END $$;

-- Created only when missing: CREATE [OR REPLACE] TRIGGER locks the table against writers (SHARE ROW EXCLUSIVE) until setup
-- commits. A changed function body needs only its CREATE OR REPLACE FUNCTION; a changed trigger definition needs a
-- DROP TRIGGER in the same change.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='product_enrichments'::regclass AND tgname='product_enrichment_tombstone_delete') THEN
  CREATE TRIGGER product_enrichment_tombstone_delete AFTER DELETE ON product_enrichments
   FOR EACH ROW EXECUTE FUNCTION product_enrichment_tombstone_log();
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='product_enrichment_jobs'::regclass AND tgname='product_enrichment_job_tombstone_update') THEN
  CREATE TRIGGER product_enrichment_job_tombstone_update AFTER UPDATE OF status ON product_enrichment_jobs
   FOR EACH ROW WHEN (OLD.status IN ('complete','partial') AND NEW.status NOT IN ('complete','partial'))
   EXECUTE FUNCTION product_enrichment_tombstone_log();
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='product_enrichment_jobs'::regclass AND tgname='product_enrichment_job_tombstone_delete') THEN
  CREATE TRIGGER product_enrichment_job_tombstone_delete AFTER DELETE ON product_enrichment_jobs
   FOR EACH ROW WHEN (OLD.status IN ('complete','partial'))
   EXECUTE FUNCTION product_enrichment_tombstone_log();
 END IF;
END $$;
