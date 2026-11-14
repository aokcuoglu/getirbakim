import { z } from "zod";

const listPath = "/yonetim/siparisler";
const kept = ["status", "sort", "dir", "page"] as const;

/** The order list a form was submitted from. Anything that is not that list (other paths, `//host`, schemes) is refused. */
export const orderListBack = z.string().max(500)
  .refine(value => value === listPath || value.startsWith(`${listPath}?`), "Sipariş listesi dışında bir adres");

/** Back to the same tab, sort and page, with the action's outcome. Only list parameters are carried over. */
export function orderListReturn(back: unknown, outcome: "saved" | "error") {
  const parsed = orderListBack.safeParse(back);
  const source = new URLSearchParams(parsed.success ? parsed.data.slice(listPath.length + 1) : "");
  const query = new URLSearchParams();
  for (const key of kept) {
    const value = source.get(key);
    if (value) query.set(key, value);
  }
  query.set(outcome, "1");
  return `${listPath}?${query}`;
}
