import "server-only";
import { db } from "@/lib/db";
import { storefrontCompanies } from "@/modules/suppliers/storefront-sources";
import { z } from "zod";
import { cache } from "react";
import { staleCache } from "@/lib/stale-cache";
export type { CatalogQuery } from "./catalog-query";
import type { CatalogQuery } from "./catalog-query";
import {getStoreCategories} from './categories';
import {legacyCategoryIds} from './category-tree';
import {getVehicleBrandBySlug} from './vehicle-catalog.server';
import {normalizeSearchText,parseSearchQuery,exactTsQuery,prefixTsQuery,searchTooShort,wholeWords,withoutSynonyms,type ParsedSearch} from '@/modules/search/query';
import {binder,catalogRank,correctSearch,storeProductMatch,supplierItemMatch,vehicleTypeMatch,type Bind,type SearchMode} from '@/modules/search/sql';
import {selectedBrands,selectedAttributes,specificationLabel,type CatalogFacet} from './catalog-filters';
import {engineOilCategoryId,parseOilFilters} from './vehicle-oil';
import {engineOilIds,vehicleOilProductIds} from './vehicle-oil.server';
export type Product = { id: string; category: string; supplier: "dinamik" | "basbug" | "seta" | "demo"; code: string; name: string; brand: string; description: string; price_kurus: number; stock: number; updated_at: Date };
export type CatalogProduct = Omit<Product, "price_kurus" | "stock" | "category"> & {
 category: string | null; price_kurus: number | null; stock: number | null; oem: string; source: "store" | "supplier";
 available: boolean; max_quantity: number; stock_label: string; pricing_snapshot: Record<string, unknown>;
 /** Set when the listing groups several supplier offers (db/product-matching.sql): the offer sold, and how many. */
 offer_id?: string; offers?: number;
};
// Prices and availability are calculated by the shared commerce view.
export const catalogSql = "SELECT * FROM commerce_catalog WHERE source='store' OR company=ANY($1::text[])";
const catalogEntriesSql = "SELECT * FROM commerce_catalog_entries WHERE source='store' OR company=ANY($1::text[])";
const company = storefrontCompanies;
export async function searchProducts(code: string): Promise<CatalogProduct[]> {
 if (!code.trim()) return [];
 return (await browseProducts({q:code,searchBy:"code"})).items;
}
export async function getProduct(id: string): Promise<CatalogProduct | undefined> {
 if (!z.uuid().safeParse(id).success) return undefined;
 return (await db.query<CatalogProduct>(`SELECT * FROM (${catalogSql}) catalog WHERE id=$2`,[company(),id])).rows[0];
}
/**
 * Same product from several suppliers (product_offers): the listing shows the primary row, priced and stocked by
 * the cheapest offer that can be sold now; the primary itself wins ties. Without a sellable offer the row is kept.
 */
