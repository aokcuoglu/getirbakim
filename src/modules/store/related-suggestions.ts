import "server-only";
import { db } from "@/lib/db";
import { categoryProductIds, typeFittedIds, type CatalogProduct } from "./catalog";
import type { GarageVehicle } from "./garage";
import { oilPackLitres } from "./maintenance-kit";
import { sellableProducts } from "./maintenance-kit.server";
import { complementsFor, pickRelated } from "./related-rules";

export type RelatedContext = { vehicle?: GarageVehicle | null; cartIds?: string[] };

// Candidates ranked per category before pricing: enough for one sellable pick when the best fitting are out of stock
// or (engine oil) sold in barrels.
const rankedPerCategory = 6;
// Bounds the fit lookups' id lists; the complementary categories hold a few hundred products each.
const candidateCap = 1000;
// Engine oil is suggested in packs a shopper carries home, not workshop barrels.
const maxOilLitres = 5;
const engineOilCategory = 957;

/**
 * The added product's category path (root first): the admin's category when set (#575), else the deepest trusted
 * enrichment category, as on the home rails.
 */
async function productCategoryPath(productId: string) {
  const rows = (await db.query<{ path: number[]; admin: boolean }>(`SELECT c.path_ids AS path,picked.admin FROM (
    SELECT pc.category_id,false AS admin FROM storefront_enrichments e
     JOIN product_source_categories pc ON pc.supplier_item_id=e.donor_item_id WHERE pc.source='trodo' AND e.supplier_item_id=$1::uuid
    UNION ALL SELECT o.category_id,true FROM product_sources ps JOIN product_overrides o ON o.product_id=ps.product_id
     WHERE o.category_id IS NOT NULL AND ps.supplier_item_id=$1::uuid) picked
    JOIN source_categories c ON c.source='trodo' AND c.category_id=picked.category_id`, [productId])).rows;
  const chosen = rows.some(row => row.admin) ? rows.filter(row => row.admin) : rows;
  return chosen.reduce<number[]>((deepest, row) => row.path.length > deepest.length ? row.path : deepest, []);
}

/** The added product's offers, its master product's other sources and their equivalents (muadil): not "related". */
async function equivalentIds(productId: string) {
  return (await db.query<{ id: string }>(`SELECT $1::uuid::text AS id
    UNION SELECT o.primary_id::text FROM product_offers o WHERE o.item_id=$1::uuid
    UNION SELECT g.item_id::text FROM product_offers o JOIN product_offers g ON g.primary_id=o.primary_id WHERE o.item_id=$1::uuid
    UNION SELECT g.item_id::text FROM product_offers g WHERE g.primary_id=$1::uuid
    UNION SELECT same.supplier_item_id::text FROM product_sources ps JOIN product_sources same ON same.product_id=ps.product_id WHERE ps.supplier_item_id=$1::uuid
    UNION SELECT other.supplier_item_id::text FROM product_sources ps JOIN product_equivalents q ON q.product_id=ps.product_id
      JOIN product_sources other ON other.product_id=q.equivalent_id WHERE ps.supplier_item_id=$1::uuid
    UNION SELECT r.seta_item_id::text FROM product_seta_references r WHERE r.item_id=$1::uuid
    UNION SELECT r.item_id::text FROM product_seta_references r WHERE r.seta_item_id=$1::uuid`, [productId])).rows.map(row => row.id);
}

/** The vehicle models the added product fits, from the storefront fits and the supplier's model fitments. */
async function productModels(productId: string) {
  return (await db.query<{ model_id: number }>(`SELECT model_id FROM (SELECT model_id FROM storefront_model_fits WHERE supplier_item_id=$1::uuid
    UNION SELECT model_id FROM product_model_fitments WHERE supplier_item_id=$1::uuid) m ORDER BY 1 LIMIT 200`, [productId])).rows.map(row => row.model_id);
}

/**
 * How well each candidate fits the added product's vehicle, and which candidates carry any fitment. The garage vehicle
 * counts when the added product fits it; otherwise the added product's own models do (shared models = score).
 */
async function vehicleFit(productId: string, vehicle: GarageVehicle | null | undefined, candidates: string[]) {
  const typeId = Number(vehicle?.vehicleId);
  const [typeFitted, models] = await Promise.all([
    Number.isInteger(typeId) && typeId > 0 ? typeFittedIds(typeId) : Promise.resolve<string[]>([]),
    productModels(productId),
  ]);
  const typeSet = new Set(typeFitted);
  const useType = typeSet.has(productId);
  if (!useType && !models.length) return { fitScore: null, hasFitData: new Set<string>() };
  // Both conditions in the overlap query: the candidate list alone sends the planner to a slower bitmap scan.
  const [overlap, fitted] = await Promise.all([
    useType ? Promise.resolve([]) : db.query<{ id: string; shared: number }>(`SELECT f.supplier_item_id::text AS id,count(*)::int AS shared FROM storefront_model_fits f
      WHERE f.model_id=ANY($1::int[]) AND f.supplier_item_id=ANY($2::uuid[]) GROUP BY 1`, [models, candidates]).then(result => result.rows),
    db.query<{ id: string }>(`SELECT DISTINCT supplier_item_id::text AS id FROM storefront_model_fits WHERE supplier_item_id=ANY($1::uuid[])`, [candidates])
      .then(result => result.rows),
  ]);
  const fitScore = new Map<string, number>();
  if (useType) for (const id of candidates) { if (typeSet.has(id)) fitScore.set(id, 1); }
  else for (const row of overlap) fitScore.set(row.id, row.shared);
  return { fitScore, hasFitData: new Set(fitted.map(row => row.id)) };
}

/**
 * Products to suggest after `productId` went into the cart (#704): sellable parts of the categories fitted together with
 * it, one per category, the best fitting the vehicle first. Never the product's equivalents or what the cart holds.
 * Empty when the product has no category with complements or anything fails: adding to the cart must not depend on it.
 */
export async function relatedSuggestions(productId: string, context: RelatedContext, limit = 3): Promise<CatalogProduct[]> {
  try {
    const complements = complementsFor(await productCategoryPath(productId));
    if (!complements.length) return [];
    const [lists, equivalents] = await Promise.all([
      Promise.all(complements.map(async categoryId => ({ categoryId, ids: (await categoryProductIds([], [categoryId])).slice(0, candidateCap) }))),
      equivalentIds(productId),
    ]);
    const exclude = new Set([...equivalents, ...(context.cartIds ?? [])]);
    const candidates = [...new Set(lists.flatMap(list => list.ids))].filter(id => !exclude.has(id));
    if (!candidates.length) return [];
    const { fitScore, hasFitData } = await vehicleFit(productId, context.vehicle, candidates);
    const ranked = pickRelated({ complements: lists, fitScore, hasFitData, exclude, perCategory: rankedPerCategory });
    const priced = new Map((await sellableProducts(ranked.map(pick => pick.id))).map(product => [product.id, product]));
    const chosen: CatalogProduct[] = [];
    const filled = new Set<number>();
    for (const pick of ranked) {
      if (chosen.length >= limit) break;
      const product = priced.get(pick.id);
      if (!product || filled.has(pick.categoryId)) continue;
      if (pick.categoryId === engineOilCategory) {
        const litres = oilPackLitres(product.name);
        if (litres === null || litres > maxOilLitres) continue;
      }
      chosen.push(product); filled.add(pick.categoryId);
    }
    return chosen;
  } catch (error) {
    console.error("Related suggestions failed", error instanceof Error ? error.message : error);
    return [];
  }
}
