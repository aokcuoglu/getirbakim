// Shared by the server modules and the item page's live cost preview (#842): kept free of imports, since
// manual-template.ts pulls ExcelJS in, which must not reach the client bundle.

/** Cost (KDV hariç alış) of a list price less a discount percent, rounded to 4 decimals. */
export function manualCost(list: number, discount: number) {
  return Math.round(list * (100 - discount) * 100) / 10000;
}

/** Turkish ("1.234,56") and plain ("1234.56") decimals written as text; "TL", "₺" and spaces are ignored. */
export function parseDecimalText(value: string | null | undefined): number | null | "invalid" {
  const text = value?.replace(/\s|TL|₺/gi, "");
  if (!text) return null;
  const normalized = /,\d{1,4}$/.test(text) ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  return /^\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : "invalid";
}
