-- Admin-uploaded product images (#575, #581). They belong to the master product (all of its supplier rows show them)
-- and come before the automatic enrichment image; the smallest position is the primary image. Supplier syncs, the
-- matcher, enrichment imports, fitment rebuilds and the storefront bundle never write these tables. Uploads live in the
-- environment where they were made: products.id differs between environments, so the bundle carries none of them.
-- Deleting an image removes only its row here; the media object and its stored bytes stay (#597 collects them).
CREATE TABLE IF NOT EXISTS product_override_images (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 media_id uuid NOT NULL REFERENCES product_media_objects(id),
 position integer NOT NULL CHECK (position>=0),
 width integer NOT NULL CHECK (width>0),
 height integer NOT NULL CHECK (height>0),
 file_name text NOT NULL DEFAULT '' CHECK (char_length(file_name)<=200),
 -- Copied by a merge from this product (product_override_images_carry); NULL once an admin changes the gallery.
 carried_from uuid REFERENCES products(id) ON DELETE SET NULL,
 created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (product_id,media_id)
);
CREATE INDEX IF NOT EXISTS product_override_images_product_idx ON product_override_images(product_id,position,id);
CREATE INDEX IF NOT EXISTS product_override_images_media_idx ON product_override_images(media_id);
CREATE INDEX IF NOT EXISTS product_override_images_carried_idx ON product_override_images(carried_from) WHERE carried_from IS NOT NULL;

-- "Otomatik görseli mağazada gizle": a row exists only while hide_automatic is true.
CREATE TABLE IF NOT EXISTS product_override_image_settings (
 product_id uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
 hide_automatic boolean NOT NULL DEFAULT false,
 -- Set by a merge from this product; NULL once an admin changes the gallery.
 hide_carried_from uuid REFERENCES products(id) ON DELETE SET NULL,
 updated_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_override_image_settings_carried_idx ON product_override_image_settings(hide_carried_from) WHERE hide_carried_from IS NOT NULL;

-- "Aynı ürün" (product_merge): the kept product takes the merged product's uploads when it has none of its own, and
-- its hidden automatic image when it shows its own. Called by the merge actions next to product_overrides_carry; `kept`
-- says the merged product had uploads that were not copied because the kept product has its own.
-- Names are qualified: the parameters would otherwise be read as columns of the same name (42702).
CREATE OR REPLACE FUNCTION product_override_images_carry(source uuid, target uuid, actor uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE copied integer := 0; hid boolean := false; kept boolean := false;
BEGIN
 IF product_override_images_carry.source IS NULL OR product_override_images_carry.target IS NULL
  OR product_override_images_carry.source=product_override_images_carry.target THEN
  RETURN jsonb_build_object('images',0,'hide_automatic',false,'kept',false);
 END IF;
 -- Serializes with the admin's gallery changes (product-image-store.ts locks the same row).
 PERFORM 1 FROM products p WHERE p.id=product_override_images_carry.target FOR UPDATE;
 IF NOT EXISTS (SELECT 1 FROM product_override_images i WHERE i.product_id=product_override_images_carry.target) THEN
  WITH copied_rows AS (
   INSERT INTO product_override_images(product_id,media_id,position,width,height,file_name,carried_from,created_by)
   SELECT product_override_images_carry.target,i.media_id,i.position,i.width,i.height,i.file_name,
    product_override_images_carry.source,product_override_images_carry.actor
   FROM product_override_images i WHERE i.product_id=product_override_images_carry.source
   RETURNING file_name)
  INSERT INTO product_override_changes(product_id,field,old_value,new_value,changed_by,reason)
  SELECT product_override_images_carry.target,'image_added',NULL,c.file_name,product_override_images_carry.actor,'carry' FROM copied_rows c;
  GET DIAGNOSTICS copied = ROW_COUNT;
 ELSE
  kept := EXISTS (SELECT 1 FROM product_override_images i WHERE i.product_id=product_override_images_carry.source);
 END IF;
 IF EXISTS (SELECT 1 FROM product_override_image_settings st WHERE st.product_id=product_override_images_carry.source AND st.hide_automatic)
  AND NOT EXISTS (SELECT 1 FROM product_override_image_settings st WHERE st.product_id=product_override_images_carry.target AND st.hide_automatic) THEN
  INSERT INTO product_override_image_settings(product_id,hide_automatic,hide_carried_from,updated_by)
  VALUES (product_override_images_carry.target,true,product_override_images_carry.source,product_override_images_carry.actor)
  ON CONFLICT (product_id) DO UPDATE SET hide_automatic=true,hide_carried_from=excluded.hide_carried_from,
   updated_by=excluded.updated_by,updated_at=now();
  INSERT INTO product_override_changes(product_id,field,old_value,new_value,changed_by,reason)
  VALUES (product_override_images_carry.target,'auto_image_hidden',NULL,'true',product_override_images_carry.actor,'carry');
  hid := true;
 END IF;
 RETURN jsonb_build_object('images',copied,'hide_automatic',hid,'kept',kept);
END $$;

-- A merged product revived (its merged_into cleared): the products it carried images or the hidden automatic image
-- into give them back, unless an admin changed their gallery since (that cleared carried_from / hide_carried_from).
CREATE OR REPLACE FUNCTION product_override_images_uncarry(source_id uuid) RETURNS void LANGUAGE sql AS $$
 WITH removed AS (DELETE FROM product_override_images i WHERE i.carried_from=source_id RETURNING i.product_id,i.file_name)
 INSERT INTO product_override_changes(product_id,field,old_value,new_value,changed_by,reason)
 SELECT r.product_id,'image_removed',r.file_name,NULL,NULL,'uncarry' FROM removed r;
 WITH shown AS (DELETE FROM product_override_image_settings st WHERE st.hide_carried_from=source_id RETURNING st.product_id)
 INSERT INTO product_override_changes(product_id,field,old_value,new_value,changed_by,reason)
 SELECT s.product_id,'auto_image_hidden','true',NULL,NULL,'uncarry' FROM shown s;
$$;
CREATE OR REPLACE FUNCTION product_override_images_restored() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM product_override_images WHERE carried_from=NEW.id)
  OR EXISTS (SELECT 1 FROM product_override_image_settings WHERE hide_carried_from=NEW.id) THEN
  PERFORM product_override_images_uncarry(NEW.id);
 END IF;
 RETURN NULL;
END $$;
-- Created only when missing (no DROP/CREATE lock on products on every setup); a changed definition needs a DROP first.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='products'::regclass AND tgname='product_override_images_products_restored') THEN
  CREATE TRIGGER product_override_images_products_restored AFTER UPDATE OF merged_into ON products FOR EACH ROW
   WHEN (OLD.merged_into IS NOT NULL AND NEW.merged_into IS NULL) EXECUTE FUNCTION product_override_images_restored();
 END IF;
END $$;
