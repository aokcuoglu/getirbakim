import "server-only";
import { shownProductName } from "./product-name";
import { getProduct, servicePrice, type CatalogProduct } from "./catalog";
import { getHomeProducts } from "./home";
import { getCatalogProductDetails, getCatalogProductImages } from "./product-enrichment";
import { catalogCardTitle } from "./product-override-display";
import { productPath } from "@/modules/seo/product-path";
import type { PurchasePreview } from "./purchase-types";
import { fillSuggestions } from "./related-rules";
import { offerGroupIds, relatedSuggestions, type RelatedContext } from "./related-suggestions";

const suggestionCount = 3;
// The dialog does not wait longer than this for related parts; a cold cache keeps loading in the background.
const relatedBudgetMs = 250;

/** `work`'s result, or an empty list when it takes longer than `ms` (the work itself is not cancelled). */
export function withinBudget<T>(work: Promise<T[]>, ms: number): Promise<T[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T[]>(resolve => { timer = setTimeout(() => resolve([]), ms); });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export async function purchasePreview(productId: string, quantity: number, discount: number, context: RelatedContext = {}) {
  const [product, related, taken] = await Promise.all([getProduct(productId),
    withinBudget(relatedSuggestions(productId, context, suggestionCount), relatedBudgetMs),
    // Cart lines may hold a secondary offer's id: the fill skips the whole offer group.
    offerGroupIds([productId, ...(context.cartIds ?? [])]).catch(() => [productId, ...(context.cartIds ?? [])])]);
  if (!product?.price_kurus) return null;
  // Parts fitted with the added one first (#704); the newest store products fill the remaining places.
  const suggestions = fillSuggestions(related, related.length < suggestionCount ? await getHomeProducts() : [], new Set(taken), suggestionCount);
  const shown = [product, ...suggestions];
  const [images, details] = await Promise.all([getCatalogProductImages(shown), getCatalogProductDetails(shown)]);
  // `id`: what the suggestion's form adds; a suggestion sells its best offer, whose price it shows.
  const preview = (p: CatalogProduct, count: number, id = p.id): PurchasePreview => ({
    // The store brand and part number (#602); the image lookup above keeps the supplier's code and brand.
    id, href: productPath(p), name: `${shownProductName(p)} ${p.display_brand}`, itemName: catalogCardTitle(p, details.get(p.id)?.partNumber), code: p.display_code, brand: p.display_brand,
    price: servicePrice(p.price_kurus!, discount), quantity: count, maxQuantity: p.max_quantity,
    image: images.get(p.id)?.src ?? null, stockLabel: p.stock_label,
  });
  return { added: preview(product, quantity), suggestions: suggestions.map(p => preview(p, 1, p.offer_id ?? p.id)) };
}
