-- Admin decisions about the vehicles a product fits (#575, #583): an engine type added by hand (shown and searched like
-- an automatic fitment, also on a product without enrichment, and kept if the automatic source later drops it) and an
-- automatic fitment removed from the store. They belong to the master product (every supplier row follows them).
-- Supplier syncs, the matcher, enrichment imports, fitment rebuilds (rebuild-product-fitments.ts, fitment-sync.ts), the
-- vehicle catalog import and the storefront bundle never write this table: they write product_vehicle_fitments, which
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
CREATE INDEX IF NOT EXISTS product_override_fitments_type_idx ON product_override_fitments(vehicle_type_id,product_id);
CREATE INDEX IF NOT EXISTS product_override_fitments_carried_idx ON product_override_fitments(carried_from) WHERE carried_from IS NOT NULL;

-- "Aynı ürün" (product_merge): the kept product takes the merged product's decisions; where both decided the same
-- type, the kept product's row wins. Called by the merge actions next to product_override_specs_carry. History values
-- are the type id. Names are qualified: the parameters would otherwise be read as columns of the same name (42702).
CREATE OR REPLACE FUNCTION product_override_fitments_carry(source uuid, target uuid, actor uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE added integer := 0; removed integer := 0;
BEGIN
 IF product_override_fitments_carry.source IS NULL OR product_override_fitments_carry.target IS NULL
  OR product_override_fitments_carry.source=product_override_fitments_carry.target THEN
  RETURN jsonb_build_object('added',0,'removed',0);
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
 RETURN jsonb_build_object('added',added,'removed',removed);
END $$;

-- A merged product revived (its merged_into cleared): the products it carried decisions into give them back. A carried
-- row the admin removed stays removed; history says what left.
CREATE OR REPLACE FUNCTION product_override_fitments_uncarry(source_id uuid) RETURNS void LANGUAGE sql AS $$
 WITH removed AS (DELETE FROM product_override_fitments o WHERE o.carried_from=source_id RETURNING o.product_id,o.mode,o.vehicle_type_id)
 INSERT INTO product_override_changes(product_id,field,old_value,new_value,changed_by,reason)
 SELECT r.product_id,CASE r.mode WHEN 'add' THEN 'fitment_unadded' ELSE 'fitment_restored' END,
  r.vehicle_type_id::text,NULL,NULL,'uncarry' FROM removed r;
$$;
CREATE OR REPLACE FUNCTION product_override_fitments_restored() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM product_override_fitments WHERE carried_from=NEW.id) THEN
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
