import "server-only";
import { productPath } from "@/modules/seo/product-path";
import { getDecidedEquivalents, getSetaEquivalents } from "./catalog";
import { getProductEnrichment } from "./product-enrichment";
import { fitmentVersion } from "./product-fitment-sources";
import { applyReferenceOverrides } from "./product-reference-display";
import type { ReferenceRow } from "./product-reference-view";
import { getItemReferences } from "./product-references";
import { getReferenceLinks } from "./reference-links";

type ReferenceGroups = { oemNumbers: Record<string, string[]>; crossReferences: Record<string, string[]> };

/**
 * The rows of a product's "OEM ve muadil numaraları" (#1211, moved from src/app/(store)/urun/[id]/page.tsx): the OEM and
 * cross-reference numbers merged per brand, linked where the store lists the part; the SETA and admin-decided
 * equivalents first in their brand's row; alphabetical by brand. `oemBrands` are the vehicle makers' brands (the OEM
 * numbers'), whose rows the page prints before other brands when it caps the list (initialReferenceView).
 */
export async function productReferenceRows(product: { id: string; supplier: string }, refs: ReferenceGroups): Promise<{ rows: ReferenceRow[]; oemBrands: Set<string> }> {
  const referenceNumbers: Record<string, string[]> = {};
  for (const [brand, codes] of [...Object.entries(refs.crossReferences), ...Object.entries(refs.oemNumbers)]) {
    referenceNumbers[brand] = [...new Set([...(referenceNumbers[brand] || []), ...codes])];
  }
  const references = Object.entries(referenceNumbers).sort(([a], [b]) => a.localeCompare(b));
  const referenceHref = await getReferenceLinks(product.id, [
    ...Object.entries(refs.crossReferences).map(([brand, codes]) => ({ brand, codes, kind: "cross" as const })),
    ...Object.entries(refs.oemNumbers).map(([brand, codes]) => ({ brand, codes, kind: "oem" as const })),
  ]);
  const [seta, decided] = await Promise.all([product.supplier === "seta" ? [] : getSetaEquivalents(product.id), getDecidedEquivalents(product.id)]);
  const referenceRows: [string, { code: string; href?: string | null }[]][] = references.map(([brand, codes]) => [brand, codes.map(code => ({ code, href: referenceHref(brand, code) }))]);
  // Equivalents listed in the store link to their pages, first in their brand's row; a code printed by the
  // enrichment's references as well is shown once.
  const linkEquivalents = (brand: string, items: { href: string | null; code: string }[]) => {
    // Dinamik codes carry the brand's first word ("WAGENBURG 15036003"), printed in the row's label already.
    const prefix = `${brand.split(" ")[0]} `;
    const linked = items.map(item => ({ code: brand !== "SETA" && item.code.startsWith(prefix) ? item.code.slice(prefix.length) : item.code, href: item.href }));
    const existing = referenceRows.findIndex(([name]) => name.toLocaleUpperCase("tr-TR") === brand.toLocaleUpperCase("tr-TR"));
    if (existing >= 0) {
      const [name, codes] = referenceRows[existing];
      referenceRows[existing] = [name, [...linked, ...codes.filter(({ code }) => !linked.some(item => item.code === code))]];
    } else referenceRows.push([brand, linked]);
  };
  // SETA equivalents under the part number the store shows for them (#602).
  if (seta.length > 0) linkEquivalents("SETA", seta.map(item => ({ href: productPath(item), code: item.display_code })));
  const decidedBrands = new Map<string, typeof decided>();
  for (const item of decided.filter(item => !seta.some(row => row.id === item.id))) decidedBrands.set(item.brand, [...(decidedBrands.get(item.brand) || []), item]);
  for (const [brand, items] of decidedBrands) linkEquivalents(brand, items);
  referenceRows.sort(([a], [b]) => a.localeCompare(b));
  return {
    rows: referenceRows.map(([brand, codes]): ReferenceRow => [brand, codes.map(({ code, href }) => href ? [code, href] : code)]),
    oemBrands: new Set(Object.keys(refs.oemNumbers)),
  };
}

/**
 * A product's whole reference list, read like the product page reads it (the enrichment with the admin's decisions,
 * #582), with its version (fitmentVersion): what /api/product-references/[id] answers.
 */
export async function getProductReferenceRows(product: { id: string; code: string; brand: string; supplier: string }): Promise<{ v: string; rows: ReferenceRow[] }> {
  const [enrichment, overrides] = await Promise.all([getProductEnrichment(product), getItemReferences(product.id)]);
  const refs = applyReferenceOverrides({ oemNumbers: enrichment?.oemNumbers ?? {}, crossReferences: enrichment?.crossReferences ?? {} }, overrides);
  // The page builds its view from the same rows (productReferenceRows), so its `?v=` names this answer.
  const { rows } = await productReferenceRows(product, refs);
  return { v: fitmentVersion(rows), rows };
}
