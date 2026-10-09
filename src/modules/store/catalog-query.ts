import { z } from "zod";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";

const optionalText = (max: number) => z.string().trim().max(max).optional().catch(undefined);
const schema = z.object({
  q: optionalText(120),
  category: z.string().max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional().catch(undefined),
  // Vehicle make slug; set from the /car-parts/{slug} path, not the query string.
  make: z.string().max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional().catch(undefined),
  brand: optionalText(200),
  brands: optionalText(6500),
  attributes: optionalText(18000),
  availability: z.enum(["in_stock","out_of_stock"]).optional().catch(undefined),
  sort: z.enum(["newest", "price-asc", "price-desc"]).optional().catch(undefined),
  searchBy: z.enum(["all", "code"]).optional().catch(undefined),
  page: z.string().regex(/^\d+$/).refine(value => Number.isSafeInteger(Number(value))).optional().catch(undefined),
});

export type CatalogQuery = z.infer<typeof schema>;
export function parseCatalogQuery(params: SearchParams): CatalogQuery {
  return schema.parse(normalizeSearchParams(params));
}
