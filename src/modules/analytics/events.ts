export type AnalyticsItem = {
  item_id: string; item_name: string; item_brand: string; item_category?: string;
  price: number; quantity: number; index?: number;
};
type ListInput = { listId: string; listName: string; items: AnalyticsItem[] };

/** Kuruş to a two-decimal lira number, as GA4 expects. */
export function kurusToValue(kurus: number) { return Math.round(kurus) / 100; }

/** `priceKurus` is what the visitor sees and pays (VAT included, service discount applied). */
export function catalogItem(
  product: { id: string; name: string; brand: string; category?: string }, priceKurus: number,
  extra: { quantity?: number; index?: number } = {},
): AnalyticsItem {
  return {
    item_id: product.id, item_name: product.name, item_brand: product.brand,
    ...(product.category ? { item_category: product.category } : {}),
    price: kurusToValue(priceKurus), quantity: extra.quantity ?? 1,
    ...(extra.index === undefined ? {} : { index: extra.index }),
  };
}

const total = (items: AnalyticsItem[]) => Math.round(items.reduce((sum, item) => sum + item.price * 100 * item.quantity, 0)) / 100;
const withValue = (items: AnalyticsItem[]) => ({ currency: "TRY", value: total(items), items });

const withList = ({ listId, listName, items }: ListInput) =>
  ({ item_list_id: listId, item_list_name: listName, ...withValue(items) });

export const viewItemList = withList;
export const selectItem = withList;
export const viewItem = (item: AnalyticsItem) => withValue([item]);
export const addToCart = (item: AnalyticsItem, quantity: number) => withValue([{ ...item, quantity }]);
export const search = (term: string) => ({ search_term: term.slice(0, 100) });
export const viewCart = (items: AnalyticsItem[]) => withValue(items);
export const beginCheckout = (items: AnalyticsItem[]) => withValue(items);
/** `quantity` is how many were taken out; the value is that many at the line's price. */
export const removeFromCart = (item: AnalyticsItem, quantity: number) => withValue([{ ...item, quantity }]);
export const addPaymentInfo = (items: AnalyticsItem[]) => ({ ...withValue(items), payment_type: "credit_card" });

/** VAT inside a VAT-included amount, in kuruş: total × rate / (100 + rate). */
export function vatIncludedKurus(totalKurus: number, vatPercent: number) {
  return vatPercent > 0 ? Math.round(totalKurus * vatPercent / (100 + vatPercent)) : 0;
}

/**
 * `value` is the product subtotal the customer paid (VAT included, service discount applied, shipping excluded), the same
 * basis as add_to_cart / view_cart / begin_checkout; `shipping` is reported separately, so value + shipping = order total.
 */
export function purchase(input: { transactionId: string; subtotalKurus: number; shippingKurus: number; taxKurus: number; items: AnalyticsItem[] }) {
  return {
    transaction_id: input.transactionId, currency: "TRY", value: kurusToValue(input.subtotalKurus),
    tax: kurusToValue(input.taxKurus), shipping: kurusToValue(input.shippingKurus), items: input.items,
  };
}
export type PurchaseEvent = ReturnType<typeof purchase>;

/** The page address Google receives: the sign-in `next` parameter would otherwise leak the page behind it (e.g. /yonetim). */
export function cleanPageLocation(url: string) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("next");
    return parsed.toString();
  } catch {
    return url.split("?")[0];
  }
}

/**
 * A cancelled paid order's full refund (#750): the same `value` / `shipping` the purchase reported, so GA4 nets it out.
 * No `items`: GA4 reads a refund without items as the whole transaction.
 */
export function refund(input: { transactionId: string; subtotalKurus: number; shippingKurus: number }) {
  return {
    transaction_id: input.transactionId, currency: "TRY", value: kurusToValue(input.subtotalKurus), shipping: kurusToValue(input.shippingKurus),
  };
}
export type RefundEvent = ReturnType<typeof refund>;
