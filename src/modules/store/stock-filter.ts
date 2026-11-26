import "server-only";
import type { CatalogQuery } from "./catalog-query";

// The listing's stock filter (catalogFilter in catalog.ts): "Stokta" (in_stock), "Stokta yok" (out_of_stock) and
// "Tedarik edilebilir" (supplied). `$1` is the companies array, as in catalog.ts's views.

// Only id, available and stock_label of the same rows, without the pricing joins (db/commerce.sql, #1242): the listing's
// availability filter.
export const availabilitySql = "SELECT * FROM commerce_item_availability WHERE source='store' OR company=ANY($1::text[])";
/** The cards that can be sold now: a row, or the primary of a group one of whose offers is available. */
export const inStockIdsSql=`SELECT COALESCE(o.primary_id,a.id) FROM (${availabilitySql}) a LEFT JOIN product_offers o ON o.item_id=a.id WHERE a.available`;

/**
 * The cards of `ids` (a uuid[] parameter, "$3::uuid[]") that inStockIdsSql holds, read for those ids only (#1429): a row
 * of `ids` that can be sold now (its group's primary when it is an offer), and a primary of `ids` one of whose offers can.
 * The offers come from the primaries' own index rows (product_offers_primary_idx) as one array, so the availability view
 * is read by primary key for them. It may also hold ids outside `ids` (the primary of an offer in `ids`); the listing's
 * own clause on `ids` drops those.
 */
export const scopedInStockIdsSql=(ids:string)=>`${inStockIdsSql} AND a.id=ANY(${ids})
 UNION ALL SELECT o.primary_id FROM product_offers o JOIN (${availabilitySql}) a ON a.id=o.item_id
 WHERE a.available AND o.primary_id=ANY(${ids}) AND a.id=ANY(ARRAY(SELECT o3.item_id FROM product_offers o3 WHERE o3.primary_id=ANY(${ids})))`;
/**
 * The cards of `ids` the unscoped out-of-stock clause lists, read for those ids only (#1429): rows of `ids` that
 * commerce_out_of_stock_ids returns (the same view, companies and predicate: not available, labelled "Stokta yok"),
 * without the cards in stock (scopedInStockIdsSql: the card itself or a grouped offer can be sold, #1342).
 */
export const scopedOutOfStockIdsSql=(ids:string)=>`SELECT a.id FROM (${availabilitySql}) a WHERE a.id=ANY(${ids}) AND NOT a.available AND a.stock_label='Stokta yok'
 EXCEPT (${scopedInStockIdsSql(ids)})`;

export const defaultStockScopeMaxIds=30_000;
// catalog.ts's pricedByIdsMax: a listing under the scoped clause never has more rows than its bound array, so a price
// order over it is always priced by its ids (pricedScope / listedIds), never by a statement reading the clause.
const stockScopeCeiling=50_000;
/**
 * The largest bound id array whose listing reads its stock filter for those ids only (stockClause, #1429):
 * LISTING_STOCK_SCOPE_MAX_IDS, read per call. Blank or invalid: 30,000. 0 turns the scoped clause off (the rollback):
 * every stock filter reads the whole stock set again. Larger values stop at 50,000 (pricedByIdsMax, see above). Measured
 * locally, the scoped clause gains up to ~30k ids, barely at 50k, and loses at 100k, where the whole set's one hash is
 * cheaper than reading the availability view per id.
 */
export function stockScopeMaxIds():number{
 const setting=process.env.LISTING_STOCK_SCOPE_MAX_IDS?.trim();
 if(!setting)return defaultStockScopeMaxIds;
 const value=Number(setting);
 if(value===0)return 0;
 return Number.isSafeInteger(value)&&value>0?Math.min(value,stockScopeCeiling):defaultStockScopeMaxIds;
}

/** A JS id array the listing binds (`param`: "$3::uuid[]") and its length. */
export type StockScope={param:string;size:number};
/**
 * The listing's stock clause. `idSet`: the clause narrows the listing to an id set, and catalogFilter counts it as one
 * (pricedScope). `workMem`: the work_mem its reads need (listingQuery).
 */
