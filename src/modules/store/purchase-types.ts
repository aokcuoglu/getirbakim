export type PurchasePreview = {
  id: string; /** The product page. */ href: string; name: string; /** The listing card's title, so every analytics event names the product alike. */ itemName: string; code: string; brand: string; price: number;
  quantity: number; maxQuantity: number; image: string | null; stockLabel: string;
};
export type PurchaseState = { error: string | null; added: PurchasePreview | null; suggestions: PurchasePreview[];
  /** Units added by this action; `added.quantity` is the cart's running total. */
  addedQuantity?: number };
