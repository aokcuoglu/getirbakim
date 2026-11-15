import "server-only";
import { normalizeSearchText, parseSearchQuery, searchTooShort } from "@/modules/search/query";
import type { SearchMode } from "@/modules/search/sql";
import { getStoreCategories } from "./categories";
import { suggestProducts, type VehicleSearchScope } from "./catalog";
import { categoryPath, searchPath } from "@/modules/seo/paths";
import { productPath } from "@/modules/seo/product-path";
import { readableProductName } from "./product-name";

export type SearchSuggestions = {
  categories: { name: string; href: string }[];
  /** Products, or for broad searches product names leading to their search results. */
  products: { name: string; detail: string; href: string }[];
  correctedQuery?: string;
  vehicleScope?: VehicleSearchScope;
};

/** Header type-ahead: categories whose name has every query word as a word prefix, then products. */
export async function searchSuggestions(raw: string, mode: SearchMode): Promise<SearchSuggestions> {
  if (searchTooShort(raw)) return { categories: [], products: [] };
  const [found, categories] = await Promise.all([suggestProducts(raw, mode), mode === "all" ? getStoreCategories() : []]);
  const prefixes = parseSearchQuery(raw).terms.map(term => term.alternatives.filter(a => a.prefix).map(a => a.value));
  // "fren" lists "Fren sistemi" before "Bisiklet frenleri".
  const leading = (category: { name: string }) => Number(prefixes[0]?.some(spelling => normalizeSearchText(category.name).startsWith(spelling)) ?? false);
  const matching = categories.filter(category => {
    const words = normalizeSearchText(category.name).split(" ");
    return prefixes.length > 0 && prefixes.every(spellings => spellings.some(spelling => words.some(word => word.startsWith(spelling))));
  }).sort((a, b) => leading(b) - leading(a) || a.path.length - b.path.length || a.name.localeCompare(b.name, "tr")).slice(0, 4);
  return {
    categories: matching.map(category => ({ name: category.name, href: categoryPath(category.slug) })),
    products: found.products.map(product => product.kind === "product"
      ? { name: readableProductName(product.name), detail: `${product.brand} · ${product.code}`, href: productPath({ id: product.id, name: product.name, display_brand: product.brand, display_code: product.code }) }
      : { name: readableProductName(product.name), detail: `${product.products.toLocaleString("tr-TR")} ürün`, href: searchPath({ q: product.name.toLocaleLowerCase("tr") }) }),
    correctedQuery: found.correctedQuery,
    vehicleScope: found.vehicleScope,
  };
}
