import "server-only";
import type { PoolClient, QueryResultRow } from "pg";
import { boundedQuery, db, preparedQuery } from "@/lib/db";
import { storefrontCompanies } from "@/modules/suppliers/storefront-sources";
import { z } from "zod";
import { cache } from "react";
import { staleCache } from "@/lib/stale-cache";
import { failureHold, sharedLoads, ttlCache } from "@/lib/ttl-cache";
import { isPoolTimeout, isStatementTimeout } from "@/lib/db-errors";
import { productPath } from "@/modules/seo/product-path";
import { productIdPath } from "@/modules/seo/product-id";
import { fitsEpoch, listingEpoch } from "./listing-epoch";
import { listingCacheStore, storedLinks } from "./listing-cache-store";
import { buildPriceOrder, priceOrderEnabled, priceOrderHeadStore, priceOrderInUse, priceOrderMaxIds, priceOrderSelectSql, priceOrderSlice, priceOrderStore, type PriceOrder } from "./listing-price-order";
import { listingWaitMs } from "./listing-wait";
import { defaultListingLimitMs, listingStatementTimeoutMs, searchFailureHoldMs, suggestStatementTimeoutMs } from "./listing-timeout";
export type { CatalogQuery } from "./catalog-query";
import type { CatalogQuery } from "./catalog-query";
import {getStoreCategories} from './categories';
import {legacyCategoryIds} from './category-tree';
import {getVehicleBrandBySlug} from './vehicle-catalog.server';
import {getVehicleModelGroup,getVehicleModelGroups} from './vehicle-model-groups.server';
import {normalizeSearchText,parseSearchQuery,exactTsQuery,prefixTsQuery,searchTooShort,wholeWords,withoutSynonyms,type ParsedSearch} from '@/modules/search/query';
import {ensureCustomSynonyms} from '@/modules/search/custom-synonyms';
import {typeNamePrefixQuery} from '@/modules/search/type-names';
import {binder,catalogRank,correctSearch,storedRank,overrideItemMatch,priceOnlyItemMatch,storeProductMatch,supplierItemMatch,vehicleTypeMatch,type Bind,type SearchMode} from '@/modules/search/sql';
import {facetOptions} from './specification-translations';
import {facetSpecificationKeys,selectedBrands,selectedAttributes,specificationLabel,type CatalogFacet} from './catalog-filters';
import {engineOilCategoryId,parseOilFilters} from './vehicle-oil';
import {engineOilIds,vehicleOilProductIds} from './vehicle-oil.server';
import {compareOffers} from './best-offer';
import {manufacturerLabels} from './manufacturers.server';
import {displayBrandSql,masterBrandJoinSql} from './display-brand-sql';
export type Product = { id: string; category: string; supplier: "dinamik" | "basbug" | "seta" | "demo"; code: string; name: string; brand: string; description: string; price_kurus: number; stock: number; updated_at: Date };
export type CatalogProduct = Omit<Product, "price_kurus" | "stock" | "category"> & {
 category: string | null; price_kurus: number | null; stock: number | null; oem: string; source: "store" | "supplier";
 available: boolean; max_quantity: number; stock_label: string; pricing_snapshot: Record<string, unknown>;
 /**
  * What the store shows as brand and manufacturer part number (#602): an admin's store brand / part number, else the
  * supplier's. `brand` and `code` stay the supplier's values: order lines, enrichment lookups and matching read those.
  */
 display_brand: string; display_code: string;
 /** The supplier's own label (supplier_item_brand; a store product's brand), indexed for brand pages (#771). */
 brand_label?: string;
 /** The name is an admin's (#575): shown as written, not converted like a supplier's (#686). */
 name_overridden: boolean;
 /** Set when the listing groups several supplier offers (db/product-matching.sql): the offer sold, and how many. */
 offer_id?: string; offers?: number;
 /** No supplier sells the product now (db/storefront-catalog.sql, #475): listed last, without a price, not orderable. */
 unavailable?: boolean;
 /**
  * An unavailable card of a Dinamik price-list-only code with content (#1068): in the supplier's price list but without
  * stock data, so never orderable; unlike other unavailable cards its page is indexed (productIndexable).
  */
 price_only?: boolean;
};
// Prices and availability are calculated by the shared commerce view.
export const catalogSql = "SELECT * FROM commerce_catalog WHERE source='store' OR company=ANY($1::text[])";
// Only id, available and stock_label of the same rows, without the pricing joins (db/commerce.sql, #1242): the listing's
// availability filter.
export const availabilitySql = "SELECT * FROM commerce_item_availability WHERE source='store' OR company=ANY($1::text[])";
/** The cards that can be sold now: a row, or the primary of a group one of whose offers is available. */
const inStockIdsSql=`SELECT COALESCE(o.primary_id,a.id) FROM (${availabilitySql}) a LEFT JOIN product_offers o ON o.item_id=a.id WHERE a.available`;
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
 // Two reads, never a join against the view (#1135): the offer ids first, then their priced rows by id array. The
 // per-offer LATERAL repeated the view per row (24 cards: ~281 ms against ~7 ms), and a plain join
 // `product_offers JOIN (catalogSql) ON id=item_id` lets the planner build the whole view (~2.3 s).
 const links = (await db.query<{ primary_id: string; item_id: string }>(
  "SELECT o.primary_id::text,o.item_id::text FROM product_offers o WHERE o.primary_id=ANY($1::uuid[])", [ids])).rows;
 if (!links.length) return items;
 const priced = new Map<string, CatalogProduct[]>();
 for (const row of await catalogRowsByIds([...new Set(links.map(link => link.item_id))])) priced.set(row.id, [...priced.get(row.id) ?? [], row]);
 const groups = new Map<string, CatalogProduct[]>();
 for (const link of links) groups.set(link.primary_id, [...groups.get(link.primary_id) ?? [], ...priced.get(link.item_id) ?? []]);
 return items.map(item => withBestOffer(item, groups.get(item.id) ?? []));
}
/** `item` priced and stocked by the best of its grouped offers (`group`, priced rows of product_offers), as withBestOffers does. */
export function withBestOffer<T extends CatalogProduct>(item: T, group: CatalogProduct[]): T {
 if (group.length < 2) return item;
 const best = group.filter(offer => offer.available && offer.price_kurus !== null).sort(compareOffers(item.id))[0];
 if (!best) return { ...item, offers: group.length };
 return { ...item, price_kurus: best.price_kurus, available: best.available, max_quantity: best.max_quantity, stock_label: best.stock_label,
  pricing_snapshot: best.pricing_snapshot, offer_id: best.id, offers: group.length };
}
/**
 * The rows of `sourceSql` (catalogSql, storefrontCatalogSql; `$1` stays the companies array) whose id is in `idsSql`, an
 * expression yielding a uuid[]. Read as `id=ANY(...)`, the view reaches supplier_items by primary key once for all ids
 * and computes its "latest succeeded import per supplier" step once. A per-id `JOIN LATERAL (… WHERE priced.id=page.id
 * OFFSET 0)` repeats that step per row, ~5.8 ms each (#1135): 24 listing cards on storefront_catalog took 138-157 ms
 * against 6.4 ms, 24 home cards on commerce_catalog 139 ms against 6.0 ms (200 ids: ~0.9 s against ~12 ms, #1093);
 * SETA equivalents 75.8 ms against 6.1 ms (#1158). Allowed shapes of `idsSql`: a bind array (`$2::uuid[]`), or
 * `ARRAY(SELECT …)` with the whole read inside a MATERIALIZED CTE (`WITH p AS MATERIALIZED (${catalogRowsByIdsSql(…)})`),
 * which plans as one InitPlan feeding the primary key scan. Never `IN (subquery)`, a plain join against the view or a
 * per-row LATERAL: the planner then builds the whole view (seconds) or repeats it per row.
 * A price order over up to 50k listed ids (pricedScope in browseProducts, #1335) reads the same bind array shape: the
 * planner sees their count and hash-joins, where the listing's own two id-set clauses estimated one row and priced per row.
 * The hot reads go out as named prepared statements (preparedQuery, #1170): planning was most of their time. Name a
 * statement on any connection only when its outer select lists its columns; one returning `*` (the view's row) only on
 * the pool, where a cached plan broken by a view gaining a column is retried, never inside a transaction it would abort.
 */
export const catalogRowsByIdsSql = (idsSql: string, sourceSql = catalogSql) => `SELECT * FROM (${sourceSql}) catalog WHERE catalog.id=ANY(${idsSql})`;
/**
 * The rows of `sourceSql` with these ids (catalogRowsByIdsSql), in the order given; an id without a row is left out, an id
 * with several rows keeps them all. `connection` lets a transaction read the supplier rows it has just written.
 */
async function rowsByIds(sourceSql:string,ids:string[],connection:Pick<PoolClient,"query">=db){
 if(!ids.length)return [] as CatalogProduct[];
 const sql=catalogRowsByIdsSql("$2::uuid[]",sourceSql);
 // `*` result: named only on the pool (catalogRowsByIdsSql); a transaction's client keeps it unnamed.
 // This file's by-id reads stay without listingQuery's limit (#1377): key reads of ~1 ms, and preparedQuery's 0A000 retry
 // needs the pool, not a transaction.
 const rows=(connection===db?await preparedQuery<CatalogProduct>(db,sql,[company(),ids]):await connection.query<CatalogProduct>(sql,[company(),ids])).rows;
 const byId=new Map<string,CatalogProduct[]>();
 for(const row of rows)byId.set(row.id,[...byId.get(row.id)??[],row]);
 return ids.flatMap(id=>byId.get(id)??[]);
}
/** The saleable rows (catalogSql) of these ids, in the order given; an id that is not saleable now is left out (#1093). */
export async function catalogRowsByIds(ids:string[],connection:Pick<PoolClient,"query">=db){
 return rowsByIds(catalogSql,ids,connection);
}
/** The store's rows (storefrontCatalogSql: saleable or `unavailable`) of these ids, in the order given (#1135). */
export async function storefrontRowsByIds(ids:string[],connection:Pick<PoolClient,"query">=db){
 return rowsByIds(storefrontCatalogSql,ids,connection);
}
/** A row the store shows: saleable, or (`unavailable`) a product no supplier sells now. */
export async function getStorefrontProduct(id: string): Promise<CatalogProduct | undefined> {
 if (!z.uuid().safeParse(id).success) return undefined;
 return (await preparedQuery<CatalogProduct>(db,`SELECT * FROM (${storefrontCatalogSql}) catalog WHERE id=$2`,[company(),id])).rows[0];
}
/**
 * Where the store shows a row it does not list itself (an old link): the same supplier code sold from another scope
 * or list (Dinamik's FALKON → "FALKON - AUTOKIT"), a saleable row of its product group, else the group's or the code's
 * unavailable card. Product ids are row ids; a merged product follows `merged_into`.
 * The unavailable candidates (the same supplier + code through supplier_items_part_key_idx, the group's members) are
 * found first and each tested against commerce_unavailable_items by id: OFFSET 0 keeps that a per-row probe reaching
 * every branch of the view by primary key. Joined on supplier + code the planner computed the whole view, price-only
 * branch included (#1068): 57 ms → 0.1 ms per unknown product address in an isolated schema with 60k price-only cards
 * (0.3-0.6 s measured at production size before).
 */
const canonicalSql = `WITH source AS (SELECT id,supplier,code FROM supplier_items WHERE id=$2),
 product AS (SELECT COALESCE(p.merged_into,p.id) AS id FROM products p WHERE p.id=$2
  UNION SELECT s.product_id FROM product_sources s WHERE s.supplier_item_id=$2),
 members AS (SELECT m.supplier_item_id AS id,m.product_id FROM product_sources m WHERE m.product_id IN (SELECT id FROM product)),
 same_code AS (SELECT c.id,c.code FROM source JOIN supplier_items c
  ON part_number_key(substring(c.code from position(' ' in c.code)+1))=part_number_key(substring(source.code from position(' ' in source.code)+1))
  AND c.supplier=source.supplier AND c.code=source.code)
 SELECT id::text FROM (
  SELECT c.id,0 AS step,0 AS own,storefront_supplier_rank(c.supplier) AS supplier_rank,c.code FROM source JOIN commerce_supplier_items c ON c.supplier=source.supplier AND c.code=source.code
  UNION ALL SELECT c.id,1,CASE WHEN c.id=m.product_id THEN 0 ELSE 1 END,storefront_supplier_rank(c.supplier),c.code FROM members m JOIN commerce_supplier_items c ON c.id=m.id
  UNION ALL SELECT k.id,2,0,0,k.code FROM same_code k WHERE EXISTS (SELECT 1 FROM commerce_unavailable_items u WHERE u.id=k.id OFFSET 0)
  UNION ALL SELECT m.id,3,0,0,i.code FROM members m JOIN supplier_items i ON i.id=m.id
   WHERE EXISTS (SELECT 1 FROM commerce_unavailable_items u WHERE u.id=m.id OFFSET 0)) target
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
 // The references first, then their priced rows by id array (catalogRowsByIdsSql, #1158): no view read per reference.
 return (await preparedQuery<CatalogProduct & { via_brand: string; via_part: string }>(db,`WITH refs AS MATERIALIZED (
   SELECT r.seta_item_id,r.brand,r.part_number FROM product_seta_references r
   WHERE r.item_id IN (SELECT $2::uuid UNION SELECT item_id FROM product_offers WHERE primary_id=$2::uuid)),
  priced AS MATERIALIZED (${catalogRowsByIdsSql("ARRAY(SELECT seta_item_id FROM refs)")})
  SELECT * FROM (
  SELECT DISTINCT ON (priced.id) priced.*,r.brand AS via_brand,r.part_number AS via_part FROM refs r
  JOIN priced ON priced.id=r.seta_item_id
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
 // An admin's store brand and part number of the equivalent (#602) win, as on its own page. The equivalents, their
 // candidate rows and those rows' prices are read once each (catalogRowsByIdsSql, #1158); the per-equivalent LATERAL
 // only picks among them.
 return (await preparedQuery<{ id: string | null; name: string | null; name_overridden: boolean | null; display_brand: string | null; display_code: string | null; brand: string; code: string; available: boolean | null }>(db,`WITH eq AS MATERIALIZED (
   SELECT q.id FROM product_sources s
   JOIN product_equivalents e ON e.product_id=s.product_id AND e.kind IN ('manual','brand')
   JOIN products q ON q.id=e.equivalent_id AND q.merged_into IS NULL
   WHERE s.supplier_item_id=$2::uuid ORDER BY q.id LIMIT 48),
  cand AS MATERIALIZED (
   SELECT o.product_id,o.supplier_item_id FROM product_sources o JOIN eq ON eq.id=o.product_id
   WHERE NOT EXISTS (SELECT 1 FROM product_offers po WHERE po.item_id=o.supplier_item_id AND po.primary_id<>po.item_id)),
  priced AS MATERIALIZED (${catalogRowsByIdsSql("ARRAY(SELECT supplier_item_id FROM cand)")})
  SELECT DISTINCT ON (q.id) listed.id::text,
   listed.name, listed.name_overridden, listed.display_brand, listed.display_code,
   COALESCE(qo.brand,b.name,q.brand_label) AS brand, COALESCE(qo.part_number,listed.code,q.code) AS code, listed.available
  FROM eq JOIN products q ON q.id=eq.id LEFT JOIN brands b ON b.key=q.brand
  LEFT JOIN product_overrides qo ON qo.product_id=q.id
  LEFT JOIN LATERAL (SELECT priced.id, priced.code, priced.available, priced.name, priced.name_overridden, priced.display_brand, priced.display_code
   FROM cand o JOIN priced ON priced.id=o.supplier_item_id
   WHERE o.product_id=q.id
   ORDER BY o.supplier_item_id=q.id DESC, priced.available DESC, o.supplier_item_id LIMIT 1) listed ON true
  ORDER BY q.id`, [company(), id])).rows
  .sort((a, b) => Number(Boolean(b.id)) - Number(Boolean(a.id)) || Number(Boolean(b.available)) - Number(Boolean(a.available)) || a.code.localeCompare(b.code))
  // The address of the listed row, from the row's own shown name, brand and part number: the page's canonical one.
  .map(({ id, name, name_overridden, display_brand, display_code, ...rest }) => ({ ...rest, id, href: id && name !== null && name_overridden !== null && display_brand !== null && display_code !== null ? productPath({ id, name, name_overridden, display_brand, display_code }) : id && productIdPath(id) }));
}
export { money, servicePrice } from "./money";

