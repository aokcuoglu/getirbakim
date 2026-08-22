CREATE TABLE "catalog"."partner_orders" (
  "id" UUID NOT NULL,
  "partner_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "request_fingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED',
  "version" INTEGER NOT NULL DEFAULT 1,
  "currency" TEXT NOT NULL,
  "binding_net_amount" DECIMAL(12,2) NOT NULL,
  "binding_vat_amount" DECIMAL(12,2) NOT NULL,
  "binding_gross_amount" DECIMAL(12,2) NOT NULL,
  "pricing_policy_version" TEXT NOT NULL,
  "binding_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "cancellation_requested_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_partner_orders_status" CHECK ("status" IN ('REQUESTED','CONFIRMED','REJECTED','RESERVATION_EXPIRED','CANCELLED','SHIPPED','COMPLETED')),
  CONSTRAINT "ck_partner_orders_version" CHECK ("version" > 0),
  CONSTRAINT "ck_partner_orders_amounts" CHECK ("binding_net_amount" > 0 AND "binding_vat_amount" >= 0 AND "binding_gross_amount" = "binding_net_amount" + "binding_vat_amount")
);

CREATE TABLE "catalog"."partner_order_items" (
  "id" BIGSERIAL NOT NULL,
  "order_id" UUID NOT NULL,
  "product_id" BIGINT NOT NULL,
  "selected_offer_id" BIGINT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit_net_amount" DECIMAL(12,2) NOT NULL,
  "unit_vat_amount" DECIMAL(12,2) NOT NULL,
  "unit_gross_amount" DECIMAL(12,2) NOT NULL,
  CONSTRAINT "partner_order_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_partner_order_items_values" CHECK ("quantity" > 0 AND "unit_net_amount" > 0 AND "unit_vat_amount" >= 0 AND "unit_gross_amount" = "unit_net_amount" + "unit_vat_amount")
);

CREATE TABLE "catalog"."partner_stock_reservations" (
  "id" BIGSERIAL NOT NULL,
  "order_id" UUID NOT NULL,
  "product_id" BIGINT NOT NULL,
  "selected_offer_id" BIGINT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_stock_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_partner_reservation_status" CHECK ("status" IN ('ACTIVE','COMMITTED','RELEASED')),
  CONSTRAINT "ck_partner_reservation_quantity" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "uq_partner_orders_idempotency" ON "catalog"."partner_orders"("partner_id", "idempotency_key");
CREATE INDEX "partner_orders_partner_id_created_at_idx" ON "catalog"."partner_orders"("partner_id", "created_at");
CREATE INDEX "partner_orders_status_binding_expires_at_idx" ON "catalog"."partner_orders"("status", "binding_expires_at");
CREATE INDEX "partner_order_items_order_id_idx" ON "catalog"."partner_order_items"("order_id");
CREATE UNIQUE INDEX "uq_partner_order_items_order" ON "catalog"."partner_order_items"("order_id");
CREATE INDEX "partner_order_items_product_id_idx" ON "catalog"."partner_order_items"("product_id");
CREATE INDEX "partner_order_items_selected_offer_id_idx" ON "catalog"."partner_order_items"("selected_offer_id");
CREATE INDEX "partner_stock_reservations_order_id_status_idx" ON "catalog"."partner_stock_reservations"("order_id", "status");
CREATE UNIQUE INDEX "uq_partner_reservations_order" ON "catalog"."partner_stock_reservations"("order_id");
CREATE INDEX "partner_stock_reservations_selected_offer_id_status_expires_at_idx" ON "catalog"."partner_stock_reservations"("selected_offer_id", "status", "expires_at");

ALTER TABLE "catalog"."partner_order_items" ADD CONSTRAINT "partner_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "catalog"."partner_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog"."partner_order_items" ADD CONSTRAINT "partner_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "catalog"."partner_order_items" ADD CONSTRAINT "partner_order_items_selected_offer_id_fkey" FOREIGN KEY ("selected_offer_id") REFERENCES "catalog"."product_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "catalog"."partner_stock_reservations" ADD CONSTRAINT "partner_stock_reservations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "catalog"."partner_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog"."partner_stock_reservations" ADD CONSTRAINT "partner_stock_reservations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "catalog"."partner_stock_reservations" ADD CONSTRAINT "partner_stock_reservations_selected_offer_id_fkey" FOREIGN KEY ("selected_offer_id") REFERENCES "catalog"."product_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
