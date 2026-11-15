-- Admin-entered reference numbers of a product (#575, #582): OEM numbers, cross-reference (competitor) codes and
-- barcodes added by hand, and automatic (enrichment) OEM / cross-reference numbers hidden from the store. They belong
-- to the master product (every supplier row shows them). Supplier syncs, the matcher, enrichment imports, fitment
-- rebuilds and the storefront bundle never write this table; products.id differs between environments, so the bundle
-- carries none of it.
-- Keys are part_number_key() of the typed text (db/commerce.sql), the key compactPartNumber
-- (src/modules/store/reference-links.ts) and the store's reference links use.
CREATE TABLE IF NOT EXISTS product_override_references (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('oem','cross','ean')),
 -- add: shown in the store and found by search; hide: an automatic number of the same key is left out.
 action text NOT NULL CHECK (action IN ('add','hide')),
 -- OEM: the vehicle make ("VW"); cross: the part maker ("BOSCH"); a barcode has none.
 brand text NOT NULL DEFAULT '' CHECK (char_length(brand)<=80),
 number text NOT NULL CHECK (char_length(number) BETWEEN 3 AND 60),
 brand_key text GENERATED ALWAYS AS (part_number_key(brand)) STORED,
 number_key text GENERATED ALWAYS AS (part_number_key(number)) STORED,
 -- Copied by a merge from this product (product_override_references_carry); undoing the merge removes the row.
 carried_from uuid REFERENCES products(id) ON DELETE SET NULL,
 created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (char_length(number_key)>=3),
 -- Barcodes are added only (supplier barcodes are not shown, so there is nothing to hide) and are digits.
 CHECK (kind<>'ean' OR (action='add' AND brand='' AND number_key ~ '^[0-9]{8,14}$')),
 CHECK (kind='ean' OR brand_key<>''),
 UNIQUE (product_id,kind,brand_key,number_key)
);
CREATE INDEX IF NOT EXISTS product_override_references_carried_idx ON product_override_references(carried_from) WHERE carried_from IS NOT NULL;

-- "Aynı ürün" (product_merge): the kept product takes the merged product's numbers; where both have a row for the same
-- number, the kept product's row wins. Called by the merge actions next to product_override_images_carry.
-- Names are qualified: the parameters would otherwise be read as columns of the same name (42702).
CREATE OR REPLACE FUNCTION product_override_references_carry(source uuid, target uuid, actor uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE added integer := 0; hid integer := 0;
BEGIN
 IF product_override_references_carry.source IS NULL OR product_override_references_carry.target IS NULL
  OR product_override_references_carry.source=product_override_references_carry.target THEN
  RETURN jsonb_build_object('added',0,'hidden',0);
 END IF;
 -- Serializes with the admin's changes (product-reference-store.ts locks the same row).
 PERFORM 1 FROM products p WHERE p.id=product_override_references_carry.target FOR UPDATE;
 WITH copied AS (
  INSERT INTO product_override_references(product_id,kind,action,brand,number,carried_from,created_by)
  SELECT product_override_references_carry.target,r.kind,r.action,r.brand,r.number,
   product_override_references_carry.source,product_override_references_carry.actor
  FROM product_override_references r WHERE r.product_id=product_override_references_carry.source
  ORDER BY r.created_at,r.id
  ON CONFLICT (product_id,kind,brand_key,number_key) DO NOTHING
  RETURNING kind,action,brand,number), logged AS (
  INSERT INTO product_override_changes(product_id,field,old_value,new_value,changed_by,reason)
  SELECT product_override_references_carry.target,CASE c.action WHEN 'add' THEN 'reference_added' ELSE 'reference_hidden' END,
   NULL,concat_ws('|',c.kind,c.brand,c.number),product_override_references_carry.actor,'carry' FROM copied c
  RETURNING field)
 SELECT count(*) FILTER (WHERE field='reference_added'),count(*) FILTER (WHERE field='reference_hidden') INTO added,hid FROM logged;
 RETURN jsonb_build_object('added',added,'hidden',hid);
END $$;

-- A merged product revived (its merged_into cleared): the products it carried numbers into give them back. A carried
-- row the admin removed is gone already; history says what left.
CREATE OR REPLACE FUNCTION product_override_references_uncarry(source_id uuid) RETURNS void LANGUAGE sql AS $$
 WITH removed AS (DELETE FROM product_override_references r WHERE r.carried_from=source_id RETURNING r.product_id,r.kind,r.action,r.brand,r.number)
 INSERT INTO product_override_changes(product_id,field,old_value,new_value,changed_by,reason)
 SELECT r.product_id,CASE r.action WHEN 'add' THEN 'reference_removed' ELSE 'reference_shown' END,
  concat_ws('|',r.kind,r.brand,r.number),NULL,NULL,'uncarry' FROM removed r;
$$;
CREATE OR REPLACE FUNCTION product_override_references_restored() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM product_override_references WHERE carried_from=NEW.id) THEN
  PERFORM product_override_references_uncarry(NEW.id);
 END IF;
 RETURN NULL;
END $$;
-- Created only when missing (no DROP/CREATE lock on products on every setup); a changed definition needs a DROP first.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='products'::regclass AND tgname='product_override_references_products_restored') THEN
  CREATE TRIGGER product_override_references_products_restored AFTER UPDATE OF merged_into ON products FOR EACH ROW
   WHEN (OLD.merged_into IS NOT NULL AND NEW.merged_into IS NULL) EXECUTE FUNCTION product_override_references_restored();
 END IF;
END $$;
