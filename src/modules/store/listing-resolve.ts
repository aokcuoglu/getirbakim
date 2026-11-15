// Which listing a /katalog, /kategori/<category>[/<make>] or /yedek-parca/<make> request shows (#638). Pure: the
// category list and the make lookup come in, so scripts/test-listing-paths.ts covers the path and 404 rules.
import { parseCatalogQuery, type CatalogQuery } from "./catalog-query";
import type { SearchParams } from "@/lib/search-params";
import type { StoreCategory } from "./category-tree";
import type { VehicleBrand } from "./vehicle-catalog";

export type Listing = { query: CatalogQuery; category?: StoreCategory; make?: VehicleBrand };

/**
 * The path segments win over query parameters of the same name. A segment that is not a valid slug (upper case,
 * spaces) or names no category or make gives null (a 404), not an unfiltered catalog.
 */
export async function resolveListing(
  { category, make, search }: { category?: string; make?: string; search: SearchParams },
  { categories, findMake }: { categories: () => Promise<StoreCategory[]>; findMake: (slug: string) => Promise<VehicleBrand | undefined> },
): Promise<Listing | null> {
  const query = parseCatalogQuery({ ...search, category, make });
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
  return { query, category: found, make: brand };
}
