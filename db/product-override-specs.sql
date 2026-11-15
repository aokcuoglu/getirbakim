-- Admin-entered technical specifications of a product (#575, #603): a value set by hand for a key (replacing the
-- automatic value of the same key, or adding a key the enrichment does not give) and automatic keys hidden from the
-- store. They belong to the master product (every supplier row shows them). Supplier syncs, the matcher, enrichment
-- imports, fitment rebuilds and the storefront bundle never write this table; products.id differs between
-- environments, so the bundle carries none of it.
-- Keys are the enrichment's raw keys ("Fitting Position"), matched exactly (spec->>0=key) by the store's product page,
-- cards and catalog filters; src/modules/admin/product-spec-store.ts turns a Turkish label into the raw key on write.
CREATE TABLE IF NOT EXISTS product_override_specs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 -- set: the value shown for the key (the automatic rows of the key are replaced); hide: the key's automatic rows are left out.
 action text NOT NULL CHECK (action IN ('set','hide')),
 -- "|" separates key and value in the history text.
 key text NOT NULL CHECK (key=btrim(key) AND char_length(key) BETWEEN 1 AND 200 AND position('|' in key)=0),
 value text CHECK (value IS NULL OR (value=btrim(value) AND char_length(value) BETWEEN 1 AND 500)),
 -- Copied by a merge from this product (product_override_specs_carry); undoing the merge removes the row.
 carried_from uuid REFERENCES products(id) ON DELETE SET NULL,
 created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((action='set') = (value IS NOT NULL)),
 UNIQUE (product_id,key)
);
CREATE INDEX IF NOT EXISTS product_override_specs_carried_idx ON product_override_specs(carried_from) WHERE carried_from IS NOT NULL;
-- The catalog's attribute filter and facets read the rows of one key.
CREATE INDEX IF NOT EXISTS product_override_specs_key_idx ON product_override_specs(key,product_id);

-- "Aynı ürün" (product_merge): the kept product takes the merged product's specifications; where both have a row for
-- the same key, the kept product's row wins. Called by the merge actions next to product_override_references_carry.
-- Names are qualified: the parameters would otherwise be read as columns of the same name (42702).
CREATE OR REPLACE FUNCTION product_override_specs_carry(source uuid, target uuid, actor uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE added integer := 0; hid integer := 0;
BEGIN
 IF product_override_specs_carry.source IS NULL OR product_override_specs_carry.target IS NULL
  OR product_override_specs_carry.source=product_override_specs_carry.target THEN
  RETURN jsonb_build_object('set',0,'hidden',0);
 END IF;
 -- Serializes with the admin's changes (product-spec-store.ts locks the same row).
 PERFORM 1 FROM products p WHERE p.id=product_override_specs_carry.target FOR UPDATE;
 WITH copied AS (
  -- The source's created_at keeps the admin's order (one statement would give every copy the same now()).
  INSERT INTO product_override_specs(product_id,action,key,value,carried_from,created_by,created_at)
  SELECT product_override_specs_carry.target,o.action,o.key,o.value,product_override_specs_carry.source,product_override_specs_carry.actor,o.created_at
  FROM product_override_specs o WHERE o.product_id=product_override_specs_carry.source
  ORDER BY o.created_at,o.id
  ON CONFLICT (product_id,key) DO NOTHING
  RETURNING action,key,value), logged AS (
  INSERT INTO product_override_changes(product_id,field,old_value,new_value,changed_by,reason)
  SELECT product_override_specs_carry.target,CASE c.action WHEN 'set' THEN 'spec_set' ELSE 'spec_hidden' END,
   NULL,concat_ws('|',c.key,c.value),product_override_specs_carry.actor,'carry' FROM copied c
  RETURNING field)
 SELECT count(*) FILTER (WHERE field='spec_set'),count(*) FILTER (WHERE field='spec_hidden') INTO added,hid FROM logged;
 RETURN jsonb_build_object('set',added,'hidden',hid);
END $$;

-- A merged product revived (its merged_into cleared): the products it carried specifications into give them back. A
-- carried row the admin removed or changed (a change clears carried_from) stays; history says what left.
CREATE OR REPLACE FUNCTION product_override_specs_uncarry(source_id uuid) RETURNS void LANGUAGE sql AS $$
 WITH removed AS (DELETE FROM product_override_specs o WHERE o.carried_from=source_id RETURNING o.product_id,o.action,o.key,o.value)
 INSERT INTO product_override_changes(product_id,field,old_value,new_value,changed_by,reason)
 SELECT r.product_id,CASE r.action WHEN 'set' THEN 'spec_removed' ELSE 'spec_shown' END,
  concat_ws('|',r.key,r.value),NULL,NULL,'uncarry' FROM removed r;
$$;
CREATE OR REPLACE FUNCTION product_override_specs_restored() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM product_override_specs WHERE carried_from=NEW.id) THEN
  PERFORM product_override_specs_uncarry(NEW.id);
 END IF;
 RETURN NULL;
END $$;
-- Created only when missing (no DROP/CREATE lock on products on every setup); a changed definition needs a DROP first.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='products'::regclass AND tgname='product_override_specs_products_restored') THEN
  CREATE TRIGGER product_override_specs_products_restored AFTER UPDATE OF merged_into ON products FOR EACH ROW
   WHEN (OLD.merged_into IS NOT NULL AND NEW.merged_into IS NULL) EXECUTE FUNCTION product_override_specs_restored();
 END IF;
END $$;
