import "server-only";
import { shownProductName } from "./product-name";
import { getProduct, servicePrice, type CatalogProduct } from "./catalog";
import { getHomeProducts } from "./home";
import { getCatalogProductDetails, getCatalogProductImages } from "./product-enrichment";
import { catalogCardTitle } from "./product-override-display";
import { productPath } from "@/modules/seo/product-path";
import type { PurchasePreview } from "./purchase-types";
import { relatedSuggestions, type RelatedContext } from "./related-suggestions";

const suggestionCount = 3;
// The dialog does not wait longer than this for related parts; a cold cache keeps loading in the background.
const relatedBudgetMs = 250;

function withinBudget<T>(work: Promise<T[]>, ms: number): Promise<T[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T[]>(resolve => { timer = setTimeout(() => resolve([]), ms); });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export async function purchasePreview(productId: string, quantity: number, discount: number, context: RelatedContext = {}) {
  const [product, related] = await Promise.all([getProduct(productId), withinBudget(relatedSuggestions(productId, context, suggestionCount), relatedBudgetMs)]);
  if (!product?.price_kurus) return null;
  // Parts fitted with the added one first (#704); the newest store products fill the remaining places.
  const taken = new Set([productId, ...(context.cartIds ?? []), ...related.map(p => p.id)]);
  const suggestions = related.length < suggestionCount
    ? [...related, ...(await getHomeProducts()).filter(p => !taken.has(p.id) && p.available && p.price_kurus).slice(0, suggestionCount - related.length)]
    : related;
  const shown = [product, ...suggestions];
  const [images, details] = await Promise.all([getCatalogProductImages(shown), getCatalogProductDetails(shown)]);
  const preview = (p: CatalogProduct, count: number): PurchasePreview => ({
    // The store brand and part number (#602); the image lookup above keeps the supplier's code and brand.
    id: p.id, href: productPath(p), name: `${shownProductName(p)} ${p.display_brand}`, itemName: catalogCardTitle(p, details.get(p.id)?.partNumber), code: p.display_code, brand: p.display_brand,
    price: servicePrice(p.price_kurus!, discount), quantity: count, maxQuantity: p.max_quantity,
    image: images.get(p.id)?.src ?? null, stockLabel: p.stock_label,
  });
  return { added: preview(product, quantity), suggestions: suggestions.map(p => preview(p, 1)) };
}
