import type {Pool} from 'pg';
import {partKey,manufacturerBrandKey,supplierPartKeys} from '../store/enrichment-contract';
import {productSchema,safeProductSlug,type SourceProduct} from './trodo-adapter';
export {supplierPartKeys};
/** Search result products worth keeping: an identifiable part with an openable product page. Only the fields the
 *  worker reads are stored. */
export function searchProductRows(products:SourceProduct[]){
 return products.flatMap(p=>{
  const key=partKey(p.tecdoc_sku);
  try{safeProductSlug(p);}catch{return [];}
  if(!key)return [];
  const product={entity_id:p.entity_id,manufacturer:p.manufacturer,tecdoc_sku:p.tecdoc_sku,url_key:p.url_key,url_path:p.url_path,media:p.media,category:p.category,category_ids:p.category_ids};
  return [{partKey:key,entityId:String(p.entity_id),brandKey:manufacturerBrandKey(p.manufacturer),product}];
 });
}
/** Keeps the products of a fetched search; a failed write is logged and never stops a run. */
export async function recordSearchProducts(pool:Pool,products:SourceProduct[]){
 const rows=searchProductRows(products);if(!rows.length)return;
 await pool.query(`INSERT INTO enrichment_search_products(part_key,entity_id,brand_key,product)
  SELECT r->>'partKey',r->>'entityId',r->>'brandKey',r->'product' FROM jsonb_array_elements($1::jsonb) r
  ON CONFLICT(part_key,entity_id) DO UPDATE SET brand_key=EXCLUDED.brand_key,product=EXCLUDED.product,seen_at=now()`,[JSON.stringify(rows)])
  .catch(error=>console.error('Search products not stored:',String(error)));
}
/** Source products earlier searches listed under the supplier code's part numbers. */
export async function knownSearchProducts(pool:Pool,code:string){
 const rows=(await pool.query('SELECT product FROM enrichment_search_products WHERE part_key=ANY($1)',[supplierPartKeys(code)])).rows;
 return rows.flatMap(r=>{const parsed=productSchema.safeParse(r.product);return parsed.success?[parsed.data]:[];});
}
