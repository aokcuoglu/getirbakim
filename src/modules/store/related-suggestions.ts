import "server-only";
import { db } from "@/lib/db";
import { categoryProductIds, typeFittedIds, type CatalogProduct } from "./catalog";
import type { GarageVehicle } from "./garage";
import { oilPackLitres } from "./maintenance-kit";
import { sellableProducts } from "./maintenance-kit.server";
import { complementsFor, fillerSection, pickRelated, universalCategories } from "./related-rules";

export type RelatedContext = { vehicle?: GarageVehicle | null; cartIds?: string[] };

// Candidates ranked per category before pricing: enough for a sellable pick (and a second one for a short list) when
// the best fitting are out of stock or (engine oil) sold in barrels.
const rankedPerCategory = 6;
// Filler candidates priced at most; the best fitting come first, so a few dozen leave enough sellable ones.
const fillerCap = 24;
// Engine oil is suggested in packs a shopper carries home, not workshop barrels.
const maxOilLitres = 5;
const engineOilCategory = 957;

/**
 * The offer groups (product_offers) of `ids`: each id, its primary and every offer of that primary. A cart line or an
 * add-to-cart form may carry a secondary offer's id (the cheapest supplier's row), the listing the primary's.
 */
export async function offerGroupIds(ids: readonly string[]): Promise<string[]> {
  if (!ids.length) return [];
  return (await db.query<{ id: string }>(`SELECT u.id::text FROM unnest($1::uuid[]) u(id)
    UNION SELECT o.primary_id::text FROM product_offers o WHERE o.item_id=ANY($1::uuid[])
    UNION SELECT g.item_id::text FROM product_offers o JOIN product_offers g ON g.primary_id=o.primary_id WHERE o.item_id=ANY($1::uuid[])
    UNION SELECT g.item_id::text FROM product_offers g WHERE g.primary_id=ANY($1::uuid[])`, [ids])).rows.map(row => row.id);
}

/**
 * The added product's category path (root first): the admin's category when set (#575), else the deepest trusted
 * enrichment category, as on the home rails. `ids`: the product's offer group.
 */
async function productCategoryPath(ids: string[]) {
  const rows = (await db.query<{ path: number[]; admin: boolean }>(`SELECT c.path_ids AS path,picked.admin FROM (
    SELECT pc.category_id,false AS admin FROM storefront_enrichments e
     JOIN product_source_categories pc ON pc.supplier_item_id=e.donor_item_id WHERE pc.source='trodo' AND e.supplier_item_id=ANY($1::uuid[])
    UNION ALL SELECT o.category_id,true FROM product_sources ps JOIN product_overrides o ON o.product_id=ps.product_id
     WHERE o.category_id IS NOT NULL AND ps.supplier_item_id=ANY($1::uuid[])) picked
    JOIN source_categories c ON c.source='trodo' AND c.category_id=picked.category_id`, [ids])).rows;
  const chosen = rows.some(row => row.admin) ? rows.filter(row => row.admin) : rows;
  return chosen.reduce<number[]>((deepest, row) => row.path.length > deepest.length ? row.path : deepest, []);
}

/** The master products' other sources and their equivalents (muadil) and SETA references of `ids`: not "related". */
async function equivalentIds(ids: string[]) {
  return (await db.query<{ id: string }>(`SELECT same.supplier_item_id::text AS id FROM product_sources ps
      JOIN product_sources same ON same.product_id=ps.product_id WHERE ps.supplier_item_id=ANY($1::uuid[])
    UNION SELECT other.supplier_item_id::text FROM product_sources ps JOIN product_equivalents q ON q.product_id=ps.product_id
      JOIN product_sources other ON other.product_id=q.equivalent_id WHERE ps.supplier_item_id=ANY($1::uuid[])
    UNION SELECT r.seta_item_id::text FROM product_seta_references r WHERE r.item_id=ANY($1::uuid[])
    UNION SELECT r.item_id::text FROM product_seta_references r WHERE r.seta_item_id=ANY($1::uuid[])`, [ids])).rows.map(row => row.id);
}

