import type {Pool,PoolClient} from 'pg';
import {typeSlug,type TypedEnrichment} from './type-categories';

// parts2world part types (#852): article-info names each article's TecDoc generic article ("V-ribbed Belt"). Collect
// stores it as it goes; fetch-types re-asks the articles of enrichments written before; backfill-types maps the names
// through the Trodo dictionary.
type Db=Pool|PoolClient;
/** The stored source URL's ids, in SQL (the same URL productUrl builds). */
const urlPattern='^https://www\\.parts2world\\.com/tecdoc/#/product\\?mod=(\\d+)&link=(\\d+)&id=(\\d+)$';
const normalize=(value:string|null)=>(value??'').toUpperCase().replace(/[^A-Z0-9]/g,'');

export type ArticleType={articleId:number|string;linkId:number|string;brand:string|null;partNumber:string|null;spareInfo:string|null};
/** Stores (or replaces) one article's answer; brand/part/name null when the API had no article. */
export async function saveArticleType(db:Db,a:ArticleType){
 await db.query(`INSERT INTO parts2world_article_types(article_id,link_id,brand,part_number,spare_info) VALUES($1,$2,$3,$4,$5)
  ON CONFLICT(article_id,link_id) DO UPDATE SET brand=EXCLUDED.brand,part_number=EXCLUDED.part_number,spare_info=EXCLUDED.spare_info,fetched_at=now()`,
  [a.articleId,a.linkId,a.brand,a.partNumber,a.spareInfo]);
}

export type PendingArticle={articleId:number;linkId:number;vehicleTypeId:number;rows:number};
/** Articles of stored parts2world enrichments without a stored answer (retry: also those answered without a name),
 *  one per article in a hashed order, so a sample is not one brand. */
export async function pendingArticleTypes(db:Db,{retry=false}:{retry?:boolean}={}):Promise<PendingArticle[]>{
 const rows=(await db.query<{article_id:string;link_id:string;vehicle_type_id:string;rows:number}>(`WITH ids AS (
   SELECT regexp_match(source_url,$1) AS m FROM product_enrichments WHERE source_url LIKE 'https://www.parts2world.com/%'),
  articles AS (SELECT m[3]::bigint AS article_id,m[2]::bigint AS link_id,min(m[1]::bigint) AS vehicle_type_id,count(*)::int AS rows
   FROM ids WHERE m IS NOT NULL GROUP BY 1,2)
  SELECT a.article_id::text,a.link_id::text,a.vehicle_type_id::text,a.rows FROM articles a
  WHERE NOT EXISTS(SELECT 1 FROM parts2world_article_types t WHERE t.article_id=a.article_id AND t.link_id=a.link_id AND (NOT $2::boolean OR t.spare_info IS NOT NULL))
  ORDER BY md5(a.article_id::text||'/'||a.link_id::text)`,[urlPattern,retry])).rows;
 return rows.map(r=>({articleId:Number(r.article_id),linkId:Number(r.link_id),vehicleTypeId:Number(r.vehicle_type_id),rows:r.rows}));
}

/** Every parts2world enrichment with its stored part type. The type counts only while the stored answer still names the
 *  enrichment's article (same brand and part number); otherwise, or without a name, it is null and the backfill leaves
 *  the row alone. */
export async function parts2worldTypedEnrichments(db:Db):Promise<TypedEnrichment[]>{
 const rows=(await db.query<{supplier_item_id:string;source_url:string;manufacturer:string;manufacturer_part_number:string;
  brand:string|null;part_number:string|null;spare_info:string|null}>(`SELECT e.supplier_item_id::text,e.source_url,e.manufacturer,e.manufacturer_part_number,
   t.brand,t.part_number,t.spare_info
  FROM (SELECT supplier_item_id,source_url,manufacturer,manufacturer_part_number,regexp_match(source_url,$1) AS m
   FROM product_enrichments WHERE source_url LIKE 'https://www.parts2world.com/%') e
  LEFT JOIN parts2world_article_types t ON t.article_id=e.m[3]::bigint AND t.link_id=e.m[2]::bigint
  ORDER BY e.supplier_item_id`,[urlPattern])).rows;
 return rows.map(r=>{
  const same=Boolean(r.spare_info)&&normalize(r.brand)===normalize(r.manufacturer)&&normalize(r.part_number)===normalize(r.manufacturer_part_number);
  return {supplierItemId:r.supplier_item_id,sourceUrl:r.source_url,type:same&&r.spare_info?typeSlug(r.spare_info)||null:null};
 });
}
