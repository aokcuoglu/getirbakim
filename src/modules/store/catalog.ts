import "server-only";
import { db } from "@/lib/db";
import { z } from "zod";
import { cache } from "react";
import { staleCache } from "@/lib/stale-cache";
export type { CatalogQuery } from "./catalog-query";
import type { CatalogQuery } from "./catalog-query";
import {getStoreCategories} from './categories';
import {legacyCategoryIds} from './category-tree';
import {getVehicleBrandBySlug} from './vehicle-catalog.server';
import {normalizeSearchText,parseSearchQuery,searchTooShort,wholeWords,type ParsedSearch} from '@/modules/search/query';
import {binder,catalogRank,correctSearch,storeProductMatch,supplierItemMatch,vehicleTypeMatch,type Bind,type SearchMode} from '@/modules/search/sql';
import {selectedBrands,selectedAttributes,specificationLabel,type CatalogFacet} from './catalog-filters';
export type Product = { id: string; category: string; supplier: "dinamik" | "basbug" | "demo"; code: string; name: string; brand: string; description: string; price_kurus: number; stock: number; updated_at: Date };
export type CatalogProduct = Omit<Product, "price_kurus" | "stock" | "category"> & {
 category: string | null; price_kurus: number | null; stock: number | null; oem: string; source: "store" | "supplier";
 available: boolean; max_quantity: number; stock_label: string; pricing_snapshot: Record<string, unknown>;
};
// Prices and availability are calculated by the shared commerce view.
export const catalogSql = "SELECT * FROM commerce_catalog WHERE source='store' OR company=$1";
const catalogEntriesSql = "SELECT * FROM commerce_catalog_entries WHERE source='store' OR company=$1";
const company = () => process.env.BASBUG_FIRMA_ADI || "BASBUG";
export async function searchProducts(code: string): Promise<CatalogProduct[]> {
 if (!code.trim()) return [];
 return (await browseProducts({q:code,searchBy:"code"})).items;
}
export async function getProduct(id: string): Promise<CatalogProduct | undefined> {
 if (!z.uuid().safeParse(id).success) return undefined;
 return (await db.query<CatalogProduct>(`SELECT * FROM (${catalogSql}) catalog WHERE id=$2`,[company(),id])).rows[0];
}
export function servicePrice(price: number, discount: number) { return Math.round(price * (100-discount) / 100); }
export function money(kurus: number) { return new Intl.NumberFormat("tr-TR",{ style:"currency", currency:"TRY" }).format(kurus/100); }

export const categories = [
 {slug:"yedek-parca",name:"Yedek parçalar",art:"parts"},
 {slug:"fren",name:"Fren sistemi",art:"brakes"},
 {slug:"filtre",name:"Filtreler",art:"filter"},
 {slug:"yag",name:"Yağlar ve sıvılar",art:"oil"},
 {slug:"silecek",name:"Silecekler",art:"wipers"},
 {slug:"aksesuar",name:"Aksesuar ve ekipman",art:"tools"},
] as const;
// Fitments observed in the product's current, trusted enrichment payload; `f` is product_vehicle_fitments.
const trustedFitments=`JOIN product_enrichments e ON e.supplier_item_id=f.supplier_item_id AND f.source_vehicle=e.payload->'vehicles'->f.source_index
    JOIN supplier_items s ON s.id=e.supplier_item_id AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
    AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=COALESCE(s.product_data->>'oe',''))`;
/**
 * `vehicle`: the query named a part and a vehicle ("fren balatası passat"). `fitted` says whether
 * the ids are the parts linked to that vehicle, or (no linked part yet) every match of `productText`.
 */
