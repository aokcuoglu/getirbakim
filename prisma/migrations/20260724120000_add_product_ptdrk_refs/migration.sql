-- CreateTable
CREATE TABLE "catalog"."product_ptdrk_refs" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "ptdrk_product_id" INTEGER NOT NULL,
    "matched_code" TEXT,
    "confidence" DECIMAL(4,3),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "product_ptdrk_refs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_ptdrk_ref_product" ON "catalog"."product_ptdrk_refs"("ptdrk_product_id");

-- CreateIndex
CREATE INDEX "product_ptdrk_refs_product_id_idx" ON "catalog"."product_ptdrk_refs"("product_id");

-- AddForeignKey
ALTER TABLE "catalog"."product_ptdrk_refs" ADD CONSTRAINT "product_ptdrk_refs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."product_ptdrk_refs" ADD CONSTRAINT "product_ptdrk_refs_ptdrk_product_id_fkey" FOREIGN KEY ("ptdrk_product_id") REFERENCES "catalog"."ptdrk_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
