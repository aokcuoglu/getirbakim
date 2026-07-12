-- Drop unused columns from product_mappings (kept: id, brand_list_id, dnmk_products_id, ptdrk_products_id, bsbg_products_id, mapping_status)
ALTER TABLE "v0"."product_mappings"
  DROP COLUMN "match_method",
  DROP COLUMN "confidence",
  DROP COLUMN "oem_no",
  DROP COLUMN "approved_by",
  DROP COLUMN "approved_at",
  DROP COLUMN "ignored_at",
  DROP COLUMN "created_at",
  DROP COLUMN "updated_at";
