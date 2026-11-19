import { z } from "zod";

const listPath = "/yonetim/siparisler";
const kept = ["status", "tedarik", "sahip", "sort", "dir", "page"] as const;

/** The order list a form was submitted from. Anything that is not that list (other paths, `//host`, schemes) is refused. */
export const orderListBack = z.string().max(500)
  .refine(value => value === listPath || value.startsWith(`${listPath}?`), "Sipariş listesi dışında bir adres");

/** Back to the same tab, sort and page, with the action's outcome. Only list parameters are carried over. */
export type OrderListOutcome = "saved" | "error" | "refunded" | "refund_failed" | "refund_void_failed" | "refund_unknown" | "refund_busy" | "refund_unavailable"
  | "label_created" | "label_unknown" | "label_failed" | "label_busy" | "label_orphan";
/** `orderNumber` (label_orphan) is carried as the outcome's value so the list can name the order; digits only. */
export function orderListReturn(back: unknown, outcome: OrderListOutcome, orderNumber?: string) {
  const parsed = orderListBack.safeParse(back);
  const source = new URLSearchParams(parsed.success ? parsed.data.slice(listPath.length + 1) : "");
  const query = new URLSearchParams();
  for (const key of kept) {
    const value = source.get(key);
    if (value) query.set(key, value);
  }
  query.set(outcome, orderNumber && /^\d{1,18}$/.test(orderNumber) ? orderNumber : "1");
  return `${listPath}?${query}`;
}
