import { z } from "zod";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";

const optionalText = (max: number) => z.string().trim().max(max).optional().catch(undefined);
const schema = z.object({
  q: optionalText(120),
  category: z.enum(["yedek-parca", "fren", "filtre", "yag", "silecek", "aksesuar"]).optional().catch(undefined),
  brand: optionalText(200),
  sort: z.enum(["newest", "price-asc", "price-desc"]).optional().catch(undefined),
  searchBy: z.enum(["all", "code"]).optional().catch(undefined),
  page: z.string().regex(/^\d+$/).refine(value => Number.isSafeInteger(Number(value))).optional().catch(undefined),
});

export type CatalogQuery = z.infer<typeof schema>;
export function parseCatalogQuery(params: SearchParams): CatalogQuery {
  return schema.parse(normalizeSearchParams(params));
}
