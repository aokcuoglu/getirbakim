import "server-only";
import { db } from "@/lib/db";
import { categoryProductIds, typeFittedIds, type CatalogProduct } from "./catalog";
import type { GarageVehicle } from "./garage";
import { oilPackLitres } from "./maintenance-kit";
import { sellableProducts } from "./maintenance-kit.server";
import { maxOilLitres, productOilTargets, sellableFluidIds, suggestableOils } from "./related-fluids.server";
import { complementsFor, fillerSection, pickRelated, rankOils, sameTypeName, targetCapacity, unrelatedFluids, universalCategories } from "./related-rules";
import { engineOilCategoryId, vehicleOilFilters } from "./vehicle-oil";
import { engineOilIds, getVehicleOilSpec, namedEngineOil } from "./vehicle-oil.server";

export type RelatedContext = { vehicle?: GarageVehicle | null; cartIds?: string[] };

// Candidates ranked per category before pricing: enough for a sellable pick (and a second one for a short list) when
// the best fitting are out of stock or (engine oil) sold in barrels.
const rankedPerCategory = 6;
// Filler candidates priced at most; the best fitting come first, so a few dozen leave enough sellable ones.
const fillerCap = 24;

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
 * enrichment category, as on the home rails, with every leaf category it is listed in (the admin's alone when set).
 * `ids`: the product's offer group.
 */
async function productCategoryPath(ids: string[]) {
  const rows = (await db.query<{ path: number[]; admin: boolean; category: number }>(`SELECT c.path_ids AS path,picked.admin,picked.category_id AS category FROM (
    SELECT pc.category_id,false AS admin FROM storefront_enrichments e
     JOIN product_source_categories pc ON pc.supplier_item_id=e.donor_item_id WHERE pc.source='trodo' AND e.supplier_item_id=ANY($1::uuid[])
    UNION ALL SELECT o.category_id,true FROM product_sources ps JOIN product_overrides o ON o.product_id=ps.product_id
     WHERE o.category_id IS NOT NULL AND ps.supplier_item_id=ANY($1::uuid[])) picked
    JOIN source_categories c ON c.source='trodo' AND c.category_id=picked.category_id`, [ids])).rows;
  const chosen = rows.some(row => row.admin) ? rows.filter(row => row.admin) : rows;
  return {
    path: chosen.reduce<number[]>((deepest, row) => row.path.length > deepest.length ? row.path : deepest, []),
    categories: [...new Set(chosen.map(row => row.category))],
  };
}

/** A category's path (root first); empty when unknown. */
async function categoryPath(categoryId: number) {
  return (await db.query<{ path: number[] }>(`SELECT path_ids AS path FROM source_categories WHERE source='trodo' AND category_id=$1`,
    [categoryId])).rows[0]?.path ?? [];
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
 * How well each candidate fits the vehicle the shopper is working on (fitScore null: no vehicle known). The garage vehicle
 * counts when the added product fits it, or when the added product carries no fitment of its own (engine oil); then
 * garageTypeId is its type. Otherwise the added product's models do, a candidate scoring the models it shares.
 */
async function vehicleFit(group: string[], vehicle: GarageVehicle | null | undefined, candidates: string[]): Promise<{
  fitScore: Map<string, number> | null; garageTypeId: string | null;
}> {
  const typeId = Number(vehicle?.vehicleId);
  const garage = Number.isInteger(typeId) && typeId > 0;
  const [typeFitted, models] = await Promise.all([garage ? typeFittedIds(typeId) : Promise.resolve<string[]>([]), productModels(group)]);
  const typeSet = new Set(typeFitted);
  const fitScore = new Map<string, number>();
  if (garage && (!models.length || group.some(id => typeSet.has(id)))) {
    for (const id of candidates) if (typeSet.has(id)) fitScore.set(id, 1);
    return { fitScore, garageTypeId: String(typeId) };
  }
  if (!models.length) return { fitScore: null, garageTypeId: null };
  // Both conditions together: the candidate list alone sends the planner to a slower bitmap scan.
  const overlap = (await db.query<{ id: string; shared: number }>(`SELECT f.supplier_item_id::text AS id,count(*)::int AS shared FROM storefront_model_fits f
    WHERE f.model_id=ANY($1::int[]) AND f.supplier_item_id=ANY($2::uuid[]) GROUP BY 1`, [models, candidates])).rows;
  for (const row of overlap) fitScore.set(row.id, row.shared);
  return { fitScore, garageTypeId: null };
}

const packTooBig = (categoryId: number, product: CatalogProduct) => {
  if (categoryId !== engineOilCategoryId) return false;
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

/** What the engine oil ranking reads, loaded alongside the vehicle fit. */
const oilInputs = (group: string[], vehicle: GarageVehicle | null | undefined) =>
  Promise.all([suggestableOils(), productOilTargets(group), getVehicleOilSpec(vehicle?.vehicleId)]);

/**
 * The engine oils to suggest, best first (#715): when the garage vehicle counts (vehicleFit's garageTypeId) and has oil
 * data, only oils meeting its recommendation, the fewest packs for its capacity first; otherwise ranked by the
 * recommendations of the vehicle types the added product fits. Ties rotate by the added product, so oil filters do not all
 * get one oil.
 */
function rankedOils(seed: string, [oils, fitted, garage]: Awaited<ReturnType<typeof oilInputs>>, garageTypeId: string | null) {
  if (garageTypeId && garage && vehicleOilFilters(garage).length)
    return rankOils(oils, [{ spec: garage, weight: 1 }], { seed, strict: true, capacityLitres: garage.capacityMax });
  return rankOils(oils, fitted, { seed, strict: false, capacityLitres: targetCapacity(fitted) });
}

/**
 * Products to suggest after `productId` went into the cart (#704): sellable parts of the categories fitted together with
 * it, one per category first, the best fitting the vehicle first; a short list then takes a second fitting part, then
 * fitting parts of the rest of the product's section (Fren sistemi for a disc, fillerSection). Parts tied to a vehicle are
 * suggested only when they fit the vehicle (garage, or the added product's models); fluids always, at most one per fluid
 * category, engine oil by the vehicle's oil specification (#715) and other fluids rotated by the added product. Never the
 * product's offers or equivalents, what the cart holds, a category the cart already has a part of, products of the
 * product's own categories, or (#733) a product named like the product's kind from another category (oil filters under
 * fuel or hydraulic filters). An engine oil recognised by name only counts as engine oil. Fewer than `limit`
 * (or none) when nothing else qualifies, and none when anything fails: adding to the cart must not depend on it.
 */
export async function relatedSuggestions(productId: string, context: RelatedContext, limit = 3): Promise<CatalogProduct[]> {
  try {
    const [group, cartGroup] = await Promise.all([offerGroupIds([productId]), offerGroupIds(context.cartIds ?? [])]);
    // The rotation's seed: the same for every offer of the product (the card adds the best offer, the page the primary).
    const seed = [...group].sort()[0] ?? productId;
    let { path, categories } = await productCategoryPath(group);
    // An engine oil recognised by name only has no category of its own: it is treated as engine oil (#733).
    if (!path.length && await namedEngineOil(group)) {
      path = await categoryPath(engineOilCategoryId);
      categories = [engineOilCategoryId];
    }
    if (!path.length) return [];
    const complements = complementsFor(path);
    const unrelated = path.flatMap(id => unrelatedFluids[id] ?? []);
    const siblings = (await siblingCategories(fillerSection(path), path[path.length - 1]))
      .filter(id => !complements.includes(id) && !unrelated.includes(id));
    const specific = siblings.filter(id => !universalCategories.has(id));
    const fluids = siblings.filter(id => universalCategories.has(id));
    // Engine oil: the category's products and the oils recognised by name (as its listing), so an oil in the cart covers it.
    const idsOf = (categoryId: number) => Promise.all([categoryProductIds([], [categoryId]),
      categoryId === engineOilCategoryId ? engineOilIds() : Promise.resolve<string[]>([])])
      .then(([listed, named]) => ({ categoryId, ids: named.length ? [...new Set([...listed, ...named])] : listed }));
    const [lists, fluidLists, specificIds, equivalents, ownCategoryIds] = await Promise.all([
      Promise.all(complements.map(idsOf)), Promise.all(fluids.map(idsOf)),
      specific.length ? categoryProductIds([], specific) : Promise.resolve<string[]>([]),
      equivalentIds(group), categoryProductIds([], [...categories].sort((a, b) => a - b)),
    ]);
    const own = new Set([...group, ...equivalents]);
    // A category the cart already holds a part of (other than the added product) is covered.
    const inCart = new Set(cartGroup.filter(id => !own.has(id)));
    const uncovered = (list: { ids: readonly string[] }) => !list.ids.some(id => inCart.has(id));
    let open = lists.filter(uncovered), openFluids = fluidLists.filter(uncovered);
    // The product's own categories: a product listed in one of them is its kind, not a complement of it, even via a sibling (#733).
    const exclude = new Set([...own, ...cartGroup, ...ownCategoryIds]);
    const needsOil = [...open, ...openFluids].some(list => list.categoryId === engineOilCategoryId);
    // Engine oil is ranked by rankedOils, not by fitment: its ids stay out of the fit lookup.
    const candidates = [...new Set([...open.filter(list => list.categoryId !== engineOilCategoryId).flatMap(list => list.ids), ...specificIds])]
      .filter(id => !exclude.has(id));
    if (!candidates.length && !needsOil && !openFluids.some(list => list.ids.length)) return [];
    // Fluids other than engine oil rotate over their sellable products (the cart check above used the whole category).
    const otherFluids = [...new Set([...open, ...openFluids].map(list => list.categoryId)
      .filter(id => universalCategories.has(id) && id !== engineOilCategoryId))];
    const [{ fitScore, garageTypeId }, oilData, fluidIds] = await Promise.all([vehicleFit(group, context.vehicle, candidates),
      needsOil ? oilInputs(group, context.vehicle) : null,
      Promise.all(otherFluids.map(async id => [id, await sellableFluidIds(id)] as const)).then(entries => new Map(entries))]);
    const oils = oilData ? rankedOils(seed, oilData, garageTypeId) : [];
    const pool = (list: { categoryId: number; ids: string[] }) =>
      ({ ...list, ids: list.categoryId === engineOilCategoryId ? oils : fluidIds.get(list.categoryId) ?? list.ids });
    open = open.map(pool); openFluids = openFluids.map(pool);
    const order = { exclude, perCategory: rankedPerCategory, ordered: new Set([engineOilCategoryId]), seed };
    const ranked = pickRelated({ complements: open, fitScore, ...order });
    // The filler: fitting parts of the sibling categories, best fitting first, then the fluids taking turns; scored before it is capped.
    const filler = [
      ...[...new Set(specificIds)].filter(id => !exclude.has(id) && (fitScore?.get(id) ?? 0) > 0).sort(byScore(fitScore)).map(id => ({ id, categoryId: 0 })),
      ...pickRelated({ complements: openFluids, fitScore: null, ...order }),
    ].slice(0, fillerCap);
    if (!ranked.length && !filler.length) return [];
    const priced = new Map((await sellableProducts([...new Set([...ranked, ...filler].map(pick => pick.id))])).map(product => [product.id, product]));
    const sameType = sameTypeName(path);
    const usable = (picks: { id: string; categoryId: number }[]) => picks.flatMap(pick => {
      const product = priced.get(pick.id);
      return product && !packTooBig(pick.categoryId, product) && !sameType?.test(product.name) ? [{ product, categoryId: pick.categoryId }] : [];
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
      // A second part of a category, then the filler; never the same product or an equivalent of one already suggested,
      // nor a second fluid of a kind (two brake fluids, two engine oils).
      const pairs = await equivalentPairs([...new Set([...chosen, ...rest.map(({ product }) => product)].map(product => product.id))]);
      const twins = (id: string) => pairs.filter(pair => pair.a === id).map(pair => pair.b);
      const taken = new Set(chosen.flatMap(product => [product.id, ...twins(product.id)]));
      for (const { product, categoryId } of rest) {
        if (chosen.length >= limit) break;
        if (taken.has(product.id) || (universalCategories.has(categoryId) && filled.has(categoryId))) continue;
        chosen.push(product); filled.add(categoryId);
        for (const id of [product.id, ...twins(product.id)]) taken.add(id);
      }
    }
    return chosen;
  } catch (error) {
    console.error("Related suggestions failed", error instanceof Error ? error.message : error);
    return [];
  }
}
