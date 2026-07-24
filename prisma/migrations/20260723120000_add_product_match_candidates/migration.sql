-- CreateTable
CREATE TABLE "catalog"."product_match_candidates" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "supplier_code" TEXT NOT NULL,
    "dinamik_product_id" BIGINT,
    "basbug_product_id" BIGINT,
    "match_method" TEXT NOT NULL,
    "matched_code" TEXT,
    "confidence" DECIMAL(4,3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(6),
    "reviewed_by" TEXT,

    CONSTRAINT "product_match_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_match_candidates_status_idx" ON "catalog"."product_match_candidates"("status");

-- CreateIndex
CREATE INDEX "product_match_candidates_product_id_idx" ON "catalog"."product_match_candidates"("product_id");

-- CreateIndex
CREATE INDEX "product_match_candidates_basbug_product_id_idx" ON "catalog"."product_match_candidates"("basbug_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_match_cand_basbug_product" ON "catalog"."product_match_candidates"("basbug_product_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_match_cand_dinamik_product" ON "catalog"."product_match_candidates"("dinamik_product_id", "product_id");

-- AddForeignKey
ALTER TABLE "catalog"."product_match_candidates" ADD CONSTRAINT "product_match_candidates_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."product_match_candidates" ADD CONSTRAINT "product_match_candidates_dinamik_product_id_fkey" FOREIGN KEY ("dinamik_product_id") REFERENCES "catalog"."supplier_dinamik_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."product_match_candidates" ADD CONSTRAINT "product_match_candidates_basbug_product_id_fkey" FOREIGN KEY ("basbug_product_id") REFERENCES "catalog"."supplier_basbug_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
