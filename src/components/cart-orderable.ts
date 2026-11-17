import type { CartItem } from "@/modules/store/cart";

/** Whether every cart line can be ordered; one rule for the cart page, its action bar and the order summary (#877). */
export function cartOrderable(items: Pick<CartItem, "available" | "price_kurus" | "quantity" | "max_quantity">[]): boolean {
  return items.every(p => Boolean(p.available && p.price_kurus && p.quantity <= p.max_quantity));
}
