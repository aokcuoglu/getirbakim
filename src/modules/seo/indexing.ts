/**
 * Which product pages search engines may index (#634). The supplier catalog is open; demo rows and unavailable cards
 * (no supplier sells the product now, #475) stay `noindex,follow`. #641 narrows this to products with enough content.
 *
 * The product sitemap selects the same rows in SQL (src/modules/seo/sitemap.server.ts); scripts/test-sitemap.ts keeps
 * the two in step.
 */
export const productIndexPolicy = { supplierCatalog: true, unavailable: false } as const;

export function productIndexable(product: { supplier: string; source: "store" | "supplier"; unavailable?: boolean }): boolean {
  if (product.supplier === "demo") return false;
  if (product.unavailable) return productIndexPolicy.unavailable;
  return product.source === "supplier" ? productIndexPolicy.supplierCatalog : true;
}
