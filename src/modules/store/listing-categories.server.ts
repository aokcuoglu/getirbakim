import "server-only";
import { boundedQuery } from "@/lib/db";
import { listingCacheStore, storedLinks } from "./listing-cache-store";
import { staleCache } from "@/lib/stale-cache";
import { storefrontCompanies } from "@/modules/suppliers/storefront-sources";
import type { CatalogQuery } from "./catalog-query";
import { listedOnly, makeFitsSql, modelFitsSql } from "./catalog";
import { legacyCategoryIds } from "./category-tree";
import { fitsEpoch } from "./listing-epoch";
import { listingWaitMs } from "./listing-wait";
import { getVehicleBrandBySlug } from "./vehicle-catalog.server";
import { getVehicleModelGroup } from "./vehicle-model-groups.server";
import { engineOilCategoryId } from "./vehicle-oil";
import { engineOilIds } from "./vehicle-oil.server";

/** Placeholders (e.g. "$2") of the values itemCategoriesSql reads; `categoryParams` gives the values in this order. */
export type ItemCategoryParams = { legacySlugs: string; legacyIds: string; oilIds: string; oilCategory: string };

/** The values behind ItemCategoryParams: legacy slugs, their category ids, the engine oils read from names, their category. */
export async function categoryParams(): Promise<[string[], number[], string[], number]> {
  const legacy = Object.entries(legacyCategoryIds);
  return [legacy.map(([slug]) => slug), legacy.map(([, id]) => id), await engineOilIds(), engineOilCategoryId];
}

/**
 * Each catalog row's own categories as (id, category_id) rows, a pair possibly repeated: the inverse of the category
 * filter (categoryProductIds in catalog.ts), so a product is in category C exactly when one of its rows here is C or
 * a descendant of C.
 * - A legacy slug on the store row or the supplier item (product_data.category), as its category id.
 * - The Trodo category of a trusted enrichment (the same match_basis condition as the filter).
 * - An admin's category (#575) replaces the automatic ones: an item whose product has one keeps only that.
 * - Engine oils recognised by their name (engineOilIds) are in the engine-oil category whatever the admin decided,
 *   as the filter adds them after the admin's rule.
 * `scoped` names a relation with an `id` column: every branch starts from it through the tables' id indexes. Without it
 * the whole catalog is read (the model × category sitemap).
 * The trusted-enrichment branch carries the same 1-row estimate as #1240 (~199k rows in fact), but the mis-estimated side
 * only drives product_source_categories_pkey probes by donor (~199k, ~0.45 s unscoped), and every caller fences it in a
 * MATERIALIZED CTE (#1245).
 */
export function itemCategoriesSql({ scoped, legacySlugs, legacyIds, oilIds, oilCategory }: ItemCategoryParams & { scoped?: string }): string {
  const from = (table: string, alias: string, key: string) => scoped ? `${scoped} JOIN ${table} ${alias} ON ${alias}.${key}=${scoped}.id` : `${table} ${alias}`;
  const legacy = `unnest(${legacySlugs}::text[],${legacyIds}::int[]) legacy(slug,category_id)`;
  return `SELECT automatic.id,automatic.category_id FROM (
   SELECT p.id,legacy.category_id FROM ${from("store_products", "p", "id")} JOIN ${legacy} ON p.category=legacy.slug
   UNION ALL SELECT s.id,legacy.category_id FROM ${from("supplier_items", "s", "id")} JOIN ${legacy}
    ON s.product_data->>'category'<>'' AND s.product_data->>'category'=legacy.slug
   UNION ALL SELECT e.supplier_item_id,pc.category_id FROM ${from("storefront_enrichments", "e", "supplier_item_id")}
    JOIN product_source_categories pc ON pc.supplier_item_id=e.donor_item_id AND pc.source='trodo'
    JOIN supplier_items s ON s.id=e.supplier_item_id AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
    AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)) automatic
  WHERE NOT EXISTS (SELECT 1 FROM product_sources ps JOIN product_overrides o ON o.product_id=ps.product_id
   WHERE ps.supplier_item_id=automatic.id AND o.category_id IS NOT NULL)
  UNION ALL SELECT ps.supplier_item_id,o.category_id FROM product_overrides o JOIN product_sources ps ON ps.product_id=o.product_id
   WHERE o.category_id IS NOT NULL${scoped ? ` AND ps.supplier_item_id IN (SELECT id FROM ${scoped})` : ""}
  UNION ALL SELECT oil.id,${oilCategory}::int FROM unnest(${oilIds}::uuid[]) oil(id)${scoped ? ` JOIN ${scoped} ON ${scoped}.id=oil.id` : ""}`;
}

