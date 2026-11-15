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
