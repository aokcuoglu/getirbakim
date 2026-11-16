import type {Pool,PoolClient} from 'pg';
import {categoryNodes,categoryRef,type SourceCategory} from './source-categories';

// Part type -> Trodo category dictionary (#851). Trodo names each product "<part type> <brand> <part number>" and lists
// its categories; sources without categories (spareto, parts2world) name the same TecDoc part types, so a type Trodo
// files consistently under the same categories gives their products those categories too. Source-agnostic: callers
// turn their own names into a type slug with typeSlug().

const slug=(value:string)=>value.normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
/** "Shaft Seal, differential" -> "shaft-seal-differential". */
export const typeSlug=(name:string)=>slug(name);
/** Brand as source URLs spell it: "MEAT & DORIA" -> "meat-and-doria", "HERTH+BUSS" -> "herth-plus-buss", "LEMFÖRDER" -> "lemforder". */
export const brandSlug=(brand:string)=>slug(brand.replace(/&/g,' and ').replace(/\+/g,' plus '));

/** The part type of a Trodo product name ("Sensor, coolant temperature AUTLOG AS2078" -> "Sensor, coolant temperature"). */
export function trodoType(name:string,brand:string){
 const upper=name.toUpperCase(),mark=' '+brand.trim().toUpperCase();
 if(mark.length<2)return null;
 for(let at=upper.indexOf(mark);at>=0;at=upper.indexOf(mark,at+1)){
  const next=upper[at+mark.length];
  if(next===undefined||next===' ')return name.slice(0,at).trim()||null;
 }
 return null;
}
/** The part type slug of a Trodo product URL slug ("condenser-air-conditioning-nrf-35492" + NRF), or null. */
export function trodoSlugType(productSlug:string,manufacturer:string){
 const brand=brandSlug(manufacturer);if(!brand)return null;
 const at=productSlug.indexOf('-'+brand+'-');
 return at>0?productSlug.slice(0,at):null;
}

/** Dictionary thresholds the spareto worker and every written backfill use; other values are for dry runs only, so a
 *  backfill never writes categories a later re-collection would replace. */
export const DEFAULT_MIN_SHARE=0.8;
export const DEFAULT_MIN_SUPPORT=2;

export type TypeObservation={type:string;categoryIds:number[]};
export type TypeCategoryPair={type:string;categoryId:number;support:number;total:number};
/** How often each category appears among a type's observations (support) out of the type's observations (total). */
export function learnTypeCategories(observations:TypeObservation[]):TypeCategoryPair[]{
 const totals=new Map<string,number>(),supports=new Map<string,Map<number,number>>();
 for(const {type,categoryIds} of observations){
  if(!type||!categoryIds.length)continue;
  totals.set(type,(totals.get(type)??0)+1);
  const counts=supports.get(type)??new Map<number,number>();supports.set(type,counts);
  for(const id of new Set(categoryIds))counts.set(id,(counts.get(id)??0)+1);
 }
 return [...supports].flatMap(([type,counts])=>[...counts].map(([categoryId,support])=>({type,categoryId,support,total:totals.get(type)!})))
  .sort((a,b)=>a.type.localeCompare(b.type)||a.categoryId-b.categoryId);
}
/** Pairs a dictionary keeps: the category appears in at least minShare of the type's observations, minSupport times. */
export function acceptedPairs(pairs:TypeCategoryPair[],{minShare=DEFAULT_MIN_SHARE,minSupport=DEFAULT_MIN_SUPPORT}:{minShare?:number;minSupport?:number}={}){
 return pairs.filter(p=>p.support>=minSupport&&p.support>=minShare*p.total-1e-9);
}

type Db=Pool|PoolClient;
const cacheSql=`SELECT substring(path from '/product-url/([^/]+)/') AS slug,a->>'name' AS name,
  COALESCE(NULLIF(a->'label'->'brand'->>'name',''),a->>'manufacturer') AS brand,
  ARRAY(SELECT DISTINCT x::int FROM (
   SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(a->'category_ids')='array' THEN a->'category_ids' ELSE '[]' END) AS x
   UNION ALL SELECT c->>'category_id' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a->'category')='array' THEN a->'category' ELSE '[]' END) c
  ) ids WHERE x ~ '^[0-9]{1,9}$') AS ids
 FROM (SELECT path,body->0->'attributes' AS a FROM enrichment_source_cache
  WHERE host='www.trodo.com' AND path LIKE '/rest/V1/catalog-product-api/product-url/%' AND jsonb_typeof(body)='array') t`;
const enrichmentSql=`SELECT substring(source_url from '^https://www\\.trodo\\.com/([a-z0-9-]+)$') AS slug,manufacturer,
  ARRAY(SELECT DISTINCT (c->>'id')::int FROM jsonb_array_elements(payload->'categories') c WHERE c->>'source'='trodo' AND c->>'id' ~ '^[0-9]{1,9}$') AS ids
 FROM product_enrichments WHERE source_url LIKE 'https://www.trodo.com/%' AND jsonb_typeof(payload->'categories')='array'`;
