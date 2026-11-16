import "server-only";
import { boundedQuery } from "@/lib/db";
import { storefrontCompanies } from "@/modules/suppliers/storefront-sources";
import { listedOnly, modelFitsSql } from "@/modules/store/catalog";
import { categoryAncestorsSql, categoryParams, itemCategoriesSql } from "@/modules/store/listing-categories.server";
import { vehicleBrandSlug } from "@/modules/store/vehicle-catalog";
import { getVehicleBrands } from "@/modules/store/vehicle-catalog.server";
import { getVehicleModelGroups } from "@/modules/store/vehicle-model-groups.server";
import { minIndexableListingProducts } from "./indexing";
import { listingPath, modelPath } from "./paths";

// The model and model × category sitemap files (#673): the pages listingIndexable opens, i.e. a plain listing with at
// least minIndexableListingProducts products. scripts/test-vehicle-model-listing.ts keeps them equal to the pages' rule.

type Unit = { makeSlug: string; modelSlug: string };

/**
 * Every model page unit with its series: `unit` indexes `units`, the two arrays pair each series with its unit (the
 * query's unnest). A make is taken by slug as the route finds it (getVehicleBrandBySlug: the first brand of that slug).
 */
async function modelUnits() {
  const makes = new Map<string, string>();
  for (const brand of await getVehicleBrands()) if (!makes.has(vehicleBrandSlug(brand.name))) makes.set(vehicleBrandSlug(brand.name), brand.id);
  const groups = await Promise.all([...makes].map(async ([makeSlug, brandId]) => ({ makeSlug, groups: await getVehicleModelGroups(brandId) })));
  const units: Unit[] = [], modelIds: number[] = [], unitIds: number[] = [];
  for (const { makeSlug, groups: makeGroups } of groups) for (const group of makeGroups) {
    for (const member of group.models) { modelIds.push(Number(member.id)); unitIds.push(units.length); }
    units.push({ makeSlug, modelSlug: group.slug });
  }
  return { units, modelIds, unitIds };
}

// Each unit's distinct fitted products (modelFitsSql, as the model page reads them) that the store lists.
// ~3.7 s locally: every fit is read once and the listing once (hashed), instead of a count per unit.
const modelsSql = `WITH units AS MATERIALIZED (SELECT * FROM unnest($2::int[],$3::int[]) u(model_id,unit)),
 pairs AS MATERIALIZED (SELECT DISTINCT units.unit,fits.id FROM (${modelFitsSql}) fits JOIN units USING (model_id)),
 listed AS MATERIALIZED (SELECT catalog.id FROM (SELECT e.id,e.unavailable FROM storefront_catalog_entries e
   WHERE e.source='store' OR e.company=ANY($1::text[])) catalog WHERE ${listedOnly})
 SELECT pairs.unit FROM pairs JOIN listed ON listed.id=pairs.id GROUP BY 1 HAVING count(*)>=$4 ORDER BY 1`;

/** Addresses of the model pages that are indexed (/yedek-parca/<make>/<model>). */
export async function loadModelPaths(): Promise<string[]> {
  const { units, modelIds, unitIds } = await modelUnits();
  const { rows } = await boundedQuery<{ unit: number }>(modelsSql, [storefrontCompanies(), modelIds, unitIds, minIndexableListingProducts], 120_000);
  return rows.map(row => modelPath(units[row.unit].makeSlug, units[row.unit].modelSlug));
}

/**
 * Model × category pairs with enough listed products, subcategories included. Starts from the categorised products
 * (itemCategoriesSql over the whole catalog), keeps those the store lists, then reads each one's model fits through
 * the item indexes (the inverse of modelFitsSql: its engine-level fits, the description fits of its offers, and its
 * own when it groups no offer). ~1.5 s locally.
 */
const modelCategoriesSql = `WITH units AS MATERIALIZED (SELECT * FROM unnest($6::int[],$7::int[]) u(model_id,unit)),
 cats AS MATERIALIZED (${itemCategoriesSql({ legacySlugs: "$2", legacyIds: "$3", oilIds: "$4", oilCategory: "$5" })}),
 ids AS MATERIALIZED (SELECT DISTINCT id FROM cats),
 listed AS MATERIALIZED (SELECT ids.id FROM ids JOIN LATERAL (SELECT e.id,e.unavailable FROM storefront_catalog_entries e
   WHERE e.id=ids.id AND (e.source='store' OR e.company=ANY($1::text[])) OFFSET 0) catalog ON true WHERE ${listedOnly}),
 fits AS MATERIALIZED (SELECT f.model_id,f.supplier_item_id AS id FROM listed JOIN storefront_model_fits f ON f.supplier_item_id=listed.id
  UNION ALL SELECT f.model_id,listed.id FROM listed JOIN product_offers o ON o.primary_id=listed.id JOIN product_model_fitments f ON f.supplier_item_id=o.item_id
  UNION ALL SELECT f.model_id,listed.id FROM listed JOIN product_model_fitments f ON f.supplier_item_id=listed.id
   WHERE NOT EXISTS (SELECT 1 FROM product_offers o WHERE o.item_id=listed.id))
 SELECT units.unit,label.slug FROM fits JOIN units USING (model_id) JOIN cats ON cats.id=fits.id
 ${categoryAncestorsSql("cats.category_id")}
 JOIN source_category_labels label ON label.source='trodo' AND label.category_id=ancestor.category_id AND label.locale='tr'
 GROUP BY units.unit,ancestor.category_id,label.slug HAVING count(DISTINCT fits.id)>=$8 ORDER BY 1,ancestor.category_id`;

/** Addresses of the model × category pages that are indexed (/kategori/<category>/<make>/<model>). */
export async function loadModelCategoryPaths(): Promise<string[]> {
  const { units, modelIds, unitIds } = await modelUnits();
  const { rows } = await boundedQuery<{ unit: number; slug: string }>(modelCategoriesSql,
    [storefrontCompanies(), ...await categoryParams(), modelIds, unitIds, minIndexableListingProducts], 120_000);
  return rows.map(row => listingPath({ makeSlug: units[row.unit].makeSlug, modelSlug: units[row.unit].modelSlug, categorySlug: row.slug }));
}
