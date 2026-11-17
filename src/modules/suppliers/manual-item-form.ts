import { z } from "zod";
import { parseDecimalText, parsePanelDecimal } from "./manual-cost";
import type { ManualItemEdit } from "./manual-import";

const priceGroup = z.object({
  list: z.number().positive().refine(value => Number(value.toFixed(4)) === value).nullable(),
  discount: z.number().min(0).max(100).nullable(),
}).refine(value => value.list !== null || value.discount === null);
const stockValue = z.string().regex(/^\d{1,9}$/).transform(Number).nullable();

/**
 * The item page's list price, discount and stock (#842). Only a group that differs from what the form showed (`was_*`)
 * is validated and returned: an untouched value an upload or a CSV set (no decimal limit there) never blocks saving
 * the other fields. Amounts are read strictly (parsePanelDecimal: one separator, no thousands grouping). Emptied = null; with no list price a discount of 0 counts as empty. `invalid`: a changed group fails.
 */
export function readManualPriceEdit(field: (key: string) => string | null): Pick<ManualItemEdit, "pricing" | "stock"> | "invalid" {
  const number = (key: string) => parsePanelDecimal(field(key));
  // A hidden value the form did not produce (tampered) reads as empty, so its group counts as changed.
  // `was_*` is the page's own comma text (panelDecimalText); a form opened before that wrote "1.125" for 1.125, which
  // the strict reading refuses, so it falls back to the plain one.
  const was = (key: string) => {
    const strict = parsePanelDecimal(field(key));
    const value = strict === "invalid" ? parseDecimalText(field(key)) : strict;
    return typeof value === "number" ? value : null;
  };
  const list = number("listPrice");
  const shownList = was("was_listPrice");
  const discount = list === null && number("discount") === 0 ? null : number("discount");
  const shownDiscount = shownList === null ? null : was("was_discount") ?? 0;
  const edit: Pick<ManualItemEdit, "pricing" | "stock"> = {};
  // The fields sent back exactly as shown are untouched, whatever the strict reading would say ("1.125" as written).
  const asShown = (field("listPrice") ?? "") === (field("was_listPrice") ?? "") && (field("discount") ?? "") === (field("was_discount") ?? "");
  if (!asShown && (list !== shownList || (discount ?? 0) !== (shownDiscount ?? 0) || list === null && discount !== null)) {
    const group = priceGroup.safeParse({ list, discount });
    if (!group.success) return "invalid";
    edit.pricing = group.data.list === null ? null : { list: group.data.list, discount: group.data.discount ?? 0 };
  }
  const stock = field("stock")?.replace(/\s/g, "") || null;
  if ((stock ?? "") !== (field("was_stock")?.trim() ?? "")) {
    const parsed = stockValue.safeParse(stock);
    if (!parsed.success) return "invalid";
    edit.stock = parsed.data;
  }
  return edit;
}
