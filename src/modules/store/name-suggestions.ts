// Product-name suggestions of the header type-ahead (#962). Pure: the header search tests import it.
import { searchPath } from "@/modules/seo/paths";
import { foldText, readableProductName } from "./product-name";
import { isEnglishTypeName, turkishTypeName } from "./suggestion-names";

export type NameSuggestion = { name: string; detail: string; href: string };

/**
 * Name rows as suggestions: a Turkish label, English names without a translation dropped, rows with one label ("Fren
 * Hortumu" and its English BRAKE HOSE) merged with their product counts added, most products first, at most `limit`.
 * A dictionary label links to its Turkish query, which finds both spellings (#953); other names keep their own query.
 */
export function mergeNameSuggestions(rows: { name: string; products: number }[], limit: number): NameSuggestion[] {
  const merged = new Map<string, { label: string; products: number; href: string }>();
  for (const row of rows) {
    const translated = turkishTypeName(row.name);
    const label = translated ?? (isEnglishTypeName(row.name) ? null : readableProductName(row.name));
    if (label === null) continue;
    const key = foldText(label);
    const known = merged.get(key);
    const href = searchPath({ q: (translated ? label : row.name).toLocaleLowerCase("tr") });
    if (!known) merged.set(key, { label, products: row.products, href });
    else {
      known.products += row.products;
      if (translated) known.href = href;
    }
  }
  return [...merged.values()]
    .sort((a, b) => b.products - a.products)
    .slice(0, limit)
    .map(row => ({ name: row.label, detail: `${row.products.toLocaleString("tr-TR")} ürün`, href: row.href }));
}
