-- catalog.brands'e slug ve display_name eklenir.
--
-- Gerekçe: marka sayfası URL'i ve görünen adı bugüne kadar runtime'da
-- catalog.ptdrk_brands (url_key / name) üzerinden hesaplanıyordu. ParcaTedarik
-- projeden çıkarıldığı için bu iki değer kalıcılaştırılır; aksi halde 408 marka
-- sayfasının URL'i değişir ve 39 markanın yazımı bozulurdu.
--
-- Backfill ayrı script ile yapılır (mevcut toBrandSlug() ile birebir aynı slug
-- üretilsin diye TS tarafında hesaplanır):
--   bun scripts/backfill-brand-slugs.ts

ALTER TABLE "catalog"."brands" ADD COLUMN "slug" TEXT;
ALTER TABLE "catalog"."brands" ADD COLUMN "display_name" TEXT;

CREATE UNIQUE INDEX "brands_slug_key" ON "catalog"."brands"("slug");