export const categories = [
 {slug:"yedek-parca",name:"Yedek parçalar",art:"parts"},
 {slug:"fren",name:"Fren sistemi",art:"brakes"},
 {slug:"filtre",name:"Filtreler",art:"filter"},
 {slug:"yag",name:"Yağlar ve sıvılar",art:"oil"},
 {slug:"silecek",name:"Silecekler",art:"wipers"},
 {slug:"aksesuar",name:"Aksesuar ve ekipman",art:"tools"},
] as const;
/**
 * Products linked to the vehicle types `typeIds`, counting only fitments observed in the product's current, trusted
 * enrichment payload. Steps are materialised in order: the types' fitments gathered per donor enrichment, each donor's
 * payload vehicles read once, then the offers sharing the donor. Joined row by row instead, the multi-kB payload was
 * re-read per fitment: 20 s for "passat", 1-2 min for a make page. Read from the materialized links (#446): the live
 * view, expected as one row, was nested against a make's 600k fitments and never finished (BMW: minutes, 504 at the CDN).
 * Since #1395 a donor's fitments are compared with its payload once, as arrays (`observed`: the types it agrees on), and
 * each offer sharing the donor is one row carrying those types. Before, every offer row carried the vehicles array into
 * a hash against the fitments: one type (17173) took 1.8-2.3 s locally and wrote ~2 GB of temp files (a 660 MB hash in
 * 512 batches); now 0.3-0.4 s without temp files. 120 types ("passat tdi"): 4.0 s → 1.3 s; 1,890 ("tdi"): 10.9 s → 7.8 s;
 * the same ids. The types are an array parameter, so the planner sees their number: an index read per type for a few,
 * one sequential pass for thousands. The 30 s limit stays: one type now takes ~1/60-1/90 of it, so it only stops a
 * runaway read (the vehicle search reads whole models elsewhere, vehicleFittedHits). A search read under a shorter limit
 * (the type-ahead's, `read`, #1398) keeps the shorter one, and its signal cancels the read.
 * An admin's decisions (db/product-override-fitments.sql, #583) apply per row and type: a removed type drops that
 * automatic fitment only (a search over several types still lists the row through another), an added type lists every
 * row of the product, enriched or not. The decisions of the selected types are read once, through their index.
 */
async function fittedProductIds(typeIds:number[],scope:string,read?:ReadOptions){
 return (await boundedQuery<{id:string}>(`catalog.fittedProductIds ${scope}`,
  `WITH donors AS MATERIALIZED (SELECT f.supplier_item_id AS donor_id,array_agg(f.source_index) AS idx,array_agg(f.source_vehicle) AS veh,
    array_agg(f.vehicle_type_id) AS typ FROM product_vehicle_fitments f WHERE f.vehicle_type_id=ANY($1::int[]) GROUP BY 1),
  observed AS MATERIALIZED (SELECT d.donor_id,m.types FROM donors d JOIN product_enrichments e ON e.supplier_item_id=d.donor_id
   CROSS JOIN LATERAL (SELECT e.payload->'vehicles' AS vehicles OFFSET 0) v
   CROSS JOIN LATERAL (SELECT array_agg(u.typ) AS types FROM unnest(d.idx,d.veh,d.typ) u(idx,veh,typ) WHERE u.veh=v.vehicles->u.idx) m
   WHERE m.types IS NOT NULL),
  trusted AS MATERIALIZED (SELECT e.supplier_item_id,o.types FROM observed o JOIN storefront_enrichments e ON e.donor_item_id=o.donor_id
   JOIN supplier_items s ON s.id=e.supplier_item_id AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
   AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)),
  decided AS MATERIALIZED (SELECT ps.supplier_item_id,o.vehicle_type_id,o.mode FROM product_override_fitments o
   JOIN product_sources ps ON ps.product_id=o.product_id WHERE o.vehicle_type_id=ANY($1::int[]))
  SELECT id::text FROM (SELECT t.supplier_item_id AS id FROM trusted t WHERE EXISTS (SELECT 1 FROM unnest(t.types) type_id
    WHERE (t.supplier_item_id,type_id) NOT IN (SELECT supplier_item_id,vehicle_type_id FROM decided WHERE mode='remove'))
  UNION SELECT supplier_item_id FROM decided WHERE mode='add') fitted`,[typeIds],Math.min(30_000,read?.timeoutMs||30_000),{signal:read?.signal})).rows.map(row=>row.id);
}
// Admin edits move products between categories (#575) and change vehicle fitments (#583): an edit bumps the listing
// epoch and these reload (#585). The caches that read vehicle fits follow the fits value instead (`fitListings`, #1368,
// listing-epoch.ts): it moves with every admin edit and also when the fit sync changed fit rows, which the others ignore.
const listings={epoch:listingEpoch},fitListings={epoch:fitsEpoch};
// How long a visitor waits for a reload when an earlier value exists (#771, listing-wait.ts), and how old a stored one
// served meanwhile may be (the store's prune window). Used by the listing caches below, since #1368 by the fit
// caches a page reads itself (listed models, garage vehicle listings), and since #1394 by the search caches (plain,
// API rankings, suggestions).
const boundedWait={maxWaitMs:listingWaitMs,maxFallbackMs:48*60*60*1000};
// Fitments change when enrichments are imported or an admin decides; vehicle-type lists are shared per process.
// Each value is an id array that can hold hundreds of thousands of uuids, so the caches are also bounded by total id
// count (#1262), not only by entries. The fitted ids wait for their reload (no bounded wait, #1368): other caches' loads
// read them (catalogFilter, the API's fitted rankings), and an earlier id set served there would be stored in that cache
// as the new value, one reload behind until its next bump or refresh.
const cachedFitted=staleCache<string[]>(10*60*1000,500,{...fitListings,weigh:ids=>ids.length,maxWeight:400_000});
const cachedCategoryIds=staleCache<string[]>(10*60*1000,500,{...listings,weigh:ids=>ids.length,maxWeight:600_000});
/**
 * Products fitting one make (`param`: its vehicle_brands id, e.g. "$2::int"), as one id column: the engine-level fits
 * precomputed in storefront_make_fits (db/storefront-make-fits.sql, #455) and the makes of the models read from supplier
 * descriptions (storefront_description_fits: product_model_fitments without the models the admin hid, #661), precomputed
 * per fitted row in storefront_make_description_fits (#956), a secondary offer counting as the product listing it, like
 * modelFittedIds (#674). Matching a make's fitments to the payloads per read took 20-57 s on RDS for the large makes;
 * hashing every description fit against the make's series per read took ~60 ms warm (VW, locally). Both branches are
 * now index reads (VW: ~60k ids, ~22 ms warm locally). Used as `id=ANY(ARRAY(...))`, an InitPlan run once per query, so
 * a make's ids never pass through Node (large id arrays fed the heap OOMs). The listing's cost grows with the id count;
 * its counts, facets and page ids (also the price orders, see browseProducts) are cached for 10 minutes.
 */
export const makeFitsSql=(param:string)=>`SELECT supplier_item_id FROM storefront_make_fits WHERE brand_id=${param}
  UNION SELECT COALESCE(o.primary_id,f.supplier_item_id) FROM storefront_make_description_fits f
  LEFT JOIN product_offers o ON o.item_id=f.supplier_item_id WHERE f.brand_id=${param}`;
/**
 * Every model fit as (model_id, id) rows, a pair possibly repeated: engine-level fits (storefront_model_fits, kept like
 * the make table) and models read from supplier descriptions (storefront_description_fits, model level only), a secondary
 * offer counting as the product listing it. A `model_id` condition on the subquery reaches both branches' indexes;
 * the model sitemap (src/modules/seo/sitemap-models.server.ts) and a model's category counts read the same rows (#673).
 */
export const modelFitsSql=`SELECT model_id,supplier_item_id AS id FROM storefront_model_fits
  UNION ALL SELECT f.model_id,COALESCE(o.primary_id,f.supplier_item_id) FROM storefront_description_fits f LEFT JOIN product_offers o ON o.item_id=f.supplier_item_id`;
/**
 * Products fitting a vehicle model page's series (#639), from modelFitsSql. Both branches are index reads (Golf 7:
 * ~25 ms for the description side); cached per process.
 */
const modelFittedIds=(modelIds:string[])=>cachedFitted(`model:${modelIds.join(",")}`,async()=>(await boundedQuery<{id:string}>(`catalog.modelFittedIds models=${modelIds.join(",")}`, 
 `SELECT DISTINCT id::text FROM (${modelFitsSql}) fits WHERE model_id=ANY($1::int[])`,[modelIds])).rows.map(row=>row.id));
/**
 * A make's model page units that list at least one product (#639): the make page links only these, so no link ends in
 * the empty model page's 404. A unit counts when a fitted product (as in modelFittedIds) is in the storefront listing
 * (listedOnly); a fit pointing at a hidden or no longer supplied item does not. One query per make over the make's
 * series, cached like the fits (per process and in storefront_listing_cache, so a new container adopts it, #1391; reloaded when a listing edit or the fit sync moves the fits value). After a
 * bump the make page waits at most LISTING_EPOCH_WAIT_MS for the reload, then links the earlier units (none: it waits).
 */