export type VehicleSearchScope={productText:string;vehicleText:string;fitted:boolean};
type CatalogSearch={parsed:ParsedSearch;ids:string[];correctedQuery?:string;vehicle?:VehicleSearchScope;tooShort?:boolean};
// Broad one-word prefixes ("a") stop here instead of shipping every catalog id around.
const maxSearchHits=50000;
/** Ids of every catalog row the search matches: supplier items, store products and enriched OEM numbers. */
function searchHits(parsed:ParsedSearch,bind:Bind,mode:SearchMode){
 const hits=[`SELECT i.id FROM commerce_supplier_items i WHERE ${supplierItemMatch("i",parsed,bind,mode)}`,
  `SELECT p.id FROM products p WHERE ${storeProductMatch("p",parsed,bind,mode)}`];
 if(parsed.compact.length>=3)hits.push(`SELECT e.supplier_item_id FROM product_enrichments e
    JOIN supplier_items supplier_item ON supplier_item.id=e.supplier_item_id
      AND supplier_item.code=e.supplier_code AND supplier_item.product_data->>'uk'=e.supplier_brand
      AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=COALESCE(supplier_item.product_data->>'oe',''))
    CROSS JOIN LATERAL jsonb_each(e.payload->'oemNumbers') refs
    CROSS JOIN LATERAL jsonb_array_elements_text(refs.value) reference(number)
    WHERE search_compact(reference.number) LIKE ${bind(`%${parsed.compact}%`)}`);
 return hits.join(" UNION ALL ");
}
/** Parses the query and, when nothing matches as typed, retries it with mistyped words corrected. */
// Memoised per request: the listing, its facets and the vehicle-fit count all filter by the same search.
// The matching ids are fetched once through the search indexes; given as `id = ANY(...)` every later
// query reaches supplier_items by primary key. Joined as a subquery instead, the planner hash-joined
// the whole 320k-row price view per query (~2.5 s each on the VPS, ~60 s per page).
const catalogSearch=cache(async(raw:string,mode:SearchMode):Promise<CatalogSearch>=>{
 const hits=async(candidate:ParsedSearch)=>{const values:unknown[]=[];
  return (await db.query<{id:string}>(`SELECT DISTINCT id::text FROM (${searchHits(candidate,binder(values),mode)}) hit(id) LIMIT ${maxSearchHits}`,values)).rows.map(row=>row.id);};
 if(searchTooShort(raw))return {parsed:parseSearchQuery(raw),ids:[],tooShort:true};
 const parsed=parseSearchQuery(raw),ids=await hits(parsed);
 if(mode==="code"||ids.length)return {parsed,ids};
 // Cheapest reading first: the words as typed split into part + vehicle, then the whole query
 // spell-corrected ("hava fiiltresi"), then a split with each part corrected ("fren balatsı pasat").
 const vehicle=await vehicleSearch(raw,hits,false);
 if(vehicle)return vehicle;
 const corrected=await correctSearch(raw,"product");
 const correctedIds=corrected?await hits(corrected.parsed):[];
 if(corrected&&correctedIds.length)return {parsed:corrected.parsed,ids:correctedIds,correctedQuery:corrected.text};
 return await vehicleSearch(raw,hits,true)??{parsed,ids};
});
/**
 * Product names never mention vehicles, so "fren balatası passat" matches nothing as a whole. Tries
 * every split of the words into a leading or trailing vehicle part ("passat", "golf 7 2015") and a
 * part that matches products. Splits whose parts are linked by fitments win, then the longest
 * vehicle part ("buji | bmw 320d" over "buji bmw | 320d").
 */
