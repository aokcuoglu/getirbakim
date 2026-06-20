-- Make ptdrk_products_id nullable to support "approved without match" rows
ALTER TABLE "v0"."product_mappings" ALTER COLUMN "ptdrk_products_id" DROP NOT NULL;

-- Replace the unique index with a partial index so that NULL-ptdrk rows
-- (approved without match) don't conflict with each other.
DROP INDEX IF EXISTS "v0"."uq_product_mapping_pair";
CREATE UNIQUE INDEX "uq_product_mapping_pair"
    ON "v0"."product_mappings" ("dnmk_products_id", "ptdrk_products_id")
    WHERE "ptdrk_products_id" IS NOT NULL;

CREATE UNIQUE INDEX "uq_product_mapping_dnmk_approved_no_match"
    ON "v0"."product_mappings" ("dnmk_products_id")
    WHERE "ptdrk_products_id" IS NULL;
