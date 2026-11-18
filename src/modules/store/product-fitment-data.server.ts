import "server-only";
import { getProductEnrichment } from "./product-enrichment";
import { getItemFitments, getItemModelFits } from "./product-fitments";
import { applyFitmentOverrides } from "./product-fitment-display";
import { productFitmentGroups } from "./product-fitment-sources";
import type { FitmentGroup } from "./product-fitment-view";
import { getVehicleBrands } from "./vehicle-catalog.server";
import { getModelPagePaths } from "./vehicle-model-groups.server";

/**
 * Every model group of a product's "Uyumlu araçlar" in the garage-independent order, read like the product page reads
 * them (src/app/(store)/urun/[id]/page.tsx): the enrichment's vehicles with the admin's decisions (#583, #661), readable
 * labels and model page links. `v` is the list's version (fitmentVersion). The description's models are not part of it.
 */
export async function getProductFitmentGroups(product: { id: string; code: string; brand: string }): Promise<{ v: string; groups: FitmentGroup[] }> {
  const [enrichment, overrides, modelFits] = await Promise.all([getProductEnrichment(product), getItemFitments(product.id), getItemModelFits(product.id)]);
  const vehicles = applyFitmentOverrides(enrichment?.vehicles ?? [], overrides);
  if (!vehicles.length) return productFitmentGroups({ vehicles, makeNames: [], modelFits, modelPaths: new Map() });
  const linked = vehicles.flatMap(row => row.modelId && modelFits.has(row.modelId) ? [row.modelId] : []);
  const [brands, modelPaths] = await Promise.all([getVehicleBrands(), linked.length ? getModelPagePaths(linked) : new Map<number, string>()]);
  // The page builds its view from the same input (productPageFitment), so its `?v=` names this answer.
  return productFitmentGroups({ vehicles, makeNames: brands.map(brand => brand.name), modelFits, modelPaths });
}
