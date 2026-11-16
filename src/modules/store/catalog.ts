import "server-only";
import { boundedQuery, db } from "@/lib/db";
import { storefrontCompanies } from "@/modules/suppliers/storefront-sources";
import { z } from "zod";
import { cache } from "react";
import { staleCache } from "@/lib/stale-cache";
import { productPath } from "@/modules/seo/product-path";
import { productIdPath } from "@/modules/seo/product-id";
import { listingEpoch } from "./listing-epoch";
export type { CatalogQuery } from "./catalog-query";
import type { CatalogQuery } from "./catalog-query";
import {getStoreCategories} from './categories';
import {legacyCategoryIds} from './category-tree';
import {getVehicleBrandBySlug} from './vehicle-catalog.server';
import {getVehicleModelGroup,getVehicleModelGroups} from './vehicle-model-groups.server';
import {normalizeSearchText,parseSearchQuery,exactTsQuery,prefixTsQuery,searchTooShort,wholeWords,withoutSynonyms,type ParsedSearch} from '@/modules/search/query';
import {binder,catalogRank,correctSearch,overrideItemMatch,storeProductMatch,supplierItemMatch,vehicleTypeMatch,type Bind,type SearchMode} from '@/modules/search/sql';
import {facetOptions} from './specification-translations';
import {facetSpecificationKeys,selectedBrands,selectedAttributes,specificationLabel,type CatalogFacet} from './catalog-filters';
import {engineOilCategoryId,parseOilFilters} from './vehicle-oil';
import {engineOilIds,vehicleOilProductIds} from './vehicle-oil.server';
import {compareOffers} from './best-offer';
import {manufacturerLabels} from './manufacturers.server';
export type Product = { id: string; category: string; supplier: "dinamik" | "basbug" | "seta" | "demo"; code: string; name: string; brand: string; description: string; price_kurus: number; stock: number; updated_at: Date };
export type CatalogProduct = Omit<Product, "price_kurus" | "stock" | "category"> & {
 category: string | null; price_kurus: number | null; stock: number | null; oem: string; source: "store" | "supplier";
 available: boolean; max_quantity: number; stock_label: string; pricing_snapshot: Record<string, unknown>;
 /**
  * What the store shows as brand and manufacturer part number (#602): an admin's store brand / part number, else the
  * supplier's. `brand` and `code` stay the supplier's values: order lines, enrichment lookups and matching read those.
  */
 display_brand: string; display_code: string;
 /** The name is an admin's (#575): shown as written, not converted like a supplier's (#686). */
 name_overridden: boolean;
 /** Set when the listing groups several supplier offers (db/product-matching.sql): the offer sold, and how many. */
 offer_id?: string; offers?: number;
 /** No supplier sells the product now (db/storefront-catalog.sql, #475): listed last, without a price, not orderable. */
 unavailable?: boolean;
};
// Prices and availability are calculated by the shared commerce view.
export const catalogSql = "SELECT * FROM commerce_catalog WHERE source='store' OR company=ANY($1::text[])";
// The store's listing, search and product page also show products nobody supplies now (`unavailable`, #475); cart,
// checkout, partner API and maintenance kits keep reading the saleable catalogSql.
export const storefrontCatalogSql = "SELECT * FROM storefront_catalog WHERE source='store' OR company=ANY($1::text[])";
export const catalogEntriesSql = "SELECT * FROM storefront_catalog_entries WHERE source='store' OR company=ANY($1::text[])";
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
 * the cheapest offer that can be sold now (compareOffers: lower cost, then the primary itself, win ties). Without a
 * sellable offer the row is kept.
 */
export async function withBestOffers<T extends CatalogProduct>(items: T[]): Promise<T[]> {
 const ids = items.filter(item => item.source === "supplier" && !item.unavailable).map(item => item.id);
 if (!ids.length) return items;
 const offers = (await db.query<CatalogProduct & { primary_id: string }>(`SELECT o.primary_id::text,priced.* FROM product_offers o
  JOIN LATERAL (SELECT * FROM (${catalogSql}) priced WHERE priced.id=o.item_id OFFSET 0) priced ON true
  WHERE o.primary_id=ANY($2::uuid[])`, [company(), ids])).rows;
 return items.map(item => {
  const group = offers.filter(offer => offer.primary_id === item.id);
  if (group.length < 2) return item;
  const best = group.filter(offer => offer.available && offer.price_kurus !== null).sort(compareOffers(item.id))[0];
  if (!best) return { ...item, offers: group.length };
  return { ...item, price_kurus: best.price_kurus, available: best.available, max_quantity: best.max_quantity, stock_label: best.stock_label,
   pricing_snapshot: best.pricing_snapshot, offer_id: best.id, offers: group.length };
 });
}
/** A row the store shows: saleable, or (`unavailable`) a product no supplier sells now. */
export async function getStorefrontProduct(id: string): Promise<CatalogProduct | undefined> {
 if (!z.uuid().safeParse(id).success) return undefined;
 return (await db.query<CatalogProduct>(`SELECT * FROM (${storefrontCatalogSql}) catalog WHERE id=$2`,[company(),id])).rows[0];
}
/**
 * Where the store shows a row it does not list itself (an old link): the same supplier code sold from another scope
 * or list (Dinamik's FALKON → "FALKON - AUTOKIT"), a saleable row of its product group, else the group's or the code's
 * unavailable card. Product ids are row ids; a merged product follows `merged_into`.
 */
