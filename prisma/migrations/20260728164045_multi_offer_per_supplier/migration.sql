-- DropIndex
DROP INDEX "catalog"."uq_offers_product_supplier";

-- CreateIndex
CREATE INDEX "product_offers_product_id_supplier_code_idx" ON "catalog"."product_offers"("product_id", "supplier_code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_offers_product_supplier_sku" ON "catalog"."product_offers"("product_id", "supplier_code", "supplier_sku");
