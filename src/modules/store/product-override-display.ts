import { foldText, shownProductName } from "./product-name";

/** Store-facing edits of a product (product_overrides, #575); NULL follows the automatic sources. */
export type StoreOverride = {
  name: string | null; description: string | null; seo_title: string | null; seo_description: string | null; category_id: number | null;
  /** The intro paragraph under the product page title (#697); admin-only, no automatic source. */
  short_description: string | null;
};

/** An admin's name beats the enrichment's display name, which beats the supplier's name. */
export function productTitle(override: StoreOverride | null, enrichmentName: string | null | undefined, productName: string) {
  return override?.name || enrichmentName || productName;
}

/** An admin's description beats the enrichment's, which beats the supplier's; empty when none says anything. */
export function productDescription(override: StoreOverride | null, enrichmentDescription: string | null | undefined, productDescription: string) {
  return override?.description || enrichmentDescription || productDescription || "";
}

/**
 * The text the meta description template is built from (#697): an admin's short description, else `description`
 * (the shown long description). seo_description still wins over both through productMeta.
 */
export function productSeoText(override: StoreOverride | null, description: string) {
  return override?.short_description || description;
}

/** Page title and meta description: the admin's SEO fields when set, else the automatic text. */
export function productMeta(override: StoreOverride | null, automatic: { title: string; description: string }) {
  return { title: override?.seo_title || automatic.title, description: override?.seo_description || automatic.description };
}

/**
 * The manufacturer part number the store prints (#602): an admin's number (display_code differs from the supplier code)
 * as entered, else `automatic` (the enrichment's exact-match spelling or the supplier code).
 */
export function shownPartNumber(product: { code: string; display_code: string }, automatic: string) {
  return product.display_code !== product.code ? product.display_code : automatic;
}

/**
 * A part number without the brand it is written with ("SNR 3TM-6312" → "3TM-6312"). The prefix may be the full brand label,
 * the raw brand of the row or the first word of either ("SNR-AV" → "SNR"), compared folded and followed by whitespace only (a hyphen belongs to the number: "PSA-E 1617", "CDF-142V");
 * the longest match wins and a number that would end up empty is returned as is (#702).
 */
export function withoutBrandPrefix(number: string, brands: string[]): string {
  const candidates = brands.flatMap(brand => [brand.trim(), brand.trim().split(/[\s-]+/)[0]]).filter(Boolean).sort((a, b) => b.length - a.length);
  const folded = foldText(number);
  for (const brand of candidates) {
    const key = foldText(brand);
    if (folded.startsWith(key) && /^\s/.test(folded.slice(key.length)) && number.length === folded.length) {
      const rest = number.slice(key.length).replace(/^[\s-]+/, "");
      if (rest) return rest;
    }
  }
  return number;
}

/** shownPartNumber without a leading brand, which a card prints beside it ("BOSCH 0986…" → "0986…"); store brand first. */
export function cardPartNumber(product: { code: string; display_code: string; brand: string; display_brand: string }, automatic: string) {
  return withoutBrandPrefix(shownPartNumber(product, automatic), [product.display_brand, product.brand]);
}

/** The title a listing card prints: the shown name (an admin's as written, the supplier's readable, #659/#686), the store brand and the part number. */
export function catalogCardTitle(product: { name: string; name_overridden: boolean; code: string; display_code: string; brand: string; display_brand: string }, partNumber?: string) {
  return `${shownProductName(product)} ${product.display_brand} ${cardPartNumber(product, partNumber ?? product.code)}`;
}