const canonicalSql = `WITH source AS (SELECT id,supplier,code FROM supplier_items WHERE id=$2),
 product AS (SELECT COALESCE(p.merged_into,p.id) AS id FROM products p WHERE p.id=$2
  UNION SELECT s.product_id FROM product_sources s WHERE s.supplier_item_id=$2),
 members AS (SELECT m.supplier_item_id AS id,m.product_id FROM product_sources m WHERE m.product_id IN (SELECT id FROM product))
 SELECT id::text FROM (
  SELECT c.id,0 AS step,0 AS own,storefront_supplier_rank(c.supplier) AS supplier_rank,c.code FROM source JOIN commerce_supplier_items c ON c.supplier=source.supplier AND c.code=source.code
  UNION ALL SELECT c.id,1,CASE WHEN c.id=m.product_id THEN 0 ELSE 1 END,storefront_supplier_rank(c.supplier),c.code FROM members m JOIN commerce_supplier_items c ON c.id=m.id
  UNION ALL SELECT u.id,2,0,0,u.code FROM source JOIN commerce_unavailable_items u ON u.supplier=source.supplier AND u.code=source.code
  UNION ALL SELECT u.id,3,0,0,u.code FROM members m JOIN commerce_unavailable_items u ON u.id=m.id) target
 WHERE id<>$2 AND EXISTS (SELECT 1 FROM supplier_items i WHERE i.id=target.id AND i.company=ANY($1::text[]))
  AND NOT EXISTS (SELECT 1 FROM commerce_item_overrides h WHERE h.supplier_item_id=target.id AND h.hidden)
 ORDER BY step,own,supplier_rank,code,id LIMIT 1`;
/**
 * The listing (primary) row of each grouped offer among `ids`: the id the storefront lists and the product page lives under (#752).
 * Primary and ungrouped rows are absent, and so is an offer whose primary is no longer sold or is hidden; callers keep `id` then.
 * product_offers is rebuilt by the matching refresh.
 */
export async function listingIds(ids: string[]): Promise<Map<string, string>> {
 if (!ids.length) return new Map();
 const rows = (await db.query<{ item_id: string; primary_id: string }>(`SELECT o.item_id::text,o.primary_id::text FROM product_offers o
  WHERE o.item_id=ANY($2::uuid[]) AND o.primary_id<>o.item_id AND EXISTS (SELECT 1 FROM commerce_supplier_items c WHERE c.id=o.primary_id AND c.company=ANY($1::text[]))
  AND NOT EXISTS (SELECT 1 FROM commerce_item_overrides h WHERE h.supplier_item_id=o.primary_id AND h.hidden)`, [company(), ids])).rows;
 return new Map(rows.map(row => [row.item_id, row.primary_id]));
}
/**
 * The store page of a catalog row: a secondary offer resolves to the product listing it (`primaryId`), and a row the
 * store does not show (a dropped duplicate, a code sold elsewhere) to the page showing that product instead of a 404.
 */
export async function getStoreProduct(id: string): Promise<{ product?: CatalogProduct; primaryId?: string }> {
 if (!z.uuid().safeParse(id).success) return {};
 // A primary no longer sold is not followed (it would lead back here).
 const primaryId = (await listingIds([id])).get(id);
 if (primaryId) return { primaryId };
 const product = await getStorefrontProduct(id);
 if (product) return { product: (await withBestOffers([product]))[0] };
 // Hidden by an admin (#575): a 404, not a redirect to another row of the same hidden product (which would lead back here).
 if ((await db.query("SELECT 1 FROM commerce_item_overrides WHERE supplier_item_id=$1 AND hidden", [id])).rowCount) return {};
 const canonical = (await db.query<{ id: string }>(canonicalSql, [company(), id])).rows[0]?.id;
 return canonical ? { primaryId: canonical } : {};
}
/** SETA products stating one of this product's (or its grouped offers') OEM numbers or its own number. */
export async function getSetaEquivalents(id: string) {
 return (await db.query<CatalogProduct & { via_brand: string; via_part: string }>(`SELECT * FROM (
  SELECT DISTINCT ON (priced.id) priced.*,r.brand AS via_brand,r.part_number AS via_part FROM product_seta_references r
  JOIN LATERAL (SELECT * FROM (${catalogSql}) priced WHERE priced.id=r.seta_item_id OFFSET 0) priced ON true
  WHERE r.item_id IN (SELECT $2::uuid UNION SELECT item_id FROM product_offers WHERE primary_id=$2::uuid)
  ORDER BY priced.id) seta ORDER BY available DESC,price_kurus NULLS LAST,code LIMIT 24`, [company(), id])).rows;
}
/**
 * Equivalents an admin decided (a hand-made link, or a brand pair decided as equivalent: same numbering, another
 * product) under their master brand's name. `id` is the store row the equivalent is listed under (its own row first,
 * never a grouped offer's secondary row), null when none is on sale: its code is still a valid reference number.
 * Automatic OEM/cross equivalents are left out; the page shows them as reference numbers already.
 */
