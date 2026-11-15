/** One admin-entered reference row as the store reads it (db/product-override-references.sql, #582). */
export type ReferenceOverride = {
  kind: "oem" | "cross" | "ean"; action: "add" | "hide"; brand: string; number: string;
  /** part_number_key() of brand / number, the key referenceKey below computes. */
  brand_key: string; number_key: string;
};
type ReferenceGroups = Record<string, string[]>;

/** Spelling-insensitive key: same as part_number_key() (db/commerce.sql) and compactPartNumber (reference-links.ts). */
const referenceKey = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

function applyKind(groups: ReferenceGroups, kind: "oem" | "cross", overrides: ReferenceOverride[]): ReferenceGroups {
  const hidden = new Set(overrides.filter(row => row.kind === kind && row.action === "hide").map(row => `${row.brand_key}|${row.number_key}`));
  const result: ReferenceGroups = {};
  // Hidden numbers first; a brand left without numbers is dropped.
  for (const [brand, codes] of Object.entries(groups)) {
    const brandKey = referenceKey(brand);
    const kept = codes.filter(code => !hidden.has(`${brandKey}|${referenceKey(code)}`));
    if (kept.length) result[brand] = kept;
  }
  // Then added numbers: into the group of the same brand key, else a new group under the admin's spelling; once per key.
  for (const row of overrides.filter(row => row.kind === kind && row.action === "add")) {
    const brand = Object.keys(result).find(name => referenceKey(name) === row.brand_key) ?? row.brand;
    const codes = result[brand] ?? [];
    if (!codes.some(code => referenceKey(code) === row.number_key)) result[brand] = [...codes, row.number];
  }
  return result;
}

/**
 * The OEM and cross-reference groups a product page shows: the enrichment's, minus the numbers an admin hid, plus the
 * ones an admin added; and the admin's barcodes.
 */
export function applyReferenceOverrides(automatic: { oemNumbers: ReferenceGroups; crossReferences: ReferenceGroups }, overrides: ReferenceOverride[]) {
  const eans: string[] = [];
  for (const row of overrides) if (row.kind === "ean" && row.action === "add" && !eans.some(ean => referenceKey(ean) === row.number_key)) eans.push(row.number_key);
  return { oemNumbers: applyKind(automatic.oemNumbers, "oem", overrides), crossReferences: applyKind(automatic.crossReferences, "cross", overrides), eans };
}

/** schema.org property of a barcode by its length (gtin8 / gtin12 / gtin13 / gtin14). */
export function gtinProperty(ean: string): "gtin8" | "gtin12" | "gtin13" | "gtin14" | null {
  switch (ean.length) {
    case 8: return "gtin8";
    case 12: return "gtin12";
    case 13: return "gtin13";
    case 14: return "gtin14";
    default: return null;
  }
}
