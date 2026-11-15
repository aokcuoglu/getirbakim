import "server-only";
import { getProduct, servicePrice, type CatalogProduct } from "./catalog";
import { getHomeProducts } from "./home";
import { getCatalogProductDetails, getCatalogProductImages } from "./product-enrichment";
import { catalogCardTitle } from "./product-override-display";
import type { PurchasePreview } from "./purchase-types";

export async function purchasePreview(productId: string, quantity: number, discount: number) {
  const product = await getProduct(productId);
  if (!product?.price_kurus) return null;
  const suggestions = (await getHomeProducts()).filter(p => p.id !== productId && p.available && p.price_kurus).slice(0, 3);
  const shown = [product, ...suggestions];
  const [images, details] = await Promise.all([getCatalogProductImages(shown), getCatalogProductDetails(shown)]);
  const preview = (p: CatalogProduct, count: number): PurchasePreview => ({
    // The store brand and part number (#602); the image lookup above keeps the supplier's code and brand.
    id: p.id, name: `${p.name} ${p.display_brand}`, itemName: catalogCardTitle(p, details.get(p.id)?.partNumber), code: p.display_code, brand: p.display_brand,
    price: servicePrice(p.price_kurus!, discount), quantity: count, maxQuantity: p.max_quantity,
    image: images.get(p.id)?.src ?? null, stockLabel: p.stock_label,
  });
  return { added: preview(product, quantity), suggestions: suggestions.map(p => preview(p, 1)) };
}
