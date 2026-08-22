-- CreateTable
CREATE TABLE "catalog"."rpa_lookup_log" (
    "product_id" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EMPTY',
    "oem_count" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "source_site" TEXT NOT NULL DEFAULT 'rpa-claude',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rpa_lookup_log_pkey" PRIMARY KEY ("product_id")
);

-- CreateIndex
CREATE INDEX "idx_rpa_lookup_log_status" ON "catalog"."rpa_lookup_log"("status");
