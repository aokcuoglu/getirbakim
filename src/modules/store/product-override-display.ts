/** Store-facing edits of a product (product_overrides, #575); NULL follows the automatic sources. */
export type StoreOverride = {
  name: string | null; description: string | null; seo_title: string | null; seo_description: string | null; category_id: number | null;
};

/** An admin's name beats the enrichment's display name, which beats the supplier's name. */
export function productTitle(override: StoreOverride | null, enrichmentName: string | null | undefined, productName: string) {
  return override?.name || enrichmentName || productName;
}

/** An admin's description beats the enrichment's, which beats the supplier's; empty when none says anything. */
export function productDescription(override: StoreOverride | null, enrichmentDescription: string | null | undefined, productDescription: string) {
  return override?.description || enrichmentDescription || productDescription || "";
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

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** shownPartNumber without a leading brand, which a card prints beside it ("BOSCH 0986…" → "0986…"); store brand first. */
export function cardPartNumber(product: { code: string; display_code: string; brand: string; display_brand: string }, automatic: string) {
  const number = shownPartNumber(product, automatic);
  for (const brand of new Set([product.display_brand, product.brand])) {
    const prefix = new RegExp(`^${escapeRegExp(brand)}\\s+`, "i");
    if (prefix.test(number)) return number.replace(prefix, "");
  }
  return number;
}

/** The title a listing card prints: the supplier's name in title case, the store brand and the part number. */
export function catalogCardTitle(product: { name: string; code: string; display_code: string; brand: string; display_brand: string }, partNumber?: string) {
  const name = product.name.toLowerCase().replace(/\bon\b/g, "ön").split(" ").map(word => word.charAt(0).toLocaleUpperCase("tr") + word.slice(1)).join(" ");
  return `${name} ${product.display_brand} ${cardPartNumber(product, partNumber ?? product.code)}`;
}