/** Trodo product observations: the raw API cache (with the product name) and stored Trodo enrichments, one per product
 *  slug (the cache wins). Categories missing from the tree are dropped; products left without categories are skipped. */
export async function trodoObservations(db:Db){
 const known=new Set((await db.query<{category_id:number}>("SELECT category_id FROM source_categories WHERE source='trodo'")).rows.map(r=>r.category_id));
 const bySlug=new Map<string,{type:string|null;ids:number[]}>();
 for(const row of (await db.query<{slug:string|null;name:string|null;brand:string|null;ids:number[]}>(cacheSql)).rows){
  if(!row.slug||bySlug.has(row.slug))continue;
  const type=row.name&&row.brand?trodoType(row.name,row.brand):null;
  bySlug.set(row.slug,{type:type&&typeSlug(type),ids:row.ids});
 }
 for(const row of (await db.query<{slug:string|null;manufacturer:string;ids:number[]}>(enrichmentSql)).rows){
  if(!row.slug||bySlug.has(row.slug))continue;
  bySlug.set(row.slug,{type:trodoSlugType(row.slug,row.manufacturer),ids:row.ids});
 }
 const observations:TypeObservation[]=[];let skippedNoType=0,skippedNoCategory=0,skippedUnknownCategory=0;
 for(const {type,ids} of bySlug.values()){
  if(!ids.length){skippedNoCategory++;continue;}
  if(!type){skippedNoType++;continue;}
  const categoryIds=ids.filter(id=>known.has(id));
  if(categoryIds.length<ids.length)skippedUnknownCategory+=ids.length-categoryIds.length;
  if(categoryIds.length)observations.push({type,categoryIds});else skippedNoCategory++;
 }
 return {observations,products:bySlug.size,skippedNoType,skippedNoCategory,skippedUnknownCategory};
}
/** Rebuilds the Trodo dictionary from the current observations in one transaction. */
export async function relearnTypeCategories(pool:Pool){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(20261007,2)');
  const {observations,products,skippedNoType,skippedNoCategory,skippedUnknownCategory}=await trodoObservations(client);
  const pairs=learnTypeCategories(observations);
  await client.query("DELETE FROM product_type_categories WHERE source='trodo'");
  if(pairs.length)await client.query(`INSERT INTO product_type_categories(type,source,category_id,support,total)
   SELECT type,'trodo',category_id,support,total FROM unnest($1::text[],$2::int[],$3::int[],$4::int[]) AS p(type,category_id,support,total)`,
   [pairs.map(p=>p.type),pairs.map(p=>p.categoryId),pairs.map(p=>p.support),pairs.map(p=>p.total)]);
  await client.query('COMMIT');
  return {types:new Set(pairs.map(p=>p.type)).size,pairs:pairs.length,observations:observations.length,products,skippedNoType,skippedNoCategory,skippedUnknownCategory};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

// Plural folding of the last word only, for sources that name types in the plural ("v-ribbed-belts"). Words that end
// in s as singulars stay as they are.
const singularS=new Set(['glass','gas','bus','axis','brass','chassis','bias','lens','canvas','series','abs','plus','atlas','news']);
function singular(word:string){
 if(singularS.has(word)||/(ss|us|is)$/.test(word)||word.length<4)return word;
 if(/ies$/.test(word))return word.slice(0,-3)+'y';
 if(/(ches|shes|xes|sses)$/.test(word))return word.slice(0,-2);
 return word.endsWith('s')?word.slice(0,-1):word;
}
const folded=(type:string)=>{const at=type.lastIndexOf('-');return at<0?singular(type):type.slice(0,at+1)+singular(type.slice(at+1));};
const setKey=(categories:SourceCategory[])=>categories.map(c=>c.id).sort((a,b)=>a-b).join(',');

export type TypeDictionary={exact:Map<string,SourceCategory[]>;folded:Map<string,SourceCategory[]|null>};
/** Exact types plus a plural-folded index; folded keys that would pick different category sets are ambiguous (null). */
export function typeDictionary(entries:Map<string,SourceCategory[]>):TypeDictionary{
 const byFold=new Map<string,SourceCategory[]|null>();
 for(const [type,categories] of entries){
  const key=folded(type);
  if(!byFold.has(key))byFold.set(key,categories);
  else{const seen=byFold.get(key);if(seen&&setKey(seen)!==setKey(categories))byFold.set(key,null);}
 }
 return {exact:entries,folded:byFold};
}
/** The dictionary's accepted pairs with full category paths. */
export async function loadTypeCategories(db:Db,{minShare=DEFAULT_MIN_SHARE,minSupport=DEFAULT_MIN_SUPPORT}:{minShare?:number;minSupport?:number}={}){
 const rows=(await db.query<{type:string;category_id:number;support:number;total:number}>(
  "SELECT type,category_id,support,total FROM product_type_categories WHERE source='trodo' ORDER BY type,category_id")).rows;
 const byId=await categoryNodes(db),entries=new Map<string,SourceCategory[]>();
 for(const p of acceptedPairs(rows.map(r=>({type:r.type,categoryId:r.category_id,support:r.support,total:r.total})),{minShare,minSupport})){
  if(!byId.has(p.categoryId))continue;
  entries.set(p.type,[...(entries.get(p.type)??[]),categoryRef(byId,p.categoryId)]);
 }
 return typeDictionary(entries);
}
/** Categories of a type: exact match, then without a numeric "-1" tail, then the plural-folded form; [] when unknown.
 *  Never a suffix or substring match ("water-pump-and-timing-belt-set" is not a "timing-belt-set"). */
export function categoriesForType(dict:TypeDictionary,type:string|null):SourceCategory[]{
 if(!type)return [];
 const candidates=[type,...(/-\d+$/.test(type)?[type.replace(/-\d+$/,'')]:[])];
 for(const candidate of candidates){const hit=dict.exact.get(candidate);if(hit)return hit;}
 for(const candidate of candidates){const hit=dict.folded.get(folded(candidate));if(hit)return hit;}
 return [];
}

export type TypedEnrichment={supplierItemId:string;sourceUrl:string;type:string|null};
/** Writes each row's dictionary categories to its enrichment and category links. A row without a type (its URL does not
 *  name one) is only counted: the worker may have stored categories from the page's own part name. A row whose
 *  categories are already the same is left alone, so imported_at (and storefront:sync) moves only for real changes; a row whose source URL changed
 *  meanwhile is not touched. dryRun only reads. */
export async function backfillTypeCategories(pool:Pool,rows:TypedEnrichment[],dict:TypeDictionary,{dryRun=false}:{dryRun?:boolean}={}){
 const result={rows:rows.length,mapped:0,changed:0,unchanged:0,missing:0,noType:0};
 const unmapped=new Map<string,number>();
 for(let start=0;start<rows.length;start+=500){
  const batch=rows.slice(start,start+500).flatMap(row=>{
   if(!row.type){result.noType++;return [];}
   const categories=categoriesForType(dict,row.type);
   if(categories.length)result.mapped++;else unmapped.set(row.type,(unmapped.get(row.type)??0)+1);
   return [{...row,categories:JSON.stringify(categories)}];
  });
  if(!batch.length)continue;
  const params=[batch.map(r=>r.supplierItemId),batch.map(r=>r.sourceUrl),batch.map(r=>r.categories)];
  const input=`unnest($1::uuid[],$2::text[],$3::jsonb[]) AS i(id,url,categories)`;
  const client=await pool.connect();
  try{
   await client.query(dryRun?'BEGIN READ ONLY':'BEGIN');
   const seen=(await client.query<{matched:number;differs:number}>(`SELECT count(*)::int AS matched,
     count(*) FILTER (WHERE COALESCE(e.payload->'categories','[]'::jsonb) IS DISTINCT FROM i.categories)::int AS differs
    FROM ${input} JOIN product_enrichments e ON e.supplier_item_id=i.id AND e.source_url=i.url`,params)).rows[0];
   let changed=seen.differs;
   if(!dryRun&&changed){
    const updated=(await client.query<{id:string;categories:unknown}>(`UPDATE product_enrichments e
      SET payload=jsonb_set(e.payload,'{categories}',i.categories),imported_at=now()
     FROM ${input} WHERE e.supplier_item_id=i.id AND e.source_url=i.url
      AND COALESCE(e.payload->'categories','[]'::jsonb) IS DISTINCT FROM i.categories
     RETURNING e.supplier_item_id::text AS id,i.categories`,params)).rows;
    changed=updated.length;
    const ids=updated.map(r=>r.id);
    await client.query('DELETE FROM product_source_categories WHERE supplier_item_id=ANY($1::uuid[])',[ids]);
    await client.query(`INSERT INTO product_source_categories(supplier_item_id,source,category_id)
     SELECT u.id,sc.source,sc.category_id FROM unnest($1::uuid[],$2::jsonb[]) AS u(id,categories)
      CROSS JOIN LATERAL jsonb_array_elements(u.categories) c
      JOIN source_categories sc ON sc.source=c->>'source' AND sc.category_id=(c->>'id')::int
     ON CONFLICT DO NOTHING`,[ids,updated.map(r=>JSON.stringify(r.categories))]);
   }
   await client.query(dryRun?'ROLLBACK':'COMMIT');
   result.changed+=changed;result.unchanged+=seen.matched-changed;result.missing+=batch.length-seen.matched;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
 return {...result,unmappedTypes:[...unmapped].map(([type,count])=>({type,count})).sort((a,b)=>b.count-a.count||a.type.localeCompare(b.type))};
}
