import { catalogSpecifications } from "./catalog-filters";

/** One admin decision about a technical specification of a product (db/product-override-specs.sql, #603). */
export type SpecOverride = { action: "set" | "hide"; key: string; value: string | null };

/**
 * The specifications the store shows: the automatic (enrichment) rows with the admin's decisions applied. A hidden key
 * loses all its rows; a set key keeps its place with the admin's value (several automatic rows of the key become one);
 * a set key the enrichment does not give is appended, in the order the admin added them.
 */
export function applySpecOverrides(automatic: [string, string][], overrides: SpecOverride[]): [string, string][] {
  if (!overrides.length) return automatic;
  const decided = new Map(overrides.map(override => [override.key, override]));
  const placed = new Set<string>();
  const shown: [string, string][] = [];
  for (const [key, value] of automatic) {
    const override = decided.get(key);
    if (!override) { shown.push([key, value]); continue; }
    if (override.action === "hide" || override.value === null || placed.has(key)) continue;
    placed.add(key);
    shown.push([key, override.value]);
  }
  for (const override of overrides) if (override.action === "set" && override.value !== null && !placed.has(override.key)) {
    placed.add(override.key);
    shown.push([override.key, override.value]);
  }
  return shown;
}

/**
 * Rows with the same label become one (#712): translated enrichment keys ("Manufacturer" → "Üretici") can meet the rows
 * the page adds itself. The first row keeps its place; a different value of the same label is appended, ", "-joined.
 */
export function mergeSpecificationRows(rows: [string, string][]): [string, string][] {
  const merged = new Map<string, string[]>();
  for (const [label, value] of rows) {
    const values = merged.get(label) ?? [];
    const text = value.trim();
    if (text && !values.some(known => known.toLowerCase() === text.toLowerCase())) values.push(text);
    merged.set(label, values);
  }
  return [...merged].filter(([, values]) => values.length).map(([label, values]): [string, string] => [label, values.join(", ")]);
}

/**
 * The enrichment rows the product page may show (#712): the page names its own maker, part number and barcode, so the
 * enrichment's Manufacturer, Manufacturer Part Number (a donor's may differ) and, with an own barcode, EAN rows are dropped;
 * a non-exact match also loses Brand class and Trade numbers, exactly like the catalog cards.
 */
export function pageSpecifications(specifications: [string, string][], exactPart: boolean, ownEan: boolean): [string, string][] {
  return catalogSpecifications(specifications, exactPart)
    .filter(([key]) => key !== "Manufacturer" && key !== "Manufacturer Part Number" && !(ownEan && key === "EAN"));
}
