import "server-only";
import {db} from "@/lib/db";

export type ReferenceGroup = {brand: string; kind: "oem" | "cross"; codes: string[]};
export const compactPartNumber = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const referenceKey = (brand: string, code: string) => `${compactPartNumber(brand)}|${compactPartNumber(code)}`;
const searchHref = (code: string) => `/katalog?q=${encodeURIComponent(compactPartNumber(code))}&searchBy=code`;
const company = () => process.env.BASBUG_FIRMA_ADI || "BASBUG";
const entriesSql = "SELECT id,brand,code,oem FROM commerce_catalog_entries WHERE source='store' OR company=$1";

// Items whose part number (the code after the supplier prefix) is one of `codes`, read through
// supplier_items_part_key_idx; filtering the catalog view directly normalised every item (~2 s per page).
const partNumberCandidates = async (codes: string[]) => (await db.query<{id: string}>(
  `SELECT id::text FROM supplier_items WHERE part_number_key(substring(code from position(' ' in code)+1))=ANY($1::text[])
   UNION SELECT id::text FROM store_products WHERE part_number_key(substring(code from position(' ' in code)+1))=ANY($1::text[])`,
  [codes])).rows.map(row => row.id);

// Resolves which OEM / cross-reference numbers exist in our own catalog, so the
// product page can link them. Unmatched numbers stay plain text.
export async function getReferenceLinks(productId: string, groups: ReferenceGroup[]) {
  const links = new Map<string, string>();
  const crossBrands = [...new Set(groups.filter(g => g.kind === "cross").map(g => compactPartNumber(g.brand)).filter(Boolean))];
  const crossCodes = [...new Set(groups.filter(g => g.kind === "cross").flatMap(g => g.codes.map(compactPartNumber)).filter(Boolean))];
  const oemCodes = [...new Set(groups.filter(g => g.kind === "oem").flatMap(g => g.codes.map(compactPartNumber)).filter(Boolean))];

  if (crossCodes.length) {
    // Catalog codes are "<supplier prefix> <part number>"; the prefix or the brand
    // name must equal the reference brand before the (costly) normalisation runs.
    const candidates = await partNumberCandidates(crossCodes);
    const rows = candidates.length ? (await db.query<{id: string; brand_key: string; prefix_key: string; part: string}>(
      `SELECT id, part_number_key(brand) brand_key, part_number_key(split_part(code,' ',1)) prefix_key,
        part_number_key(substring(code from position(' ' in code)+1)) part
      FROM (${entriesSql}) catalog
      WHERE catalog.id=ANY($4::uuid[])
        AND (part_number_key(brand)=ANY($2::text[]) OR part_number_key(split_part(code,' ',1))=ANY($2::text[]))
        AND part_number_key(substring(code from position(' ' in code)+1))=ANY($3::text[])`,
      [company(), crossBrands, crossCodes, candidates])).rows : [];
    const matches = new Map<string, Set<string>>();
    for (const row of rows) for (const brandKey of new Set([row.brand_key, row.prefix_key])) {
      const key = `${brandKey}|${row.part}`;
      matches.set(key, (matches.get(key) || new Set()).add(row.id));
    }
    for (const group of groups) if (group.kind === "cross") for (const code of group.codes) {
      const ids = [...(matches.get(referenceKey(group.brand, code)) || [])].filter(id => id !== productId);
      if (ids.length === 1) links.set(referenceKey(group.brand, code), `/urun/${ids[0]}`);
      else if (ids.length > 1) links.set(referenceKey(group.brand, code), searchHref(code));
    }
  }

  if (oemCodes.length) {
    // An OEM number points to every equivalent part, so it opens the catalog search.
    const candidates = (await db.query<{id: string}>(
      `SELECT id::text FROM supplier_items WHERE product_data->>'oe'<>'' AND part_number_key(product_data->>'oe')=ANY($1::text[])`,
      [oemCodes])).rows.map(row => row.id);
    const rows = candidates.length ? (await db.query<{oem: string}>(
      `SELECT DISTINCT part_number_key(oem) oem FROM (${entriesSql}) catalog
      WHERE catalog.id=ANY($4::uuid[]) AND oem<>'' AND id::text<>$3 AND part_number_key(oem)=ANY($2::text[])`,
      [company(), oemCodes, productId, candidates])).rows : [];
    const found = new Set(rows.map(row => row.oem));
    for (const group of groups) if (group.kind === "oem") for (const code of group.codes)
      if (found.has(compactPartNumber(code))) links.set(referenceKey(group.brand, code), searchHref(code));
  }

  return (brand: string, code: string) => links.get(referenceKey(brand, code));
}
