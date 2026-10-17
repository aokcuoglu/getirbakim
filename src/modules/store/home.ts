import "server-only";
import {db} from "@/lib/db";
import {catalogSql, type CatalogProduct} from "./catalog";
import {getStoreCategories} from "./categories";
import {staleCache} from "@/lib/stale-cache";

// Picking the newest enriched items reads every enrichment (~0.4 s, four times per home page). The
// pick only changes when enrichments are imported, so the ids are cached; price and stock are joined
// fresh on every request.
const cachedHomeIds=staleCache<string[]>(10*60*1000);
const homeProductIds=(company:string,categoryIds:number[]|null)=>cachedHomeIds(`${company}:${categoryIds?.join(",")??"all"}`,async()=>(await db.query<{id:string}>(`
    SELECT s.id::text AS id FROM supplier_items s JOIN product_enrichments e ON e.supplier_item_id=s.id
    WHERE s.company=$1 AND s.presence='present' AND s.code=e.supplier_code
      AND s.product_data->>'uk'=e.supplier_brand AND e.image_id IS NOT NULL
      AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=COALESCE(s.product_data->>'oe',''))
      AND ($2::int[] IS NULL OR s.id IN (SELECT pc.supplier_item_id FROM product_source_categories pc WHERE pc.source='trodo' AND pc.category_id=ANY($2::int[])))
    ORDER BY e.imported_at DESC,s.id LIMIT 24`,[company,categoryIds])).rows.map(row=>row.id));

export async function getHomeProducts(categoryId?:number):Promise<CatalogProduct[]> {
  const company=process.env.BASBUG_FIRMA_ADI||"BASBUG";
  const categoryIds=categoryId?(await getStoreCategories()).filter(category=>category.path.includes(categoryId)).map(category=>category.id):null;
  const ids=await homeProductIds(company,categoryIds);
  return (await db.query<CatalogProduct>(`SELECT catalog.* FROM unnest($2::uuid[]) WITH ORDINALITY page(id,ordinal)
    JOIN LATERAL (SELECT * FROM (${catalogSql}) priced WHERE priced.id=page.id OFFSET 0) catalog ON true ORDER BY page.ordinal`,
    [company,ids])).rows;
}

export async function getHomeProductCategories(products:{id:string}[]) {
  const categories=await getStoreCategories();
  const rows=(await db.query<{supplier_item_id:string;category_id:number}>("SELECT supplier_item_id,category_id FROM product_source_categories WHERE source='trodo' AND supplier_item_id=ANY($1::uuid[])",[products.map(product=>product.id)])).rows;
  const labels=new Map<string,{name:string;slug:string;depth:number}>();
  for(const row of rows){const category=categories.find(category=>category.id===row.category_id);if(category&&category.path.length>(labels.get(row.supplier_item_id)?.depth??0))labels.set(row.supplier_item_id,{name:category.name,slug:category.slug,depth:category.path.length});}
  return labels;
}