/** Pairs among `ids` that are the same master product or equivalents of each other. */
async function equivalentPairs(ids: string[]) {
  return (await db.query<{ a: string; b: string }>(`SELECT a.supplier_item_id::text AS a,b.supplier_item_id::text AS b FROM product_sources a
      JOIN product_sources b ON b.product_id=a.product_id AND b.supplier_item_id<>a.supplier_item_id
      WHERE a.supplier_item_id=ANY($1::uuid[]) AND b.supplier_item_id=ANY($1::uuid[])
    UNION SELECT a.supplier_item_id::text,b.supplier_item_id::text FROM product_sources a JOIN product_equivalents q ON q.product_id=a.product_id
      JOIN product_sources b ON b.product_id=q.equivalent_id WHERE a.supplier_item_id=ANY($1::uuid[]) AND b.supplier_item_id=ANY($1::uuid[])`, [ids])).rows;
}

/** The vehicle models the added product (its offer group) fits, from the storefront fits and the supplier's model fitments. */
async function productModels(ids: string[]) {
  return (await db.query<{ model_id: number }>(`SELECT model_id FROM (SELECT model_id FROM storefront_model_fits WHERE supplier_item_id=ANY($1::uuid[])
    UNION SELECT model_id FROM product_model_fitments WHERE supplier_item_id=ANY($1::uuid[])) m ORDER BY 1 LIMIT 200`, [ids])).rows.map(row => row.model_id);
}

/**
 * How well each candidate fits the vehicle the shopper is working on (null: no vehicle known). The garage vehicle counts
 * when the added product fits it, or when the added product carries no fitment of its own (engine oil); otherwise the added
 * product's models do, a candidate scoring the models it shares.
 */
async function vehicleFit(group: string[], vehicle: GarageVehicle | null | undefined, candidates: string[]): Promise<Map<string, number> | null> {
  const typeId = Number(vehicle?.vehicleId);
  const garage = Number.isInteger(typeId) && typeId > 0;
  const [typeFitted, models] = await Promise.all([garage ? typeFittedIds(typeId) : Promise.resolve<string[]>([]), productModels(group)]);
  const typeSet = new Set(typeFitted);
  const fitScore = new Map<string, number>();
  if (garage && (!models.length || group.some(id => typeSet.has(id)))) {
    for (const id of candidates) if (typeSet.has(id)) fitScore.set(id, 1);
    return fitScore;
  }
  if (!models.length) return null;
  // Both conditions together: the candidate list alone sends the planner to a slower bitmap scan.
  const overlap = (await db.query<{ id: string; shared: number }>(`SELECT f.supplier_item_id::text AS id,count(*)::int AS shared FROM storefront_model_fits f
    WHERE f.model_id=ANY($1::int[]) AND f.supplier_item_id=ANY($2::uuid[]) GROUP BY 1`, [models, candidates])).rows;
  for (const row of overlap) fitScore.set(row.id, row.shared);
  return fitScore;
}

const packTooBig = (categoryId: number, product: CatalogProduct) => {
  if (categoryId !== engineOilCategory) return false;
  const litres = oilPackLitres(product.name);
  return litres === null || litres > maxOilLitres;
};

/** The categories under `section`, outside `own` and its subcategories, in id order. */
async function siblingCategories(section: number, own: number) {
  return (await db.query<{ id: number }>(`SELECT category_id AS id FROM source_categories
    WHERE source='trodo' AND $1=ANY(path_ids) AND NOT ($2=ANY(path_ids)) ORDER BY 1`, [section, own])).rows.map(row => row.id);
}

const byScore = (fitScore: ReadonlyMap<string, number> | null) => (a: string, b: string) =>
  (fitScore?.get(b) ?? 0) - (fitScore?.get(a) ?? 0) || (a < b ? -1 : a > b ? 1 : 0);

/**
 * Products to suggest after `productId` went into the cart (#704): sellable parts of the categories fitted together with
 * it, one per category first, the best fitting the vehicle first; a short list then takes a second fitting part, then
 * fitting parts of the rest of the product's section (Fren sistemi for a disc, fillerSection). Parts tied to a vehicle are
 * suggested only when they fit the vehicle (garage, or the added product's models); fluids always. Never the product's
 * offers or equivalents, what the cart holds, or a category the cart already has a part of. Fewer than `limit` (or none)
 * when nothing else qualifies, and none when anything fails: adding to the cart must not depend on it.
 */
