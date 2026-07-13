-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "catalog";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "trodo";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "v0";

-- CreateTable
CREATE TABLE "engines" (
    "id" INTEGER NOT NULL,
    "fuel_type_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_types" (
    "id" INTEGER NOT NULL,
    "vehicle_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fuel_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "makes" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "url_key" TEXT,
    "is_popular" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "makes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "models" (
    "id" INTEGER NOT NULL,
    "make_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "year_from" INTEGER,
    "year_to" INTEGER,
    "url_key" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "part_id" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_payments" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "provider_conversation_id" TEXT,
    "status" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "raw_payload" JSONB,
    "paid_at" TIMESTAMP(6),
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT,
    "guest_name" TEXT,
    "guest_email" TEXT,
    "guest_phone" TEXT,
    "subtotal_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "shipping_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "status" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
    "payment_status" TEXT NOT NULL DEFAULT 'PENDING',
    "shipping_method" TEXT,
    "payment_method" TEXT,
    "shipping_address_json" JSONB,
    "note" TEXT,
    "last_payment_error" TEXT,
    "stock_released_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_requests" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT,
    "request_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "source" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "part_id" BIGINT,
    "part_name_snapshot" TEXT,
    "brand_name_snapshot" TEXT,
    "category_name_snapshot" TEXT,
    "page_url" TEXT,
    "locale" TEXT,
    "vehicle_json" JSONB,
    "search_query" TEXT,
    "requested_sku_or_oem" TEXT,
    "message" TEXT,
    "admin_note" TEXT,
    "assigned_to" TEXT,
    "resolved_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "customer_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_brands" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "logo_url" TEXT,

    CONSTRAINT "part_brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_categories" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "has_childs" BOOLEAN NOT NULL DEFAULT false,
    "parent_id" INTEGER,
    "name_tr" TEXT,
    "url_key" TEXT,
    "is_main_nav" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,

    CONSTRAINT "part_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_cross_references" (
    "id" SERIAL NOT NULL,
    "brand_name" TEXT NOT NULL,
    "article_number" TEXT NOT NULL,
    "part_id" BIGINT NOT NULL,

    CONSTRAINT "part_cross_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_documents" (
    "id" SERIAL NOT NULL,
    "doc_file_name" TEXT NOT NULL,
    "doc_file_type_name" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "doc_type_id" INTEGER NOT NULL,
    "doc_type_name" TEXT NOT NULL,
    "doc_url" TEXT,
    "part_id" BIGINT NOT NULL,

    CONSTRAINT "part_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_eans" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "part_id" BIGINT NOT NULL,

    CONSTRAINT "part_eans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_images" (
    "id" SERIAL NOT NULL,
    "image" TEXT,
    "thumb" TEXT,
    "part_id" BIGINT NOT NULL,

    CONSTRAINT "part_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_infos" (
    "id" SERIAL NOT NULL,
    "content" TEXT NOT NULL,
    "part_id" BIGINT NOT NULL,

    CONSTRAINT "part_infos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_oens" (
    "id" SERIAL NOT NULL,
    "brand" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "part_id" BIGINT NOT NULL,

    CONSTRAINT "part_oens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_properties" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "part_id" BIGINT NOT NULL,

    CONSTRAINT "part_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_vehicle_types" (
    "id" SERIAL NOT NULL,
    "part_id" BIGINT NOT NULL,
    "vehicle_type_id" INTEGER NOT NULL,

    CONSTRAINT "part_vehicle_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parts" (
    "id" BIGINT NOT NULL,
    "tecdoc_article_id" BIGINT,
    "name" TEXT NOT NULL,
    "part_no" BIGINT,
    "article_link_id" BIGINT NOT NULL,
    "price" DECIMAL(10,2),
    "in_basket" BOOLEAN NOT NULL DEFAULT false,
    "brand_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_vehicles" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "vehicle_data" JSONB NOT NULL,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "password_hash" TEXT,
    "image" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,
    "role" TEXT DEFAULT 'CUSTOMER',

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" BIGSERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "read_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" INTEGER NOT NULL,
    "model_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "year_from" INTEGER,
    "year_to" INTEGER,
    "url_key" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrape_progress" (
    "id" SERIAL NOT NULL,
    "vehicle_type_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,
    "parts_count" INTEGER NOT NULL DEFAULT 0,
    "scraped_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scrape_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oil_capacities" (
    "id" SERIAL NOT NULL,
    "vehicle_type_id" INTEGER NOT NULL,
    "brand" TEXT NOT NULL,
    "capacity" TEXT,
    "viscosity1" TEXT,
    "viscosity2" TEXT,
    "viscosity3" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oil_capacities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trodo"."variants" (
    "id" INTEGER NOT NULL,
    "engine_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "year_from" INTEGER,
    "year_to" INTEGER,
    "ccm" TEXT,
    "kw_ps" TEXT,
    "engine_code" TEXT,
    "url_key" TEXT,
    "tecdoc_id" INTEGER,
    "magento_id" INTEGER,
    "tags" TEXT,
    "popularity_order" INTEGER,
    "is_popular" BOOLEAN DEFAULT false,
    "dropdown_id" INTEGER,
    "liters" TEXT,
    "engine_fuel" TEXT,
    "engine_liters" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trodo"."category_tree" (
    "id" BIGSERIAL NOT NULL,
    "variant_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,
    "parent_category_id" INTEGER,
    "tree_parent_key" TEXT NOT NULL,
    "child_position" INTEGER NOT NULL,
    "child_category_ids" INTEGER[],
    "children_count" INTEGER NOT NULL DEFAULT 0,
    "is_extra_branch" BOOLEAN NOT NULL DEFAULT false,
    "root_category_id" INTEGER,
    "current_category_id" INTEGER,
    "base_url" TEXT,
    "car_title" TEXT,
    "car_link" TEXT,
    "empty_message" TEXT,
    "name" TEXT NOT NULL,
    "url_key" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "path_ids" INTEGER[],
    "path_depth" INTEGER NOT NULL,
    "image_name" TEXT,
    "inherited_image_name" TEXT,
    "position" INTEGER,
    "page_type" TEXT,
    "intro_html" TEXT,
    "seo_title" TEXT,
    "headline" TEXT,
    "dynamic_text" TEXT,
    "content_html" TEXT,
    "raw_attributes" JSONB NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "category_tree_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "v0"."ptdrk_brands" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "url_key" TEXT,
    "logo_url" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ptdrk_brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "v0"."ptdrk_products" (
    "id" SERIAL NOT NULL,
    "ptdrk_brands_id" INTEGER NOT NULL,
    "product_id" TEXT NOT NULL,
    "part_no" TEXT,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "ref_no" TEXT,
    "sku" TEXT,
    "price_list" DECIMAL(10,2),
    "price_actual" DECIMAL(10,2),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ptdrk_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "v0"."vehicle_brands" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "vehicle_brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "v0"."vehicle_models" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "date_from" TEXT,
    "date_to" TEXT,
    "brand_id" INTEGER NOT NULL,

    CONSTRAINT "vehicle_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "v0"."vehicle_types" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "cc" INTEGER,
    "fuel_type" TEXT,
    "hp" INTEGER,
    "kwt" INTEGER,
    "year_of_constr_from" TEXT,
    "year_of_constr_to" TEXT,
    "model_id" INTEGER NOT NULL,

    CONSTRAINT "vehicle_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "v0"."vehicle_type_details" (
    "id" BIGSERIAL NOT NULL,
    "vehicle_type_id" INTEGER NOT NULL,
    "brake_system" TEXT,
    "car_id" INTEGER,
    "ccm_tech" INTEGER,
    "construction_type" TEXT,
    "cylinder" INTEGER,
    "cylinder_capacity_ccm" INTEGER,
    "cylinder_capacity_liter" INTEGER,
    "fuel_type" TEXT,
    "fuel_type_process" TEXT,
    "impulsion_type" TEXT,
    "manu_id" INTEGER,
    "manu_name" TEXT,
    "mod_id" INTEGER,
    "model_name" TEXT,
    "motor_type" TEXT,
    "power_hp_from" INTEGER,
    "power_hp_to" INTEGER,
    "power_kw_from" INTEGER,
    "power_kw_to" INTEGER,
    "type_name" TEXT,
    "type_number" INTEGER,
    "valves" INTEGER,
    "year_of_constr_from" TEXT,
    "year_of_constr_to" TEXT,
    "rmi_type_id" INTEGER,
    "motor_codes" JSONB,
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "vehicle_type_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."supplier_dinamik_brands" (
    "id" BIGSERIAL NOT NULL,
    "brand" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_dinamik_brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."supplier_dinamik_products" (
    "id" BIGSERIAL NOT NULL,
    "brand_id" BIGINT NOT NULL,
    "stock_code" TEXT NOT NULL,
    "stock_name" TEXT,
    "part_no" TEXT,
    "oem_no" TEXT,
    "barcode_1" TEXT,
    "barcode_2" TEXT,
    "barcode_3" TEXT,
    "image_url" TEXT,
    "raw" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_passive" BOOLEAN NOT NULL DEFAULT false,
    "passive_at" TIMESTAMPTZ(6),

    CONSTRAINT "supplier_dinamik_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."supplier_dinamik_cost" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "price" DECIMAL(10,2),
    "stock_qty" INTEGER,
    "campaign_rate" DECIMAL(6,3),
    "regional_stock" JSONB,
    "raw" JSONB NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_dinamik_cost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."supplier_basbug_brands" (
    "id" BIGSERIAL NOT NULL,
    "brand" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_basbug_brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."supplier_basbug_products" (
    "id" BIGSERIAL NOT NULL,
    "brand_id" BIGINT NOT NULL,
    "malzeme_no" TEXT NOT NULL,
    "part_no" TEXT,
    "aciklama" TEXT,
    "aciklama2" TEXT,
    "oem_no" TEXT,
    "liste_grubu_kodu" TEXT NOT NULL,
    "arac_bilgisi" TEXT,
    "motor_bilgisi" TEXT,
    "yil_araligi" TEXT,
    "birim" TEXT,
    "para_birimi" TEXT,
    "liste_fiyati" DECIMAL(12,2),
    "raw" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_passive" BOOLEAN NOT NULL DEFAULT false,
    "passive_at" TIMESTAMPTZ(6),

    CONSTRAINT "supplier_basbug_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."supplier_basbug_rates" (
    "id" SERIAL NOT NULL,
    "doviz_cinsi" TEXT NOT NULL,
    "alis" DECIMAL(18,6) NOT NULL,
    "satis" DECIMAL(18,6) NOT NULL,
    "kaynak" TEXT NOT NULL DEFAULT 'BASBUG',
    "tarih" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_basbug_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."supplier_basbug_cost_history" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "liste_fiyati" DECIMAL(12,2),
    "para_birimi" TEXT,
    "kur_degeri" DECIMAL(18,6),
    "fiyat_tl" DECIMAL(12,2),
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_basbug_cost_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."brands" (
    "id" SERIAL NOT NULL,
    "brand" TEXT NOT NULL,
    "logo_url" TEXT,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."brand_mappings" (
    "id" SERIAL NOT NULL,
    "brand_id" INTEGER NOT NULL,
    "dinamik_brand_id" BIGINT,
    "ptdrk_brand_id" INTEGER,
    "basbug_brand_id" BIGINT,
    "mapping_status" TEXT NOT NULL DEFAULT 'PENDING',
    "match_method" TEXT,
    "ptdrk_productsId" INTEGER,

    CONSTRAINT "brand_mappings_pkey" PRIMARY KEY ("id")
);

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
    "brand_id" INTEGER NOT NULL,
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

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."product_offers" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "supplier_code" TEXT NOT NULL,
    "dinamik_product_id" BIGINT,
    "basbug_product_id" BIGINT,
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

    CONSTRAINT "product_offers_pkey" PRIMARY KEY ("id")
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

    CONSTRAINT "product_oems_pkey" PRIMARY KEY ("id")
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

    CONSTRAINT "product_part_links_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "order_payments_order_id_created_at_idx" ON "order_payments"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "order_payments_provider_conversation_id_idx" ON "order_payments"("provider_conversation_id");

-- CreateIndex
CREATE INDEX "order_payments_provider_payment_id_idx" ON "order_payments"("provider_payment_id");

-- CreateIndex
CREATE INDEX "orders_user_id_idx" ON "orders"("user_id");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_payment_status_idx" ON "orders"("payment_status");

-- CreateIndex
CREATE INDEX "orders_guest_email_idx" ON "orders"("guest_email");

-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "customer_requests_status_idx" ON "customer_requests"("status");

-- CreateIndex
CREATE INDEX "customer_requests_request_type_idx" ON "customer_requests"("request_type");

-- CreateIndex
CREATE INDEX "customer_requests_source_idx" ON "customer_requests"("source");

-- CreateIndex
CREATE INDEX "customer_requests_created_at_idx" ON "customer_requests"("created_at");

-- CreateIndex
CREATE INDEX "customer_requests_user_id_idx" ON "customer_requests"("user_id");

-- CreateIndex
CREATE INDEX "customer_requests_part_id_idx" ON "customer_requests"("part_id");

-- CreateIndex
CREATE INDEX "customer_requests_status_created_at_idx" ON "customer_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "customer_requests_request_type_status_idx" ON "customer_requests"("request_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "part_brands_name_key" ON "part_brands"("name");

-- CreateIndex
CREATE INDEX "part_brands_logo_url_idx" ON "part_brands"("logo_url");

-- CreateIndex
CREATE INDEX "part_categories_name_idx" ON "part_categories"("name");

-- CreateIndex
CREATE INDEX "part_categories_name_tr_idx" ON "part_categories"("name_tr");

-- CreateIndex
CREATE INDEX "part_categories_is_active_idx" ON "part_categories"("is_active");

-- CreateIndex
CREATE INDEX "part_categories_parent_id_idx" ON "part_categories"("parent_id");

-- CreateIndex
CREATE INDEX "part_categories_url_key_idx" ON "part_categories"("url_key");

-- CreateIndex
CREATE INDEX "part_categories_is_main_nav_idx" ON "part_categories"("is_main_nav");

-- CreateIndex
CREATE INDEX "part_categories_active_main_nav_idx" ON "part_categories"("is_active", "is_main_nav");

-- CreateIndex
CREATE INDEX "part_categories_active_parent_idx" ON "part_categories"("is_active", "parent_id");

-- CreateIndex
CREATE INDEX "part_categories_active_url_key_idx" ON "part_categories"("is_active", "url_key");

-- CreateIndex
CREATE INDEX "part_cross_references_article_number_idx" ON "part_cross_references"("article_number");

-- CreateIndex
CREATE INDEX "part_cross_references_brand_name_idx" ON "part_cross_references"("brand_name");

-- CreateIndex
CREATE INDEX "part_cross_references_part_id_idx" ON "part_cross_references"("part_id");

-- CreateIndex
CREATE INDEX "part_cross_refs_article_part_idx" ON "part_cross_references"("article_number", "part_id");

-- CreateIndex
CREATE INDEX "part_documents_part_id_idx" ON "part_documents"("part_id");

-- CreateIndex
CREATE INDEX "part_eans_code_idx" ON "part_eans"("code");

-- CreateIndex
CREATE INDEX "part_eans_part_id_idx" ON "part_eans"("part_id");

-- CreateIndex
CREATE UNIQUE INDEX "part_eans_part_id_code_key" ON "part_eans"("part_id", "code");

-- CreateIndex
CREATE INDEX "part_images_part_id_idx" ON "part_images"("part_id");

-- CreateIndex
CREATE INDEX "part_infos_part_id_idx" ON "part_infos"("part_id");

-- CreateIndex
CREATE INDEX "part_oens_code_idx" ON "part_oens"("code");

-- CreateIndex
CREATE INDEX "part_oens_brand_idx" ON "part_oens"("brand");

-- CreateIndex
CREATE INDEX "part_oens_part_id_idx" ON "part_oens"("part_id");

-- CreateIndex
CREATE INDEX "part_oens_code_part_idx" ON "part_oens"("code", "part_id");

-- CreateIndex
CREATE INDEX "part_properties_part_id_idx" ON "part_properties"("part_id");

-- CreateIndex
CREATE UNIQUE INDEX "part_properties_part_id_key_unique" ON "part_properties"("part_id", "key");

-- CreateIndex
CREATE INDEX "part_vehicle_types_vehicle_type_id_part_id_idx" ON "part_vehicle_types"("vehicle_type_id", "part_id");

-- CreateIndex
CREATE UNIQUE INDEX "part_vehicle_types_part_id_vehicle_type_id_key" ON "part_vehicle_types"("part_id", "vehicle_type_id");

-- CreateIndex
CREATE INDEX "parts_article_link_id_idx" ON "parts"("article_link_id");

-- CreateIndex
CREATE INDEX "parts_tecdoc_article_id_idx" ON "parts"("tecdoc_article_id");

-- CreateIndex
CREATE INDEX "parts_category_id_idx" ON "parts"("category_id");

-- CreateIndex
CREATE INDEX "parts_brand_id_idx" ON "parts"("brand_id");

-- CreateIndex
CREATE INDEX "parts_updated_at_idx" ON "parts"("updated_at");

-- CreateIndex
CREATE INDEX "parts_category_id_updated_at_idx" ON "parts"("category_id", "updated_at");

-- CreateIndex
CREATE INDEX "parts_category_id_brand_id_idx" ON "parts"("category_id", "brand_id");

-- CreateIndex
CREATE INDEX "parts_category_id_brand_id_updated_at_idx" ON "parts"("category_id", "brand_id", "updated_at");

-- CreateIndex
CREATE INDEX "parts_category_id_price_idx" ON "parts"("category_id", "price");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_unique" ON "users"("email");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "scrape_progress_vehicle_type_id_idx" ON "scrape_progress"("vehicle_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "scrape_progress_vehicle_type_id_category_id_key" ON "scrape_progress"("vehicle_type_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "oil_capacities_vehicle_type_id_key" ON "oil_capacities"("vehicle_type_id");

-- CreateIndex
CREATE INDEX "category_tree_variant_id_idx" ON "trodo"."category_tree"("variant_id");

-- CreateIndex
CREATE INDEX "category_tree_category_id_idx" ON "trodo"."category_tree"("category_id");

-- CreateIndex
CREATE INDEX "category_tree_variant_id_parent_category_id_idx" ON "trodo"."category_tree"("variant_id", "parent_category_id");

-- CreateIndex
CREATE INDEX "category_tree_variant_id_tree_parent_key_idx" ON "trodo"."category_tree"("variant_id", "tree_parent_key");

-- CreateIndex
CREATE INDEX "category_tree_variant_id_url_key_idx" ON "trodo"."category_tree"("variant_id", "url_key");

-- CreateIndex
CREATE INDEX "category_tree_variant_id_page_type_idx" ON "trodo"."category_tree"("variant_id", "page_type");

-- CreateIndex
CREATE INDEX "category_tree_variant_id_is_extra_branch_idx" ON "trodo"."category_tree"("variant_id", "is_extra_branch");

-- CreateIndex
CREATE UNIQUE INDEX "category_tree_variant_id_category_id_key" ON "trodo"."category_tree"("variant_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "ptdrk_brands_name_key" ON "v0"."ptdrk_brands"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ptdrk_brands_url_key_key" ON "v0"."ptdrk_brands"("url_key");

-- CreateIndex
CREATE UNIQUE INDEX "ptdrk_products_product_id_key" ON "v0"."ptdrk_products"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "ptdrk_products_url_key" ON "v0"."ptdrk_products"("url");

-- CreateIndex
CREATE INDEX "ptdrk_products_ptdrk_brands_id_idx" ON "v0"."ptdrk_products"("ptdrk_brands_id");

-- CreateIndex
CREATE INDEX "ptdrk_products_product_id_idx" ON "v0"."ptdrk_products"("product_id");

-- CreateIndex
CREATE INDEX "ptdrk_products_sku_idx" ON "v0"."ptdrk_products"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_brands_name_key" ON "v0"."vehicle_brands"("name");

-- CreateIndex
CREATE INDEX "vtypes_name_idx" ON "v0"."vehicle_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_type_details_vehicle_type_id_key" ON "v0"."vehicle_type_details"("vehicle_type_id");

-- CreateIndex
CREATE INDEX "vtype_details_manu_id_idx" ON "v0"."vehicle_type_details"("manu_id");

-- CreateIndex
CREATE INDEX "vtype_details_mod_id_idx" ON "v0"."vehicle_type_details"("mod_id");

-- CreateIndex
CREATE INDEX "vtype_details_updated_at_idx" ON "v0"."vehicle_type_details"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_dinamik_brands_brand_key" ON "catalog"."supplier_dinamik_brands"("brand");

-- CreateIndex
CREATE INDEX "idx_dinamik_products_brand_id" ON "catalog"."supplier_dinamik_products"("brand_id");

-- CreateIndex
CREATE INDEX "supplier_dinamik_products_stock_code_idx" ON "catalog"."supplier_dinamik_products"("stock_code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_dinamik_products_brand_stock_code" ON "catalog"."supplier_dinamik_products"("brand_id", "stock_code");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_dinamik_cost_product_id_key" ON "catalog"."supplier_dinamik_cost"("product_id");

-- CreateIndex
CREATE INDEX "supplier_dinamik_cost_last_seen_at_idx" ON "catalog"."supplier_dinamik_cost"("last_seen_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_basbug_brands_brand_key" ON "catalog"."supplier_basbug_brands"("brand");

-- CreateIndex
CREATE INDEX "supplier_basbug_products_brand_id_idx" ON "catalog"."supplier_basbug_products"("brand_id");

-- CreateIndex
CREATE INDEX "supplier_basbug_products_malzeme_no_idx" ON "catalog"."supplier_basbug_products"("malzeme_no");

-- CreateIndex
CREATE INDEX "supplier_basbug_products_oem_no_idx" ON "catalog"."supplier_basbug_products"("oem_no");

-- CreateIndex
CREATE INDEX "supplier_basbug_products_liste_grubu_kodu_idx" ON "catalog"."supplier_basbug_products"("liste_grubu_kodu");

-- CreateIndex
CREATE UNIQUE INDEX "uq_basbug_products_brand_malzeme_no" ON "catalog"."supplier_basbug_products"("brand_id", "malzeme_no");

-- CreateIndex
CREATE INDEX "supplier_basbug_rates_tarih_idx" ON "catalog"."supplier_basbug_rates"("tarih");

-- CreateIndex
CREATE INDEX "supplier_basbug_rates_doviz_cinsi_tarih_idx" ON "catalog"."supplier_basbug_rates"("doviz_cinsi", "tarih" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_basbug_rates_cinsi_kaynak_tarih" ON "catalog"."supplier_basbug_rates"("doviz_cinsi", "kaynak", "tarih");

-- CreateIndex
CREATE INDEX "supplier_basbug_cost_history_product_id_captured_at_idx" ON "catalog"."supplier_basbug_cost_history"("product_id", "captured_at" DESC);

-- CreateIndex
CREATE INDEX "supplier_basbug_cost_history_para_birimi_idx" ON "catalog"."supplier_basbug_cost_history"("para_birimi");

-- CreateIndex
CREATE INDEX "supplier_basbug_cost_history_captured_at_idx" ON "catalog"."supplier_basbug_cost_history"("captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "brands_brand_key" ON "catalog"."brands"("brand");

-- CreateIndex
CREATE INDEX "idx_brands_match_brand" ON "catalog"."brands"("brand");

-- CreateIndex
CREATE INDEX "idx_brand_mappings_brand" ON "catalog"."brand_mappings"("brand_id");

-- CreateIndex
CREATE INDEX "idx_brand_mappings_dinamik" ON "catalog"."brand_mappings"("dinamik_brand_id");

-- CreateIndex
CREATE INDEX "idx_brand_mappings_ptdrk" ON "catalog"."brand_mappings"("ptdrk_brand_id");

-- CreateIndex
CREATE INDEX "idx_brand_mappings_basbug" ON "catalog"."brand_mappings"("basbug_brand_id");

-- CreateIndex
CREATE INDEX "idx_brand_mappings_status" ON "catalog"."brand_mappings"("mapping_status");

-- CreateIndex
CREATE UNIQUE INDEX "brand_mappings_brand_id_dinamik_brand_id_ptdrk_brand_id_bas_key" ON "catalog"."brand_mappings"("brand_id", "dinamik_brand_id", "ptdrk_brand_id", "basbug_brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "catalog"."products"("slug");

-- CreateIndex
CREATE INDEX "products_part_no_norm_idx" ON "catalog"."products"("part_no_norm");

-- CreateIndex
CREATE INDEX "products_status_idx" ON "catalog"."products"("status");

-- CreateIndex
CREATE INDEX "products_category_id_status_idx" ON "catalog"."products"("category_id", "status");

-- CreateIndex
CREATE INDEX "products_brand_id_status_idx" ON "catalog"."products"("brand_id", "status");

-- CreateIndex
CREATE INDEX "products_in_stock_status_idx" ON "catalog"."products"("in_stock", "status");

-- CreateIndex
CREATE INDEX "products_primary_part_id_idx" ON "catalog"."products"("primary_part_id");

-- CreateIndex
CREATE INDEX "products_updated_at_idx" ON "catalog"."products"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_products_brand_partno_norm" ON "catalog"."products"("brand_id", "part_no_norm");

-- CreateIndex
CREATE UNIQUE INDEX "uq_offers_dinamik_product" ON "catalog"."product_offers"("dinamik_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_offers_basbug_product" ON "catalog"."product_offers"("basbug_product_id");

-- CreateIndex
CREATE INDEX "product_offers_supplier_code_is_active_idx" ON "catalog"."product_offers"("supplier_code", "is_active");

-- CreateIndex
CREATE INDEX "product_offers_supplier_code_last_synced_at_idx" ON "catalog"."product_offers"("supplier_code", "last_synced_at");

-- CreateIndex
CREATE INDEX "product_offers_is_active_stock_qty_idx" ON "catalog"."product_offers"("is_active", "stock_qty");

-- CreateIndex
CREATE UNIQUE INDEX "uq_offers_product_supplier" ON "catalog"."product_offers"("product_id", "supplier_code");

-- CreateIndex
CREATE INDEX "product_oems_code_norm_idx" ON "catalog"."product_oems"("code_norm");

-- CreateIndex
CREATE INDEX "product_oems_source_idx" ON "catalog"."product_oems"("source");

-- CreateIndex
CREATE UNIQUE INDEX "uq_product_oems_product_code" ON "catalog"."product_oems"("product_id", "code_norm");

-- CreateIndex
CREATE INDEX "product_eans_code_idx" ON "catalog"."product_eans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_product_eans_product_code" ON "catalog"."product_eans"("product_id", "code");

-- CreateIndex
CREATE INDEX "product_images_product_id_position_idx" ON "catalog"."product_images"("product_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "uq_product_images_product_url" ON "catalog"."product_images"("product_id", "url");

-- CreateIndex
CREATE UNIQUE INDEX "uq_product_properties_product_key" ON "catalog"."product_properties"("product_id", "key");

-- CreateIndex
CREATE INDEX "product_vehicle_types_vehicle_type_id_product_id_idx" ON "catalog"."product_vehicle_types"("vehicle_type_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_product_vehicle_types" ON "catalog"."product_vehicle_types"("product_id", "vehicle_type_id");

-- CreateIndex
CREATE INDEX "product_part_links_part_id_idx" ON "catalog"."product_part_links"("part_id");

-- CreateIndex
CREATE INDEX "product_part_links_status_idx" ON "catalog"."product_part_links"("status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_product_part_links" ON "catalog"."product_part_links"("product_id", "part_id");

-- AddForeignKey
ALTER TABLE "engines" ADD CONSTRAINT "engines_fuel_type_id_fuel_types_id_fk" FOREIGN KEY ("fuel_type_id") REFERENCES "fuel_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fuel_types" ADD CONSTRAINT "fuel_types_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "models" ADD CONSTRAINT "models_make_id_makes_id_fk" FOREIGN KEY ("make_id") REFERENCES "makes"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "part_cross_references" ADD CONSTRAINT "part_cross_references_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "part_documents" ADD CONSTRAINT "part_documents_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "part_eans" ADD CONSTRAINT "part_eans_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "part_images" ADD CONSTRAINT "part_images_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "part_infos" ADD CONSTRAINT "part_infos_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "part_oens" ADD CONSTRAINT "part_oens_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "part_properties" ADD CONSTRAINT "part_properties_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "part_vehicle_types" ADD CONSTRAINT "part_vehicle_types_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "part_vehicle_types" ADD CONSTRAINT "part_vehicle_types_vehicle_type_id_fkey" FOREIGN KEY ("vehicle_type_id") REFERENCES "v0"."vehicle_types"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "part_brands"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "part_categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_vehicles" ADD CONSTRAINT "user_vehicles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "oil_capacities" ADD CONSTRAINT "oil_capacities_vehicle_type_id_fkey" FOREIGN KEY ("vehicle_type_id") REFERENCES "v0"."vehicle_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trodo"."variants" ADD CONSTRAINT "variants_engine_id_engines_id_fk" FOREIGN KEY ("engine_id") REFERENCES "engines"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "trodo"."category_tree" ADD CONSTRAINT "category_tree_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "trodo"."variants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "v0"."ptdrk_products" ADD CONSTRAINT "ptdrk_products_ptdrk_brands_id_fkey" FOREIGN KEY ("ptdrk_brands_id") REFERENCES "v0"."ptdrk_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "v0"."vehicle_models" ADD CONSTRAINT "vehicle_models_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "v0"."vehicle_brands"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "v0"."vehicle_types" ADD CONSTRAINT "vehicle_types_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "v0"."vehicle_models"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "v0"."vehicle_type_details" ADD CONSTRAINT "vehicle_type_details_vehicle_type_id_fkey" FOREIGN KEY ("vehicle_type_id") REFERENCES "v0"."vehicle_types"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "catalog"."supplier_dinamik_products" ADD CONSTRAINT "supplier_dinamik_products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "catalog"."supplier_dinamik_brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."supplier_dinamik_cost" ADD CONSTRAINT "supplier_dinamik_cost_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."supplier_dinamik_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."supplier_basbug_products" ADD CONSTRAINT "supplier_basbug_products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "catalog"."supplier_basbug_brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."supplier_basbug_cost_history" ADD CONSTRAINT "supplier_basbug_cost_history_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."supplier_basbug_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."brand_mappings" ADD CONSTRAINT "brand_mappings_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "catalog"."brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."brand_mappings" ADD CONSTRAINT "brand_mappings_dinamik_brand_id_fkey" FOREIGN KEY ("dinamik_brand_id") REFERENCES "catalog"."supplier_dinamik_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."brand_mappings" ADD CONSTRAINT "brand_mappings_ptdrk_brand_id_fkey" FOREIGN KEY ("ptdrk_brand_id") REFERENCES "v0"."ptdrk_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."brand_mappings" ADD CONSTRAINT "brand_mappings_basbug_brand_id_fkey" FOREIGN KEY ("basbug_brand_id") REFERENCES "catalog"."supplier_basbug_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."brand_mappings" ADD CONSTRAINT "brand_mappings_ptdrk_productsId_fkey" FOREIGN KEY ("ptdrk_productsId") REFERENCES "v0"."ptdrk_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "catalog"."brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "part_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_primary_part_id_fkey" FOREIGN KEY ("primary_part_id") REFERENCES "parts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."product_offers" ADD CONSTRAINT "product_offers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."product_offers" ADD CONSTRAINT "product_offers_supplier_code_fkey" FOREIGN KEY ("supplier_code") REFERENCES "catalog"."suppliers"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."product_offers" ADD CONSTRAINT "product_offers_dinamik_product_id_fkey" FOREIGN KEY ("dinamik_product_id") REFERENCES "catalog"."supplier_dinamik_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."product_offers" ADD CONSTRAINT "product_offers_basbug_product_id_fkey" FOREIGN KEY ("basbug_product_id") REFERENCES "catalog"."supplier_basbug_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."product_oems" ADD CONSTRAINT "product_oems_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."product_eans" ADD CONSTRAINT "product_eans_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."product_properties" ADD CONSTRAINT "product_properties_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."product_vehicle_types" ADD CONSTRAINT "product_vehicle_types_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."product_vehicle_types" ADD CONSTRAINT "product_vehicle_types_vehicle_type_id_fkey" FOREIGN KEY ("vehicle_type_id") REFERENCES "v0"."vehicle_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."product_part_links" ADD CONSTRAINT "product_part_links_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."product_part_links" ADD CONSTRAINT "product_part_links_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."product_overrides" ADD CONSTRAINT "product_overrides_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
