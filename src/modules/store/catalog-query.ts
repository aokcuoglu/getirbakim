import { z } from "zod";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";

const optionalText = (max: number) => z.string().trim().max(max).optional().catch(undefined);
const schema = z.object({
  q: optionalText(120),
  // Category, make and model slugs come from the path (/kategori/{category}[/{make}], /yedek-parca/{make}[/{model}]);
  // /katalog has none.
  category: z.string().max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional().catch(undefined),
  make: z.string().max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional().catch(undefined),
  model: z.string().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional().catch(undefined),
  brand: optionalText(200),
  brands: optionalText(6500),
  attributes: optionalText(18000),
  availability: z.enum(["in_stock","out_of_stock","supplied"]).optional().catch(undefined),
  // Only products linked to the garage vehicle's engine type; the vehicle itself comes from the garage cookie.
  fits: z.enum(["vehicle"]).optional().catch(undefined),
  // Engine oils meeting the garage vehicle's recommended oil: "viscosity", "approval" or both, comma separated.
  oil: z.string().max(40).regex(/^(viscosity|approval)(,(viscosity|approval))?$/).optional().catch(undefined),
  sort: z.enum(["relevance", "newest", "price-asc", "price-desc"]).optional().catch(undefined),
  searchBy: z.enum(["all", "code"]).optional().catch(undefined),
  page: z.string().regex(/^\d+$/).refine(value => Number.isSafeInteger(Number(value))).transform(value => (Number(value) > 1 ? value : undefined)).optional().catch(undefined),
});

// `page`: page 1 is the address without a page parameter (#1250), as `listingUrl` writes it.
// `manufacturer` (a /marka/<slug> page, #660) comes from the route only: it is not in the schema, so a query string never sets it.
export type CatalogQuery = z.infer<typeof schema> & { manufacturer?: string };
export function parseCatalogQuery(params: SearchParams): CatalogQuery {
  return schema.parse(normalizeSearchParams(params));
}

/** A plain listing (no search, filter, sort or page): the only kind search engines index and the one structured data lists. */
export function isIndexableListing(query: CatalogQuery): boolean {
  return !(query.q || query.brand || query.brands || query.attributes || query.availability || query.fits || query.oil || query.sort || query.page);
}
