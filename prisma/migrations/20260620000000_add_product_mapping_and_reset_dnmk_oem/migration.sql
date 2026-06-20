-- CreateTable: v0.product_mappings (Dinamik ↔ ParçaTedarik product mapping)
CREATE TABLE "v0"."product_mappings" (
    "id" BIGSERIAL PRIMARY KEY,
    "brand_list_id" INTEGER NOT NULL,
    "dnmk_products_id" BIGINT NOT NULL,
    "ptdrk_products_id" INTEGER NOT NULL,
    "mapping_status" TEXT NOT NULL DEFAULT 'PENDING',
    "match_method" TEXT,
    "confidence" DECIMAL(5, 4),
    "oem_no" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMPTZ(6),
    "ignored_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- AddForeignKey: brand_list
ALTER TABLE "v0"."product_mappings"
    ADD CONSTRAINT "product_mappings_brand_list_id_fkey"
    FOREIGN KEY ("brand_list_id") REFERENCES "v0"."brand_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: dnmk_products
ALTER TABLE "v0"."product_mappings"
    ADD CONSTRAINT "product_mappings_dnmk_products_id_fkey"
    FOREIGN KEY ("dnmk_products_id") REFERENCES "v0"."dnmk_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: ptdrk_products
ALTER TABLE "v0"."product_mappings"
    ADD CONSTRAINT "product_mappings_ptdrk_products_id_fkey"
    FOREIGN KEY ("ptdrk_products_id") REFERENCES "v0"."ptdrk_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex: unique pair
CREATE UNIQUE INDEX "uq_product_mapping_pair"
    ON "v0"."product_mappings" ("dnmk_products_id", "ptdrk_products_id");

-- CreateIndex: status
CREATE INDEX "idx_product_mapping_status"
    ON "v0"."product_mappings" ("mapping_status");

-- CreateIndex: brand_list
CREATE INDEX "idx_product_mapping_brand_list"
    ON "v0"."product_mappings" ("brand_list_id");

-- CreateIndex: dnmk
CREATE INDEX "idx_product_mapping_dnmk"
    ON "v0"."product_mappings" ("dnmk_products_id");

-- CreateIndex: ptdrk
CREATE INDEX "idx_product_mapping_ptdrk"
    ON "v0"."product_mappings" ("ptdrk_products_id");

-- Reset OEM bridge data: clear all dnmk_products.oem_no so the new
-- bridge populate (ptdrk.ref_no → dnmk.oem_no) starts from a clean state.
UPDATE "v0"."dnmk_products" SET "oem_no" = NULL;