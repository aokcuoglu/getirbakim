import "server-only";
import type { CartItem } from "@/modules/store/cart";
import { listingIds, servicePrice } from "@/modules/store/catalog";
import { getCatalogProductDetails } from "@/modules/store/product-enrichment";
import { catalogCardTitle } from "@/modules/store/product-override-display";
import { catalogItem, type AnalyticsItem } from "./events";

export type CartAnalyticsLine = {
  /** The cart line's product (the offer): what the quantity and remove forms post. */
  productId: string;
  item: AnalyticsItem;
};

/**
 * Cart lines as GA4 items (#675), named and priced like add_to_cart: the listing card's title, the price the visitor pays.
 * The item id is the listing id of a grouped offer (#752), like every other event; `productId` stays the cart line's.
 * Lines without a price (removed or unpriced products) are left out.
 */
export async function cartAnalyticsItems(items: CartItem[], discount: number): Promise<CartAnalyticsLine[]> {
  const priced = items.filter(item => item.price_kurus);
  if (!priced.length) return [];
  const [details, listing] = await Promise.all([
    getCatalogProductDetails(priced),
    listingIds(priced.map(item => item.id)).catch(error => {
      console.error("Cart analytics listing ids failed", { error: error instanceof Error ? error.message : error });
      return new Map<string, string>();
    }),
  ]);
  return priced.map((item, index) => ({
    productId: item.id,
    item: catalogItem(
      { id: listing.get(item.id) ?? item.id, name: catalogCardTitle(item, details.get(item.id)?.partNumber), brand: item.display_brand },
      servicePrice(item.price_kurus!, discount), { quantity: item.quantity, index },
    ),
  }));
}
