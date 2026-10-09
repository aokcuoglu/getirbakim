import "server-only";
import {db} from "@/lib/db";

export type ReferenceGroup = {brand: string; kind: "oem" | "cross"; codes: string[]};
export const compactPartNumber = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const referenceKey = (brand: string, code: string) => `${compactPartNumber(brand)}|${compactPartNumber(code)}`;
const searchHref = (code: string) => `/katalog?q=${encodeURIComponent(compactPartNumber(code))}&searchBy=code`;
const company = () => process.env.BASBUG_FIRMA_ADI || "BASBUG";
const entriesSql = "SELECT id,brand,code,oem FROM commerce_catalog_entries WHERE source='store' OR company=$1";

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
    const rows = (await db.query<{id: string; brand_key: string; prefix_key: string; part: string}>(
      `SELECT id, regexp_replace(upper(brand),'[^A-Z0-9]','','g') brand_key,
        regexp_replace(upper(split_part(code,' ',1)),'[^A-Z0-9]','','g') prefix_key,
        regexp_replace(upper(substring(code from position(' ' in code)+1)),'[^A-Z0-9]','','g') part
      FROM (${entriesSql}) catalog
      WHERE (regexp_replace(upper(brand),'[^A-Z0-9]','','g')=ANY($2::text[])
        OR regexp_replace(upper(split_part(code,' ',1)),'[^A-Z0-9]','','g')=ANY($2::text[]))
        AND regexp_replace(upper(substring(code from position(' ' in code)+1)),'[^A-Z0-9]','','g')=ANY($3::text[])`,
      [company(), crossBrands, crossCodes])).rows;
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
    const rows = (await db.query<{oem: string}>(
      `SELECT DISTINCT regexp_replace(upper(oem),'[^A-Z0-9]','','g') oem FROM (${entriesSql}) catalog
      WHERE oem<>'' AND id::text<>$3 AND regexp_replace(upper(oem),'[^A-Z0-9]','','g')=ANY($2::text[])`,
      [company(), oemCodes, productId])).rows;
    const found = new Set(rows.map(row => row.oem));
    for (const group of groups) if (group.kind === "oem") for (const code of group.codes)
      if (found.has(compactPartNumber(code))) links.set(referenceKey(group.brand, code), searchHref(code));
  }

  return (brand: string, code: string) => links.get(referenceKey(brand, code));
}
