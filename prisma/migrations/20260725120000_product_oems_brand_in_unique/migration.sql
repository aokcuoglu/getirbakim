-- catalog.product_oems: oem_brand joins the unique key.
--
-- Why: one OEM code is shared across a whole vehicle-maker group — part_oens
-- lists 55284051 under FIAT, ALFA ROMEO, LANCIA and ABARTH for the same part.
-- The old (product_id, code_norm) key could hold only one of them, so the
-- enrichment writers' `DISTINCT ON (product_id, code_norm)` (no ORDER BY) kept
-- an arbitrary brand and silently dropped the rest — non-deterministic across
-- re-runs.
--
-- oem_brand becomes NOT NULL DEFAULT '' ('' = brand unknown, e.g. supplier
-- OEM strings that carry no maker). It cannot stay nullable: Postgres counts
-- NULLs as distinct, so `ON CONFLICT (product_id, code_norm, oem_brand) DO
-- NOTHING` would never fire for brand-less rows and every ingest re-run would
-- duplicate them. Prisma also rejects optional fields in @@unique.

UPDATE "catalog"."product_oems" SET "oem_brand" = '' WHERE "oem_brand" IS NULL;

-- Trim before it becomes part of the key. Cannot create duplicates: the old
-- key already allowed at most one row per (product_id, code_norm).
UPDATE "catalog"."product_oems"
SET "oem_brand" = btrim("oem_brand")
WHERE "oem_brand" <> btrim("oem_brand");

ALTER TABLE "catalog"."product_oems" ALTER COLUMN "oem_brand" SET DEFAULT '';
ALTER TABLE "catalog"."product_oems" ALTER COLUMN "oem_brand" SET NOT NULL;

DROP INDEX "catalog"."uq_product_oems_product_code";

CREATE UNIQUE INDEX "uq_product_oems_product_code_brand"
  ON "catalog"."product_oems"("product_id", "code_norm", "oem_brand");