export type StockClause={clause:string;idSet:boolean;workMem?:string};
/**
 * The clause of `availability` over `catalog`, none without one. In stock: the row or any offer grouped under it can be
 * sold now. Supplied: some supplier sells it (#475). Out of stock: the card's own row says "Stokta yok" and none of its
 * grouped offers can be sold, so a card is never in both filters, and unknown-stock or unsupplied cards are in neither
 * (#1342; locally 25,018 cards were in both). Both stock filters read the lean availability view, not commerce_catalog's
 * priced rows a second time (#1242).
 *
 * Scoped (#1429): with `scope`, the smallest JS id array the listing binds (search hits, category, model, garage vehicle
 * fits, oils) of at most stockScopeMaxIds() ids, the stock filter reads the availability of those ids only, as
 * `catalog.id=ANY(ARRAY(<scoped ids>)::uuid[])`: an InitPlan run once whose array drives the catalog by primary key. The
 * unscoped clauses below read the whole stock set (a serial scan of supplier_items, ~1.3M rows, and its hash) whatever the
 * listing's size: ~0.25-0.9 s a statement. Measured locally on one snapshot, same count and ids in the newest and price
 * orders: 2k ids in stock, count 537 -> 91 ms; out of stock 1445 -> 56 ms; category=fren in stock ~0.7-1.6 s ->
 * 0.43-0.53 s, out of stock ~1.4-1.9 s -> 0.59-0.73 s. Other shapes of the same set were not linear: `catalog.id IN
 * (<scoped ids>)` planned out of stock as nested loops (4-30 s) and a correlated EXISTS took 96 s.
 * The scoped clause is an id set (`idSet`): a statement pricing the view must never read it (750 ms at 2k ids, over 120 s
 * at 200k), and with the bound array the listing has two id sets, so a price order first reads its ids (listedIds) and
 * prices them by bind array (pricedScope, #1335). Its reads need no extra work_mem and run under the listing's limit.
 * The listings that bind no JS array (brand, manufacturer, a make alone, /katalog) keep the unscoped clause.
 *
 * Unscoped out of stock reads the view through commerce_out_of_stock_ids (db/commerce.sql), whose declared size keeps deep
 * pages off a nested loop (#1286). The in-stock exclusion sits inside that subquery, a hashed SubPlan on the Function Scan
 * the catalog hash-joins (page 49: ~0.85 s -> ~1.1 s); NOT IN at the top level filters the catalog scan itself and
 * serialises it (~1.6 s), and EXCEPT took ~60 s. The planner hashes the NOT IN only while the in-stock ids' estimate (~40 B
 * a row) fits work_mem x hash_mem_multiplier: locally ~189k rows, 7.6 MB against the default 4 MB x 2, hashed at 3750 kB
 * but a per-row SubPlan at 3600 kB (estimated cost 8e10, a hang). Its reads therefore run bounded with 32 MB
 * (listingQuery): room for ~1.6M estimated rows, where the session default would leave ~200k locally and ~800k on
 * production's 16 MB. Pushed as clauses, not id sets: the unscoped filters stay out of pricedScope's id-set count (#1335).
 */
export function stockClause(availability:CatalogQuery["availability"],scope?:StockScope):StockClause|undefined{
 if(!availability)return undefined;
 if(availability==="supplied")return {clause:"NOT catalog.unavailable",idSet:false};
 const max=stockScopeMaxIds();
 if(scope&&max>0&&scope.size<=max){
  const ids=availability==="in_stock"?scopedInStockIdsSql(scope.param):scopedOutOfStockIdsSql(scope.param);
  return {clause:`catalog.id=ANY(ARRAY(${ids})::uuid[])`,idSet:true};
 }
 if(availability==="in_stock")return {clause:`catalog.id IN (${inStockIdsSql})`,idSet:false};
 return {clause:`catalog.id IN (SELECT id FROM commerce_out_of_stock_ids($1::text[]) id WHERE id NOT IN (${inStockIdsSql}))`,idSet:false,workMem:"32MB"};
}
