-- Add bsbg_products_id to product_mappings for DNMK ↔ BSBG matching
ALTER TABLE "v0"."product_mappings" ADD COLUMN "bsbg_products_id" BIGINT;

-- FK → v0.bsbg_products
ALTER TABLE "v0"."product_mappings" ADD CONSTRAINT "product_mappings_bsbg_products_id_fkey"
    FOREIGN KEY ("bsbg_products_id") REFERENCES "v0"."bsbg_products"("id")
    ON DELETE CASCADE;

-- Unique partial index: each bsbg product mapped at most once
CREATE UNIQUE INDEX "uq_product_mapping_bsbg"
    ON "v0"."product_mappings" ("bsbg_products_id")
    WHERE "bsbg_products_id" IS NOT NULL;

-- Add product_mapping_id to v0.products for back-link
ALTER TABLE "v0"."products" ADD COLUMN "product_mapping_id" BIGINT;

-- FK → v0.product_mappings
ALTER TABLE "v0"."products" ADD CONSTRAINT "products_product_mapping_id_fkey"
    FOREIGN KEY ("product_mapping_id") REFERENCES "v0"."product_mappings"("id")
    ON DELETE SET NULL;

-- Unique: each product_mapping produces at most one v0.product
CREATE UNIQUE INDEX "uq_v0_products_product_mapping"
    ON "v0"."products" ("product_mapping_id");

-- Index for lookups by product_mapping_id
CREATE INDEX "idx_v0_products_product_mapping"
    ON "v0"."products" ("product_mapping_id");

-- Index for bsbg lookups on product_mappings
CREATE INDEX "idx_product_mapping_bsbg"
    ON "v0"."product_mappings" ("bsbg_products_id");