export async function getDecidedEquivalents(id: string) {
 if (!z.uuid().safeParse(id).success) return [];
 // An admin's store brand and part number of the equivalent (#602) win, as on its own page.
 return (await db.query<{ id: string | null; name: string | null; name_overridden: boolean | null; display_brand: string | null; display_code: string | null; brand: string; code: string; available: boolean | null }>(`SELECT DISTINCT ON (q.id) listed.id::text,
   listed.name, listed.name_overridden, listed.display_brand, listed.display_code,
   COALESCE(qo.brand,b.name,q.brand_label) AS brand, COALESCE(qo.part_number,listed.code,q.code) AS code, listed.available
  FROM product_sources s
  JOIN product_equivalents e ON e.product_id=s.product_id AND e.kind IN ('manual','brand')
  JOIN products q ON q.id=e.equivalent_id AND q.merged_into IS NULL LEFT JOIN brands b ON b.key=q.brand
  LEFT JOIN product_overrides qo ON qo.product_id=q.id
  LEFT JOIN LATERAL (SELECT priced.id, priced.code, priced.available, priced.name, priced.name_overridden, priced.display_brand, priced.display_code FROM product_sources o
   JOIN LATERAL (SELECT * FROM (${catalogSql}) priced WHERE priced.id=o.supplier_item_id OFFSET 0) priced ON true
   WHERE o.product_id=q.id
    AND NOT EXISTS (SELECT 1 FROM product_offers po WHERE po.item_id=o.supplier_item_id AND po.primary_id<>po.item_id)
   ORDER BY o.supplier_item_id=q.id DESC, priced.available DESC, o.supplier_item_id LIMIT 1) listed ON true
  WHERE s.supplier_item_id=$2::uuid ORDER BY q.id LIMIT 48`, [company(), id])).rows
  .sort((a, b) => Number(Boolean(b.id)) - Number(Boolean(a.id)) || Number(Boolean(b.available)) - Number(Boolean(a.available)) || a.code.localeCompare(b.code))
  // The address of the listed row, from the row's own shown name, brand and part number: the page's canonical one.
  .map(({ id, name, name_overridden, display_brand, display_code, ...rest }) => ({ ...rest, id, href: id && name !== null && name_overridden !== null && display_brand !== null && display_code !== null ? productPath({ id, name, name_overridden, display_brand, display_code }) : id && productIdPath(id) }));
}
export function servicePrice(price: number, discount: number) { return Math.round(price * (100-discount) / 100); }
export { money } from "./money";

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
 * 1-2 min for a make page. Read from the materialized links (#446): the live view, expected as one row,
 * was nested against a make's 600k fitments and never finished (BMW: minutes, 504 at the CDN).
 * An admin's decisions (db/product-override-fitments.sql, #583) apply per row and type: a removed type drops that
 * automatic fitment only (a search over several types still lists the row through another), an added type lists every
 * row of the product, enriched or not. The decisions of the selected types are read once, through their index.
 */
async function fittedProductIds(typesSql:string,values:unknown[]){
 return (await boundedQuery<{id:string}>(`WITH types AS MATERIALIZED (${typesSql}),
  fits AS MATERIALIZED (SELECT f.supplier_item_id,f.source_index,f.source_vehicle,f.vehicle_type_id FROM types JOIN product_vehicle_fitments f ON f.vehicle_type_id=types.id),
  trusted AS MATERIALIZED (SELECT e.supplier_item_id,e.donor_item_id,e.payload->'vehicles' AS vehicles FROM storefront_enrichments e
   JOIN supplier_items s ON s.id=e.supplier_item_id AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
   AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)
   WHERE e.donor_item_id IN (SELECT supplier_item_id FROM fits)),
  decided AS MATERIALIZED (SELECT ps.supplier_item_id,o.vehicle_type_id,o.mode FROM types
   JOIN product_override_fitments o ON o.vehicle_type_id=types.id JOIN product_sources ps ON ps.product_id=o.product_id)
  SELECT id::text FROM (SELECT t.supplier_item_id AS id FROM fits f JOIN trusted t ON t.donor_item_id=f.supplier_item_id AND f.source_vehicle=t.vehicles->f.source_index
   WHERE (t.supplier_item_id,f.vehicle_type_id) NOT IN (SELECT supplier_item_id,vehicle_type_id FROM decided WHERE mode='remove')
  UNION SELECT supplier_item_id FROM decided WHERE mode='add') fitted`,values)).rows.map(row=>row.id);
}
// Admin edits move products between categories (#575) and change vehicle fitments (#583): an edit bumps the listing
// epoch and these reload (#585).
const listings={epoch:listingEpoch};
// Fitments change when enrichments are imported or an admin decides; vehicle-type lists are shared per process.
const cachedFitted=staleCache<string[]>(10*60*1000,500,listings);
const cachedCategoryIds=staleCache<string[]>(10*60*1000,500,listings);
/**
 * Products fitting one make (`param`: its vehicle_brands id, e.g. "$2::int"), as one id column: the engine-level fits
 * precomputed in storefront_make_fits (db/storefront-make-fits.sql, #455) and the models read from supplier
 * descriptions (product_model_fitments) of the make's series, a secondary offer counting as the product listing it,
 * like modelFittedIds (#674). Matching a make's fitments to the payloads per read took 20-57 s on RDS for the large
 * makes. The make table is an index read; the description side is planned as a parallel sequential scan of
 * product_model_fitments hashed against the make's series (VW: ~53k ids, ~0.1 s warm and ~0.5 s cold locally). Used as
 * `id=ANY(ARRAY(...))`, an InitPlan run once per query, so a make's ids never pass through Node (large id arrays fed the
 * heap OOMs). The listing's cost grows with the id count; its counts, facets and page ids (also the price orders, see
 * browseProducts) are cached for 10 minutes.
 */
export const makeFitsSql=(param:string)=>`SELECT supplier_item_id FROM storefront_make_fits WHERE brand_id=${param}
  UNION SELECT COALESCE(o.primary_id,f.supplier_item_id) FROM vehicle_models m JOIN product_model_fitments f ON f.model_id=m.id
  LEFT JOIN product_offers o ON o.item_id=f.supplier_item_id WHERE m.brand_id=${param}`;
/**
 * Every model fit as (model_id, id) rows, a pair possibly repeated: engine-level fits (storefront_model_fits, kept like
 * the make table) and models read from supplier descriptions (product_model_fitments, model level only), a secondary
 * offer counting as the product listing it. A `model_id` condition on the subquery reaches both branches' indexes;
 * the model sitemap (src/modules/seo/sitemap-models.server.ts) and a model's category counts read the same rows (#673).
 */
export const modelFitsSql=`SELECT model_id,supplier_item_id AS id FROM storefront_model_fits
  UNION ALL SELECT f.model_id,COALESCE(o.primary_id,f.supplier_item_id) FROM product_model_fitments f LEFT JOIN product_offers o ON o.item_id=f.supplier_item_id`;
/**
 * Products fitting a vehicle model page's series (#639), from modelFitsSql. Both branches are index reads (Golf 7:
 * ~25 ms for the description side); cached per process.
 */
const modelFittedIds=(modelIds:string[])=>cachedFitted(`model:${modelIds.join(",")}`,async()=>(await boundedQuery<{id:string}>(
 `SELECT DISTINCT id::text FROM (${modelFitsSql}) fits WHERE model_id=ANY($1::int[])`,[modelIds])).rows.map(row=>row.id));
/**
 * A make's model page units that list at least one product (#639): the make page links only these, so no link ends in
 * the empty model page's 404. A unit counts when a fitted product (as in modelFittedIds) is in the storefront listing
 * (listedOnly); a fit pointing at a hidden or no longer supplied item does not. One query per make over the make's
 * series, cached like the fits (per process, reloaded when a listing edit moves the epoch).
 */
const cachedListedModels=staleCache<string[]>(10*60*1000,300,listings);
export async function getListedModelGroups(brandId:string) {
 const groups=await getVehicleModelGroups(brandId);
 const modelIds=groups.flatMap(group=>group.models.map(member=>member.id));
 const listedIds=new Set(await cachedListedModels(brandId,async()=>(await boundedQuery<{id:string}>(
  `WITH fits AS MATERIALIZED (SELECT model_id,supplier_item_id AS id FROM storefront_model_fits WHERE model_id=ANY($2::int[])
    UNION SELECT f.model_id,COALESCE(o.primary_id,f.supplier_item_id) FROM product_model_fitments f LEFT JOIN product_offers o ON o.item_id=f.supplier_item_id
    WHERE f.model_id=ANY($2::int[])),
   ids AS MATERIALIZED (SELECT DISTINCT id FROM fits),
   listed AS MATERIALIZED (SELECT catalog.id FROM (SELECT e.* FROM storefront_catalog_entries e JOIN ids ON ids.id=e.id
     WHERE e.source='store' OR e.company=ANY($1::text[])) catalog WHERE ${listedOnly})
   SELECT DISTINCT fits.model_id::text AS id FROM fits JOIN listed ON listed.id=fits.id`,[company(),modelIds])).rows.map(row=>row.id)));
 return groups.filter(group=>group.models.some(member=>listedIds.has(member.id)));
}
/** Ids of the products linked to one vehicle type (cached per process). */
export const typeFittedIds=(typeId:number)=>cachedFitted(`type:${typeId}`,()=>fittedProductIds("SELECT $1::int AS id",[typeId]));
/**
 * The admin's category (#575) replaces the automatic ones: true for an item whose product the admin put in a category
 * outside `ids` (an int[] parameter such as "$2"), so it leaves the automatic category's list. The home rails (#667) use
 * the same rule as the category page.
 */
export const categoryMovedAwaySql=(itemId:string,ids:string)=>`NOT EXISTS (SELECT 1 FROM product_sources ps JOIN product_overrides o ON o.product_id=ps.product_id
   WHERE ps.supplier_item_id=${itemId} AND o.category_id IS NOT NULL AND o.category_id<>ALL(${ids}::int[]))`;
/**
 * Products in a category: a legacy category on the item, or a trusted enrichment category. Resolved
 * to ids first, like makes; as an OR inside the catalog WHERE it defeated the indexes and every
 * listing query (count, page, brands, facets) scanned all supplier items: 6-8 s each in production.
 */
export const categoryProductIds=(legacy:string[],categoryIds:number[])=>cachedCategoryIds(`category:${legacy.join(",")}:${categoryIds.join(",")}`,async()=>
 (await boundedQuery<{id:string}>(`SELECT id::text FROM (SELECT id FROM store_products WHERE category=ANY($1::text[])
  UNION SELECT id FROM supplier_items WHERE product_data->>'category'<>'' AND product_data->>'category'=ANY($1::text[])
  UNION SELECT e.supplier_item_id FROM product_source_categories pc JOIN storefront_enrichments e ON e.donor_item_id=pc.supplier_item_id
   JOIN supplier_items s ON s.id=e.supplier_item_id AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
   AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)
   WHERE pc.source='trodo' AND pc.category_id=ANY($2::int[])) automatic
  -- An admin's category (#575) replaces the automatic ones: the product leaves other categories and joins its own.
  WHERE ${categoryMovedAwaySql("automatic.id","$2")}
  UNION SELECT ps.supplier_item_id::text FROM product_overrides o JOIN product_sources ps ON ps.product_id=o.product_id
   WHERE o.category_id=ANY($2::int[])`,[legacy,categoryIds])).rows.map(row=>row.id));
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
 // The stored search fields hold the supplier OEM; a row whose OEM field an admin hid (#615) is matched by
 // overrideItemMatch instead, on its text and code without the OEM. The anti-join reads the small overrides table.
 const oemHidden=(alias:string)=>`NOT EXISTS (SELECT 1 FROM commerce_item_overrides ho WHERE ho.supplier_item_id=${alias}.id AND ho.hide_oem)`;
 const hits=[`SELECT i.id FROM commerce_supplier_items i WHERE ${supplierItemMatch("i",parsed,bind,mode)} AND ${oemHidden("i")}`,
  `SELECT p.id FROM store_products p WHERE ${storeProductMatch("p",parsed,bind,mode)}`,
  // Products no supplier sells now are found too; the listing puts them last (#475).
  `SELECT u.id FROM commerce_unavailable_items u WHERE ${supplierItemMatch("u",parsed,bind,mode)} AND ${oemHidden("u")}`];
 // OEM numbers always carry digits. The trigram index on enrichment_oem_search (db/enrichment-search.sql, #609)
 // narrows the enrichments first; normalising every stored reference per query took ~3 s.
 if(parsed.compact.length>=3&&/[0-9]/.test(parsed.compact)){const key=bind(`%${parsed.compact}%`);hits.push(`SELECT e.supplier_item_id FROM storefront_enrichments e
    JOIN supplier_items supplier_item ON supplier_item.id=e.supplier_item_id
      AND supplier_item.code=e.supplier_code AND supplier_item.product_data->>'uk'=e.supplier_brand
      AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)
    CROSS JOIN LATERAL jsonb_each(e.payload->'oemNumbers') refs
    CROSS JOIN LATERAL jsonb_array_elements_text(refs.value) reference(number)
    WHERE enrichment_oem_search(e.payload) LIKE ${key} AND search_compact(reference.number) LIKE ${key}
     AND NOT EXISTS (SELECT 1 FROM product_override_references h JOIN product_sources hs ON hs.product_id=h.product_id
      WHERE hs.supplier_item_id=e.supplier_item_id AND h.action='hide' AND h.kind='oem' AND h.brand_key=part_number_key(refs.key)
       AND h.number_key=part_number_key(reference.number))`);}
 // Numbers an admin added (#582): OEM, cross-reference and barcode. A small table read whole, like overrideItemMatch.
 if(parsed.compact.length>=3)hits.push(`SELECT ps.supplier_item_id FROM product_override_references r
    JOIN product_sources ps ON ps.product_id=r.product_id
    WHERE r.action='add' AND lower(r.number_key) LIKE ${bind(`%${parsed.compact}%`)}`);
 // Rows renamed by an admin are found by the new name (#575), store brand and part number (#602).
 const overridden=overrideItemMatch(parsed,bind,mode);
 if(overridden)hits.push(overridden);
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
  // Rows an admin hid (#575) are not hits.
  return (await db.query<{id:string}>(`SELECT id::text FROM (SELECT DISTINCT COALESCE(o.primary_id,hit.id) AS id FROM (${searchHits(candidate,binder(values),mode)}) hit(id)
   LEFT JOIN product_offers o ON o.item_id=hit.id
   WHERE NOT EXISTS (SELECT 1 FROM commerce_item_overrides h WHERE h.supplier_item_id=hit.id AND h.hidden) LIMIT ${maxSearchHits}) unique_hits`,values)).rows.map(row=>row.id);};
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
// Secondary offers of a product sold by several suppliers are reached through the product listing them. An unavailable
// card is never hidden by product_offers, which only the next matching refresh rebuilds. NOT IN is planned as one
// hashed set; the correlated NOT EXISTS under the OR ran per row (~0.7 s instead of ~0.3 s for a full listing).
/** The secondary-offer test alone, for a query over commerce_catalog (supplied rows only, no `unavailable` column). */
export const notSecondaryOffer="catalog.id NOT IN (SELECT o.item_id FROM product_offers o WHERE o.primary_id<>o.item_id)";
export const listedOnly=`(catalog.unavailable OR ${notSecondaryOffer})`;
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
 // A model page lists its own fits, not their intersection with the make's: the make's list is the union of its
 // models' (and more), while the model's own read is a cached index lookup of its series.
 if(query.model) {
  const make=query.make?await getVehicleBrandBySlug(query.make):undefined;
  const model=make&&await getVehicleModelGroup(make,query.model);
  if(!model)clauses.push('false');
  else {
   values.push(await modelFittedIds(model.models.map(member=>member.id)));
   clauses.push(`catalog.id=ANY($${values.length}::uuid[])`);
  }
 }
 else if(query.make) {
  const make=await getVehicleBrandBySlug(query.make);
  if(!make)clauses.push('false');
  else {
   values.push(Number(make.id));
   clauses.push(`catalog.id=ANY(ARRAY(${makeFitsSql(`$${values.length}::int`)})::uuid[])`);
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
 // A manufacturer page (#660) lists its master brand's supplier labels, the same column the brand filter reads.
 if(query.manufacturer){const labels=await manufacturerLabels(query.manufacturer);if(labels.length){values.push(labels);clauses.push(`display_brand=ANY($${values.length}::text[])`);}else clauses.push('false');}
 const brands=selectedBrands(query);if(brands.length){values.push(brands);clauses.push(`display_brand=ANY($${values.length}::text[])`);}
 for(const [attribute,options] of Object.entries(selectedAttributes(query))){if(!options.length)continue;
  values.push(attribute);const attributeKey=`$${values.length}`;values.push(options);const optionsKey=`$${values.length}`;
  clauses.push(`catalog.id IN (SELECT e.supplier_item_id FROM storefront_enrichments e JOIN supplier_items s ON s.id=e.supplier_item_id
   AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
   AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)
   CROSS JOIN LATERAL jsonb_array_elements(e.payload->'specifications') spec
   WHERE spec->>0=${attributeKey} AND spec->>1=ANY(${optionsKey}::text[])
   AND (spec->>0<>'Brand class' OR e.match_basis->>'type'='exact_part')
   -- The admin's value or hiding of the key (#603) replaces the automatic one: those products match by the set value only.
   -- NOT IN (product_sources.supplier_item_id is NOT NULL) plans as a hashed SubPlan; <>ALL(ARRAY(...)) scans the array per row.
   AND e.supplier_item_id NOT IN (SELECT ps.supplier_item_id FROM product_override_specs o JOIN product_sources ps ON ps.product_id=o.product_id WHERE o.key=${attributeKey})
   UNION ALL SELECT ps.supplier_item_id FROM product_override_specs o JOIN product_sources ps ON ps.product_id=o.product_id
   WHERE o.action='set' AND o.key=${attributeKey} AND o.value=ANY(${optionsKey}::text[]))`);
 }
 // In stock: the row or any offer grouped under it can be sold now. Supplied: some supplier sells it (#475).
 if(query.availability==='supplied')clauses.push('NOT catalog.unavailable');
 else if(query.availability)clauses.push(query.availability==='in_stock'
  ?`catalog.id IN (SELECT COALESCE(o.primary_id,a.id) FROM (${catalogSql}) a LEFT JOIN product_offers o ON o.item_id=a.id WHERE a.available)`
  :`catalog.id IN (SELECT id FROM (${catalogSql}) available_catalog WHERE NOT available AND stock_label='Stokta yok')`);
 const where = clauses.length ? "WHERE "+clauses.join(" AND ") : "";
 const from = `FROM (${catalogEntriesSql}) catalog ${where}`;
 return {values,where,from,search};
}
// Listings without a search scan the whole 320k-row catalog for counts, facets and the date order
// (~0.5-1.5 s each on the VPS). Those change only with supplier syncs, so they are served from a
// 10-minute stale-while-revalidate cache; prices and stock are still read live for the listed ids. Admin edits
// (name, category, hidden, brand, part number, references, merge/split) bump the listing epoch instead (#585).
const aggregateTtl=10*60*1000;
const cachedCounts=staleCache<number>(aggregateTtl,500,listings),cachedPageIds=staleCache<string[]>(aggregateTtl,500,listings);
const cachedFacets=staleCache<{brands:string[];attributes:CatalogFacet[]}>(aggregateTtl,500,listings),cachedBrands=staleCache<string[]>(aggregateTtl,500,listings);
/** Cache key of everything that narrows the listing except search, which goes uncached. */
function filterKey(query:CatalogQuery,context:CatalogContext){
 return JSON.stringify([query.category,query.make,query.model,query.manufacturer,query.brand,query.brands,query.attributes,query.availability,query.fits,query.oil,query.fits||query.oil?context.vehicleTypeId:null]);
}
/**
 * Everything a plain search listing needs from its matches in one pass: ids in relevance order and the
 * brand facet. Reads the matched rows by primary key with their stored ranking inputs (db/search.sql);
 * the generic path joined the 23k-row id list against the catalog view four times (count, brands,
 * attribute facet, ranked page: ~0.6 s together) for the same answer. Same fields and order as that path.
 */
async function summarizeSearch(search:CatalogSearch,includeUnavailable=true){
 if(!search.ids.length)return {ids:[] as string[],brands:[] as string[]};
 const values:unknown[]=[company(),search.ids],bind=binder(values);
 const queries=`to_tsquery('simple',${bind(prefixTsQuery(search.parsed))}::text),to_tsquery('simple',${bind(exactTsQuery(search.parsed))}::text),${bind(search.parsed.compact)}::text`;
 const row=(await db.query<{ids:string[]|null;brands:string[]|null}>(`WITH hits AS MATERIALIZED (
   SELECT i.id,COALESCE(ov.brand,NULLIF(i.product_data->>'uk',''),'Belirtilmemiş') AS brand,i.updated_at,i.unavailable,
    -- The stored ranking inputs are the supplier's; a row with an admin-edited name, description, store brand or part
    -- number ranks the edit (#575, #602), the part number as the better of it and the supplier code. A price-only edit
    -- (#580) keeps the stored inputs. A hidden supplier OEM field (#615) ranks without the OEM. Same rule as catalogRank
    -- (src/modules/search/sql.ts).
    COALESCE(CASE WHEN ov.name IS NULL AND ov.description IS NULL AND ov.brand IS NULL AND ov.part_number IS NULL AND ov.hide_oem IS NOT TRUE
      THEN catalog_search_rank_doc(i.search_doc,i.search_code,i.search_oem,${queries}) END,
     GREATEST(catalog_search_rank(COALESCE(ov.name,NULLIF(i.product_data->>'ac',''),i.code),COALESCE(ov.brand,NULLIF(i.product_data->>'uk',''),'Belirtilmemiş'),
      i.code,CASE WHEN ov.hide_oem THEN '' ELSE COALESCE(i.product_data->>'oe','') END,COALESCE(ov.description,i.product_data->>'ac2',''),${queries}),
      CASE WHEN ov.part_number IS NOT NULL AND ov.part_number<>i.code THEN catalog_search_rank(COALESCE(ov.name,NULLIF(i.product_data->>'ac',''),i.code),
       COALESCE(ov.brand,NULLIF(i.product_data->>'uk',''),'Belirtilmemiş'),ov.part_number,CASE WHEN ov.hide_oem THEN '' ELSE COALESCE(i.product_data->>'oe','') END,
       COALESCE(ov.description,i.product_data->>'ac2',''),${queries}) END)) AS rank
   FROM (SELECT s.*,s.changed_at AS updated_at,false AS unavailable FROM commerce_supplier_items s WHERE s.id=ANY($2::uuid[]) AND s.company=ANY($1::text[])
    UNION ALL
    SELECT u.*,u.last_seen_at,true FROM commerce_unavailable_items u WHERE ${includeUnavailable} AND u.id=ANY($2::uuid[]) AND u.company=ANY($1::text[])) i
   LEFT JOIN commerce_item_overrides ov ON ov.supplier_item_id=i.id
   UNION ALL
   SELECT p.id,p.brand,p.updated_at,false,catalog_search_rank(p.name,p.brand,p.code,'',p.description,${queries}) FROM store_products p WHERE p.id=ANY($2::uuid[]))
  SELECT (SELECT array_agg(id::text ORDER BY unavailable,rank DESC,updated_at DESC,id) FROM hits) AS ids,
   (SELECT array_agg(DISTINCT brand ORDER BY brand) FROM hits) AS brands`,values)).rows[0];
 return {ids:row?.ids??[],brands:row?.brands??[]};
}
// A search with no other filter is the common case. Broad ones ("fren": ~70k matches) spend ~0.5 s just
// reading the matched rows, and their answer changes only with supplier syncs — like the listings above,
// it is served stale-while-revalidate for 10 minutes (admin edits reload it at once through the listing epoch, #585). Prices and stock are still read live for the listed
// ids. The first pages are kept (deeper pages are recomputed); facets need every match, so they are kept too.
// 30 cards keep a listing page near 0.6 MB of HTML (60 made it 1.15 MB); 20 cached pages still cover 600 results.
const catalogPageSize=30;
const cachedPages=20,cachedPlainSearches=staleCache<PlainSearch>(aggregateTtl,300,listings);
type PlainSearch={ids:string[];total:number;brands:string[];attributes:CatalogFacet[];correctedQuery?:string;vehicle?:VehicleSearchScope;tooShort?:boolean};
const plainSearch=(raw:string,mode:SearchMode)=>cachedPlainSearches(`${mode}|${normalizeSearchText(raw.slice(0,120))}|${raw.trim().toLocaleLowerCase("tr")}`,async()=>{
 const search=await catalogSearch(raw,mode),summary=await summarizeSearch(search);
 const {attributes}=await attributeFacets(summary.brands,[summary.ids],"SELECT unnest($1::uuid[]) AS id");
 return {ids:summary.ids.slice(0,cachedPages*catalogPageSize),total:summary.ids.length,brands:summary.brands,attributes,
  correctedQuery:search.correctedQuery,vehicle:search.vehicle,tooShort:search.tooShort};
});
/** No filter but the search (mirrors the clauses catalogFilter adds). */
function isPlainSearch(query:CatalogQuery){
 return Boolean(query.q?.trim())&&!query.category&&!query.make&&!query.model&&!query.manufacturer&&query.fits!=="vehicle"&&!query.oil&&!query.availability
  &&!selectedBrands(query).length&&!Object.values(selectedAttributes(query)).some(options=>options.length);
}
/**
 * The best matches of a search, priced, without the listing's counts and facets (#431). For API consumers that only
 * need the first results (the BakımX partner API): the facets of a broad search read every match and took 11-20 s
 * cold, while the ids and their ranking take ~0.2 s. Same ids, order and prices as the first page of a plain search.
 */
export async function searchCatalogItems(raw:string,mode:SearchMode,limit=catalogPageSize){
 const {ids}=await summarizeSearch(await catalogSearch(raw,mode),false);
 const items=(await db.query<CatalogProduct>(`SELECT catalog.* FROM unnest($2::uuid[]) WITH ORDINALITY page(id,ordinal)
  JOIN LATERAL (SELECT * FROM (${catalogSql}) priced WHERE priced.id=page.id OFFSET 0) catalog ON true ORDER BY page.ordinal`,[company(),ids.slice(0,limit)])).rows;
 return withBestOffers(items);
}
/**
 * The product count of a listing without a search, as browseProducts reports it (the same cache entry): the model
 * pages' metadata and their 404 and index rules read it before the page renders.
 */
export function listingTotal(query:CatalogQuery,context:CatalogContext={}){
 return cachedCounts(filterKey(query,context),async()=>{
  const {values,from}=await catalogFilter({...query,q:undefined},context);
  return Number((await db.query<{count:string}>(`SELECT count(*) ${from}`,values)).rows[0].count);
 });
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
   JOIN LATERAL (SELECT * FROM (${storefrontCatalogSql}) priced WHERE priced.id=page.id OFFSET 0) catalog ON true ORDER BY page.ordinal`,[company(),ids])).rows;
  return {items:await withBestOffers(items),total,page,pages,pageSize,correctedQuery:plain.correctedQuery,vehicleScope:plain.vehicle,searchTooShort:plain.tooShort};
 }
 const {values,where,from,search}=await catalogFilter(query,context);
 const count=async()=>Number((await db.query<{count:string}>(`SELECT count(*) ${from}`,values)).rows[0].count);
 const total = search ? await count() : await cachedCounts(filterKey(query,context),count);
 const pageSize = catalogPageSize, pages = Math.max(1,Math.ceil(total/pageSize));
 const requested = Number(query.page);
 const page = Number.isSafeInteger(requested) ? Math.min(pages,Math.max(1,requested)) : 1;
 // Products nobody supplies now come after every saleable one, in every order (#475).
 const order=query.sort === "price-asc" ? "unavailable,price_kurus ASC NULLS LAST,id" : query.sort === "price-desc" ? "unavailable,price_kurus DESC NULLS LAST,id" : "unavailable,updated_at DESC,id";
 const pricedSort = query.sort === "price-asc" || query.sort === "price-desc";
 // A search lists the best matches first unless the shopper picked another order.
 const pageValues=[...values],bind=binder(pageValues);
 const rank=search&&(query.sort??"relevance")==="relevance"?catalogRank("catalog",search.parsed,bind):"0";
 const offset=bind((page-1)*pageSize);
 if(!search&&!pricedSort){
  const ids=await cachedPageIds(`${filterKey(query,context)}|${page}`,async()=>(await db.query<{id:string}>(
   `SELECT id::text FROM (SELECT id,updated_at,unavailable ${from} ORDER BY ${order} LIMIT ${pageSize} OFFSET $${values.length+1}) page`,[...values,(page-1)*pageSize])).rows.map(row=>row.id));
  const items=(await db.query<CatalogProduct>(`SELECT catalog.* FROM unnest($2::uuid[]) WITH ORDINALITY page(id,ordinal)
   JOIN LATERAL (SELECT * FROM (${storefrontCatalogSql}) priced WHERE priced.id=page.id OFFSET 0) catalog ON true ORDER BY page.ordinal`,[company(),ids])).rows;
  return {items:await withBestOffers(items),total,page,pages,pageSize};
 }
 // A price order prices every listed row before it sorts (VW make page: ~50k rows, ~3 s per page). Its first
 // cachedPages pages are ordered once and kept like the page ids above; the cards are still read live, so a card shows
 // the current price and stock, while its position follows the prices of up to 10 minutes ago (supplier syncs, and admin
 // price edits, which do not move the listing epoch). Deeper pages keep the live query.
 if(!search&&pricedSort&&page<=cachedPages){
  const ordered=await cachedPageIds(`${filterKey(query,context)}|${query.sort}`,async()=>(await db.query<{id:string}>(
   `SELECT id::text FROM (SELECT id,unavailable,price_kurus FROM (${storefrontCatalogSql}) catalog ${where} ORDER BY ${order} LIMIT ${cachedPages*pageSize}) page`,values)).rows.map(row=>row.id));
  const items=(await db.query<CatalogProduct>(`SELECT catalog.* FROM unnest($2::uuid[]) WITH ORDINALITY page(id,ordinal)
   JOIN LATERAL (SELECT * FROM (${storefrontCatalogSql}) priced WHERE priced.id=page.id OFFSET 0) catalog ON true ORDER BY page.ordinal`,[company(),ordered.slice((page-1)*pageSize,page*pageSize)])).rows;
  return {items:await withBestOffers(items),total,page,pages,pageSize};
 }
 const items = (await db.query<CatalogProduct>(pricedSort
  ? `SELECT * FROM (${storefrontCatalogSql}) catalog ${where} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`
  : `WITH page AS MATERIALIZED (SELECT id,updated_at,unavailable,${rank} AS rank ${from} ORDER BY unavailable,rank DESC,${order} LIMIT ${pageSize} OFFSET ${offset})
     SELECT catalog.* FROM page JOIN LATERAL (SELECT * FROM (${storefrontCatalogSql}) priced WHERE priced.id=page.id OFFSET 0) catalog ON true
     ORDER BY page.unavailable,page.rank DESC,page.updated_at DESC,page.id`, pageValues)).rows;
 return {items:await withBestOffers(items),total,page,pages,pageSize,correctedQuery:search?.correctedQuery,vehicleScope:search?.vehicle,searchTooShort:search?.tooShort};
}
/** A product, or (for broad searches) a product name shared by `products` items. */
export type ProductSuggestion={kind:"product";id:string;name:string;name_overridden:boolean;brand:string;code:string}|{kind:"name";name:string;products:number};
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
 const products=(await db.query<{id:string;name:string;name_overridden:boolean;brand:string;code:string}>(`SELECT id,name,name_overridden,brand,code FROM (
  SELECT DISTINCT ON (name,display_brand) id::text,name,name_overridden,display_brand AS brand,display_code AS code,rank,updated_at,unavailable FROM (
   SELECT catalog.*,${catalogRank("catalog",search.parsed,bind)} AS rank FROM (${catalogEntriesSql}) catalog WHERE catalog.id=ANY($2::uuid[])) ranked
  ORDER BY name,display_brand,unavailable,rank DESC,updated_at DESC,id) best ORDER BY unavailable,rank DESC,updated_at DESC,id LIMIT ${Number(limit)}`,values)).rows;
 return {products:products.map(row=>({kind:"product" as const,...row})),...notes};
}
export async function catalogBrands() {
 return cachedBrands("all",async()=>(await db.query<{brand:string}>(`SELECT DISTINCT display_brand AS brand FROM (${catalogEntriesSql}) catalog ORDER BY brand`,[company()])).rows.map(p=>p.brand));
}

/** Products in the current search, category and make scope that are linked to the vehicle type. */
export async function vehicleFitCount(query:CatalogQuery,vehicleTypeId:string) {
 const scope:CatalogQuery={q:query.q,searchBy:query.searchBy,category:query.category,make:query.make,model:query.model,manufacturer:query.manufacturer,fits:'vehicle'};
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
 const scope:CatalogQuery={q:query.q,searchBy:query.searchBy,category:query.category,make:query.make,model:query.model,manufacturer:query.manufacturer,fits:query.fits,oil:query.oil};
 if(isPlainSearch(scope)){
  const plain=await plainSearch(query.q!,query.searchBy==="code"?"code":"all");
  return {brands:plain.brands,attributes:plain.attributes};
 }
 const {values,from,search}=await catalogFilter(scope,context);
 const load=()=>facetsFor(values,from);
 return search ? load() : cachedFacets(filterKey(scope,context),load);
}
async function facetsFor(values:unknown[],from:string){
 const brands=(await db.query<{brand:string}>(`SELECT DISTINCT display_brand AS brand ${from} ORDER BY brand`,values)).rows.map(r=>r.brand);
 return attributeFacets(brands,values,`SELECT catalog.id ${from}`);
}
/** `scopedSql` selects the listing's ids (one `id` column) using `values`. */
async function attributeFacets(brands:string[],values:unknown[],scopedSql:string){
 // MATERIALIZED: inlined, the search filter gets planned across the enrichment joins (~60 s instead of ms).
 // `ov`: the admin's specifications of the facet keys (#603); a set or hidden key replaces the row's automatic values.
 const keys=`$${values.length+1}::text[]`;
 const rows=(await db.query<{key:string;values:string[]}>(`WITH scoped AS MATERIALIZED (${scopedSql}),
 ov AS MATERIALIZED (SELECT ps.supplier_item_id AS id,o.key,o.action,o.value FROM product_override_specs o JOIN product_sources ps ON ps.product_id=o.product_id WHERE o.key=ANY(${keys})),
 specs AS (
  SELECT spec->>0 AS key,spec->>1 AS value
  FROM scoped JOIN storefront_enrichments e ON e.supplier_item_id=scoped.id JOIN supplier_items s ON s.id=e.supplier_item_id
  AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
  AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)
  CROSS JOIN LATERAL jsonb_array_elements(e.payload->'specifications') spec
  WHERE spec->>0=ANY(${keys}) AND length(spec->>1)<=200
  AND (spec->>0<>'Brand class' OR e.match_basis->>'type'='exact_part')
  AND NOT EXISTS (SELECT 1 FROM ov WHERE ov.id=scoped.id AND ov.key=spec->>0)
  UNION ALL
  SELECT ov.key,ov.value FROM ov JOIN scoped ON scoped.id=ov.id WHERE ov.action='set' AND length(ov.value)<=200)
 SELECT key,array_agg(DISTINCT value ORDER BY value) AS values FROM specs
 GROUP BY key HAVING count(DISTINCT value)<=40 ORDER BY CASE WHEN key='Fitting Position' THEN 0 WHEN key='Brand class' THEN 1 ELSE 2 END,key LIMIT 8`,[...values,facetSpecificationKeys])).rows;
 return {brands,attributes:rows.map(row=>({key:row.key,label:specificationLabel(row.key),options:facetOptions(row.values)}))};
}
