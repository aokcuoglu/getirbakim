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