/**
 * Joins each row's own category (`column`) to the store's category tree and yields `ancestor.category_id` for it and
 * every category above it (its path). Only categories the store shows count (getStoreCategories: Trodo categories
 * with a Turkish label), like the filter's descendants; a product is counted once per ancestor with count(DISTINCT).
 */
export const categoryAncestorsSql = (column: string) => `JOIN source_categories own ON own.source='trodo' AND own.category_id=${column}
 JOIN source_category_labels own_label ON own_label.source=own.source AND own_label.category_id=own.category_id AND own_label.locale='tr'
 CROSS JOIN LATERAL unnest(own.path_ids) ancestor(category_id)`;

// Like the make and model listings' counts: reloaded when the fits value moves (an admin edit or the fit sync, #1368,
// listing-epoch.ts), otherwise every 10 minutes in the background; after a bump a page waits at most
// LISTING_EPOCH_WAIT_MS for the reload, then gets the earlier counts (none: it waits). One entry per make or model page
// visited (~4.4k units): 1000 keeps the popular ones warm. Also persisted (#1391), so a new container adopts them.
const cachedCounts = staleCache<[number, number][]>(10 * 60 * 1000, 1000, {name:"category-counts", weigh: counts => 32 * counts.length, maxWeight: 16 * 1024 * 1024, epoch: fitsEpoch, maxWaitMs: listingWaitMs, ...storedLinks, fallbackWhen: counts => counts.length > 0, store: listingCacheStore<[number, number][]>("category-counts", 1) });

/**
 * Products per category, subcategories included, of a make's or a vehicle model's listing ($1 companies, $2-$5
 * categoryParams, $6 the scope). Categorised first, then only those ids are looked up in the listing one by one: the
 * other order read the whole scope from the catalog view (Golf 7: 664 ms instead of 129 ms).
 */
const scopeCountsSql = (scopeSql: string) => `WITH scoped AS MATERIALIZED (${scopeSql}),
 cats AS MATERIALIZED (${itemCategoriesSql({ scoped: "scoped", legacySlugs: "$2", legacyIds: "$3", oilIds: "$4", oilCategory: "$5" })}),
 ids AS MATERIALIZED (SELECT DISTINCT id FROM cats),
 listed AS MATERIALIZED (SELECT ids.id FROM ids JOIN LATERAL (SELECT e.id,e.unavailable FROM storefront_catalog_entries e
   WHERE e.id=ids.id AND (e.source='store' OR e.company=ANY($1::text[])) OFFSET 0) catalog ON true WHERE ${listedOnly})
 SELECT ancestor.category_id,count(DISTINCT cats.id)::int AS products FROM cats JOIN listed ON listed.id=cats.id
 ${categoryAncestorsSql("cats.category_id")} GROUP BY 1`;

/**
 * How many products of a make's or a vehicle model's listing (without filters) each category holds, its
 * subcategories included: the count the make × category or model × category page would show (#673). The make and
 * model pages link only the categories found here, so no category link ends in an empty page's 404. A model is read
 * like the model page (its own fits, not the make's); an unknown make or model gives an empty map.
 */
export async function scopeCategoryCounts(query: Pick<CatalogQuery, "make" | "model">): Promise<Map<number, number>> {
  const make = query.make ? await getVehicleBrandBySlug(query.make) : undefined;
  if (!make) return new Map();
  let scope: { sql: string; value: unknown };
  if (query.model) {
    const group = await getVehicleModelGroup(make, query.model);
    if (!group) return new Map();
    scope = { sql: `SELECT DISTINCT id FROM (${modelFitsSql}) fits WHERE model_id=ANY($6::int[])`, value: group.models.map(member => member.id) };
  } else {
    // The make listing's fits as catalogFilter reads them: engine-level and description fits (#674).
    scope = { sql: `SELECT supplier_item_id AS id FROM (${makeFitsSql("$6::int")}) fits`, value: Number(make.id) };
  }
  return new Map(await cachedCounts(`${query.make}|${query.model ?? ""}`, async () => (await boundedQuery<{ category_id: number; products: number }>(`listing.categoryCounts ${query.make}|${query.model ?? ""}`, 
    scopeCountsSql(scope.sql), [storefrontCompanies(), ...await categoryParams(), scope.value])).rows.map(row => [row.category_id, row.products])));
}