async function vehicleSearch(raw:string,hits:(parsed:ParsedSearch)=>Promise<string[]>,correct:boolean):Promise<CatalogSearch|null>{
 const words=normalizeSearchText(raw.slice(0,120)).split(" ").filter(Boolean);
 if(words.length<2||words.length>6)return null;
 // Notices quote the shopper's own spelling ("yağ filtresi") when each typed word is one search word.
 const typed=raw.trim().split(/\s+/),sameWords=typed.length===words.length&&typed.every((word,index)=>normalizeSearchText(word)===words[index]);
 const display=(text:string,part:string[])=>sameWords&&text===part.join(" ")?part.map(word=>typed[words.indexOf(word)]).join(" "):text;
 const splits=words.slice(1).flatMap((_,index)=>{const size=index+1;
  return [{product:words.slice(0,words.length-size),vehicle:words.slice(words.length-size)},{product:words.slice(size),vehicle:words.slice(0,size)}];});
 let best:(CatalogSearch&{vehicleWords:number})|null=null;
 for(const split of splits){
  if(best&&(best.vehicle?.fitted||split.vehicle.length<=best.vehicleWords))continue;
  if(!parseSearchQuery(split.vehicle.join(" ")).terms.some(term=>term.required&&/[a-z]/.test(term.text)))continue;
  // Each part is spell-checked against its own vocabulary: "pasat" is a vehicle word, "balatsı" a part word.
  const vehicle=await resolvePart(split.vehicle.join(" "),"vehicle",correct,async parsed=>{const values:unknown[]=[];
   return Boolean((await db.query(`SELECT 1 FROM vehicle_types v WHERE ${vehicleTypeMatch("v",parsed,binder(values))} LIMIT 1`,values)).rowCount);});
  if(!vehicle)continue;
  let ids:string[]=[];
  const product=await resolvePart(split.product.join(" "),"product",correct,async parsed=>(ids=await hits(parsed)).length>0);
  if(!product)continue;
  const fitValues:unknown[]=[ids],fitBind=binder(fitValues);
  const fitted=(await db.query<{id:string}>(`SELECT DISTINCT f.supplier_item_id::text AS id FROM product_vehicle_fitments f ${trustedFitments}
   JOIN vehicle_types v ON v.id=f.vehicle_type_id WHERE f.supplier_item_id=ANY($1::uuid[]) AND ${vehicleTypeMatch("v",vehicle.parsed,fitBind)}`,fitValues)).rows.map(row=>row.id);
  const candidate={parsed:product.parsed,ids:fitted.length?fitted:ids,vehicleWords:split.vehicle.length,
   vehicle:{productText:display(product.text,split.product),vehicleText:display(vehicle.text,split.vehicle),fitted:fitted.length>0}};
  if(!best||(candidate.vehicle.fitted&&!best.vehicle?.fitted)||(candidate.vehicle.fitted===best.vehicle?.fitted&&candidate.vehicleWords>best.vehicleWords))best=candidate;
 }
 return best&&{parsed:best.parsed,ids:best.ids,vehicle:best.vehicle};
}
// Vehicle words must be whole words ("passat", "golf 7"), so a part word that only starts a make
// ("hava" → HAVAL) does not split "hava filtresi" into a vehicle and a part.
/** The part as typed, else (when `correct`) spell-corrected, if it `matches`; null otherwise. */
async function resolvePart(text:string,scope:"vehicle"|"product",correct:boolean,matches:(parsed:ParsedSearch)=>Promise<boolean>){
 const options={years:scope==="vehicle"},parse=(value:string)=>scope==="vehicle"?wholeWords(parseSearchQuery(value,options)):parseSearchQuery(value,options);
 const parsed=parse(text);
 if(await matches(parsed))return {text,parsed};
 if(!correct)return null;
 const corrected=await correctSearch(text,scope,options);
 const correctedParsed=corrected&&parse(corrected.text);
 return corrected&&correctedParsed&&await matches(correctedParsed)?{text:corrected.text,parsed:correctedParsed}:null;
}
/** `vehicleTypeId` is the garage vehicle's catalog type; without it a `fits` filter matches nothing. */
export type CatalogContext={vehicleTypeId?:string|null};
async function catalogFilter(query:CatalogQuery,context:CatalogContext={}) {
 const values: unknown[] = [company()]; const clauses: string[] = [];
 let search:CatalogSearch|undefined;
 if(query.q?.trim()) {
  search=await catalogSearch(query.q,query.searchBy==="code"?"code":"all");
  clauses.push(`catalog.id=ANY(${binder(values)(search.ids)}::uuid[])`);
 }
 if(query.category) {
  const selected=(await getStoreCategories()).find(c=>c.slug===query.category);
  if(!selected)clauses.push('false');
  else {
   const descendants=(await getStoreCategories()).filter(c=>c.path.includes(selected.id)).map(c=>c.id);
   values.push(Object.entries(legacyCategoryIds).filter(([,id])=>descendants.includes(id)).map(([slug])=>slug));const legacyKey=`$${values.length}`;
   values.push(descendants);const idsKey=`$${values.length}`;
   clauses.push(`(catalog.category=ANY(${legacyKey}::text[]) OR catalog.id IN (
    SELECT pc.supplier_item_id FROM product_source_categories pc JOIN product_enrichments e USING(supplier_item_id)
    JOIN supplier_items s ON s.id=e.supplier_item_id AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
    AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=COALESCE(s.product_data->>'oe',''))
    WHERE pc.source='trodo' AND pc.category_id=ANY(${idsKey}::int[])))`);
  }
 }
 if(query.make) {
  const make=await getVehicleBrandBySlug(query.make);
  if(!make)clauses.push('false');
  else {
   values.push(Number(make.id));
   clauses.push(`catalog.id IN (SELECT f.supplier_item_id FROM vehicle_models m
    JOIN vehicle_types v ON v.model_id=m.id
    JOIN product_vehicle_fitments f ON f.vehicle_type_id=v.id
    ${trustedFitments}
    WHERE m.brand_id=$${values.length})`);
  }
 }
 if(query.fits==='vehicle') {
  if(!context.vehicleTypeId)clauses.push('false');
  else {
   values.push(Number(context.vehicleTypeId));
   clauses.push(`catalog.id IN (SELECT f.supplier_item_id FROM product_vehicle_fitments f ${trustedFitments} WHERE f.vehicle_type_id=$${values.length})`);
  }
 }
 const brands=selectedBrands(query);if(brands.length){values.push(brands);clauses.push(`brand=ANY($${values.length}::text[])`);}
 for(const [attribute,options] of Object.entries(selectedAttributes(query))){if(!options.length)continue;
  values.push(attribute);const attributeKey=`$${values.length}`;values.push(options);const optionsKey=`$${values.length}`;
  clauses.push(`catalog.id IN (SELECT e.supplier_item_id FROM product_enrichments e JOIN supplier_items s ON s.id=e.supplier_item_id
   AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
   AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=COALESCE(s.product_data->>'oe',''))
   CROSS JOIN LATERAL jsonb_array_elements(e.payload->'specifications') spec
   WHERE spec->>0=${attributeKey} AND spec->>1=ANY(${optionsKey}::text[])
   AND (spec->>0<>'Brand class' OR e.match_basis->>'type'='exact_part'))`);
 }
 if(query.availability)clauses.push(`catalog.id IN (SELECT id FROM (${catalogSql}) available_catalog WHERE ${query.availability==='in_stock'?'available':"NOT available AND stock_label='Stokta yok'"})`);
 const where = clauses.length ? "WHERE "+clauses.join(" AND ") : "";
 const from = `FROM (${catalogEntriesSql}) catalog ${where}`;
 return {values,where,from,search};
}
// Listings without a search scan the whole 320k-row catalog for counts, facets and the date order
// (~0.5-1.5 s each on the VPS). Those change only with supplier syncs, so they are served from a
// 10-minute stale-while-revalidate cache; prices and stock are still read live for the listed ids.
const aggregateTtl=10*60*1000;
const cachedCounts=staleCache<number>(aggregateTtl),cachedPageIds=staleCache<string[]>(aggregateTtl);
const cachedFacets=staleCache<{brands:string[];attributes:CatalogFacet[]}>(aggregateTtl),cachedBrands=staleCache<string[]>(aggregateTtl);
/** Cache key of everything that narrows the listing except search, which goes uncached. */
function filterKey(query:CatalogQuery,context:CatalogContext){
 return JSON.stringify([query.category,query.make,query.brand,query.brands,query.attributes,query.availability,query.fits,query.fits?context.vehicleTypeId:null]);
}
export async function browseProducts(query:CatalogQuery,context:CatalogContext={}){
 const {values,where,from,search}=await catalogFilter(query,context);
 const count=async()=>Number((await db.query<{count:string}>(`SELECT count(*) ${from}`,values)).rows[0].count);
 const total = search ? await count() : await cachedCounts(filterKey(query,context),count);
 const pageSize = 60, pages = Math.max(1,Math.ceil(total/pageSize));
 const requested = Number(query.page);
 const page = Number.isSafeInteger(requested) ? Math.min(pages,Math.max(1,requested)) : 1;
 const order=query.sort === "price-asc" ? "price_kurus ASC NULLS LAST,id" : query.sort === "price-desc" ? "price_kurus DESC NULLS LAST,id" : "updated_at DESC,id";
 const pricedSort = query.sort === "price-asc" || query.sort === "price-desc";
 // A search lists the best matches first unless the shopper picked another order.
 const pageValues=[...values],bind=binder(pageValues);
 const rank=search&&(query.sort??"relevance")==="relevance"?catalogRank("catalog",search.parsed,bind):"0";
 const offset=bind((page-1)*pageSize);
 if(!search&&!pricedSort){
  const ids=await cachedPageIds(`${filterKey(query,context)}|${page}`,async()=>(await db.query<{id:string}>(
   `SELECT id::text FROM (SELECT id,updated_at ${from} ORDER BY ${order} LIMIT ${pageSize} OFFSET $${values.length+1}) page`,[...values,(page-1)*pageSize])).rows.map(row=>row.id));
  const items=(await db.query<CatalogProduct>(`SELECT catalog.* FROM unnest($2::uuid[]) WITH ORDINALITY page(id,ordinal)
   JOIN LATERAL (SELECT * FROM (${catalogSql}) priced WHERE priced.id=page.id OFFSET 0) catalog ON true ORDER BY page.ordinal`,[company(),ids])).rows;
  return {items,total,page,pages,pageSize};
 }
 const items = (await db.query<CatalogProduct>(pricedSort
  ? `SELECT * FROM (${catalogSql}) catalog ${where} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`
  : `WITH page AS MATERIALIZED (SELECT id,updated_at,${rank} AS rank ${from} ORDER BY rank DESC,${order} LIMIT ${pageSize} OFFSET ${offset})
     SELECT catalog.* FROM page JOIN LATERAL (SELECT * FROM (${catalogSql}) priced WHERE priced.id=page.id OFFSET 0) catalog ON true
     ORDER BY page.rank DESC,page.updated_at DESC,page.id`, pageValues)).rows;
 return {items,total,page,pages,pageSize,correctedQuery:search?.correctedQuery,vehicleScope:search?.vehicle,searchTooShort:search?.tooShort};
}
export type ProductSuggestion={id:string;name:string;brand:string;code:string};
/** Best matches for the header type-ahead: the catalog search's engine and readings, without prices. */
export async function suggestProducts(raw:string,mode:SearchMode,limit=6){
 const search=await catalogSearch(raw,mode);
 const notes={correctedQuery:search.correctedQuery,vehicleScope:search.vehicle};
 if(!search.ids.length)return {products:[] as ProductSuggestion[],...notes};
 const values:unknown[]=[company(),search.ids],bind=binder(values);
 // One suggestion per name and brand: a supplier lists the same part in many sizes.
 const products=(await db.query<ProductSuggestion>(`SELECT id,name,brand,code FROM (
  SELECT DISTINCT ON (name,brand) id::text,name,brand,code,rank,updated_at FROM (
   SELECT catalog.*,${catalogRank("catalog",search.parsed,bind)} AS rank FROM (${catalogEntriesSql}) catalog WHERE catalog.id=ANY($2::uuid[])) ranked
  ORDER BY name,brand,rank DESC,updated_at DESC,id) best ORDER BY rank DESC,updated_at DESC,id LIMIT ${Number(limit)}`,values)).rows;
 return {products,...notes};
}
export async function catalogBrands() {
 return cachedBrands("all",async()=>(await db.query<{brand:string}>(`SELECT DISTINCT brand FROM (${catalogEntriesSql}) catalog ORDER BY brand`,[company()])).rows.map(p=>p.brand));
}

