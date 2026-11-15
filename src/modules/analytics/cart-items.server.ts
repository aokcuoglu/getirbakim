import "server-only";
import type { CartItem } from "@/modules/store/cart";
import { servicePrice } from "@/modules/store/catalog";
import { getCatalogProductDetails } from "@/modules/store/product-enrichment";
import { catalogCardTitle } from "@/modules/store/product-override-display";
import { catalogItem, type AnalyticsItem } from "./events";

/**
 * Cart lines as GA4 items (#675), named and priced like add_to_cart: the listing card's title, the price the visitor pays.
 * Lines without a price (removed or unpriced products) are left out.
 */
export async function cartAnalyticsItems(items: CartItem[], discount: number): Promise<AnalyticsItem[]> {
  const priced = items.filter(item => item.price_kurus);
  if (!priced.length) return [];
  const details = await getCatalogProductDetails(priced);
  return priced.map((item, index) => catalogItem(
    { id: item.id, name: catalogCardTitle(item, details.get(item.id)?.partNumber), brand: item.display_brand },
    servicePrice(item.price_kurus!, discount), { quantity: item.quantity, index },
  ));
}
