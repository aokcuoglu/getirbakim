-- Rename column dnmk_ptdrk_brands_id to brand_list_id on v0.brand_mappings
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'v0'
      AND table_name = 'brand_mappings'
      AND column_name = 'dnmk_ptdrk_brands_id'
  ) THEN
    ALTER TABLE "v0"."brand_mappings" RENAME COLUMN "dnmk_ptdrk_brands_id" TO "brand_list_id";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'v0'
      AND tablename = 'brand_mappings'
      AND indexname = 'idx_dpbrm_dpbrands'
  ) THEN
    ALTER INDEX "v0"."idx_dpbrm_dpbrands" RENAME TO "idx_dpbrm_brand_list";
  END IF;
END $$;
