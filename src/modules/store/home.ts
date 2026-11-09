import "server-only";
import {db} from "@/lib/db";
import {catalogSql, withBestOffers, type CatalogProduct} from "./catalog";
import {getStoreCategories} from "./categories";
import {storefrontCompanies} from "@/modules/suppliers/storefront-sources";
import {staleCache} from "@/lib/stale-cache";

// Picking the newest enriched items reads every enrichment (~0.4 s, four times per home page). The
// pick only changes when enrichments are imported, so the ids are cached; price and stock are joined
// fresh on every request.
const cachedHomeIds=staleCache<string[]>(10*60*1000);
const homeProductIds=(categoryIds:number[]|null)=>cachedHomeIds(categoryIds?.join(",")??"all",async()=>(await db.query<{id:string}>(`
    SELECT s.id::text AS id FROM supplier_items s JOIN product_enrichment_shared e ON e.supplier_item_id=s.id
    WHERE s.company=ANY($1::text[]) AND s.presence='present' AND s.code=e.supplier_code
      AND s.product_data->>'uk'=e.supplier_brand AND e.image_id IS NOT NULL
      AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)
      AND NOT EXISTS (SELECT 1 FROM product_offers o WHERE o.item_id=s.id AND o.primary_id<>o.item_id)
      AND ($2::int[] IS NULL OR e.donor_item_id IN (SELECT pc.supplier_item_id FROM product_source_categories pc WHERE pc.source='trodo' AND pc.category_id=ANY($2::int[])))
    ORDER BY e.imported_at DESC,s.id LIMIT 24`,[storefrontCompanies(),categoryIds])).rows.map(row=>row.id));

export async function getHomeProducts(categoryId?:number):Promise<CatalogProduct[]> {
  const categoryIds=categoryId?(await getStoreCategories()).filter(category=>category.path.includes(categoryId)).map(category=>category.id):null;
  const ids=await homeProductIds(categoryIds);
  return withBestOffers((await db.query<CatalogProduct>(`SELECT catalog.* FROM unnest($2::uuid[]) WITH ORDINALITY page(id,ordinal)
    JOIN LATERAL (SELECT * FROM (${catalogSql}) priced WHERE priced.id=page.id OFFSET 0) catalog ON true ORDER BY page.ordinal`,
    [storefrontCompanies(),ids])).rows);
}

export async function getHomeProductCategories(products:{id:string}[]) {
  const categories=await getStoreCategories();
  const rows=(await db.query<{supplier_item_id:string;category_id:number}>("SELECT e.supplier_item_id,pc.category_id FROM product_enrichment_shared e JOIN product_source_categories pc ON pc.supplier_item_id=e.donor_item_id WHERE pc.source='trodo' AND e.supplier_item_id=ANY($1::uuid[])",[products.map(product=>product.id)])).rows;
  const labels=new Map<string,{name:string;slug:string;depth:number}>();
  for(const row of rows){const category=categories.find(category=>category.id===row.category_id);if(category&&category.path.length>(labels.get(row.supplier_item_id)?.depth??0))labels.set(row.supplier_item_id,{name:category.name,slug:category.slug,depth:category.path.length});}
  return labels;
}