export async function withBestOffers<T extends CatalogProduct>(items: T[]): Promise<T[]> {
 const ids = items.filter(item => item.source === "supplier").map(item => item.id);
 if (!ids.length) return items;
 const offers = (await db.query<CatalogProduct & { primary_id: string }>(`SELECT o.primary_id::text,priced.* FROM product_offers o
  JOIN LATERAL (SELECT * FROM (${catalogSql}) priced WHERE priced.id=o.item_id OFFSET 0) priced ON true
  WHERE o.primary_id=ANY($2::uuid[])`, [company(), ids])).rows;
 return items.map(item => {
  const group = offers.filter(offer => offer.primary_id === item.id);
  if (group.length < 2) return item;
  const best = group.filter(offer => offer.available && offer.price_kurus !== null)
   .sort((a, b) => a.price_kurus! - b.price_kurus! || Number(b.id === item.id) - Number(a.id === item.id))[0];
  if (!best) return { ...item, offers: group.length };
  return { ...item, price_kurus: best.price_kurus, available: best.available, max_quantity: best.max_quantity, stock_label: best.stock_label,
   pricing_snapshot: best.pricing_snapshot, offer_id: best.id, offers: group.length };
 });
}
/** The store page of a catalog row: a secondary offer resolves to the product listing it (`primaryId`). */
export async function getStoreProduct(id: string): Promise<{ product?: CatalogProduct; primaryId?: string }> {
 if (!z.uuid().safeParse(id).success) return {};
 const primaryId = (await db.query<{ primary_id: string }>("SELECT primary_id::text FROM product_offers WHERE item_id=$1 AND primary_id<>item_id", [id])).rows[0]?.primary_id;
 if (primaryId) return { primaryId };
 const product = await getProduct(id);
 return { product: product && (await withBestOffers([product]))[0] };
}
/** SETA products stating one of this product's (or its grouped offers') OEM numbers or its own number. */
export async function getSetaEquivalents(id: string) {
 return (await db.query<CatalogProduct & { via_brand: string; via_part: string }>(`SELECT * FROM (
  SELECT DISTINCT ON (priced.id) priced.*,r.brand AS via_brand,r.part_number AS via_part FROM product_seta_references r
  JOIN LATERAL (SELECT * FROM (${catalogSql}) priced WHERE priced.id=r.seta_item_id OFFSET 0) priced ON true
  WHERE r.item_id IN (SELECT $2::uuid UNION SELECT item_id FROM product_offers WHERE primary_id=$2::uuid)
  ORDER BY priced.id) seta ORDER BY available DESC,price_kurus NULLS LAST,code LIMIT 24`, [company(), id])).rows;
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
/**
 * Products linked to the vehicle types `typesSql` selects (one `id` column), counting only fitments
 * observed in the product's current, trusted enrichment payload. Steps are materialised in order:
 * matching types (through their indexes), their fitments, then each candidate's payload vehicles read
 * once. Joined row by row instead, the multi-kB payload was re-read per fitment: 20 s for "passat",
 * 1-2 min for a make page.
 */
async function fittedProductIds(typesSql:string,values:unknown[]){
 return (await db.query<{id:string}>(`WITH types AS MATERIALIZED (${typesSql}),
  fits AS MATERIALIZED (SELECT f.supplier_item_id,f.source_index,f.source_vehicle FROM types JOIN product_vehicle_fitments f ON f.vehicle_type_id=types.id),
  trusted AS MATERIALIZED (SELECT e.supplier_item_id,e.donor_item_id,e.payload->'vehicles' AS vehicles FROM product_enrichment_shared e
   JOIN supplier_items s ON s.id=e.supplier_item_id AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
   AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)
   WHERE e.donor_item_id IN (SELECT supplier_item_id FROM fits))
  SELECT DISTINCT t.supplier_item_id::text AS id FROM fits f JOIN trusted t ON t.donor_item_id=f.supplier_item_id AND f.source_vehicle=t.vehicles->f.source_index`,values)).rows.map(row=>row.id);
}
// Fitments change only when enrichments are imported; make and vehicle-type lists are shared per process.
const cachedFitted=staleCache<string[]>(10*60*1000);
const makeFittedIds=(brandId:number)=>cachedFitted(`make:${brandId}`,()=>fittedProductIds(
 "SELECT v.id FROM vehicle_types v JOIN vehicle_models m ON m.id=v.model_id WHERE m.brand_id=$1",[brandId]));
/** Ids of the products linked to one vehicle type (cached per process). */
export const typeFittedIds=(typeId:number)=>cachedFitted(`type:${typeId}`,()=>fittedProductIds("SELECT $1::int AS id",[typeId]));
/**
 * Products in a category: a legacy category on the item, or a trusted enrichment category. Resolved
 * to ids first, like makes; as an OR inside the catalog WHERE it defeated the indexes and every
 * listing query (count, page, brands, facets) scanned all supplier items: 6-8 s each in production.
 */
export const categoryProductIds=(legacy:string[],categoryIds:number[])=>cachedFitted(`category:${legacy.join(",")}:${categoryIds.join(",")}`,async()=>
 (await db.query<{id:string}>(`SELECT id::text FROM store_products WHERE category=ANY($1::text[])
  UNION SELECT id::text FROM supplier_items WHERE product_data->>'category'<>'' AND product_data->>'category'=ANY($1::text[])
  UNION SELECT e.supplier_item_id::text FROM product_source_categories pc JOIN product_enrichment_shared e ON e.donor_item_id=pc.supplier_item_id
   JOIN supplier_items s ON s.id=e.supplier_item_id AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
   AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)
   WHERE pc.source='trodo' AND pc.category_id=ANY($2::int[])`,[legacy,categoryIds])).rows.map(row=>row.id));
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
  `SELECT p.id FROM store_products p WHERE ${storeProductMatch("p",parsed,bind,mode)}`];
 // OEM numbers always carry digits; a word query ("frenbalatasi") would only normalise every stored reference (~0.1 s).
 if(parsed.compact.length>=3&&/[0-9]/.test(parsed.compact))hits.push(`SELECT e.supplier_item_id FROM product_enrichment_shared e
    JOIN supplier_items supplier_item ON supplier_item.id=e.supplier_item_id
      AND supplier_item.code=e.supplier_code AND supplier_item.product_data->>'uk'=e.supplier_brand
      AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)
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
  // DISTINCT on the uuid, text afterwards: sorting 20k+ ids as collated text took ~50 ms of the query.
  // A secondary supplier offer counts as a hit of the product listing it.
  return (await db.query<{id:string}>(`SELECT id::text FROM (SELECT DISTINCT COALESCE(o.primary_id,hit.id) AS id FROM (${searchHits(candidate,binder(values),mode)}) hit(id)
   LEFT JOIN product_offers o ON o.item_id=hit.id LIMIT ${maxSearchHits}) unique_hits`,values)).rows.map(row=>row.id);};
 if(searchTooShort(raw))return {parsed:parseSearchQuery(raw),ids:[],tooShort:true};
 const parsed=parseSearchQuery(raw),ids=await hits(parsed);
 if(mode==="code")return {parsed,ids};
 if(ids.length){
  // Dinamik names do list vehicles ("ON FREN BALATASI … GOLF PASSAT"), so the whole query can match by name
  // alone and would hide the parts fitments link to that vehicle. A fitted part + vehicle reading adds them.
  const vehicle=await vehicleSearch(raw,hits,false,true);
  return vehicle?.vehicle?.fitted?{...vehicle,ids:[...new Set([...vehicle.ids,...ids])].slice(0,maxSearchHits)}:{parsed,ids};
 }
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
 * Most product names never mention vehicles, so "fren balatası passat" often matches nothing as a whole. Tries
 * every split of the words into a leading or trailing vehicle part ("passat", "golf 7 2015") and a
 * part that matches products. Splits whose parts are linked by fitments win, then the longest
 * vehicle part ("buji | bmw 320d" over "buji bmw | 320d").
 */
/** `fittedOnly`: only readings whose vehicle has linked parts count, checked before the costlier product search. */
async function vehicleSearch(raw:string,hits:(parsed:ParsedSearch)=>Promise<string[]>,correct:boolean,fittedOnly=false):Promise<CatalogSearch|null>{
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
  // Next to a name match the vehicle words must match as typed: "fren" (→ "brake") must not read as the
  // "shooting brake" body style of "fren balatası".
  const vehicleWords=(parsed:ParsedSearch)=>fittedOnly?withoutSynonyms(parsed):parsed;
  const vehicle=await resolvePart(split.vehicle.join(" "),"vehicle",correct,async parsed=>{const values:unknown[]=[];
   return Boolean((await db.query(`SELECT 1 FROM vehicle_types v WHERE ${vehicleTypeMatch("v",vehicleWords(parsed),binder(values))} LIMIT 1`,values)).rowCount);});
  if(!vehicle)continue;
  const fitValues:unknown[]=[];
  const linked=new Set(await fittedProductIds(`SELECT v.id FROM vehicle_types v WHERE ${vehicleTypeMatch("v",vehicleWords(vehicle.parsed),binder(fitValues))}`,fitValues));
  if(fittedOnly&&!linked.size)continue;
  let ids:string[]=[];
  const product=await resolvePart(split.product.join(" "),"product",correct,async parsed=>(ids=await hits(parsed)).length>0);
  if(!product)continue;
  const fitted=ids.filter(id=>linked.has(id));
  if(fittedOnly&&!fitted.length)continue;
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
// Secondary offers of a product sold by several suppliers are reached through the product listing them.
export const listedOnly="NOT EXISTS (SELECT 1 FROM product_offers o WHERE o.item_id=catalog.id AND o.primary_id<>o.item_id)";
/** `vehicleTypeId` is the garage vehicle's catalog type; without it a `fits` or `oil` filter matches nothing. */
export type CatalogContext={vehicleTypeId?:string|null};
async function catalogFilter(query:CatalogQuery,context:CatalogContext={}) {
 const values: unknown[] = [company()]; const clauses: string[] = [listedOnly];
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
   const legacy=Object.entries(legacyCategoryIds).filter(([,id])=>descendants.includes(id)).map(([slug])=>slug);
   // Few oils carry a category yet; the engine-oil category also lists the oils read from product names.
   const ids=await categoryProductIds(legacy,descendants);
   values.push(descendants.includes(engineOilCategoryId)?[...new Set([...ids,...await engineOilIds()])]:ids);
   clauses.push(`catalog.id=ANY($${values.length}::uuid[])`);
  }
 }
 if(query.make) {
  const make=await getVehicleBrandBySlug(query.make);
  if(!make)clauses.push('false');
  else {
   values.push(await makeFittedIds(Number(make.id)));
   clauses.push(`catalog.id=ANY($${values.length}::uuid[])`);
  }
 }
 if(query.fits==='vehicle') {
  if(!context.vehicleTypeId)clauses.push('false');
  else {
   values.push(await typeFittedIds(Number(context.vehicleTypeId)));
   clauses.push(`catalog.id=ANY($${values.length}::uuid[])`);
  }
 }
 const oil=parseOilFilters(query.oil);
 if(oil.size) {
  if(!context.vehicleTypeId)clauses.push('false');
  else {
   values.push(await vehicleOilProductIds(context.vehicleTypeId,oil));
   clauses.push(`catalog.id=ANY($${values.length}::uuid[])`);
  }
 }
 const brands=selectedBrands(query);if(brands.length){values.push(brands);clauses.push(`brand=ANY($${values.length}::text[])`);}
 for(const [attribute,options] of Object.entries(selectedAttributes(query))){if(!options.length)continue;
  values.push(attribute);const attributeKey=`$${values.length}`;values.push(options);const optionsKey=`$${values.length}`;
  clauses.push(`catalog.id IN (SELECT e.supplier_item_id FROM product_enrichment_shared e JOIN supplier_items s ON s.id=e.supplier_item_id
   AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
   AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)
   CROSS JOIN LATERAL jsonb_array_elements(e.payload->'specifications') spec
   WHERE spec->>0=${attributeKey} AND spec->>1=ANY(${optionsKey}::text[])
   AND (spec->>0<>'Brand class' OR e.match_basis->>'type'='exact_part'))`);
 }
 // In stock: the row or any offer grouped under it can be sold now.
 if(query.availability)clauses.push(query.availability==='in_stock'
  ?`catalog.id IN (SELECT COALESCE(o.primary_id,a.id) FROM (${catalogSql}) a LEFT JOIN product_offers o ON o.item_id=a.id WHERE a.available)`
  :`catalog.id IN (SELECT id FROM (${catalogSql}) available_catalog WHERE NOT available AND stock_label='Stokta yok')`);
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
 return JSON.stringify([query.category,query.make,query.brand,query.brands,query.attributes,query.availability,query.fits,query.oil,query.fits||query.oil?context.vehicleTypeId:null]);
}
/**
 * Everything a plain search listing needs from its matches in one pass: ids in relevance order and the
 * brand facet. Reads the matched rows by primary key with their stored ranking inputs (db/search.sql);
 * the generic path joined the 23k-row id list against the catalog view four times (count, brands,
 * attribute facet, ranked page: ~0.6 s together) for the same answer. Same fields and order as that path.
 */
async function summarizeSearch(search:CatalogSearch){
 if(!search.ids.length)return {ids:[] as string[],brands:[] as string[]};
 const values:unknown[]=[company(),search.ids],bind=binder(values);
 const queries=`to_tsquery('simple',${bind(prefixTsQuery(search.parsed))}::text),to_tsquery('simple',${bind(exactTsQuery(search.parsed))}::text),${bind(search.parsed.compact)}::text`;
 const row=(await db.query<{ids:string[]|null;brands:string[]|null}>(`WITH hits AS MATERIALIZED (
   SELECT i.id,COALESCE(NULLIF(i.product_data->>'uk',''),'Belirtilmemiş') AS brand,i.changed_at AS updated_at,
    COALESCE(catalog_search_rank_doc(i.search_doc,i.search_code,i.search_oem,${queries}),
     catalog_search_rank(COALESCE(NULLIF(i.product_data->>'ac',''),i.code),COALESCE(NULLIF(i.product_data->>'uk',''),'Belirtilmemiş'),
      i.code,COALESCE(i.product_data->>'oe',''),COALESCE(i.product_data->>'ac2',''),${queries})) AS rank
   FROM commerce_supplier_items i WHERE i.id=ANY($2::uuid[]) AND i.company=ANY($1::text[])
   UNION ALL
   SELECT p.id,p.brand,p.updated_at,catalog_search_rank(p.name,p.brand,p.code,'',p.description,${queries}) FROM store_products p WHERE p.id=ANY($2::uuid[]))
  SELECT (SELECT array_agg(id::text ORDER BY rank DESC,updated_at DESC,id) FROM hits) AS ids,
   (SELECT array_agg(DISTINCT brand ORDER BY brand) FROM hits) AS brands`,values)).rows[0];
 return {ids:row?.ids??[],brands:row?.brands??[]};
}
// A search with no other filter is the common case. Broad ones ("fren": ~70k matches) spend ~0.5 s just
// reading the matched rows, and their answer changes only with supplier syncs — like the listings above,
// it is served stale-while-revalidate for 10 minutes. Prices and stock are still read live for the listed
// ids. The first pages are kept (deeper pages are recomputed); facets need every match, so they are kept too.
// 30 cards keep a listing page near 0.6 MB of HTML (60 made it 1.15 MB); 20 cached pages still cover 600 results.
const catalogPageSize=30;
const cachedPages=20,cachedPlainSearches=staleCache<PlainSearch>(aggregateTtl,300);
type PlainSearch={ids:string[];total:number;brands:string[];attributes:CatalogFacet[];correctedQuery?:string;vehicle?:VehicleSearchScope;tooShort?:boolean};
const plainSearch=(raw:string,mode:SearchMode)=>cachedPlainSearches(`${mode}|${normalizeSearchText(raw.slice(0,120))}|${raw.trim().toLocaleLowerCase("tr")}`,async()=>{
 const search=await catalogSearch(raw,mode),summary=await summarizeSearch(search);
 const {attributes}=await attributeFacets(summary.brands,[summary.ids],"SELECT unnest($1::uuid[]) AS id");
 return {ids:summary.ids.slice(0,cachedPages*catalogPageSize),total:summary.ids.length,brands:summary.brands,attributes,
  correctedQuery:search.correctedQuery,vehicle:search.vehicle,tooShort:search.tooShort};
});
/** No filter but the search (mirrors the clauses catalogFilter adds). */
function isPlainSearch(query:CatalogQuery){
 return Boolean(query.q?.trim())&&!query.category&&!query.make&&query.fits!=="vehicle"&&!query.oil&&!query.availability
  &&!selectedBrands(query).length&&!Object.values(selectedAttributes(query)).some(options=>options.length);
}
export async function browseProducts(query:CatalogQuery,context:CatalogContext={}){
 if(isPlainSearch(query)&&(query.sort??"relevance")==="relevance"){
  const mode=query.searchBy==="code"?"code":"all",plain=await plainSearch(query.q!,mode);
  const pageSize=catalogPageSize,total=plain.total,pages=Math.max(1,Math.ceil(total/pageSize));
  const requested=Number(query.page);
  const page=Number.isSafeInteger(requested)?Math.min(pages,Math.max(1,requested)):1;
  const ranked=page<=cachedPages?plain.ids:(await summarizeSearch(await catalogSearch(query.q!,mode))).ids;
  const ids=ranked.slice((page-1)*pageSize,page*pageSize);
  const items=(await db.query<CatalogProduct>(`SELECT catalog.* FROM unnest($2::uuid[]) WITH ORDINALITY page(id,ordinal)
   JOIN LATERAL (SELECT * FROM (${catalogSql}) priced WHERE priced.id=page.id OFFSET 0) catalog ON true ORDER BY page.ordinal`,[company(),ids])).rows;
  return {items:await withBestOffers(items),total,page,pages,pageSize,correctedQuery:plain.correctedQuery,vehicleScope:plain.vehicle,searchTooShort:plain.tooShort};
 }
 const {values,where,from,search}=await catalogFilter(query,context);
 const count=async()=>Number((await db.query<{count:string}>(`SELECT count(*) ${from}`,values)).rows[0].count);
 const total = search ? await count() : await cachedCounts(filterKey(query,context),count);
 const pageSize = catalogPageSize, pages = Math.max(1,Math.ceil(total/pageSize));
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
  return {items:await withBestOffers(items),total,page,pages,pageSize};
 }
 const items = (await db.query<CatalogProduct>(pricedSort
  ? `SELECT * FROM (${catalogSql}) catalog ${where} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`
  : `WITH page AS MATERIALIZED (SELECT id,updated_at,${rank} AS rank ${from} ORDER BY rank DESC,${order} LIMIT ${pageSize} OFFSET ${offset})
     SELECT catalog.* FROM page JOIN LATERAL (SELECT * FROM (${catalogSql}) priced WHERE priced.id=page.id OFFSET 0) catalog ON true
     ORDER BY page.rank DESC,page.updated_at DESC,page.id`, pageValues)).rows;
 return {items:await withBestOffers(items),total,page,pages,pageSize,correctedQuery:search?.correctedQuery,vehicleScope:search?.vehicle,searchTooShort:search?.tooShort};
}
/** A product, or (for broad searches) a product name shared by `products` items. */
export type ProductSuggestion={kind:"product";id:string;name:string;brand:string;code:string}|{kind:"name";name:string;products:number};
// Ranking every match per keystroke takes seconds on the VPS for broad prefixes ("fren": ~15k);
// above this, the type-ahead suggests product names from search_product_names instead.
const maxRankedSuggestions=500;
/** Best matches for the header type-ahead: the catalog search's engine and readings, without prices. */
export async function suggestProducts(raw:string,mode:SearchMode,limit=6){
 const search=await catalogSearch(raw,mode);
 const notes={correctedQuery:search.correctedQuery,vehicleScope:search.vehicle};
 if(!search.ids.length)return {products:[] as ProductSuggestion[],...notes};
 if(search.ids.length>maxRankedSuggestions&&!search.vehicle?.fitted){
  const query=prefixTsQuery(search.parsed);
  // The names most products share first: "filtre" means "Hava Filtresi" (5k) more than "Filtre Hortumu".
  const names=query?(await db.query<{name:string;products:number}>(`SELECT name,products FROM search_product_names
   WHERE to_tsvector('simple',normalized) @@ to_tsquery('simple',$1)
   ORDER BY products DESC,name LIMIT ${Number(limit)}`,[query])).rows:[];
  if(names.length)return {products:names.map(row=>({kind:"name" as const,...row})),...notes};
 }
 const values:unknown[]=[company(),search.ids.slice(0,maxRankedSuggestions)],bind=binder(values);
 // One suggestion per name and brand: a supplier lists the same part in many sizes.
 const products=(await db.query<{id:string;name:string;brand:string;code:string}>(`SELECT id,name,brand,code FROM (
  SELECT DISTINCT ON (name,brand) id::text,name,brand,code,rank,updated_at FROM (
   SELECT catalog.*,${catalogRank("catalog",search.parsed,bind)} AS rank FROM (${catalogEntriesSql}) catalog WHERE catalog.id=ANY($2::uuid[])) ranked
  ORDER BY name,brand,rank DESC,updated_at DESC,id) best ORDER BY rank DESC,updated_at DESC,id LIMIT ${Number(limit)}`,values)).rows;
 return {products:products.map(row=>({kind:"product" as const,...row})),...notes};
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
 const linked=new Set(await typeFittedIds(Number(vehicleTypeId)));
 return new Set(ids.filter(id=>linked.has(id)));
}
export async function catalogFacets(query:CatalogQuery,context:CatalogContext={}){
 const scope:CatalogQuery={q:query.q,searchBy:query.searchBy,category:query.category,make:query.make,fits:query.fits,oil:query.oil};
 if(isPlainSearch(scope)){
  const plain=await plainSearch(query.q!,query.searchBy==="code"?"code":"all");
  return {brands:plain.brands,attributes:plain.attributes};
 }
 const {values,from,search}=await catalogFilter(scope,context);
 const load=()=>facetsFor(values,from);
 return search ? load() : cachedFacets(filterKey(scope,context),load);
}
async function facetsFor(values:unknown[],from:string){
 const brands=(await db.query<{brand:string}>(`SELECT DISTINCT brand ${from} ORDER BY brand`,values)).rows.map(r=>r.brand);
 return attributeFacets(brands,values,`SELECT catalog.id ${from}`);
}
/** `scopedSql` selects the listing's ids (one `id` column) using `values`. */
async function attributeFacets(brands:string[],values:unknown[],scopedSql:string){
 // MATERIALIZED: inlined, the search filter gets planned across the enrichment joins (~60 s instead of ms).
 const rows=(await db.query<{key:string;values:string[]}>(`WITH scoped AS MATERIALIZED (${scopedSql})
 SELECT spec->>0 AS key,array_agg(DISTINCT spec->>1 ORDER BY spec->>1) AS values
 FROM scoped JOIN product_enrichment_shared e ON e.supplier_item_id=scoped.id JOIN supplier_items s ON s.id=e.supplier_item_id
 AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
 AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)
 CROSS JOIN LATERAL jsonb_array_elements(e.payload->'specifications') spec
 WHERE spec->>0 IN ('Fitting Position','Brand class','Filter type','Lamp Type','Bulb Type','Fuel Type','Shock Absorber Type','Shock Absorber System','Wiper blade type','Oil Viscosity Classification SAE','Transmission Type','Mounting Type') AND length(spec->>1)<=200
 AND (spec->>0<>'Brand class' OR e.match_basis->>'type'='exact_part')
 GROUP BY spec->>0 HAVING count(DISTINCT spec->>1)<=40 ORDER BY CASE WHEN spec->>0='Fitting Position' THEN 0 WHEN spec->>0='Brand class' THEN 1 ELSE 2 END,spec->>0 LIMIT 8`,values)).rows;
 return {brands,attributes:rows.map(row=>({...row,label:specificationLabel(row.key)})) as CatalogFacet[]};
}