/** Products in the current search, category and make scope that are linked to the vehicle type. */
export async function vehicleFitCount(query:CatalogQuery,vehicleTypeId:string) {
 const scope:CatalogQuery={q:query.q,searchBy:query.searchBy,category:query.category,make:query.make,fits:'vehicle'};
 const {values,from,search}=await catalogFilter(scope,{vehicleTypeId});
 const count=async()=>Number((await db.query<{count:string}>(`SELECT count(*) ${from}`,values)).rows[0].count);
 return search ? count() : cachedCounts(filterKey(scope,{vehicleTypeId}),count);
}
/** Which of the listed products are linked to the vehicle type, for the card badge. */
export async function productsFittingVehicle(ids:string[],vehicleTypeId:string) {
 if(!ids.length)return new Set<string>();
 return new Set((await db.query<{id:string}>(`SELECT DISTINCT f.supplier_item_id::text AS id FROM product_vehicle_fitments f ${trustedFitments}
  WHERE f.vehicle_type_id=$1 AND f.supplier_item_id=ANY($2::uuid[])`,[Number(vehicleTypeId),ids])).rows.map(row=>row.id));
}
export async function catalogFacets(query:CatalogQuery,context:CatalogContext={}){
 const scope:CatalogQuery={q:query.q,searchBy:query.searchBy,category:query.category,make:query.make,fits:query.fits};
 const {values,from,search}=await catalogFilter(scope,context);
 const load=()=>facetsFor(values,from);
 return search ? load() : cachedFacets(filterKey(scope,context),load);
}
async function facetsFor(values:unknown[],from:string){
 const brands=(await db.query<{brand:string}>(`SELECT DISTINCT brand ${from} ORDER BY brand`,values)).rows.map(r=>r.brand);
 // MATERIALIZED: inlined, the search filter gets planned across the enrichment joins (~60 s instead of ms).
 const rows=(await db.query<{key:string;values:string[]}>(`WITH scoped AS MATERIALIZED (SELECT catalog.id ${from})
 SELECT spec->>0 AS key,array_agg(DISTINCT spec->>1 ORDER BY spec->>1) AS values
 FROM scoped JOIN product_enrichments e ON e.supplier_item_id=scoped.id JOIN supplier_items s ON s.id=e.supplier_item_id
 AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
 AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=COALESCE(s.product_data->>'oe',''))
 CROSS JOIN LATERAL jsonb_array_elements(e.payload->'specifications') spec
 WHERE spec->>0 IN ('Fitting Position','Brand class','Filter type','Lamp Type','Bulb Type','Fuel Type','Shock Absorber Type','Shock Absorber System','Wiper blade type','Oil Viscosity Classification SAE','Transmission Type','Mounting Type') AND length(spec->>1)<=200
 AND (spec->>0<>'Brand class' OR e.match_basis->>'type'='exact_part')
 GROUP BY spec->>0 HAVING count(DISTINCT spec->>1)<=40 ORDER BY CASE WHEN spec->>0='Fitting Position' THEN 0 WHEN spec->>0='Brand class' THEN 1 ELSE 2 END,spec->>0 LIMIT 8`,values)).rows;
 return {brands,attributes:rows.map(row=>({...row,label:specificationLabel(row.key)})) as CatalogFacet[]};
}
