// Which listing a /katalog, /kategori/<category>[/<make>] or /yedek-parca/<make>[/<model>] request shows (#638, #639).
// Pure: the category list and the make and model lookups come in, so scripts/test-listing-paths.ts covers the path
// and 404 rules.
import { parseCatalogQuery, type CatalogQuery } from "./catalog-query";
import type { SearchParams } from "@/lib/search-params";
import type { StoreCategory } from "./category-tree";
import type { VehicleBrand } from "./vehicle-catalog";
import type { VehicleModelGroup } from "./vehicle-model-groups";

export type Listing = { query: CatalogQuery; category?: StoreCategory; make?: VehicleBrand; model?: VehicleModelGroup };

/**
 * The path segments win over query parameters of the same name. A segment that is not a valid slug (upper case,
 * spaces) or names no category, make or model of that make gives null (a 404), not an unfiltered catalog. A model
 * without its make is null too.
 */
export async function resolveListing(
  { category, make, model, search }: { category?: string; make?: string; model?: string; search: SearchParams },
  { categories, findMake, findModel }: {
    categories: () => Promise<StoreCategory[]>;
    findMake: (slug: string) => Promise<VehicleBrand | undefined>;
    findModel: (make: VehicleBrand, slug: string) => Promise<VehicleModelGroup | undefined>;
  },
): Promise<Listing | null> {
  if (model !== undefined && make === undefined) return null;
  const query = parseCatalogQuery({ ...search, category, make, model });
  let found: StoreCategory | undefined;
  if (category !== undefined) {
    if (query.category !== category) return null;
    found = (await categories()).find(node => node.slug === category);
    if (!found) return null;
  }
  let brand: VehicleBrand | undefined;
  if (make !== undefined) {
    if (query.make !== make) return null;
    brand = await findMake(make);
    if (!brand) return null;
  }
  let group: VehicleModelGroup | undefined;
  if (model !== undefined) {
    if (query.model !== model || !brand) return null;
    group = await findModel(brand, model);
    if (!group) return null;
  }
  return { query, category: found, make: brand, model: group };
}
