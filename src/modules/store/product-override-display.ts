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
