import "server-only";
import {boundedQuery,db} from "@/lib/db";
import {catalogSql, categoryMovedAwaySql, withBestOffers, type CatalogProduct} from "./catalog";
import {getStoreCategories} from "./categories";
import type {StoreCategory} from "./category-tree";
import {storefrontCompanies} from "@/modules/suppliers/storefront-sources";
import {staleCache} from "@/lib/stale-cache";
import {listingEpoch} from "./listing-epoch";
import {hiddenAutomaticItemsSql} from "./product-image-sql";

// Picking the newest enriched items reads every enrichment (~0.4 s, four times per home page). The
// pick only changes when enrichments are imported, so the ids are cached; price and stock are joined
// fresh on every request. An admin-hidden product is left out of the pick so the rail keeps its 24 cards (the catalog
// view would drop it from the page anyway), and the pick reloads when an admin edit bumps the listing epoch (#650).
// A rail card needs an image the store shows (#596): either a trusted automatic image the admin did not hide, or an
// admin upload (no trust or enrichment needed). Each arm picks its newest 24; a row in both counts by its later date,
// so a fresh upload brings the product to the front. Uploads, deletes and the hide switch bump the epoch.
const cachedHomeIds=staleCache<string[]>(10*60*1000,500,{epoch:listingEpoch});
// The automatic arm's conditions without the category rule, shared by its donor-category and admin-category picks.
const automaticArm=`s.company=ANY($1::text[]) AND s.presence='present' AND s.code=e.supplier_code
        AND s.product_data->>'uk'=e.supplier_brand AND e.image_id IS NOT NULL
        AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)
        AND NOT EXISTS (SELECT 1 FROM product_offers o WHERE o.item_id=s.id AND o.primary_id<>o.item_id)
        AND NOT EXISTS (SELECT 1 FROM commerce_item_overrides h WHERE h.supplier_item_id=s.id AND h.hidden)
        -- On the links side: on s.id the planner seq-scans supplier_items for the category rails (~7x slower).
        AND e.supplier_item_id NOT IN (${hiddenAutomaticItemsSql})`;
export const homeProductIds=(categoryIds:number[]|null)=>cachedHomeIds(categoryIds?.join(",")??"all",async()=>(await boundedQuery<{id:string}>(`
    SELECT id::text AS id FROM (
     (SELECT s.id,e.imported_at AS shown_at FROM supplier_items s JOIN storefront_enrichments e ON e.supplier_item_id=s.id
      WHERE ${automaticArm}
        -- The admin's category replaces the donor's, as on the category page (#667).
        AND ($2::int[] IS NULL OR (${categoryMovedAwaySql("s.id","$2")} AND e.donor_item_id IN (SELECT pc.supplier_item_id FROM product_source_categories pc WHERE pc.source='trodo' AND pc.category_id=ANY($2::int[]))))
      ORDER BY e.imported_at DESC,s.id LIMIT 24)
     UNION ALL
     (SELECT s.id,e.imported_at FROM supplier_items s JOIN storefront_enrichments e ON e.supplier_item_id=s.id
      WHERE $2::int[] IS NOT NULL AND s.id IN (SELECT ps.supplier_item_id FROM product_overrides o JOIN product_sources ps ON ps.product_id=o.product_id WHERE o.category_id=ANY($2::int[]))
        AND ${automaticArm}
      ORDER BY e.imported_at DESC,s.id LIMIT 24)
     UNION ALL
     (SELECT s.id,u.uploaded_at FROM (SELECT product_id,max(created_at) AS uploaded_at FROM product_override_images GROUP BY product_id) u
      JOIN products p ON p.id=u.product_id AND p.merged_into IS NULL
      JOIN product_sources ps ON ps.product_id=u.product_id JOIN supplier_items s ON s.id=ps.supplier_item_id
      WHERE s.company=ANY($1::text[]) AND s.presence='present'
        AND NOT EXISTS (SELECT 1 FROM product_offers o WHERE o.item_id=s.id AND o.primary_id<>o.item_id)
        AND NOT EXISTS (SELECT 1 FROM commerce_item_overrides h WHERE h.supplier_item_id=s.id AND h.hidden)
        -- The admin's category, else the trusted enrichment donor's category as in the automatic arm.
        AND ($2::int[] IS NULL OR EXISTS (SELECT 1 FROM product_overrides c WHERE c.product_id=u.product_id AND c.category_id=ANY($2::int[]))
          OR (${categoryMovedAwaySql("s.id","$2")} AND EXISTS (SELECT 1 FROM storefront_enrichments e JOIN product_source_categories pc ON pc.supplier_item_id=e.donor_item_id
            WHERE e.supplier_item_id=s.id AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
              AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)
              AND pc.source='trodo' AND pc.category_id=ANY($2::int[]))))
      ORDER BY u.uploaded_at DESC,s.id LIMIT 24)
    ) picked GROUP BY id ORDER BY max(shown_at) DESC,id LIMIT 24`,[storefrontCompanies(),categoryIds])).rows.map(row=>row.id));

export async function getHomeProducts(categoryId?:number):Promise<CatalogProduct[]> {
  const categoryIds=categoryId?(await getStoreCategories()).filter(category=>category.path.includes(categoryId)).map(category=>category.id):null;
  const ids=await homeProductIds(categoryIds);
  return withBestOffers((await db.query<CatalogProduct>(`SELECT catalog.* FROM unnest($2::uuid[]) WITH ORDINALITY page(id,ordinal)
    JOIN LATERAL (SELECT * FROM (${catalogSql}) priced WHERE priced.id=page.id OFFSET 0) catalog ON true ORDER BY page.ordinal`,
    [storefrontCompanies(),ids])).rows);
}

export async function getHomeProductCategories(products:{id:string}[]) {
  return homeProductCategories(products,await getStoreCategories());
}
/** The deepest category of each card: the admin's category when set (#667), else the enrichment donor's. */
export async function homeProductCategories(products:{id:string}[],categories:StoreCategory[]) {
  const ids=products.map(product=>product.id);
  const rows=(await db.query<{supplier_item_id:string;category_id:number;admin:boolean}>(`SELECT e.supplier_item_id,pc.category_id,false AS admin FROM storefront_enrichments e
    JOIN product_source_categories pc ON pc.supplier_item_id=e.donor_item_id WHERE pc.source='trodo' AND e.supplier_item_id=ANY($1::uuid[])
    UNION ALL SELECT ps.supplier_item_id,o.category_id,true FROM product_sources ps JOIN product_overrides o ON o.product_id=ps.product_id
    WHERE o.category_id IS NOT NULL AND ps.supplier_item_id=ANY($1::uuid[])`,[ids])).rows;
  const adminRows=new Set(rows.filter(row=>row.admin).map(row=>row.supplier_item_id));
  const labels=new Map<string,{name:string;slug:string;depth:number}>();
  for(const row of rows){
    if(adminRows.has(row.supplier_item_id)&&!row.admin)continue;
    const category=categories.find(category=>category.id===row.category_id);
    if(category&&category.path.length>(labels.get(row.supplier_item_id)?.depth??0))labels.set(row.supplier_item_id,{name:category.name,slug:category.slug,depth:category.path.length});
  }
  return labels;
}
