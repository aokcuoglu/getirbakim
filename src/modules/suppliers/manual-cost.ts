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

/**
 * A hand-typed panel amount (#842): digits with at most one separator, where "," and "." both mean the decimal point.
 * Thousands separators are refused rather than guessed ("10,12345" is 10.12345, never 1.012.345); spaces are ignored.
 * Uploads and the CSV keep parseDecimalText, which reads Excel's grouping.
 */
export function parsePanelDecimal(value: string | null | undefined): number | null | "invalid" {
  const text = value?.replace(/\s/g, "");
  if (!text) return null;
  return /^\d+([.,]\d+)?$/.test(text) ? Number(text.replace(",", ".")) : "invalid";
}

/** Shown for a panel amount with more than one separator. */
export const panelDecimalHint = "Binlik ayracı kullanmayın; ondalık için virgül kullanın.";
export const hasGrouping = (value: string) => /[.,].*[.,]/.test(value);
