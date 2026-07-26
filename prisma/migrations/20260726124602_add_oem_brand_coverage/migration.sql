-- CreateTable
CREATE TABLE "catalog"."oem_brand_coverage" (
    "brand_id" INTEGER NOT NULL,
    "source_site" TEXT,
    "tecdoc_brand_id" INTEGER,
    "resolved_by" TEXT,
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oem_brand_coverage_pkey" PRIMARY KEY ("brand_id")
);

-- CreateIndex
CREATE INDEX "idx_oem_brand_coverage_source" ON "catalog"."oem_brand_coverage"("source_site");

-- AddForeignKey
ALTER TABLE "catalog"."oem_brand_coverage" ADD CONSTRAINT "oem_brand_coverage_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "catalog"."brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
