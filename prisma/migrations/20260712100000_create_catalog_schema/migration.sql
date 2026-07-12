-- Create the canonical `catalog` schema: unified sellable products built from
-- supplier raw rows (v0.dnmk_products / v0.bsbg_products), per-supplier offers,
-- normalized OEM/EAN codes, copied enrichment from public.parts, admin overrides.
-- Also drops the abandoned v1 experiment schema if present.

DROP SCHEMA IF EXISTS "v1" CASCADE;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "catalog";

-- CreateTable
CREATE TABLE "catalog"."suppliers" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "pricing_policy" JSONB,
    "config" JSONB,
    "last_offer_sync_at" TIMESTAMPTZ(6),

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "catalog"."products" (
    "id" BIGSERIAL NOT NULL,
    "brand_list_id" INTEGER NOT NULL,
    "part_no" TEXT NOT NULL,
    "part_no_norm" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "category_id" INTEGER,
    "primary_image_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "primary_part_id" BIGINT,
    "min_selling_price_try" DECIMAL(12,2),
    "total_stock_qty" INTEGER NOT NULL DEFAULT 0,
    "in_stock" BOOLEAN NOT NULL DEFAULT false,
    "offer_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_products_status" CHECK ("status" IN ('ACTIVE', 'DRAFT', 'HIDDEN', 'ARCHIVED'))
);

-- CreateTable
CREATE TABLE "catalog"."product_offers" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "supplier_code" TEXT NOT NULL,
    "dnmk_products_id" BIGINT,
    "bsbg_products_id" BIGINT,
    "supplier_sku" TEXT NOT NULL,
    "list_price" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "fx_rate" DECIMAL(18,6),
    "fx_date" DATE,
    "campaign_rate" DECIMAL(6,3),
    "cost_try" DECIMAL(12,2),
    "net_cost_try" DECIMAL(12,2),
    "selling_price_try" DECIMAL(12,2),
    "stock_qty" INTEGER NOT NULL DEFAULT 0,
    "stock_breakdown" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "priced_at" TIMESTAMPTZ(6),
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_offers_pkey" PRIMARY KEY ("id"),
    -- exactly one supplier provenance FK, and it must match supplier_code
    CONSTRAINT "ck_offers_supplier_fk" CHECK (
        ("supplier_code" = 'dinamik' AND "dnmk_products_id" IS NOT NULL AND "bsbg_products_id" IS NULL) OR
        ("supplier_code" = 'basbug' AND "bsbg_products_id" IS NOT NULL AND "dnmk_products_id" IS NULL)
    )
);

-- CreateTable
CREATE TABLE "catalog"."product_oems" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "code_norm" TEXT NOT NULL,
    "oem_brand" TEXT,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_oems_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_product_oems_source" CHECK ("source" IN ('BSBG', 'DNMK', 'PARTS', 'MANUAL'))
);

-- CreateTable
CREATE TABLE "catalog"."product_eans" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "product_eans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."product_images" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "url" TEXT NOT NULL,
    "thumb" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."product_properties" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'PARTS',

    CONSTRAINT "product_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."product_vehicle_types" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "vehicle_type_id" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'PARTS',

    CONSTRAINT "product_vehicle_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."product_part_links" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "part_id" BIGINT NOT NULL,
    "match_method" TEXT NOT NULL,
    "matched_code" TEXT,
    "confidence" DECIMAL(4,3),
    "status" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(6),
    "reviewed_by" TEXT,

    CONSTRAINT "product_part_links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_product_part_links_status" CHECK ("status" IN ('CANDIDATE', 'APPROVED', 'REJECTED')),
    CONSTRAINT "ck_product_part_links_method" CHECK ("match_method" IN ('OEM', 'PART_NO', 'CROSS_REF', 'EAN', 'MANUAL'))
);

