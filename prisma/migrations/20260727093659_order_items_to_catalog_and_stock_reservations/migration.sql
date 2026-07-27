-- order_items'ı public.parts yerine catalog.products'a bağlar ve ödeme
-- penceresi için süreli stok rezervasyonu tablosunu ekler.
--
-- part_id DROP + product_id/product_name NOT NULL ekleme YALNIZCA tablo boşken
-- güvenli. Hiç sipariş alınmadığı için öyle; ama sessizce varsaymak yerine
-- doğruluyoruz — dolu bir tabloda bu migration okunabilir bir hatayla dursun.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "order_items") THEN
    RAISE EXCEPTION
      'order_items bos degil (% satir): part_id -> product_id gecisi veri tasima gerektirir',
      (SELECT count(*) FROM "order_items");
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_part_id_fkey";

-- AlterTable
ALTER TABLE "order_items" DROP COLUMN "part_id",
ADD COLUMN     "product_id" BIGINT NOT NULL,
ADD COLUMN     "product_name" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "catalog"."stock_reservations" (
    "id" BIGSERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "product_id" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_reservations_order_id_idx" ON "catalog"."stock_reservations"("order_id");

-- CreateIndex
CREATE INDEX "stock_reservations_product_id_status_expires_at_idx" ON "catalog"."stock_reservations"("product_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "catalog"."stock_reservations" ADD CONSTRAINT "stock_reservations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
