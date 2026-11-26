import "server-only";
import { normalizeSearchText, parseSearchQuery, searchTooShort } from "@/modules/search/query";
import type { SearchMode } from "@/modules/search/sql";
import { getStoreCategories } from "./categories";
import { suggestProducts, type VehicleSearchScope } from "./catalog";
import { categoryPath } from "@/modules/seo/paths";
import { productPath } from "@/modules/seo/product-path";
import { shownProductName } from "./product-name";
import { mergeNameSuggestions } from "./name-suggestions";

export type SearchSuggestions = {
  categories: { name: string; href: string }[];
  /** Products, or for broad searches product names leading to their search results. */
  products: { name: string; detail: string; href: string }[];
  correctedQuery?: string;
  vehicleScope?: VehicleSearchScope;
};

/**
 * Header type-ahead: categories whose name has every query word as a word prefix, then products. `signal` (the request's)
 * cancels the product reads when the visitor has gone (suggestProducts, #1398).
 */
export async function searchSuggestions(raw: string, mode: SearchMode, { signal }: { signal?: AbortSignal } = {}): Promise<SearchSuggestions> {
  if (searchTooShort(raw)) return { categories: [], products: [] };
  const [found, categories] = await Promise.all([suggestProducts(raw, mode, undefined, { signal }), mode === "all" ? getStoreCategories() : []]);
  const prefixes = parseSearchQuery(raw).terms.map(term => term.alternatives.filter(a => a.prefix).map(a => a.value));
  // "fren" lists "Fren sistemi" before "Bisiklet frenleri".
  const leading = (category: { name: string }) => Number(prefixes[0]?.some(spelling => normalizeSearchText(category.name).startsWith(spelling)) ?? false);
  const matching = categories.filter(category => {
    const words = normalizeSearchText(category.name).split(" ");
    // A multi-word spelling ("sogutma sivi") needs each of its words.
    return prefixes.length > 0 && prefixes.every(spellings => spellings.some(spelling => spelling.split(" ").every(part => words.some(word => word.startsWith(part)))));
  }).sort((a, b) => leading(b) - leading(a) || a.path.length - b.path.length || a.name.localeCompare(b.name, "tr")).slice(0, 4);
  return {
    categories: matching.map(category => ({ name: category.name, href: categoryPath(category.slug) })),
    products: suggestedProducts(found.products),
    correctedQuery: found.correctedQuery,
    vehicleScope: found.vehicleScope,
  };
}

type Found = Awaited<ReturnType<typeof suggestProducts>>["products"];

/** Products as suggestions after the name suggestions (mergeNameSuggestions). */
function suggestedProducts(found: Found): SearchSuggestions["products"] {
  const names = mergeNameSuggestions(found.flatMap(item => (item.kind === "name" ? [item] : [])), 6);
  const products = found.flatMap(item => (item.kind === "product" ? [item] : [])).map(product => ({
    name: shownProductName(product),
    detail: `${product.brand} · ${product.code}`,
    href: productPath({ id: product.id, name: product.name, name_overridden: product.name_overridden, display_brand: product.brand, display_code: product.code }),
  }));
  return [...names, ...products].slice(0, 6);
}