-- CreateTable
CREATE TABLE "catalog"."product_overrides" (
    "product_id" BIGINT NOT NULL,
    "selling_price_override" DECIMAL(12,2),
    "lock_price" BOOLEAN NOT NULL DEFAULT false,
    "name_override" TEXT,
    "category_override_id" INTEGER,
    "note" TEXT,
    "updated_by" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_overrides_pkey" PRIMARY KEY ("product_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "catalog"."products"("slug");
CREATE INDEX "products_part_no_norm_idx" ON "catalog"."products"("part_no_norm");
CREATE INDEX "products_status_idx" ON "catalog"."products"("status");
CREATE INDEX "products_category_id_status_idx" ON "catalog"."products"("category_id", "status");
CREATE INDEX "products_brand_list_id_status_idx" ON "catalog"."products"("brand_list_id", "status");
CREATE INDEX "products_in_stock_status_idx" ON "catalog"."products"("in_stock", "status");
CREATE INDEX "products_primary_part_id_idx" ON "catalog"."products"("primary_part_id");
CREATE INDEX "products_updated_at_idx" ON "catalog"."products"("updated_at");
CREATE UNIQUE INDEX "uq_products_brand_partno_norm" ON "catalog"."products"("brand_list_id", "part_no_norm");

-- CreateIndex
CREATE UNIQUE INDEX "uq_offers_dnmk_product" ON "catalog"."product_offers"("dnmk_products_id");
CREATE UNIQUE INDEX "uq_offers_bsbg_product" ON "catalog"."product_offers"("bsbg_products_id");
CREATE INDEX "product_offers_supplier_code_is_active_idx" ON "catalog"."product_offers"("supplier_code", "is_active");
CREATE INDEX "product_offers_supplier_code_last_synced_at_idx" ON "catalog"."product_offers"("supplier_code", "last_synced_at");
CREATE INDEX "product_offers_is_active_stock_qty_idx" ON "catalog"."product_offers"("is_active", "stock_qty");
CREATE UNIQUE INDEX "uq_offers_product_supplier" ON "catalog"."product_offers"("product_id", "supplier_code");

-- CreateIndex
CREATE INDEX "product_oems_code_norm_idx" ON "catalog"."product_oems"("code_norm");
CREATE INDEX "product_oems_source_idx" ON "catalog"."product_oems"("source");
CREATE UNIQUE INDEX "uq_product_oems_product_code" ON "catalog"."product_oems"("product_id", "code_norm");

-- CreateIndex
CREATE INDEX "product_eans_code_idx" ON "catalog"."product_eans"("code");
CREATE UNIQUE INDEX "uq_product_eans_product_code" ON "catalog"."product_eans"("product_id", "code");

-- CreateIndex
CREATE INDEX "product_images_product_id_position_idx" ON "catalog"."product_images"("product_id", "position");
CREATE UNIQUE INDEX "uq_product_images_product_url" ON "catalog"."product_images"("product_id", "url");

-- CreateIndex
CREATE UNIQUE INDEX "uq_product_properties_product_key" ON "catalog"."product_properties"("product_id", "key");

-- CreateIndex
CREATE INDEX "product_vehicle_types_vehicle_type_id_product_id_idx" ON "catalog"."product_vehicle_types"("vehicle_type_id", "product_id");
CREATE UNIQUE INDEX "uq_product_vehicle_types" ON "catalog"."product_vehicle_types"("product_id", "vehicle_type_id");

-- CreateIndex
CREATE INDEX "product_part_links_part_id_idx" ON "catalog"."product_part_links"("part_id");
CREATE INDEX "product_part_links_status_idx" ON "catalog"."product_part_links"("status");
CREATE UNIQUE INDEX "uq_product_part_links" ON "catalog"."product_part_links"("product_id", "part_id");

-- AddForeignKey
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_brand_list_id_fkey" FOREIGN KEY ("brand_list_id") REFERENCES "v0"."brand_list"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."part_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_primary_part_id_fkey" FOREIGN KEY ("primary_part_id") REFERENCES "public"."parts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."product_offers" ADD CONSTRAINT "product_offers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog"."product_offers" ADD CONSTRAINT "product_offers_supplier_code_fkey" FOREIGN KEY ("supplier_code") REFERENCES "catalog"."suppliers"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "catalog"."product_offers" ADD CONSTRAINT "product_offers_dnmk_products_id_fkey" FOREIGN KEY ("dnmk_products_id") REFERENCES "v0"."dnmk_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog"."product_offers" ADD CONSTRAINT "product_offers_bsbg_products_id_fkey" FOREIGN KEY ("bsbg_products_id") REFERENCES "v0"."bsbg_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."product_oems" ADD CONSTRAINT "product_oems_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog"."product_eans" ADD CONSTRAINT "product_eans_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog"."product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog"."product_properties" ADD CONSTRAINT "product_properties_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog"."product_vehicle_types" ADD CONSTRAINT "product_vehicle_types_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog"."product_vehicle_types" ADD CONSTRAINT "product_vehicle_types_vehicle_type_id_fkey" FOREIGN KEY ("vehicle_type_id") REFERENCES "v0"."vtypes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog"."product_part_links" ADD CONSTRAINT "product_part_links_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog"."product_part_links" ADD CONSTRAINT "product_part_links_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog"."product_overrides" ADD CONSTRAINT "product_overrides_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the supplier registry. pricing_policy stays NULL until configured in
-- admin (NULL resolves to the zero-markup DEFAULT_PRICING_POLICY).
INSERT INTO "catalog"."suppliers" ("code", "name")
VALUES ('dinamik', 'Dinamik Oto'), ('basbug', 'Başbuğ Otomotiv')
ON CONFLICT ("code") DO NOTHING;
