-- Reconcile the datamodel with the TecDoc archive's actual shape.
--
-- Why: local and production drifted apart. Local `public` was built by restoring
-- the archive, never by `prisma migrate`, so it carries columns and indexes that
-- no migration created. Production was built by the init migration, so it carries
-- a `ptdrk_productsId` column that exists nowhere else and is referenced by no
-- code. `migrate diff` therefore proposed dropping ~32% of the archive's
-- `parts.part_no` values (TEXT -> BIGINT) plus 12 indexes on every run.
--
-- This migration makes production match the archive so both environments are
-- structurally identical. It is a prerequisite for loading TecDoc data into
-- production: `pg_dump --data-only` emits an explicit column list, so a column
-- present in one environment and absent in the other aborts the restore.
--
-- Safe on production: `public.parts` and `public.part_categories` are empty
-- there, so the column additions, the type change and the index builds are all
-- instant and lossless.
--
-- Every statement is guarded. Local already has the target state and is marked
-- as applied without executing this file, but the guards mean a partially
-- migrated database converges instead of failing.

-- DropForeignKey / DropColumn: `ptdrk_productsId` was an accidental implicit
-- relation. It landed in the init migration, exists only in production, and is
-- read by no code.
ALTER TABLE "catalog"."brand_mappings" DROP CONSTRAINT IF EXISTS "brand_mappings_ptdrk_productsId_fkey";
ALTER TABLE "catalog"."brand_mappings" DROP COLUMN IF EXISTS "ptdrk_productsId";

-- AlterTable: legacy import id present in the archive.
ALTER TABLE "part_categories" ADD COLUMN IF NOT EXISTS "trodo_category_id" BIGINT;

-- AlterTable: parts2web archive sync bookkeeping.
ALTER TABLE "parts" ADD COLUMN IF NOT EXISTS "p2w_article_info_run_id" BIGINT;
ALTER TABLE "parts" ADD COLUMN IF NOT EXISTS "p2w_article_info_synced_at" TIMESTAMP(6);
ALTER TABLE "parts" ADD COLUMN IF NOT EXISTS "p2w_last_seen_at" TIMESTAMP(6);
ALTER TABLE "parts" ADD COLUMN IF NOT EXISTS "p2w_last_seen_run_id" BIGINT;
ALTER TABLE "parts" ADD COLUMN IF NOT EXISTS "p2w_sync_version" INTEGER NOT NULL DEFAULT 1;

-- AlterColumn: part_no must be TEXT. Roughly a third of TecDoc part numbers are
-- alphanumeric ("10PK1342", "WP6118"), so BIGINT cannot represent them. Guarded
-- so re-running never triggers a table rewrite.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'parts'
      AND column_name = 'part_no'
      AND data_type <> 'text'
  ) THEN
    ALTER TABLE "parts" ALTER COLUMN "part_no" SET DATA TYPE TEXT;
  END IF;
END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_part_categories_trodo_category_id" ON "part_categories"("trodo_category_id");
CREATE INDEX IF NOT EXISTS "parts_created_at_idx" ON "parts"("created_at");
CREATE INDEX IF NOT EXISTS "parts_name_idx" ON "parts"("name");
CREATE INDEX IF NOT EXISTS "parts_part_no_idx" ON "parts"("part_no");

-- Descending variants, hand-built for the archive's "newest first" scans.
CREATE INDEX IF NOT EXISTS "idx_parts_updated_at" ON "parts"("updated_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_parts_category_updated_at" ON "parts"("category_id", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_parts_category_brand_updated_at" ON "parts"("category_id", "brand_id", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_parts_part_no_text_updated_at" ON "parts"("part_no", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_parts_p2w_last_seen_at" ON "parts"("p2w_last_seen_at");
CREATE INDEX IF NOT EXISTS "idx_parts_p2w_last_seen_run_id" ON "parts"("p2w_last_seen_run_id");
CREATE INDEX IF NOT EXISTS "idx_parts_p2w_article_info_synced_at" ON "parts"("p2w_article_info_synced_at");
CREATE INDEX IF NOT EXISTS "idx_parts_p2w_article_info_run_id" ON "parts"("p2w_article_info_run_id");