export async function relatedSuggestions(productId: string, context: RelatedContext, limit = 3): Promise<CatalogProduct[]> {
  try {
    const [group, cartGroup] = await Promise.all([offerGroupIds([productId]), offerGroupIds(context.cartIds ?? [])]);
    const path = await productCategoryPath(group);
    if (!path.length) return [];
    const complements = complementsFor(path);
    const siblings = (await siblingCategories(fillerSection(path), path[path.length - 1])).filter(id => !complements.includes(id));
    const specific = siblings.filter(id => !universalCategories.has(id));
    const fluids = siblings.filter(id => universalCategories.has(id));
    const idsOf = (categoryId: number) => categoryProductIds([], [categoryId]).then(ids => ({ categoryId, ids }));
    const [lists, fluidLists, specificIds, equivalents] = await Promise.all([
      Promise.all(complements.map(idsOf)), Promise.all(fluids.map(idsOf)),
      specific.length ? categoryProductIds([], specific) : Promise.resolve<string[]>([]),
      equivalentIds(group),
    ]);
    const own = new Set([...group, ...equivalents]);
    // A category the cart already holds a part of (other than the added product) is covered.
    const inCart = new Set(cartGroup.filter(id => !own.has(id)));
    const open = lists.filter(list => !list.ids.some(id => inCart.has(id)));
    const exclude = new Set([...own, ...cartGroup]);
    const candidates = [...new Set([...open.flatMap(list => list.ids), ...specificIds])].filter(id => !exclude.has(id));
    if (!candidates.length && !fluidLists.some(list => list.ids.length)) return [];
    const fitScore = await vehicleFit(group, context.vehicle, candidates);
    const ranked = pickRelated({ complements: open, fitScore, exclude, perCategory: rankedPerCategory });
    // The filler: fitting parts of the sibling categories, best fitting first, then fluids; scored before it is capped.
    const filler = [
      ...[...new Set(specificIds)].filter(id => !exclude.has(id) && (fitScore?.get(id) ?? 0) > 0).sort(byScore(fitScore)).map(id => ({ id, categoryId: 0 })),
      ...fluidLists.flatMap(list => list.ids.filter(id => !exclude.has(id)).sort().map(id => ({ id, categoryId: list.categoryId }))),
    ].slice(0, fillerCap);
    if (!ranked.length && !filler.length) return [];
    const priced = new Map((await sellableProducts([...new Set([...ranked, ...filler].map(pick => pick.id))])).map(product => [product.id, product]));
    const usable = (picks: { id: string; categoryId: number }[]) => picks.flatMap(pick => {
      const product = priced.get(pick.id);
      return product && !packTooBig(pick.categoryId, product) ? [{ product, categoryId: pick.categoryId }] : [];
    });
    const related = usable(ranked), extra = usable(filler);
    const chosen: CatalogProduct[] = [];
    const filled = new Set<number>();
    for (const { product, categoryId } of related) {
      if (chosen.length >= limit) break;
      if (filled.has(categoryId)) continue;
      chosen.push(product); filled.add(categoryId);
    }
    const rest = [...related.filter(({ product }) => !chosen.includes(product)), ...extra];
    if (chosen.length < limit && rest.length) {
      // A second part of a category, then the filler; never the same product or an equivalent of one already suggested.
      const pairs = await equivalentPairs([...new Set([...chosen, ...rest.map(({ product }) => product)].map(product => product.id))]);
      const twins = (id: string) => pairs.filter(pair => pair.a === id).map(pair => pair.b);
      const taken = new Set(chosen.flatMap(product => [product.id, ...twins(product.id)]));
      for (const { product } of rest) {
        if (chosen.length >= limit) break;
        if (taken.has(product.id)) continue;
        chosen.push(product);
        for (const id of [product.id, ...twins(product.id)]) taken.add(id);
      }
    }
    return chosen;
  } catch (error) {
    console.error("Related suggestions failed", error instanceof Error ? error.message : error);
    return [];
  }
}