const cachedListedModels=staleCache<string[]>(10*60*1000,300,{...fitListings,...boundedWait,...storedLinks,fallbackWhen:ids=>ids.length>0,store:listingCacheStore<string[]>("listed-models",1)});
export async function getListedModelGroups(brandId:string) {
 const groups=await getVehicleModelGroups(brandId);
 const modelIds=groups.flatMap(group=>group.models.map(member=>member.id));
 const listedIds=new Set(await cachedListedModels(brandId,async()=>(await boundedQuery<{id:string}>(`catalog.listedModels brand=${brandId}`, 
  `WITH fits AS MATERIALIZED (SELECT model_id,supplier_item_id AS id FROM storefront_model_fits WHERE model_id=ANY($2::int[])
    UNION SELECT f.model_id,COALESCE(o.primary_id,f.supplier_item_id) FROM storefront_description_fits f LEFT JOIN product_offers o ON o.item_id=f.supplier_item_id
    WHERE f.model_id=ANY($2::int[])),
   ids AS MATERIALIZED (SELECT DISTINCT id FROM fits),
   listed AS MATERIALIZED (SELECT catalog.id FROM (SELECT e.* FROM storefront_catalog_entries e JOIN ids ON ids.id=e.id
     WHERE e.source='store' OR e.company=ANY($1::text[])) catalog WHERE ${listedOnly})
   SELECT DISTINCT fits.model_id::text AS id FROM fits JOIN listed ON listed.id=fits.id`,[company(),modelIds])).rows.map(row=>row.id)));
 return groups.filter(group=>group.models.some(member=>listedIds.has(member.id)));
}
/** Ids of the products linked to one vehicle type (cached per process). */
export const typeFittedIds=(typeId:number)=>cachedFitted(`type:${typeId}`,()=>fittedProductIds([typeId],`type=${typeId}`));
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
 * The trusted-enrichment links of the categories are materialised before supplier_items is touched (#1240): joined in
 * one step, the planner estimated 1 row for the enrichment × supplier_items join (176k in fact) and nested a loop that
 * probed product_source_categories 26.5M times, so the root category (/kategori/yedek-parca, 402 category ids) took
 * 55.7 s and hit the 30 s limit; materialised first it reads in ~0.5 s. Same rows: same columns and conditions.
 */
export const categoryProductIds=(legacy:string[],categoryIds:number[])=>cachedCategoryIds(`category:${legacy.join(",")}:${categoryIds.join(",")}`,async()=>
 (await boundedQuery<{id:string}>(`catalog.categoryProductIds legacy=${legacy.join(",")} categories=${categoryIds.length}:${categoryIds.slice(0, 5).join(",")}`, `WITH linked AS MATERIALIZED (SELECT DISTINCT e.supplier_item_id,e.supplier_code,e.supplier_brand
   FROM product_source_categories pc JOIN storefront_enrichments e ON e.donor_item_id=pc.supplier_item_id
   WHERE pc.source='trodo' AND pc.category_id=ANY($2::int[])
    AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem))
  SELECT id::text FROM (SELECT id FROM store_products WHERE category=ANY($1::text[])
  UNION SELECT id FROM supplier_items WHERE product_data->>'category'<>'' AND product_data->>'category'=ANY($1::text[])
  UNION SELECT k.supplier_item_id FROM linked k
   JOIN supplier_items s ON s.id=k.supplier_item_id AND s.code=k.supplier_code AND s.product_data->>'uk'=k.supplier_brand) automatic
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
/**
 * Ids of every catalog row the search matches: supplier items, store products and enriched OEM numbers (`main`), and
 * the price-only cards (`priceOnly`, #1068), kept apart so they never take the cap's slots from the others (#1081).
 */
function searchHits(parsed:ParsedSearch,bind:Bind,mode:SearchMode){
 // The stored search fields hold the supplier OEM; a row whose OEM field an admin hid (#615) is matched by
 // overrideItemMatch instead, on its text and code without the OEM. The anti-join reads the small overrides table.
 const oemHidden=(alias:string)=>`NOT EXISTS (SELECT 1 FROM commerce_item_overrides ho WHERE ho.supplier_item_id=${alias}.id AND ho.hide_oem)`;
 const hits=[`SELECT i.id FROM commerce_supplier_items i WHERE ${supplierItemMatch("i",parsed,bind,mode)} AND ${oemHidden("i")}`,
  `SELECT p.id FROM store_products p WHERE ${storeProductMatch("p",parsed,bind,mode)}`,
  // Products no supplier sells now are found too; the listing puts them last (#475). Dropped rows through the supplier
  // search indexes (commerce_dropped_items); price-only cards (#1068) through their own stored fields and indexes
  // (storefront_price_only_items, #1081). Read through commerce_unavailable_items, every match computed the whole
  // price-only branch (~130 ms for "bosch" at 100k price-only rows). The price-only hits are not checked against the
  // view here: a probe per hit cost ~9 µs (~170 ms for 16k name hits). Every reader of the ids reads them back through
  // the storefront views by id (summarizeSearch, catalogFilter, suggestProducts), so a row the view no longer lists
  // (sold since the last refresh, or yielding to another card) is never shown. The search's `ids` may therefore hold
  // a few ids no listing shows; their count is not a result count.
  `SELECT u.id FROM commerce_dropped_items u WHERE ${supplierItemMatch("u",parsed,bind,mode)} AND ${oemHidden("u")}`];
 const priceOnly=`SELECT q.supplier_item_id FROM storefront_price_only_items q WHERE ${priceOnlyItemMatch("q",parsed,bind,mode)}
    AND NOT EXISTS (SELECT 1 FROM commerce_item_overrides ho WHERE ho.supplier_item_id=q.supplier_item_id AND ho.hide_oem)`;
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
 return {main:hits.join(" UNION ALL "),priceOnly};
}
/**
 * The search's hit ids, at most `cap`. DISTINCT on the uuid, text afterwards: sorting 20k+ ids as collated text took
 * ~50 ms of the query. A secondary supplier offer counts as a hit of the product listing it; rows an admin hid (#575)
 * are not hits. The price-only cards fill only the slots the other hits leave (#1081): broad name queries ("fren": ~58k
 * saleable hits) would otherwise lose saleable rows to them under the unordered LIMIT.
 */
export function searchHitIdsSql(parsed:ParsedSearch,values:unknown[],mode:SearchMode,cap=maxSearchHits){
 const {main,priceOnly}=searchHits(parsed,binder(values),mode);
 const unique=(sql:string)=>`SELECT DISTINCT COALESCE(o.primary_id,hit.id) AS id FROM (${sql}) hit(id)
   LEFT JOIN product_offers o ON o.item_id=hit.id
   WHERE NOT EXISTS (SELECT 1 FROM commerce_item_overrides h WHERE h.supplier_item_id=hit.id AND h.hidden)`;
 return `WITH main AS MATERIALIZED (${unique(main)} LIMIT ${Number(cap)})
  SELECT id::text FROM main
  UNION ALL SELECT id::text FROM (SELECT * FROM (${unique(priceOnly)}) price_only WHERE id NOT IN (SELECT id FROM main)
   LIMIT ${Number(cap)}-(SELECT count(*) FROM main)) price_only`;
}
/**
 * Parses the query and, when nothing matches as typed, retries it with mistyped words corrected. `read` (the type-ahead's
 * shorter limit, #1398) applies to its catalog reads and the spell-correction (#1416); the synonym load always runs under the
 * type-ahead's limit. A failed correction or synonym load goes on without it (custom-synonyms.ts, correctSearch).
 */
const searchCatalog=async(raw:string,mode:SearchMode,read?:ReadOptions):Promise<CatalogSearch>=>{
 // Admin synonyms (#822) join the parser before the query is read.
 await ensureCustomSynonyms();
 const hits=async(candidate:ParsedSearch)=>{const values:unknown[]=[];
  return (await catalogRead<{id:string}>(`catalog.searchHits mode=${mode} q=${candidate.compact.slice(0,80)}`,searchHitIdsSql(candidate,values,mode),values,read)).rows.map(row=>row.id);};
 if(searchTooShort(raw))return {parsed:parseSearchQuery(raw),ids:[],tooShort:true};
 const parsed=parseSearchQuery(raw),ids=await hits(parsed);
 if(mode==="code")return {parsed,ids};
 if(ids.length){
  // Dinamik names do list vehicles ("ON FREN BALATASI … GOLF PASSAT"), so the whole query can match by name
  // alone and would hide the parts fitments link to that vehicle. A fitted part + vehicle reading adds them.
  const vehicle=await vehicleSearch(raw,hits,false,true,read);
  return vehicle?.vehicle?.fitted?{...vehicle,ids:[...new Set([...vehicle.ids,...ids])].slice(0,maxSearchHits)}:{parsed,ids};
 }
 // Cheapest reading first: the words as typed split into part + vehicle, then the whole query
 // spell-corrected ("hava fiiltresi"), then a split with each part corrected ("fren balatsı pasat").
 const vehicle=await vehicleSearch(raw,hits,false,false,read);
 if(vehicle)return vehicle;
 const corrected=await correctSearch(raw,"product",{},read?.timeoutMs);
 const correctedIds=corrected?await hits(corrected.parsed):[];
 if(corrected&&correctedIds.length)return {parsed:corrected.parsed,ids:correctedIds,correctedQuery:corrected.text};
 return await vehicleSearch(raw,hits,true,false,read)??{parsed,ids};
};
// Memoised per request: the listing, its facets and the vehicle-fit count all filter by the same search.
// The matching ids are fetched once through the search indexes; given as `id = ANY(...)` every later
// query reaches supplier_items by primary key. Joined as a subquery instead, the planner hash-joined
// the whole 320k-row price view per query (~2.5 s each on the VPS, ~60 s per page).
const catalogSearch=cache((raw:string,mode:SearchMode)=>searchCatalog(raw,mode));
/** A query's words as vehicleSearch splits them; null for fewer than two or more than six (no vehicle reading). */
function vehicleReadingWords(raw:string){
 const words=normalizeSearchText(raw.slice(0,120)).split(" ").filter(Boolean);
 return words.length<2||words.length>6?null:words;
}
/**
 * The counter a cached search follows (#1368). A search that may read as a part and a vehicle (vehicleSearch: two to six
 * words, not a code search) reads the vehicle's fits (vehicleFittedHits), so it follows the fits value; any other search
 * never reads them and keeps its entries through the fit sync. Decided from the words alone, which its key holds, so a
 * key always reads the same counter.
 */
const searchEpoch=(raw:string,mode:SearchMode)=>mode!=="code"&&vehicleReadingWords(raw)?fitsEpoch:listingEpoch;
/**
 * The most types of partly matched models a split's vehicle words may match and still be read in its turn (#1395,
 * #1407). A split whose words match more (an engine or fuel word: "tdi" 1,890 types, "volkswagen tdi" 13 whole models +
 * 769 types, "dizel" 10,649-12,019, "benzin" 14,547-24,270, "quattro" 850-1,037) is deferred: vehicleSearch reads it
 * only when no other split gives a fitted reading, longest vehicle phrase first. Read from the hits (vehicleFittedHits)
 * such a reading now takes 0.1-1.2 s locally instead of 4-42 s, so it is no longer skipped (#1395 did: "fren balatası
 * dizel" lost its fitted pads), but words like these say little about fit: "fren balatası passat tdi" still reads
 * "passat tdi" rather than "tdi". Whole models are never counted. VEHICLE_SEARCH_MAX_LIVE_TYPES, read per call: blank or
 * invalid 500, 0 defers every split whose words partly match a model.
 */
const maxLiveVehicleTypes=500;
function liveVehicleTypeLimit(){
 const setting=process.env.VEHICLE_SEARCH_MAX_LIVE_TYPES?.trim();
 const value=setting?Number(setting):maxLiveVehicleTypes;
 return Number.isInteger(value)&&value>=0?value:maxLiveVehicleTypes;
}
/** A search's vehicle words for statement labels, so a timeout or slow line names the search that caused it. */
const vehicleLabel=(parsed:ParsedSearch)=>[...parsed.terms.map(term=>term.text),...parsed.years.map(String)].join(" ").slice(0,60);
/**
 * The vehicle types a search's vehicle words match (#1395): `models` whose every type matches ("bmw", "passat",
 * "volkswagen"), and `types`, the matched types of the other models ("passat tdi"). Read first and handed to the fits
 * read (vehicleFittedHits) as arrays, so that read is planned for its real number of models, types and hits: as one
 * statement with the scope the planner read every fitment sequentially for "passat tdi".
 */
export type VehicleTypeScope={models:number[];types:number[]};
export async function vehicleSearchScope(parsed:ParsedSearch,read?:ReadOptions):Promise<VehicleTypeScope>{
 const values:unknown[]=[];
 return (await catalogRead<VehicleTypeScope>(`catalog.searchVehicleScope words=${vehicleLabel(parsed)}`,`WITH types AS MATERIALIZED (
   SELECT v.id,v.model_id FROM vehicle_types v WHERE ${vehicleTypeMatch("v",parsed,binder(values))}),
  models AS MATERIALIZED (SELECT v.model_id,count(*)=count(t.id) AS whole FROM vehicle_types v LEFT JOIN types t ON t.id=v.id
   WHERE v.model_id IN (SELECT model_id FROM types) GROUP BY 1)
  SELECT ARRAY(SELECT model_id FROM models WHERE whole ORDER BY 1) AS models,
   ARRAY(SELECT t.id FROM types t JOIN models m ON m.model_id=t.model_id AND NOT m.whole ORDER BY 1) AS types`,values,read)).rows[0];
}
/** At least this many hits per partly matched type before vehicleFittedHits reads from the types instead of the hits. */
const hitsPerLiveType=300;
/**
 * The search hits (`hitIds`, supplier rows) linked to a vehicle scope (vehicleSearchScope), in hit order (#1395, #1407):
 * a hit fits a whole model when storefront_model_fits holds it, which the shared-link refresh keeps per model by the
 * fittedProductIds rule (trusted payload, the admin's removed and added types; db/storefront-make-fits.sql), and a
 * partly matched model's type when fittedProductIds would list it for that type. The model rows are as fresh as the
 * refresh (a fitment change or an admin's decision shows after the background sync and its fits bump, at most ~30 s), as
 * on the make and model pages; unlike modelFittedIds no models read from supplier descriptions count: the search never
 * counted them. `words` names the vehicle in the statement labels. Two reads of the same rows, chosen by `by`:
 * - "hits", unless there are at least hitsPerLiveType hits per type: from the hits outward, one statement. The whole
 *   models' fit rows are read once and joined to the hits; the other hits reach their donor enrichment through the
 *   shared link (the fittedProductIds trust rule, each donor's hits as one array), each donor's payload vehicles are read
 *   once (OFFSET 0) and compared with the donor's fitments to the scope's types; the admin's removed types drop a row's
 *   fitment, added ones list its hits. Its cost follows the hits, not the types, so an engine or fuel word is no longer a
 *   scan of every fitment: locally, the same ids, "fren balatası dizel" (400 whole models + 10,649 types) 31.6 s → 0.6-0.9
 *   s, "yağ filtresi benzin" (2,720 + 14,547) 39 s → 0.5 s, "fren balatası volkswagen tdi" (13 + 769) 10.2 s → 0.8-1.1 s,
 *   "fren balatası tdi" (21 + 1,890) 10.8 s → 0.8-1.1 s, "fren balatası passat tdi" (120 types) 1.2 s → 0.8 s.
 *   Two plan traps: `f.vehicle_type_id+0` keeps the types out of the index condition, so a donor's few fitments are read
 *   through the primary key (supplier_item_id first) and tested against the hashed type array; on the bare column the
 *   planner probed product_vehicle_fitments_type_idx (vehicle_type_id, supplier_item_id) once per type and donor, 6.1M
 *   probes and 6.5 s for "fren balatası passat tdi". And the whole models' rows are materialised before the join: as an
 *   EXISTS per hit the planner searched storefront_model_fits_pkey (model_id, supplier_item_id) once per model and hit
 *   for a few dozen models ("fren balatası golf", 30 models: 672k index searches, 0.4-0.7 s; "filtre golf" 1.1 s), where
 *   the model rows take 40-75 ms.
 * - "types": the reading before #1407, from the scope outward: the whole models' fits and fittedProductIds over the types,
 *   kept to the hits in Node. It wins for few types against many hits: "filtre passat tdi" (41,612 hits, 120 types)
 *   1.3 s, against 1.5-3.7 s from the hits.
 * No hits (or an empty scope) read nothing.
 */
export async function vehicleFittedHits(scope:VehicleTypeScope,hitIds:string[],words:string,read?:ReadOptions,by?:"hits"|"types"):Promise<string[]>{
 if(!hitIds.length||!scope.models.length&&!scope.types.length)return [];
 const fromTypes=by?by==="types":scope.types.length>0&&scope.types.length*hitsPerLiveType<=hitIds.length;
 const linked=new Set(fromTypes?(await Promise.all([
  scope.models.length?catalogRead<{id:string}>(`catalog.searchModelFits models=${scope.models.length}:${scope.models.slice(0,5).join(",")}`,
   "SELECT DISTINCT supplier_item_id::text AS id FROM storefront_model_fits WHERE model_id=ANY($1::int[])",[scope.models],read).then(result=>result.rows.map(row=>row.id)):[],
  scope.types.length?fittedProductIds(scope.types,`words=${words} types=${scope.types.length}:${scope.types.slice(0,10).join(",")}`,read):[],
 ])).flat():(await catalogRead<{id:string}>(`catalog.searchFittedHits words=${words} hits=${hitIds.length} models=${scope.models.length} types=${scope.types.length}`,
  `WITH hits AS MATERIALIZED (SELECT DISTINCT h.id FROM unnest($1::uuid[]) h(id)),
  model_rows AS MATERIALIZED (SELECT DISTINCT f.supplier_item_id AS id FROM storefront_model_fits f WHERE f.model_id=ANY($2::int[])),
  whole AS MATERIALIZED (SELECT h.id FROM hits h JOIN model_rows m ON m.id=h.id),
  donors AS MATERIALIZED (SELECT l.donor_item_id,array_agg(l.supplier_item_id) AS items FROM hits h
   JOIN product_enrichment_shared_links l ON l.supplier_item_id=h.id
   JOIN product_enrichments e ON e.supplier_item_id=l.donor_item_id
   JOIN supplier_items s ON s.id=l.supplier_item_id AND s.code=l.supplier_code AND s.product_data->>'uk'=l.supplier_brand
   WHERE cardinality($3::int[])>0 AND h.id NOT IN (SELECT id FROM whole)
    AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=l.donor_oem) GROUP BY 1),
  observed AS MATERIALIZED (SELECT d.items,m.types FROM donors d
   JOIN product_enrichments e ON e.supplier_item_id=d.donor_item_id
   CROSS JOIN LATERAL (SELECT e.payload->'vehicles' AS vehicles OFFSET 0) v
   CROSS JOIN LATERAL (SELECT array_agg(f.vehicle_type_id) AS types FROM product_vehicle_fitments f
    WHERE f.supplier_item_id=d.donor_item_id AND f.vehicle_type_id+0=ANY($3::int[]) AND f.source_vehicle=v.vehicles->f.source_index) m
   WHERE m.types IS NOT NULL),
  decided AS MATERIALIZED (SELECT ps.supplier_item_id,o.vehicle_type_id,o.mode FROM product_override_fitments o
   JOIN product_sources ps ON ps.product_id=o.product_id WHERE o.vehicle_type_id=ANY($3::int[]))
  SELECT id::text FROM (SELECT id FROM whole
   UNION SELECT item.id FROM observed o CROSS JOIN LATERAL unnest(o.items) item(id)
    WHERE EXISTS (SELECT 1 FROM unnest(o.types) type_id
     WHERE (item.id,type_id) NOT IN (SELECT supplier_item_id,vehicle_type_id FROM decided WHERE mode='remove'))
   UNION SELECT d.supplier_item_id FROM decided d JOIN hits h ON h.id=d.supplier_item_id WHERE d.mode='add') fitted`,
  [hitIds,scope.models,scope.types],read)).rows.map(row=>row.id));
 return hitIds.filter(id=>linked.has(id));
}
/**
 * Most product names never mention vehicles, so "fren balatası passat" often matches nothing as a whole. Tries
 * every split of the words into a leading or trailing vehicle part ("passat", "golf 7 2015") and a
 * part that matches products. Splits whose parts are linked by fitments win, then the longest
 * vehicle part ("buji | bmw 320d" over "buji bmw | 320d").
 */
/**
 * `fittedOnly`: only readings whose vehicle has linked parts count. A split whose vehicle words partly match more types
 * than liveVehicleTypeLimit() (an engine or fuel word, #1395, #1407) is deferred and blocks no other split. When the
 * other splits give no fitted reading, the deferred ones are read, longest vehicle phrase first, and the first with
 * fitted parts is the result, with its vehicle notice ("fren balatası dizel": the pads linked to a diesel type). A
 * deferred split without fitted parts is never a "not fitted" reading (too broad to say so): an unfitted reading of
 * another split is the result, else the product part of the first deferred split tried (fewest vehicle words) whose
 * product part matches, as a plain search without a vehicle notice. Not with `fittedOnly`: there the whole query's
 * name matches are the result. A product part found by spell-correction is reported as the corrected query.
 */
async function vehicleSearch(raw:string,hits:(parsed:ParsedSearch)=>Promise<string[]>,correct:boolean,fittedOnly=false,read?:ReadOptions):Promise<CatalogSearch|null>{
 const words=vehicleReadingWords(raw);
 if(!words)return null;
 // Notices quote the shopper's own spelling ("yağ filtresi") when each typed word is one search word.
 const typed=raw.trim().split(/\s+/),sameWords=typed.length===words.length&&typed.every((word,index)=>normalizeSearchText(word)===words[index]);
 const display=(text:string,part:string[])=>sameWords&&text===part.join(" ")?part.map(word=>typed[words.indexOf(word)]).join(" "):text;
 const splits=words.slice(1).flatMap((_,index)=>{const size=index+1;
  return [{product:words.slice(0,words.length-size),vehicle:words.slice(words.length-size)},{product:words.slice(size),vehicle:words.slice(0,size)}];});
 // Each product part is resolved once: the deferred pass and the plain fallback reuse it.
 const products=new Map<string,Promise<{text:string;parsed:ParsedSearch;ids:string[]}|null>>();
 const productPart=(part:string[])=>{
  const text=part.join(" ");
  let resolved=products.get(text);
  if(!resolved){
   resolved=(async()=>{let ids:string[]=[];
    const product=await resolvePart(text,"product",correct,async parsed=>(ids=await hits(parsed)).length>0,read);
    return product&&{...product,ids};})();
   products.set(text,resolved);
  }
  return resolved;
 };
 type Reading={split:(typeof splits)[number];vehicle:{text:string;parsed:ParsedSearch};scope:VehicleTypeScope};
 const reading=async({split,vehicle,scope}:Reading)=>{
  const product=await productPart(split.product);
  if(!product)return null;
  const fitted=await vehicleFittedHits(scope,product.ids,vehicleLabel(vehicle.parsed),read);
  return {parsed:product.parsed,ids:fitted.length?fitted:product.ids,vehicleWords:split.vehicle.length,
   vehicle:{productText:display(product.text,split.product),vehicleText:display(vehicle.text,split.vehicle),fitted:fitted.length>0}};
 };
 let best:(CatalogSearch&{vehicleWords:number})|null=null;
 const deferred:Reading[]=[];
 for(const split of splits){
  if(best&&(best.vehicle?.fitted||split.vehicle.length<=best.vehicleWords))continue;
  if(!parseSearchQuery(split.vehicle.join(" ")).terms.some(term=>term.required&&/[a-z]/.test(term.text)))continue;
  // Each part is spell-checked against its own vocabulary: "pasat" is a vehicle word, "balatsı" a part word.
  // Next to a name match the vehicle words must match as typed: "fren" (→ "brake") must not read as the
  // "shooting brake" body style of "fren balatası".
  const vehicleWords=(parsed:ParsedSearch)=>fittedOnly?withoutSynonyms(parsed):parsed;
  const vehicle=await resolvePart(split.vehicle.join(" "),"vehicle",correct,async parsed=>{const values:unknown[]=[];
   return Boolean((await catalogRead("catalog.searchVehicleProbe",`SELECT 1 FROM vehicle_types v WHERE ${vehicleTypeMatch("v",vehicleWords(parsed),binder(values))} LIMIT 1`,values,read)).rowCount);},read);
  if(!vehicle)continue;
  const entry={split,vehicle,scope:await vehicleSearchScope(vehicleWords(vehicle.parsed),read)};
  // Too broad to read in its turn (liveVehicleTypeLimit): read after the others, below.
  if(entry.scope.types.length>liveVehicleTypeLimit()){deferred.push(entry);continue;}
  const candidate=await reading(entry);
  if(!candidate||fittedOnly&&!candidate.vehicle.fitted)continue;
  if(!best||(candidate.vehicle.fitted&&!best.vehicle?.fitted)||(candidate.vehicle.fitted===best.vehicle?.fitted&&candidate.vehicleWords>best.vehicleWords))best=candidate;
 }
 if(!best?.vehicle?.fitted){
  // Longest vehicle phrase first ("volkswagen tdi" before "tdi"); the sort is stable, so equals keep the tried order.
  for(const entry of [...deferred].sort((a,b)=>b.split.vehicle.length-a.split.vehicle.length)){
   const candidate=await reading(entry);
   if(candidate?.vehicle.fitted)return {parsed:candidate.parsed,ids:candidate.ids,vehicle:candidate.vehicle};
  }
 }
 if(best)return {parsed:best.parsed,ids:best.ids,vehicle:best.vehicle};
 if(fittedOnly)return null;
 for(const {split} of deferred){
  const product=await productPart(split.product);
  if(product)return product.text===split.product.join(" ")?{parsed:product.parsed,ids:product.ids}:{parsed:product.parsed,ids:product.ids,correctedQuery:product.text};
 }
 return null;
}
// Vehicle words must be whole words ("passat", "golf 7"), so a part word that only starts a make
// ("hava" → HAVAL) does not split "hava filtresi" into a vehicle and a part.
/** The part as typed, else (when `correct`) spell-corrected, if it `matches`; null otherwise. */
async function resolvePart(text:string,scope:"vehicle"|"product",correct:boolean,matches:(parsed:ParsedSearch)=>Promise<boolean>,read?:ReadOptions){
 const options={years:scope==="vehicle"},parse=(value:string)=>scope==="vehicle"?wholeWords(parseSearchQuery(value,options)):parseSearchQuery(value,options);
 const parsed=parse(text);
 if(await matches(parsed))return {text,parsed};
 if(!correct)return null;
 const corrected=await correctSearch(text,scope,options,read?.timeoutMs);
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
// Rows whose shown brand (display_brand) is one of `names`. display_brand cannot use an index, so every brand page
// scanned all supplier items (#771); the rows are reached through brand_label (the supplier's own label,
// supplier_items_brand_label_idx): the labels of the named master brands plus the names themselves (raw labels and
// store products), or an admin's store brand (commerce_item_overrides). display_brand stays as the exact check.
// Labels and override ids are read first and passed as values: the planner then estimates the brand's share from the
// index's statistics and scans the table for a brand as large as ORIJINAL (~12% of rows), where a bitmap read of the
// subquery's unknown-size result was 1.5x slower than the old scan.
// Known difference: a Dinamik row whose label (marka) is linked to no master brand and differs from its uk value is
// not found by its uk name; it is once the label is linked to a master brand (#470). "Belirtilmemiş" has no label.
// The lookup is cached like the manufacturer directory (10 minutes; admin brand and override edits move the listing epoch),
// so a page's count, facet and id reads share one.
type BrandReach={labels:string[];ids:string[]};
const cachedBrandReach=staleCache<BrandReach>(10*60*1000,500,listings);
const brandReach=(names:string[])=>cachedBrandReach(JSON.stringify([...names].sort()),async()=>(await catalogRead<BrandReach>("catalog.brandReach",`SELECT
  ARRAY(SELECT sb.label FROM supplier_brands sb JOIN brands mb ON mb.id=sb.brand_id WHERE mb.name=ANY($1::text[]))||$1::text[] AS labels,
  ARRAY(SELECT ov.supplier_item_id::text FROM commerce_item_overrides ov WHERE ov.brand=ANY($1::text[])) AS ids`,[names])).rows[0]);
async function shownBrandClause(names:string[],values:unknown[]) {
 values.push(names);const key=`$${values.length}::text[]`;
 if(names.includes("Belirtilmemiş"))return `catalog.display_brand=ANY(${key})`;
 const {labels,ids}=await brandReach(names);
 values.push(labels);let reach=`catalog.brand_label=ANY($${values.length}::text[])`;
 if(ids.length){values.push(ids);reach=`(${reach} OR catalog.id=ANY($${values.length}::uuid[]))`;}
 return `${reach} AND catalog.display_brand=ANY(${key})`;
}
const facetKeys:ReadonlySet<string>=new Set(facetSpecificationKeys);
async function catalogFilter(query:CatalogQuery,context:CatalogContext={}) {
 const values: unknown[] = [company()]; const clauses: string[] = [listedOnly];
 // The clauses narrowing the listing to an id set (search, category, model, make, vehicle fits, oil, each property) go
 // through idSet: a price order over two or more is priced by id array (pricedScope, #1335).
 let idSets=0;
 const idSet=(clause:string)=>{idSets++;clauses.push(clause);};
 let search:CatalogSearch|undefined;
 const fitted=query.fits==='vehicle'&&context.vehicleTypeId?await typeFittedIds(Number(context.vehicleTypeId)):undefined;
 if(query.q?.trim()) {
  search=await catalogSearch(query.q,query.searchBy==="code"?"code":"all");
  // A search for the vehicle's fits passes their intersection as one small array (#884): the two id arrays (a broad
  // search's 20k+ and a type's ~2k) took ~0.1 s per query, twice per page with the "Aracına uyanlar" lead.
  const linked=fitted&&new Set(fitted);
  idSet(`catalog.id=ANY(${binder(values)(linked?search.ids.filter(id=>linked.has(id)):search.ids)}::uuid[])`);
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
   idSet(`catalog.id=ANY($${values.length}::uuid[])`);
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
   idSet(`catalog.id=ANY($${values.length}::uuid[])`);
  }
 }
 else if(query.make) {
  const make=await getVehicleBrandBySlug(query.make);
  if(!make)clauses.push('false');
  else {
   values.push(Number(make.id));
   idSet(`catalog.id=ANY(ARRAY(${makeFitsSql(`$${values.length}::int`)})::uuid[])`);
  }
 }
 if(query.fits==='vehicle') {
  if(!fitted)clauses.push('false');
  else if(!search) {
   values.push(fitted);
   idSet(`catalog.id=ANY($${values.length}::uuid[])`);
  }
 }
 const oil=parseOilFilters(query.oil);
 if(oil.size) {
  if(!context.vehicleTypeId)clauses.push('false');
  else {
   values.push(await vehicleOilProductIds(context.vehicleTypeId,oil));
   idSet(`catalog.id=ANY($${values.length}::uuid[])`);
  }
 }
 // A manufacturer page (#660) lists its master brand's name and labels (display_brand values), the column the brand filter reads.
 if(query.manufacturer){const labels=await manufacturerLabels(query.manufacturer);clauses.push(labels.length?await shownBrandClause(labels,values):'false');}
 const brands=selectedBrands(query);if(brands.length)clauses.push(await shownBrandClause(brands,values));
 // A property reads the facet rows its sidebar options come from (storefront_facet_specs, #994) instead of unpacking
 // every enrichment payload per request (#1248, locally: 1.5-3.6 s per /katalog count, 2.2-5.3 s in the root category,
 // and a price order hit the 30 s limit). The rows carry the guards applied when they were refreshed (match basis,
 // "Brand class" only from an exact part); the offer's identity (code and brand) is checked again here against its
 // link, as the cards do. A key the sidebar never offers (outside facetSpecificationKeys, so only from a hand-written
 // URL) matches nothing rather than reopening the payload read.
 // =ANY(ARRAY(...)) is an InitPlan run once that drives the catalog by primary key, like makeFitsSql: 50-140 ms per
 // /katalog count, 240-450 ms in the root category (its ~189k-id array). The same set as IN (...) kept the catalog's
 // full scan: 330-460 ms on /katalog, 1.2-1.4 s with the category, and once a 24.5 s plan.
 for(const [attribute,options] of Object.entries(selectedAttributes(query))){if(!options.length)continue;
  if(!facetKeys.has(attribute)){clauses.push('false');continue;}
  values.push(attribute);const attributeKey=`$${values.length}`;values.push(options);const optionsKey=`$${values.length}`;
  idSet(`catalog.id=ANY(ARRAY(SELECT f.supplier_item_id FROM storefront_facet_specs f
   JOIN product_enrichment_shared_links l ON l.supplier_item_id=f.supplier_item_id
   JOIN supplier_items s ON s.id=l.supplier_item_id AND s.code=l.supplier_code AND s.product_data->>'uk'=l.supplier_brand
   WHERE f.key=${attributeKey} AND f.value=ANY(${optionsKey}::text[])
   -- The admin's value or hiding of the key (#603) replaces the automatic one: those products match by the set value only.
   -- NOT IN (product_sources.supplier_item_id is NOT NULL) plans as a hashed SubPlan; <>ALL(ARRAY(...)) scans the array per row.
   AND f.supplier_item_id NOT IN (SELECT ps.supplier_item_id FROM product_override_specs o JOIN product_sources ps ON ps.product_id=o.product_id WHERE o.key=${attributeKey})
   UNION ALL SELECT ps.supplier_item_id FROM product_override_specs o JOIN product_sources ps ON ps.product_id=o.product_id
   WHERE o.action='set' AND o.key=${attributeKey} AND o.value=ANY(${optionsKey}::text[]))::uuid[])`);
 }
 // In stock: the row or any offer grouped under it can be sold now. Supplied: some supplier sells it (#475).
 // Out of stock: the card's own row says "Stokta yok" and none of its grouped offers can be sold, so a card is never in
 // both filters, and unknown-stock or unsupplied cards are in neither (#1342; locally 25,018 cards were in both).
 // Both read the lean availability view, not commerce_catalog's priced rows a second time (#1242). Out of stock reads it
 // through commerce_out_of_stock_ids (db/commerce.sql), whose declared size keeps deep pages off a nested loop (#1286).
 // The in-stock exclusion sits inside that subquery, a hashed SubPlan on the Function Scan the catalog hash-joins (page 49:
 // ~0.85 s -> ~1.1 s); NOT IN at the top level filters the catalog scan itself and serialises it (~1.6 s), and EXCEPT
 // took ~60 s. The planner hashes the NOT IN only while the in-stock ids' estimate (~40 B a row) fits work_mem x
 // hash_mem_multiplier: locally ~189k rows, 7.6 MB against the default 4 MB x 2, hashed at 3750 kB but a per-row SubPlan
 // at 3600 kB (estimated cost 8e10, a hang). Its reads therefore run bounded with 32 MB (listingQuery): room for ~1.6M
 // estimated rows, where the session default would leave ~200k locally and ~800k on production's 16 MB.
 // Pushed as clauses, not idSet: availability stays out of pricedScope's id-set count (#1335).
 let workMem:string|undefined;
 if(query.availability==='supplied')clauses.push('NOT catalog.unavailable');
 else if(query.availability==='in_stock')clauses.push(`catalog.id IN (${inStockIdsSql})`);
 else if(query.availability){
  clauses.push(`catalog.id IN (SELECT id FROM commerce_out_of_stock_ids($1::text[]) id WHERE id NOT IN (${inStockIdsSql}))`);
  workMem="32MB";
 }
 const where = clauses.length ? "WHERE "+clauses.join(" AND ") : "";
 const from = `FROM (${catalogEntriesSql}) catalog ${where}`;
 return {values,where,from,search,idSets,workMem};
}
/**
 * A catalog listing or search read, run under a server-side time limit (#1377: listingStatementTimeoutMs, 55 s, just under
 * the CDN's and load balancer's 60 s): a read the CDN gave up on (504) must not keep running on the database and hold one
 * of the pool's connections. The limit is per statement, not per request: an uncached search runs several in sequence
 * (hits, vehicle readings, summary, facets), so a request the CDN abandoned can still hold a connection for up to that many
 * times 55 s plus its pool waits; bounded, where before it was not. A statement of 55-60 s that answered its page before
 * now fails. On a page that streams, the CDN's 60 s count from the last bytes sent, not from the request, so a read under
 * its shell may have taken longer than 55 s and still answered before. A load in the background (a TTL refresh, an epoch
 * reload past the bounded wait) that hits the limit leaves its key at the earlier value (listing-timeout.ts).
 * A timeout (57014) is logged with `label` and fails the load: a cache then keeps or serves its earlier value under its
 * own rules (staleCache, #771), a first load without one fails the page. LISTING_STATEMENT_TIMEOUT_MS=0 sends the plain
 * statement again (the rollback). `workMem` (out of stock, #1342) raises work_mem for the read and keeps the 30 s it had
 * before, whatever the setting. Costs three more round trips (BEGIN, SET LOCAL, COMMIT), locally ~0.16 ms per read.
 * `read` (#1398): `timeoutMs` replaces the setting's limit (the type-ahead's shorter one, suggestStatementTimeoutMs), and
 * `signal` cancels the statement when its request is aborted (boundedQuery); a read with a signal stays bounded when the
 * limit is off (55 s then). Page renders have no signal to pass: Next 16 aborts a request's signal only in route handlers
 * (src/app/api/search/suggest/route.ts). A load a cache shares between requests never takes one: a visitor who left must
 * not fail it for the others waiting on it.
 */
export type ReadOptions={timeoutMs?:number;signal?:AbortSignal};
function listingQuery<T extends QueryResultRow>({workMem}:{workMem?:string},label:string,sql:string,values:unknown[],read?:ReadOptions){
 if(workMem)return boundedQuery<T>(label,sql,values,30_000,{workMem});
 const limit=read?.timeoutMs??listingStatementTimeoutMs();
 if(read?.signal)return boundedQuery<T>(label,sql,values,limit||defaultListingLimitMs,{signal:read.signal});
 return limit?boundedQuery<T>(label,sql,values,limit):db.query<T>(sql,values);
}
/** A catalog read outside a catalogFilter listing (search, type-ahead, facets, brand reach) under listingQuery's limit. */
function catalogRead<T extends QueryResultRow>(label:string,sql:string,values:unknown[],read?:ReadOptions){
 return listingQuery<T>({},label,sql,values,read);
}
// The listing reads, from catalogFilter's `from`: its count, one page of ids in the default order (`offset` a parameter),
// and its shown brands (the brand facet).
const countSql=(from:string)=>`SELECT count(*) ${from}`;
const pageIdsSql=(from:string,offset:string)=>`SELECT id::text FROM (SELECT id,updated_at,unavailable ${from} ORDER BY ${newestOrder} LIMIT ${catalogPageSize} OFFSET ${offset}) page`;
const brandsSql=(from:string)=>`SELECT DISTINCT display_brand AS brand ${from} ORDER BY brand`;
/** The listing's product count, as the count caches keep it. */
async function countListing(listing:{values:unknown[];from:string;workMem?:string},key:string){
 return Number((await listingQuery<{count:string}>(listing,`catalog.listingCount ${key}`,countSql(listing.from),listing.values)).rows[0].count);
}
// Listings without a search scan the whole 320k-row catalog for counts, facets and the date order
// (~0.5-1.5 s each on the VPS). Those change only with supplier syncs, so they are served from a
// 10-minute stale-while-revalidate cache; prices and stock are still read live for the listed ids. Admin edits
// (name, category, hidden, brand, part number, references, merge/split) bump the listing epoch instead (#585).
// The plain listings' counts, page ids and facets (persistable below) are also kept in storefront_listing_cache (#957), so a
// new or restarted container serves them at once: up to 24 hours old there, the first visitor sees the stored value while
// one refresh runs. Listings narrowed by brand, property, availability or a vehicle have too many variants to share.
// A property listing reads the same precomputed rows as its options (storefront_facet_specs, #1248): a changed enrichment
// value reaches both with the next shared-link sync, then with this cache's refresh (the sync does not move the epoch).
// The stored keys must stay bounded until the 2-day prune: a crawler walking model x category pages (~5.8k models x ~590
// categories) would add hundreds of thousands of rows, so model listings stay in memory, and a make's listing keeps its
// first page only (deeper pages of the plain, category and manufacturer listings are stored up to page 20; a price order is one key).
// Past page 20 a price order is read from the listing's whole stored order (storefront_listing_price_orders, #1369): one
// row per listing and sort, the same keys as the price order above, under the same rules (cachedPriceOrders). Its first
// 480 ids also serve as the stored first pages of that price order when they are newer (cachedPricedHeads, #1389).
// These three also wait at most LISTING_EPOCH_WAIT_MS (250 ms, listing-wait.ts) for a reload when an earlier value
// exists (#771): the entry an epoch bump replaced, or a stored row of an older epoch or past maxStaleMs, up to 48 hours
// old (the store's prune window). The fit sync bumps the fits value up to every 30 s while fit rows change
// (enrichment-links.server.ts, #1368), which a make's listings follow (epochOf; the manufacturer, category and plain ones
// follow the listing epoch, which only an admin edit moves), and a large listing's count, ids and facets scan every row
// of it (ORIJINAL, 155k rows: ~3 s cold); the visitor gets the earlier aggregate while the reload runs. Cards are read live by
// id (storefrontRowsByIds), so prices, stock and hidden products stay current; only the count, the order and the facets
// can be one reload behind. After an admin edit (#585) a listing whose reload takes longer than the wait shows the
// earlier count and ids until it finishes; a quick one shows the edit at once. An empty earlier value (a 0 count, no ids,
// no facet) is never served: a count gates the 404 and the index rules (marka page, findListing), and an empty listing
// that just gained products must not show "no products" beside a fresh count, so callers wait for the reload, which is
// cheap for a listing that was empty. The warm-up waits for every reload (listingWaitMs). A garage vehicle's listings, a
// make's listed models and a make's or model's category counts (listing-categories.server.ts) wait the same way (#1368);
// the fitted id sets and the brand cache still wait for their reload.
// A listing without a search, vehicle or narrowing filter loads its count, first page ids and facets from one scan
// (listingSummary, #1367): the three caches keep their own keys, stored rows and rules, and their loaders share it.
const aggregateTtl=10*60*1000,persistedFor={maxStaleMs:24*60*60*1000};
const persistedListings={...listings,...persistedFor,...boundedWait};
const cachedCounts=staleCache<number>(aggregateTtl,500,{...persistedListings,fallbackWhen:count=>count>0,store:listingCacheStore<number>("count",1)});
const cachedPageIds=staleCache<string[]>(aggregateTtl,500,{...persistedListings,fallbackWhen:ids=>ids.length>0,store:listingCacheStore<string[]>("page-ids",1)});
// A garage vehicle's fit and oil filters key their entries per vehicle type (#884): kept apart, so every page view with a
// vehicle (its "Aracına uyanlar" lead) does not push the plain listings, 0.5-1.5 s each to recompute, out of the LRU above.
// They wait like the three above (#1368), in memory only: the earlier value is the entry a bump replaced.
const cachedVehicleCounts=staleCache<number>(aggregateTtl,500,{...fitListings,...boundedWait,fallbackWhen:count=>count>0}),
 cachedVehiclePageIds=staleCache<string[]>(aggregateTtl,500,{...fitListings,...boundedWait,fallbackWhen:ids=>ids.length>0});
const vehicleScoped=(query:CatalogQuery)=>Boolean(query.fits||query.oil);
const countCache=(query:CatalogQuery)=>vehicleScoped(query)?cachedVehicleCounts:cachedCounts;
const pageIdCache=(query:CatalogQuery)=>vehicleScoped(query)?cachedVehiclePageIds:cachedPageIds;
type Facets={brands:string[];attributes:CatalogFacet[]};
const cachedFacets=staleCache<Facets>(aggregateTtl,500,{...persistedListings,fallbackWhen:facets=>facets.brands.length+facets.attributes.length>0,store:listingCacheStore<Facets>("facets",1)}),cachedBrands=staleCache<string[]>(aggregateTtl,500,listings);
// The stored whole price orders (#1369): the process keeps each one's size only, its ids stay in the table
// (listing-price-order.ts). Same rules as the three above; an order stored empty (nothing to store) is no earlier value.
// Its loader and the first pages' below both call buildPriceOrder (#1405), not each other's cache: a refresh of either
// serves its stale value at once and loads in the background, so a loader awaiting the other cache would not see the
// build. buildPriceOrder shares a running build of the same key, epoch and head size, and returns a row another load
// stored since this one read the store; each cache then picks the row up through its own store.
const cachedPriceOrders=staleCache<PriceOrder>(aggregateTtl,500,{...persistedListings,fallbackWhen:order=>order.total>0,store:priceOrderStore});
// The first pages of a stored listing's price order (#1389): cachedPageIds' rows and rules, with the stored order's first
// 480 ids as a second source (priceOrderHeadStore), so a listing a deep page ordered is not priced again. While a deep
// page sliced that order within the last 20 minutes (priceOrderInUse, #1405), a load rebuilds the order and takes its
// first ids instead of its own 480-id pass, so a listing hot on both sides is priced once per refresh. These keys have
// their own 500 entries, apart from cachedPageIds'. The size is read lazily: cachedPages is declared further down. An
// order older than the cache's longest window (maxFallbackMs, 48 hours) is not read: nothing could take it.
const cachedPricedHeads=staleCache<string[]>(aggregateTtl,500,{...persistedListings,fallbackWhen:ids=>ids.length>0,
 store:priceOrderHeadStore(listingCacheStore<string[]>("page-ids",1),()=>cachedPages*catalogPageSize,persistedListings.maxFallbackMs)});
const persistable=(query:CatalogQuery)=>!(query.q?.trim()||query.model||query.brand||query.brands||query.attributes||query.availability||query.fits||query.oil);
const persistablePage=(query:CatalogQuery,page:number)=>persistable(query)&&page<=(query.make?1:cachedPages);
/**
 * A listing that reads vehicle fits (#1368): a make's or model's, or one with a garage vehicle's filter (fits, oil; their
 * keys share the vehicle caches). Its cached count, page ids, facets and price order follow the fits value (epochOf), so
 * the fit sync reloads them; every other listing follows the listing epoch and keeps its entries through the sync. Read
 * from the fields filterKey holds, so a key always reads the same counter.
 */
const fitScoped=(query:CatalogQuery)=>Boolean(query.make||query.model||query.fits||query.oil);
const epochOf=(query:CatalogQuery)=>fitScoped(query)?fitsEpoch:listingEpoch;
/** The options of a listing cache read: whether the key is stored (persistable) and the counter it follows (epochOf). */
const readOptions=(query:CatalogQuery,persist:boolean)=>({persist,epoch:epochOf(query)});
/** The listing filter built at most once, on the first call: a cached listing never builds it (its id sets take queries too). */
function lazyFilter(query:CatalogQuery,context:CatalogContext){
 let filter:ReturnType<typeof catalogFilter>|undefined;
 return ()=>filter??=catalogFilter(query,context);
}
/** Cache key of everything that narrows the listing except search, which goes uncached. */
function filterKey(query:CatalogQuery,context:CatalogContext){
 return JSON.stringify([query.category,query.make,query.model,query.manufacturer,query.brand,query.brands,query.attributes,query.availability,query.fits,query.oil,query.fits||query.oil?context.vehicleTypeId:null]);
}
/**
 * Whether listingSummary covers the listing (#1367): no search, no vehicle filter (fits, oil) and no narrowing filter
 * (brand, brands, attributes, availability), read from the raw fields as filterKey does. The plain, category, make, model
 * and manufacturer listings, and every listing's facet scope (catalogFacets).
 */
const summarized=(query:CatalogQuery)=>!(query.q?.trim()||query.brand||query.brands||query.attributes||query.availability||query.fits||query.oil);
/** LISTING_ONE_SCAN=0 loads the count, page ids and facets with their own statements again (the rollback); read per load. */
const oneScan=()=>process.env.LISTING_ONE_SCAN?.trim()!=="0";
type ListingSummary={count:number;ids:string[];facets:Facets};
/**
 * The summaries being loaded, and each for 5 s after it settles (sharedLoads): the caches that miss together share one
 * scan, a page's count, ids and facets started side by side (primeListing, catalog-view) and a gated listing's count
 * read before the other two (findListing). Keyed by the epoch value the caches load under too (their `at`: the listing's
 * counter, epochOf), so a reload after a bump never takes a summary read before it. A failed summary fails each loader;
 * each cache then applies its own rule (#771).
 */
const sharedSummaries=sharedLoads<ListingSummary>(5_000,50);
/**
 * A covered listing's (summarized) count, page-1 ids in the default order and facets from one read of its rows
 * (listingSummarySql, #1367). Read as four statements, each scanned every row of the listing. Locally (load ~8,
 * npm run catalog:listing-timings) ORIJINAL (155k rows) took 1.9-2.0 s of database time summed and 1.3-1.5 s side by
 * side, one scan 0.5-0.6 s; the root category (156k) 6.4-8.3 s summed and 3.4-4.5 s side by side, one scan 1.6-2.1 s;
 * /katalog (803k) 3.1-3.4 s and 2.0-2.1 s against 1.4-1.5 s and 1.1-1.3 s. With 4 MB work_mem the scan writes up to a
 * third more temp blocks than the four (/katalog 57 against 45 MB); with production's 16 MB only /katalog spills (32
 * against 20 MB). 32 MB gained nothing over 16 MB, so the summary keeps the session's work_mem.
 */
function listingSummary(key:string,filter:()=>ReturnType<typeof catalogFilter>,at:number){
 return sharedSummaries(`${at}|${key}`,async()=>{
  const listing=await filter(),values=[...listing.values,facetSpecificationKeys];
  const row=(await listingQuery<{count:string;ids:string[];brands:string[];attributes:FacetRow[]}>(listing,`catalog.listingSummary ${key}`,
   listingSummarySql(listing.from,`$${values.length}::text[]`),values)).rows[0];
  return {count:Number(row.count),ids:row.ids,facets:{brands:row.brands,attributes:row.attributes.map(facetOf)}};
 });
}
/**
 * The count a count cache loads under `key` and epoch value `at` (the cache's): the summary's when it covers the listing,
 * else its own statement. A search's count, read without the cache, is never a summary (`at` 0).
 */
async function loadCount(query:CatalogQuery,filter:()=>ReturnType<typeof catalogFilter>,key:string,at:number){
 return summarized(query)&&oneScan()?(await listingSummary(key,filter,at)).count:countListing(await filter(),key);
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
 const row=(await catalogRead<{ids:string[]|null;brands:string[]|null}>(`catalog.searchSummary ids=${search.ids.length}`,`WITH hits AS MATERIALIZED (
   SELECT i.id,${displayBrandSql('i','ov')} AS brand,i.updated_at,i.unavailable,
    -- The stored ranking inputs are the supplier's; a row with an admin-edited name, description, store brand or part
    -- number ranks the edit (#575, #602), the part number as the better of it and the supplier code. A price-only edit
    -- (#580) keeps the stored inputs. A hidden supplier OEM field (#615) ranks without the OEM. Same rule as catalogRank
    -- (src/modules/search/sql.ts).
    -- A price-only card (#1081) ranks its card's stored fields (pq: its Turkish name), as storefront_catalog names it.
    COALESCE(CASE WHEN ov.name IS NULL AND ov.description IS NULL AND ov.brand IS NULL AND ov.part_number IS NULL AND ov.hide_oem IS NOT TRUE
      THEN CASE WHEN pq.supplier_item_id IS NOT NULL THEN ${storedRank('pq',search.parsed,bind,queries,'pq.name')} ELSE ${storedRank('i',search.parsed,bind,queries)} END END,
     GREATEST(catalog_search_rank(COALESCE(ov.name,pq.name,NULLIF(i.product_data->>'ac',''),i.code),${displayBrandSql('i','ov')},
      i.code,CASE WHEN ov.hide_oem THEN '' ELSE COALESCE(i.product_data->>'oe','') END,COALESCE(ov.description,i.product_data->>'ac2',''),${queries}),
      CASE WHEN ov.part_number IS NOT NULL AND ov.part_number<>i.code THEN catalog_search_rank(COALESCE(ov.name,pq.name,NULLIF(i.product_data->>'ac',''),i.code),
       ${displayBrandSql('i','ov')},ov.part_number,CASE WHEN ov.hide_oem THEN '' ELSE COALESCE(i.product_data->>'oe','') END,
       COALESCE(ov.description,i.product_data->>'ac2',''),${queries}) END)) AS rank
   FROM (SELECT s.*,s.changed_at AS updated_at,false AS unavailable FROM commerce_supplier_items s WHERE s.id=ANY($2::uuid[]) AND s.company=ANY($1::text[])
    UNION ALL
    SELECT u.*,u.last_seen_at,true FROM commerce_unavailable_items u WHERE ${includeUnavailable} AND u.id=ANY($2::uuid[]) AND u.company=ANY($1::text[])) i
   LEFT JOIN commerce_item_overrides ov ON ov.supplier_item_id=i.id
   LEFT JOIN storefront_price_only_items pq ON i.unavailable AND pq.supplier_item_id=i.id
   -- The brand facet lists the shown brands (display_brand: master brand names, #811), as the generic path does.
   ${masterBrandJoinSql('i')}
   UNION ALL
   SELECT p.id,p.brand,p.updated_at,false,catalog_search_rank(p.name,p.brand,p.code,'',p.description,${queries}) FROM store_products p WHERE p.id=ANY($2::uuid[]))
  SELECT (SELECT array_agg(id::text ORDER BY unavailable,rank DESC,updated_at DESC,id) FROM hits) AS ids,
   (SELECT array_agg(DISTINCT brand ORDER BY brand) FROM hits) AS brands`,values)).rows[0];
 return {ids:row?.ids??[],brands:row?.brands??[]};
}
// A search with no other filter is the common case. Broad ones ("fren": ~70k matches) spend ~0.5 s just
// reading the matched rows, and their answer changes only with supplier syncs — like the listings above,
// it is served stale-while-revalidate for 10 minutes (admin edits reload it at once through the listing epoch, #585; a
// search that may name a vehicle also with the fit sync, searchEpoch, #1368). A search waits at most LISTING_EPOCH_WAIT_MS
// for that reload, then shows the earlier result unless it was empty (#1394). Cards (prices, stock) are still read live for the listed
// ids. The first pages are kept (deeper pages are recomputed); facets need every match, so they are kept too.
// 24 cards (#739, was 30) keep a listing page closer to the 350 KB HTML target (#642); 20 cached pages cover 480 results.
const catalogPageSize=24;
const cachedPages=20,cachedPlainSearches=staleCache<PlainSearch>(aggregateTtl,300,{...listings,...boundedWait,fallbackWhen:plain=>plain.total>0});
type PlainSearch={ids:string[];total:number;brands:string[];attributes:CatalogFacet[];correctedQuery?:string;vehicle?:VehicleSearchScope;tooShort?:boolean};
const plainSearch=(raw:string,mode:SearchMode)=>cachedPlainSearches(`${mode}|${normalizeSearchText(raw.slice(0,120))}|${raw.trim().toLocaleLowerCase("tr")}`,async()=>{
 const search=await catalogSearch(raw,mode),summary=await summarizeSearch(search);
 const attributes=await attributeFacets([summary.ids],"SELECT unnest($1::uuid[]) AS id");
 return {ids:summary.ids.slice(0,cachedPages*catalogPageSize),total:summary.ids.length,brands:summary.brands,attributes,
  correctedQuery:search.correctedQuery,vehicle:search.vehicle,tooShort:search.tooShort};
},{epoch:searchEpoch(raw,mode)});
/** How deep API searches read the ranking (#1093): exact-number filters and fit-first ordering work on these ids. */
export const rankedSearchDepth=200;
const cachedRankedSearches=staleCache<string[]>(aggregateTtl,300,{...listings,...boundedWait,fallbackWhen:ids=>ids.length>0});
// The hit set the two API rankings below share (#1119): loaded once when both miss together (a partner request with a
// vehicle), not searched twice. Few and short-lived entries: a broad search holds up to maxSearchHits ids. Keyed by the
// search's counter too (searchEpoch), so a ranking reloaded after a bump never starts from a hit set found before it.
const sharedApiSearches=ttlCache<CatalogSearch>(30_000,4);
const apiSearchKey=(raw:string,mode:SearchMode)=>`${mode}|${normalizeSearchText(raw.slice(0,120))}|${raw.trim().toLocaleLowerCase("tr")}`;
// The type-ahead's hit set (#1394): the ids it ranks (at most maxRankedSuggestions) and whether there were more, kept like
// the API rankings so a keystroke repeated within 10 minutes sends no hit read; names and products below stay live.
// Its reads run under the type-ahead's limit (suggestStatementTimeoutMs, 5 s, #1398), not the listing's 55 s; a load that
// hits it fails and is not kept, but a key that timed out is held for SEARCH_FAILURE_HOLD_MS (#1416): it rejects with the
// same error at once instead of reading again on every keystroke, and staleCache still serves an earlier value where there is
// one. No abort signal: the load is shared by every request for the key, and one visitor
// typing on must not cancel it for the others.
type SuggestSearch=Pick<CatalogSearch,"parsed"|"correctedQuery"|"vehicle">&{ids:string[];many:boolean};
const cachedSuggestSearches=staleCache<SuggestSearch>(aggregateTtl,500,{...listings,...boundedWait,fallbackWhen:search=>search.ids.length>0,weigh:search=>search.ids.length,maxWeight:100_000});
const suggestHold=failureHold(searchFailureHoldMs,500);
const suggestSearch=(raw:string,mode:SearchMode)=>{
 const key=apiSearchKey(raw,mode);
 return cachedSuggestSearches(key,async()=>{
  const held=suggestHold.failure(key);
  if(held)throw held.error;
  try{
   const {parsed,correctedQuery,vehicle,ids}=await searchCatalog(raw,mode,{timeoutMs:suggestStatementTimeoutMs()});
   return {parsed,correctedQuery,vehicle,ids:ids.slice(0,maxRankedSuggestions),many:ids.length>maxRankedSuggestions};
  }catch(error){
   if(isStatementTimeout(error)||isPoolTimeout(error))suggestHold.hold(key,error);
   throw error;
  }
 },{epoch:searchEpoch(raw,mode)});
};
const apiSearch=async(raw:string,mode:SearchMode)=>sharedApiSearches(`${await searchEpoch(raw,mode)()}|${apiSearchKey(raw,mode)}`,()=>catalogSearch(raw,mode));
/**
 * The first rankedSearchDepth saleable matches of a search (no unavailable cards), in the storefront's relevance order
 * (#1093). For the BakımX partner API, which filters and reorders them per request: cached like plainSearch, so repeated
 * keystrokes skip the search and its ranking (~0.2-0.5 s), while prices and stock are read live for the ids.
 */
export const rankedSearchIds=(raw:string,mode:SearchMode)=>cachedRankedSearches(apiSearchKey(raw,mode),
 async()=>(await summarizeSearch(await apiSearch(raw,mode),false)).ids.slice(0,rankedSearchDepth),{epoch:searchEpoch(raw,mode)});
/**
 * The listed products a vehicle type's linked supplier rows belong to (#1119): typeFittedIds names supplier rows, and a
 * search hit is the product's listing row (a secondary offer counts as the primary it is grouped under). Cached per type
 * in its own LRU (reloaded with the fits value), apart from the storefront's fit sets.
 */
const cachedFittedListings=staleCache<string[]>(10*60*1000,300,{...fitListings,weigh:ids=>ids.length,maxWeight:300_000});
const typeFittedListingIds=(typeId:number)=>cachedFittedListings(String(typeId),async()=>{
 const fitted=await typeFittedIds(typeId);
 if(!fitted.length)return [];
 return (await catalogRead<{id:string}>(`catalog.typeFittedListings type=${typeId}`,`SELECT DISTINCT COALESCE(o.primary_id,f.id)::text AS id FROM unnest($1::uuid[]) f(id)
  LEFT JOIN product_offers o ON o.item_id=f.id`,[fitted])).rows.map(row=>row.id);
});
const cachedRankedFits=staleCache<string[]>(aggregateTtl,300,{...fitListings,...boundedWait,fallbackWhen:ids=>ids.length>0});
/**
 * The first rankedSearchDepth saleable matches of a search that are linked to the vehicle type, in relevance order
 * (#1119): the whole hit set intersected with the type's fits, as the storefront's "Aracına uyanlar" lead does
 * (catalogFilter with fits=vehicle), so a fitting part ranked far below rankedSearchIds' depth is still found. Only the
 * intersection is ranked (usually tens of ids). Cached per search and vehicle type like rankedSearchIds.
 */
export const rankedFittingSearchIds=(raw:string,mode:SearchMode,typeId:number)=>cachedRankedFits(`${typeId}|${apiSearchKey(raw,mode)}`,async()=>{
  const [search,listed]=await Promise.all([apiSearch(raw,mode),typeFittedListingIds(typeId)]);
  const linked=new Set(listed),ids=search.ids.filter(id=>linked.has(id));
  return ids.length?(await summarizeSearch({...search,ids},false)).ids.slice(0,rankedSearchDepth):[];
 });
/** No filter but the search (mirrors the clauses catalogFilter adds). */
export function isPlainSearch(query:CatalogQuery){
 return Boolean(query.q?.trim())&&!query.category&&!query.make&&!query.model&&!query.manufacturer&&query.fits!=="vehicle"&&!query.oil&&!query.availability
  &&!selectedBrands(query).length&&!Object.values(selectedAttributes(query)).some(options=>options.length);
}
/**
 * The best matches of a search, priced, without the listing's counts and facets (#431). The partner API's first page
 * before #1093 (now rankedSearchIds), kept for the search tests: the facets of a broad search read every match and took 11-20 s
 * cold, while the ids and their ranking take ~0.2 s. Same ids, order and prices as the first page of a plain search.
 */
export async function searchCatalogItems(raw:string,mode:SearchMode,limit=catalogPageSize){
 const {ids}=await summarizeSearch(await catalogSearch(raw,mode),false);
 return withBestOffers(await catalogRowsByIds(ids.slice(0,limit)));
}
// A price order over a listing narrowed by two id sets (a category's ids and a property's or a make's) planned the priced
// view as per-row nested loops (#1335): the sets' selectivities multiply to a 1-row estimate on the supplier_items primary
// key scan, so the view looked up each row's currency on supplier_imports again (5,314 loops for yedek-parca + Front
// Axle: 3.8 s; six Fitting Position values 12.5 s; yedek-parca + VW 16.8 s). Up to pricedByIdsMax rows the listing's ids
// are read first and priced by bind array (pricedScope): the planner sees their real count and hash-joins (a cold page,
// count included: Front Axle 3.3 s → 0.7 s, VW 16.5 s → 1.3 s). Above it the extra id read costs more than it saves (the
// root category's 149k rows: 1.97 s → 2.5 s; the gain is smallest near 57k), so those keep the one statement, and so do
// listings with fewer than two id sets, whose plan was right (priced read of 480 rows: manufacturer page 0.34 s → 0.44 s,
// model page 0.19 s → 0.29 s, category + brand 0.48 s → 0.93 s by ids).
// A price-sorted search is counted live on every page, so over two or more id sets its id read replaces that count
// (listedIds, #1345) and costs nothing extra (page 1: "fren" in yedek-parca 0.85 s → 0.59 s, with VW 2.45 s → 0.22 s,
// with Front Axle 1.31 s → 0.31 s). A search alone keeps its count and clause: its bound hit ids already give the planner
// their size ("fren", 50k ids: 0.80 s → 0.81 s by ids). Its ids are capped at maxSearchHits, so a search never exceeds
// the limit below.
const pricedByIdsMax=50_000;
type PricedScope={where:string;values:unknown[];workMem?:string};
type ListingFilter=PricedScope&{from:string;idSets:number};
/**
 * The listing's product count and where a price order reads its rows (#1335, #1345), from one read of the entries the
 * count reads: the listing's ids as `$2` (`$1` staying the companies array storefrontCatalogSql reads); `filter`'s own
 * clause above pricedByIdsMax rows (the array is built but not sent); null without rows, there is nothing to price.
 * The ids travel as one array literal, never as rows: 50k row objects and their bound array added ~8 MB heap and ~34 MB
 * RSS per call, paid by every live page beyond the cached ones (#1262 ran out of memory). `workMem` stays with the
 * filter's clause (listingQuery); the id array needs none.
 */
async function listedIds({values,where,from,workMem}:ListingFilter,label:string):Promise<{total:number;scope:PricedScope|null}>{
 const row=(await boundedQuery<{count:string;ids:string|null}>(`catalog.pricedListedIds ${label}`,
  `SELECT count(*) AS count,CASE WHEN count(*)<=${pricedByIdsMax} THEN array_agg(catalog.id)::text END AS ids ${from}`,values,30_000,{workMem})).rows[0];
 const total=Number(row.count);
 return {total,scope:row.ids?{where:"WHERE catalog.id=ANY($2::uuid[])",values:[values[0],row.ids]}:total?{where,values,workMem}:null};
}
/**
 * Where a price order reads its rows when its total did not come from listedIds (#1335): `filter`'s own clause above
 * pricedByIdsMax rows or below two id sets, else its ids (listedIds). `total` may be as old as the count cache; it only
 * picks the statement (listedIds checks its live count against the limit again), both read the same rows.
 */
async function pricedScope(total:number,filter:ListingFilter,label:string):Promise<PricedScope|null>{
 if(total>pricedByIdsMax||filter.idSets<2)return {where:filter.where,values:filter.values,workMem:filter.workMem};
 return (await listedIds(filter,label)).scope;
}
/**
 * The product count of a listing without a search, as browseProducts reports it (the same cache entry): the model
 * pages' metadata and their 404 and index rules read it before the page renders.
 */
export function listingTotal(query:CatalogQuery,context:CatalogContext={}){
 const scope={...query,q:undefined},key=filterKey(query,context);
 return countCache(query)(key,at=>loadCount(scope,lazyFilter(scope,context),key,at),readOptions(scope,persistable(scope)));
}
/** The default listing order: newest first, products nobody supplies now last (#475). */
const newestOrder="unavailable,updated_at DESC,id";
const pricedOrder=(query:CatalogQuery)=>query.sort==="price-asc"||query.sort==="price-desc";
/**
 * A listing's ORDER BY: by price, else newest first (a search ranked by relevance puts its rank before it). Products
 * nobody supplies now come after every saleable one, in every order (#475).
 */
const listingOrder=(query:CatalogQuery)=>query.sort==="price-asc"?"unavailable,price_kurus ASC NULLS LAST,id":query.sort==="price-desc"?"unavailable,price_kurus DESC NULLS LAST,id":newestOrder;
/** The rows a price order sorts, from pricedScope's `where`: the columns its ORDER BY reads. */
const pricedRowsSql=(where:string)=>`SELECT catalog.id,catalog.unavailable,catalog.price_kurus FROM (${storefrontCatalogSql}) catalog ${where}`;
/** One live page of a price order (`offset` a parameter): the rows themselves, for a page no stored order serves. */
const pricedPageSql=(where:string,order:string,take:number,offset:string)=>`SELECT * FROM (${storefrontCatalogSql}) catalog ${where} ORDER BY ${order} LIMIT ${take} OFFSET ${offset}`;
/** Page 1 whatever the total: no page asked, or one below 2 (browseProducts clamps it the same way). */
const firstPageAsked=(query:CatalogQuery)=>{const requested=Number(query.page);return !Number.isSafeInteger(requested)||requested<=1;};
/** The cached ids of one page of a listing without a search in the default order (newest first); page 1 of a covered listing from its summary. */
function listingPageIds(query:CatalogQuery,context:CatalogContext,filter:()=>ReturnType<typeof catalogFilter>,page:number){
 const key=`${filterKey(query,context)}|${page}`;
 return pageIdCache(query)(key,async at=>{
  if(page===1&&summarized(query)&&oneScan())return (await listingSummary(filterKey(query,context),filter,at)).ids;
  const listing=await filter(),{values,from}=listing;
  return (await listingQuery<{id:string}>(listing,`catalog.listingPageIds ${key}`,pageIdsSql(from,`$${values.length+1}`),[...values,(page-1)*catalogPageSize])).rows.map(row=>row.id);},
  readOptions(query,persistablePage(query,page)));
}
/**
 * Starts a listing's facets, count and (page 1 in the default order) page ids without waiting for them (#771), so a page
 * that reads its total before it renders (the manufacturer page) does not run them one after another. They fill the
 * entries browseProducts and catalogFacets read; a failure is left to those reads. Not for a search, nor for a vehicle
 * filter without the vehicle (its keys carry the vehicle type). On a listing listingSummary covers, the three misses
 * share one scan (#1367); a filtered listing's facets read its unfiltered scope's summary.
 */
export function primeListing(query:CatalogQuery,context:CatalogContext={}){
 if(query.q?.trim()||(vehicleScoped(query)&&!context.vehicleTypeId))return;
 const filter=lazyFilter(query,context),key=filterKey(query,context);
 const started:Promise<unknown>[]=[catalogFacets(query,context),countCache(query)(key,at=>loadCount(query,filter,key,at),readOptions(query,persistable(query)))];
 if(!pricedOrder(query)&&firstPageAsked(query))started.push(listingPageIds(query,context,filter,1));
 for(const promise of started)promise.catch(()=>{});
}
/** `limit`: read only the first `limit` cards of the page (vehicleLead); counts, pages and cached page ids stay the page's. */
export async function browseProducts(query:CatalogQuery,context:CatalogContext={},{limit=catalogPageSize}:{limit?:number}={}){
 if(isPlainSearch(query)&&(query.sort??"relevance")==="relevance"){
  const mode=query.searchBy==="code"?"code":"all",plain=await plainSearch(query.q!,mode);
  const pageSize=catalogPageSize,total=plain.total,pages=Math.max(1,Math.ceil(total/pageSize));
  const requested=Number(query.page);
  const page=Number.isSafeInteger(requested)?Math.min(pages,Math.max(1,requested)):1;
  const ranked=page<=cachedPages?plain.ids:(await summarizeSearch(await catalogSearch(query.q!,mode))).ids;
  const ids=ranked.slice((page-1)*pageSize,page*pageSize);
  const items=await storefrontRowsByIds(ids);
  return {items:await withBestOffers(items),total,page,pages,pageSize,correctedQuery:plain.correctedQuery,vehicleScope:plain.vehicle,searchTooShort:plain.tooShort};
 }
 // Without a search the filter is built only when a cache misses; a search always needs it (its matches).
 const filter=lazyFilter(query,context),search=query.q?.trim()?(await filter()).search:undefined;
 const pricedSort = pricedOrder(query), pricedKey=`${filterKey(query,context)}|${query.sort}`;
 // Page 1 of the default order does not depend on the total: its ids load beside the count (#771).
 const firstIds=!search&&!pricedSort&&firstPageAsked(query)?listingPageIds(query,context,filter,1):undefined;
 firstIds?.catch(()=>{});
 // A price-sorted search over two or more id sets prices its page by the ids it counts (listedIds, #1345).
 const pricedSearch=search&&pricedSort&&(await filter()).idSets>=2?await listedIds(await filter(),pricedKey):undefined;
 const count=(at:number)=>loadCount(query,filter,filterKey(query,context),at);
 const total = pricedSearch ? pricedSearch.total : search ? await count(0) : await countCache(query)(filterKey(query,context),count,readOptions(query,persistable(query)));
 const pageSize = catalogPageSize, pages = Math.max(1,Math.ceil(total/pageSize)), take = Math.min(pageSize,Math.max(1,Number.isFinite(limit)?Math.trunc(limit):pageSize));
 const requested = Number(query.page);
 const page = Number.isSafeInteger(requested) ? Math.min(pages,Math.max(1,requested)) : 1;
 const order=listingOrder(query);
 if(!search&&!pricedSort){
  const ids=await (page===1&&firstIds?firstIds:listingPageIds(query,context,filter,page));
  const items=await storefrontRowsByIds(ids.slice(0,take));
  return {items:await withBestOffers(items),total,page,pages,pageSize};
 }
 // A price order prices every listed row before it sorts (VW make page: ~50k rows, ~3 s per page). Its first
 // cachedPages pages are ordered once and kept like the page ids above; the cards are still read live, so a card shows
 // the current price and stock, while its position follows the prices of up to 10 minutes ago (supplier syncs, and admin
 // price edits, which do not move the listing epoch). Deeper pages read the listing's whole stored order below. The priced
 // rows are sorted before the limit (VW: ~57 MB): it spilled to disk (external merge) at both the local default (4 MB) and
 // the production RDS setting (16 MB); 64 MB for this read keeps it in memory. A listing of two id sets up to
 // pricedByIdsMax rows is priced by its id array (pricedScope), off a per-row plan (#1335).
 // A stored listing's first pages (persistable, #1389) never build its whole order while no deep page reads it, so a cold
 // page 1 does not wait for one. Their 480 ids come from the stored order's first ids instead of a pricing pass when a
 // memory miss, refresh or epoch reload finds that row newer than their stored page ids and current under the cache's
 // rules (cachedPricedHeads; a memory miss takes one up to 24 hours old and refreshes it): a listing a deep page ordered is
 // not priced again, and pages 20 and 21 then read one order. A new process's first page of such a listing without stored
 // page ids (local production build): ORIJINAL 1.74-1.84 s -> 0.14-0.15 s, /katalog 6.9-7.3 s -> 0.13-0.14 s.
 // A load that takes no such row while a deep page sliced the order within the last 20 minutes (priceOrderInUse, #1405)
 // rebuilds the whole order and takes its first ids from that statement, as the deep pages' loader below does (the same
 // epoch value, a filter built after it: `filter()` may be older, and the same head size, so one build serves both): the
 // two caches expire together, and a listing hot on both sides is then priced once per refresh instead of twice, with
 // pages 20 and 21 read from one order once the refresh has settled. A build that stores nothing (failed, backing off,
 // nothing listed) falls back to the 480-id pass. Without such recent deep use (a first page read before any deep one, or
 // deep traffic that stopped) a load prices its own 480 ids, which stay until their next refresh, so until then pages 20
 // and 21 can come from two orders up to 10 minutes apart. Slicing the stored order on every first page instead reads the
 // whole array per request: /katalog's warm page 1 was 2-4 ms slower.
 if(!search&&pricedSort&&page<=cachedPages){
  const eligible=persistable(query);
  const ordered=await (eligible?cachedPricedHeads:pageIdCache(query))(pricedKey,async at=>{
   if(eligible&&total<=priceOrderMaxIds()&&await priceOrderInUse(pricedKey)){
    const fresh=await pricedScope(total,await catalogFilter(query,context),pricedKey);
    if(!fresh)return [];
    const built=await buildPriceOrder(pricedKey,at,pricedRowsSql(fresh.where),fresh.values,order,{head:cachedPages*pageSize,freshMs:aggregateTtl});
    if(built.total>0)return built.head;
   }
   const scope=await pricedScope(total,await filter(),pricedKey);
   if(!scope)return [];
   return (await boundedQuery<{id:string}>(`catalog.pricedPageIds ${pricedKey}`,
   `SELECT id::text FROM (SELECT id,unavailable,price_kurus FROM (${storefrontCatalogSql}) catalog ${scope.where} ORDER BY ${order} LIMIT ${cachedPages*pageSize}) page`,scope.values,30_000,{workMem:"64MB"})).rows.map(row=>row.id);},
   readOptions(query,eligible));
  const items=await storefrontRowsByIds(ordered.slice((page-1)*pageSize,(page-1)*pageSize+take));
  return {items:await withBestOffers(items),total,page,pages,pageSize};
 }
 // A deeper page of a stored listing's price order (persistable, #1369) slices the listing's whole order, stored by one
 // statement that prices and sorts the rows the cached pages above read (pricedScope) and keeps the ids in the database
 // (listing-price-order.ts). Building the whole order costs about one live deep page (locally, npm run
 // catalog:listing-timings -- --price-order: ORIJINAL, 155k rows, ~1.65 s against ~1.8 s; /katalog, 804k rows, ~6.6 s
 // against ~6.5 s; no parallel plan on either side), so the first deep page of a listing waits for it once and the next
 // ones read a slice (under 1 ms in SQL; a page ~20-40 ms over HTTP against 1.8-2.1 s and 6.5-7.6 s). The process
 // keeps the stored order's size under the cached pages' rules (cachedPriceOrders); cards are read live by id as above.
 // The order is tagged with the epoch value the cache loads it under (`at`, the listing's counter: epochOf), and its filter
 // is built after that value was read: an edit after it leaves an order built from earlier id sets tagged older than the
 // counter, so it is rebuilt, never taken as current (#1369). The page's own filter may be older (built by a count miss
 // above), so the build builds its own. It asks for the first pages' head size, as their loader above does (#1405): a
 // build either one starts serves the other, and one that finds a row stored within the TTL since returns it instead.
 // A listing over priceOrderMaxIds, an order with nothing stored, a row gone (the UNLOGGED table empties after a crash)
 // or a page past its end read live below, and so does a failed build (its 30 s limit included): the listing then reads
 // live without another build for ten minutes (buildPriceOrder), instead of failing the page or building per request.
 if(!search&&pricedSort&&persistable(query)&&priceOrderEnabled()&&total<=priceOrderMaxIds()){
  const stored=await cachedPriceOrders(pricedKey,async at=>{
   const scope=await pricedScope(total,await catalogFilter(query,context),pricedKey);
   if(!scope)return {total:0};
   const built=await buildPriceOrder(pricedKey,at,pricedRowsSql(scope.where),scope.values,order,{head:cachedPages*pageSize,freshMs:aggregateTtl});
   return {total:built.total};},{epoch:epochOf(query)});
  const ids=stored.total>0?await priceOrderSlice(pricedKey,(page-1)*pageSize,take):null;
  if(ids?.length)return {items:await withBestOffers(await storefrontRowsByIds(ids)),total,page,pages,pageSize};
 }
 // A search lists the best matches first unless the shopper picked another order.
 const filtered=await filter(),{from}=filtered;
 // A deeper page of a price order no stored order serves reads the rows the cached order above reads (pricedScope), a
 // price-sorted search over two or more id sets the ids its total came from; none, no page read.
 const scope=pricedSearch?pricedSearch.scope:pricedSort?await pricedScope(total,filtered,pricedKey):filtered;
 const notes={correctedQuery:search?.correctedQuery,vehicleScope:search?.vehicle,searchTooShort:search?.tooShort};
 if(!scope)return {items:[],total,page,pages,pageSize,...notes};
 const pageValues=[...scope.values],bind=binder(pageValues);
 const rank=search&&(query.sort??"relevance")==="relevance"?catalogRank("catalog",search.parsed,bind):"0";
 const offset=bind((page-1)*pageSize),label=`catalog.listingPage ${filterKey(query,context)}|${query.sort??""}|${page}`;
 // The page's ids first, then its cards by id array (storefrontRowsByIds, #1135).
 const items = pricedSort
  ? (await listingQuery<CatalogProduct>(scope,label,pricedPageSql(scope.where,order,take,offset), pageValues)).rows
  : await storefrontRowsByIds((await listingQuery<{id:string}>(scope,label,`SELECT id::text FROM (SELECT id,updated_at,unavailable,${rank} AS rank ${from}
     ORDER BY unavailable,rank DESC,${order} LIMIT ${take} OFFSET ${offset}) page`, pageValues)).rows.map(row=>row.id));
 return {items:await withBestOffers(items),total,page,pages,pageSize,...notes};
}
/** A product, or (for broad searches) a product name shared by `products` items. */
export type ProductSuggestion={kind:"product";id:string;name:string;name_overridden:boolean;brand:string;code:string}|{kind:"name";name:string;products:number};
// Ranking every match per keystroke takes seconds on the VPS for broad prefixes ("fren": ~15k);
// above this, the type-ahead suggests product names from search_product_names instead.
const maxRankedSuggestions=500;
/**
 * Best matches for the header type-ahead: the catalog search's engine and readings, without prices. Broad searches return
 * up to 2x `limit` name rows (both spellings of one type): the caller (searchSuggestions) merges them by label and trims.
 * Every read runs under the type-ahead's limit (suggestStatementTimeoutMs, #1398); `signal` (the route's request) cancels
 * the live reads below, not the shared hit-set load (suggestSearch).
 */
export async function suggestProducts(raw:string,mode:SearchMode,limit=6,{signal}:{signal?:AbortSignal}={}){
 await ensureCustomSynonyms();
 const read:ReadOptions={timeoutMs:suggestStatementTimeoutMs(),signal};
 // Products named only in English ("BRAKE HOSE" for "fren hor") never reach the ranked list: their English names come
 // from the type-name dictionary and are suggested as names (#962). The recheck keeps the text-index plan (~1 ms).
 const expansion=mode==="all"&&!searchTooShort(raw)?typeNamePrefixQuery(parseSearchQuery(raw)):null;
 const [search,english]=await Promise.all([suggestSearch(raw,mode),expansion?catalogRead<{name:string;products:number}>("catalog.suggestNames",`SELECT name,products FROM search_product_names
  WHERE to_tsvector('simple',normalized) @@ to_tsquery('simple',$1) AND normalized=ANY($2::text[])
  ORDER BY products DESC,name LIMIT ${Number(limit)}`,[expansion.query,expansion.names],read).then(result=>result.rows):[]]);
 const notes={correctedQuery:search.correctedQuery,vehicleScope:search.vehicle};
 const englishNames=english.map(row=>({kind:"name" as const,...row}));
 if(!search.ids.length)return {products:englishNames as ProductSuggestion[],...notes};
 if(search.many&&!search.vehicle?.fitted){
  const query=prefixTsQuery(search.parsed);
  // The names most products share first: "filtre" means "Hava Filtresi" (5k) more than "Filtre Hortumu".
  const names=query?(await catalogRead<{name:string;products:number}>("catalog.suggestNames",`SELECT name,products FROM search_product_names
   WHERE to_tsvector('simple',normalized) @@ to_tsquery('simple',$1)
   ORDER BY products DESC,name LIMIT ${Number(limit)}`,[query],read)).rows:[];
  // The caller merges names by label, so both spellings of one type add up: it takes up to twice the rows.
  const merged=[...new Map([...names,...english].map(row=>[row.name,row])).values()].sort((a,b)=>b.products-a.products||a.name.localeCompare(b.name)).slice(0,limit*2);
  if(merged.length)return {products:merged.map(row=>({kind:"name" as const,...row})),...notes};
 }
 const values:unknown[]=[company(),search.ids],bind=binder(values);
 // One suggestion per name and brand: a supplier lists the same part in many sizes.
 const products=(await catalogRead<{id:string;name:string;name_overridden:boolean;brand:string;code:string}>("catalog.suggestProducts",`SELECT id,name,name_overridden,brand,code FROM (
  SELECT DISTINCT ON (name,display_brand) id::text,name,name_overridden,display_brand AS brand,display_code AS code,rank,updated_at,unavailable FROM (
   SELECT catalog.*,${catalogRank("catalog",search.parsed,bind)} AS rank FROM (${catalogEntriesSql}) catalog WHERE catalog.id=ANY($2::uuid[])) ranked
  ORDER BY name,display_brand,unavailable,rank DESC,updated_at DESC,id) best ORDER BY unavailable,rank DESC,updated_at DESC,id LIMIT ${Number(limit)}`,values,read)).rows;
 return {products:[...englishNames.slice(0,2),...products.map(row=>({kind:"product" as const,...row}))].slice(0,limit) as ProductSuggestion[],...notes};
}
export async function catalogBrands() {
 return cachedBrands("all",async()=>(await catalogRead<{brand:string}>("catalog.brands",`SELECT DISTINCT display_brand AS brand FROM (${catalogEntriesSql}) catalog ORDER BY brand`,[company()])).rows.map(p=>p.brand));
}

/**
 * Products of the listing, every filter kept, that are linked to the vehicle type: the total of its `fits=vehicle`
 * listing, read the way browseProducts counts it (the same cache entry), so the count matches the page it links to (#884).
 */
export async function vehicleFitCount(query:CatalogQuery,vehicleTypeId:string) {
 const scope:CatalogQuery={...query,fits:'vehicle',page:undefined},context={vehicleTypeId};
 const filter=lazyFilter(scope,context),search=scope.q?.trim()?(await filter()).search:undefined;
 const count=async()=>countListing(await filter(),filterKey(scope,context));
 return search ? count() : countCache(scope)(filterKey(scope,context),count,readOptions(scope,persistable(scope)));
}
/**
 * The first `limit` products of the listing linked to the garage vehicle's type, and how many there are (#884): the
 * listing's `fits=vehicle` page 1 (every filter and the order kept), shown above the full results. The vehicle does not
 * filter the catalog (DESIGN.md); its fits are put first. Its count and page ids share the `fits=vehicle` listing's cache.
 * Four cards: a card is ~7.5 KB of HTML, and the 24-card page sits near the 350 KB target (#642, #739).
 */
export async function vehicleLead(query:CatalogQuery,vehicleTypeId:string,limit=4) {
 const {items,total}=await browseProducts({...query,fits:'vehicle',page:undefined},{vehicleTypeId},{limit});
 return {items,total};
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
 const filter=lazyFilter(scope,context),search=scope.q?.trim()?(await filter()).search:undefined,key=filterKey(scope,context);
 const load=async(at:number)=>{
  if(summarized(scope)&&oneScan())return (await listingSummary(key,filter,at)).facets;
  const {values,from}=await filter();return facetsFor(values,from);
 };
 return search ? load(0) : cachedFacets(key,load,readOptions(scope,persistable(scope)));
}
async function facetsFor(values:unknown[],from:string){
 // Independent reads: the brand list and the property facet run side by side (#994).
 const [brands,attributes]=await Promise.all([
  catalogRead<{brand:string}>("catalog.facetBrands",brandsSql(from),values).then(result=>result.rows.map(r=>r.brand)),
  attributeFacets(values,`SELECT catalog.id ${from}`),
 ]);
 return {brands,attributes};
}
/** The property facet query. `scopedSql` selects the listing's ids (one `id` column), `keys` is the facet keys parameter. */
export function attributeFacetsSql(scopedSql:string,keys:string){
 // The facet rows are precomputed per offer in storefront_facet_specs (db/enrichment-shared-links.sql, #994) with the
 // guards the readers apply (the offer's own code and brand, no cross-reference match, "Brand class" only from an
 // exact part). Unpacking every listed payload here took ~2.3 s of the unfiltered /katalog facet's 3.4 s (warm; 6.6 s
 // cold); reading the ~83k rows instead brings it under a second. The table holds the facet keys only, so `fs` is one
 // small scan whatever the listing; the two size-dependent branches of #955 went with the payloads. The attribute filter
 // (catalogFilter) reads the same rows and admin values (#1248), and also checks the offer's identity when it reads them.
 // MATERIALIZED: inlined, the search filter gets planned across the joins (~60 s instead of ms).
 return `WITH scoped AS MATERIALIZED (${scopedSql}),
 ${facetSpecsSql(keys)}
 ${facetSelectSql("")}`;
}
/**
 * The CTEs after `scoped` (its `id` column) that attributeFacetsSql and listingSummarySql share: `specs`, the listed rows'
 * facet values. `ov`: the admin's specifications of the facet keys (#603); a set or hidden key replaces the row's
 * automatic values.
 */
const facetSpecsSql=(keys:string)=>`ov AS MATERIALIZED (SELECT ps.supplier_item_id AS id,o.key,o.action,o.value FROM product_override_specs o JOIN product_sources ps ON ps.product_id=o.product_id WHERE o.key=ANY(${keys})),
 fs AS MATERIALIZED (SELECT supplier_item_id,key,value FROM storefront_facet_specs WHERE key=ANY(${keys})),
 specs AS (
  SELECT f.key,f.value FROM scoped JOIN fs f ON f.supplier_item_id=scoped.id
  WHERE NOT EXISTS (SELECT 1 FROM ov WHERE ov.id=scoped.id AND ov.key=f.key)
  UNION ALL
  SELECT ov.key,ov.value FROM ov JOIN scoped ON scoped.id=ov.id WHERE ov.action='set' AND length(ov.value)<=200)`;
const facetOrder="CASE WHEN key='Fitting Position' THEN 0 WHEN key='Brand class' THEN 1 ELSE 2 END,key";
/** The facet keys shown, with their values, from `specs`; `columns` adds output columns after `values`. */
const facetSelectSql=(columns:string)=>`SELECT key,array_agg(DISTINCT value ORDER BY value) AS values${columns} FROM specs
 GROUP BY key HAVING count(DISTINCT value)<=40 ORDER BY ${facetOrder} LIMIT 8`;
/**
 * A covered listing's count, page-1 ids in the default order, shown brands and property facet in one statement (#1367):
 * the values countSql, pageIdsSql (offset 0), brandsSql and attributeFacetsSql read, from one read of the listing's rows
 * (`from`: catalogFilter's; `keys`: the facet keys parameter). `scoped` keeps the four columns those reads use; each
 * value then reads it instead of the catalog. The ids are cast after the order: a bare `id` in ORDER BY names the output
 * column, and `id::text` would break ties as text. The facet keys keep their order (`position`) through the JSON aggregate.
 */
export function listingSummarySql(from:string,keys:string){
 return `WITH scoped AS MATERIALIZED (SELECT catalog.id,catalog.updated_at,catalog.unavailable,catalog.display_brand ${from}),
 ${facetSpecsSql(keys)},
 facet AS (${facetSelectSql(`,row_number() OVER (ORDER BY ${facetOrder}) AS position`)})
 SELECT (SELECT count(*) FROM scoped)::text AS count,
  ARRAY(SELECT id FROM scoped ORDER BY ${newestOrder} LIMIT ${catalogPageSize})::text[] AS ids,
  ARRAY(SELECT DISTINCT display_brand FROM scoped ORDER BY 1) AS brands,
  (SELECT COALESCE(json_agg(json_build_object('key',facet.key,'values',facet.values) ORDER BY facet.position),'[]') FROM facet) AS attributes`;
}
type FacetRow={key:string;values:string[]};
const facetOf=(row:FacetRow):CatalogFacet=>({key:row.key,label:specificationLabel(row.key),options:facetOptions(row.values)});
/** `scopedSql` selects the listing's ids (one `id` column) using `values`. */
async function attributeFacets(values:unknown[],scopedSql:string):Promise<CatalogFacet[]>{
 return (await catalogRead<FacetRow>("catalog.facetAttributes",attributeFacetsSql(scopedSql,`$${values.length+1}::text[]`),[...values,facetSpecificationKeys])).rows.map(facetOf);
}
type Statement={text:string;values:unknown[]};
/**
 * A covered listing's (no search, vehicle or narrowing filter) four reads and the summary that replaces them, as
 * statements, for the read-only comparison scripts/listing-summary-timings.ts (#1367). The same texts the loaders run.
 */
export async function listingStatements(query:CatalogQuery):Promise<Record<"count"|"pageIds"|"brands"|"attributes"|"summary",Statement>>{
 if(!summarized(query))throw new Error("listingStatements: a listing without a search, vehicle or narrowing filter only");
 const {values,from}=await catalogFilter(query),withKeys=[...values,facetSpecificationKeys],keys=`$${withKeys.length}::text[]`;
 return {count:{text:countSql(from),values},pageIds:{text:pageIdsSql(from,`$${values.length+1}`),values:[...values,0]},brands:{text:brandsSql(from),values},
  attributes:{text:attributeFacetsSql(`SELECT catalog.id ${from}`,keys),values:withKeys},summary:{text:listingSummarySql(from,keys),values:withKeys}};
}
/**
 * A stored listing's (persistable) price-sorted page `page` read live, and the whole order a deep page slices instead
 * (#1369), as statements for the read-only comparison scripts/listing-summary-timings.ts: the live page browseProducts
 * runs, and the build's select without its INSERT. The rows are scoped as pricedScope does with the listing's live count.
 */
export async function priceOrderStatements(query:CatalogQuery,page:number):Promise<Record<"livePage"|"order",Statement>>{
 if(!persistable(query)||!pricedOrder(query))throw new Error("priceOrderStatements: a price-sorted listing without a search, model or narrowing filter only");
 const filter=await catalogFilter(query),label=`${filterKey(query,{})}|${query.sort}`;
 const scope=filter.idSets>=2?(await listedIds(filter,label)).scope:{where:filter.where,values:filter.values};
 if(!scope)throw new Error(`priceOrderStatements: ${label} lists no rows`);
 const order=listingOrder(query),values=[...scope.values,(page-1)*catalogPageSize];
 return {livePage:{text:pricedPageSql(scope.where,order,catalogPageSize,`$${values.length}`),values},order:{text:priceOrderSelectSql(pricedRowsSql(scope.where),order),values:scope.values}};
}
