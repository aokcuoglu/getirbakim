import "server-only";
import { shownProductName } from "./product-name";
import { getProduct, listingIds, servicePrice, type CatalogProduct } from "./catalog";
import { getCatalogProductDetails, getCatalogProductImages } from "./product-enrichment";
import { catalogCardTitle } from "./product-override-display";
import { productPath } from "@/modules/seo/product-path";
import type { PurchasePreview } from "./purchase-types";
import { relatedSuggestions, type RelatedContext } from "./related-suggestions";

const suggestionCount = 3;
// The add-to-cart answer does not wait longer than this for related parts; on a cold cache the dialog loads them after
// opening (loadCartSuggestions), while the first lookup keeps warming the caches in the background.
const relatedBudgetMs = 250;

/** `work`'s result, or `null` when it takes longer than `ms` (the work itself is not cancelled). */
export function withinBudget<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The dialog rows of `products`. A suggestion's `id` is its best offer (what its form adds, at the price it shows); the
 * added product keeps the cart line's id.
 */
async function previews(products: { product: CatalogProduct; quantity: number; offer: boolean }[], discount: number): Promise<PurchasePreview[]> {
  const shown = products.map(row => row.product);
  const [images, details, listing] = await Promise.all([
    getCatalogProductImages(shown), getCatalogProductDetails(shown), listingIds(products.filter(row => !row.offer).map(row => row.product.id)),
  ]);
  return products.map(({ product: p, quantity, offer }) => ({
    // The store brand and part number (#602); the image lookup above keeps the supplier's code and brand.
    id: offer ? p.offer_id ?? p.id : p.id,
    // The listing id the storefront events use (#752); a suggestion's offer id is its own listing's best offer.
    itemId: offer ? p.id : listing.get(p.id) ?? p.id, href: productPath(p), name: `${shownProductName(p)} ${p.display_brand}`, itemName: catalogCardTitle(p, details.get(p.id)?.partNumber), code: p.display_code, brand: p.display_brand,
    price: servicePrice(p.price_kurus!, discount), quantity, maxQuantity: p.max_quantity,
    image: images.get(p.id)?.src ?? null, stockLabel: p.stock_label,
  }));
}

/** Related parts for the dialog (#704), without a time budget: the dialog's follow-up request on a cold cache. */
export async function suggestionPreviews(productId: string, discount: number, context: RelatedContext) {
  const related = await relatedSuggestions(productId, context, suggestionCount);
  return related.length ? previews(related.map(product => ({ product, quantity: 1, offer: true })), discount) : [];
}

/**
 * The add-to-cart dialog: the added product and its related parts (#704). When the related parts miss the time budget,
 * `suggestionsPending` asks the dialog to load them itself; there is no unrelated filler.
 */
export type PreviewOptions = {
  /** How long the answer waits for the related parts; tests set it (a slow runner must not turn them pending). */
  budgetMs?: number;
  /** Receives the related-parts lookup, which may outlive the answer; tests await it before closing the pool. */
  onLookup?: (lookup: Promise<unknown>) => void;
};

export async function purchasePreview(productId: string, quantity: number, discount: number, context: RelatedContext = {}, options: PreviewOptions = {}) {
  const lookup = relatedSuggestions(productId, context, suggestionCount);
  options.onLookup?.(lookup);
  const [product, related] = await Promise.all([getProduct(productId), withinBudget(lookup, options.budgetMs ?? relatedBudgetMs)]);
  if (!product?.price_kurus) return null;
  const [added, ...suggestions] = await previews([{ product, quantity, offer: false }, ...(related ?? []).map(p => ({ product: p, quantity: 1, offer: true }))], discount);
  return { added, suggestions, suggestionsPending: related === null };
}
