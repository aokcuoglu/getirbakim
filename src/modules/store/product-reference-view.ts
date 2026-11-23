// The product page's "OEM ve muadil numaraları" (#1211): the rows in the fewest fields the client component prints. A
// product with hundreds of reference brands ships a capped selection in the page; the whole list loads from
// /api/product-references/[id] on request. Client-safe: no server modules.

/** A number as printed, or with the address of the store page (or search) it links to. */
export type ReferenceCode = string | [code: string, href: string];
/** One brand's numbers; `more` counts the numbers the page left out of this row. */
export type ReferenceRow = [brand: string, codes: ReferenceCode[], more?: number];
/**
 * `rows` are the printed rows (alphabetical), `rowCount` every row of the product; `rest` is the URL of the whole list,
 * set only when the page left rows or numbers out.
 */
export type ReferenceView = { rows: ReferenceRow[]; rowCount: number; rest?: string };

/** Rows printed before "Tüm {n} markayı göster". */
export const referenceInitialRows = 24;
/**
 * Numbers printed per row of a parts brand. A vehicle maker's OEM row is not capped per row (its numbers are the
 * searches people make, #1211), only by `referenceInitialCodes`.
 */
export const referenceRowCodes = 6;
/** Numbers printed in all rows together. */
export const referenceInitialCodes = 72;

const linked = (code: ReferenceCode) => typeof code !== "string";
const isCode = (code: unknown) => typeof code === "string" || (Array.isArray(code) && typeof code[0] === "string" && typeof code[1] === "string");

/** Whether a loaded row has this shape: a brand and its numbers. */
export function isReferenceRow(value: unknown): value is ReferenceRow {
  return Array.isArray(value) && typeof value[0] === "string" && Array.isArray(value[1]) && value[1].every(isCode);
}

/**
 * The view the product page ships. A list within the caps goes out whole. A longer one prints the rows with a store
 * link first, then the vehicle makers' OEM rows (`oemBrands`), then the other brands (alphabetical within each), up to
 * `referenceInitialRows` rows and `referenceInitialCodes` numbers in all; a parts brand's row prints at most
 * `referenceRowCodes` of them, a vehicle maker's row all it can within the total (linked numbers first). The printed rows
 * keep the list's alphabetical order and `more` counts each row's numbers left out.
 */
export function initialReferenceView(rows: readonly ReferenceRow[], oemBrands: ReadonlySet<string>, restUrl: string): ReferenceView {
  const rowCap = (brand: string) => oemBrands.has(brand) ? referenceInitialCodes : referenceRowCodes;
  const codeCount = rows.reduce((sum, [, codes]) => sum + codes.length, 0);
  if (rows.length <= referenceInitialRows && codeCount <= referenceInitialCodes && rows.every(([brand, codes]) => codes.length <= rowCap(brand))) {
    return { rows: [...rows], rowCount: rows.length };
  }
  const tier = ([brand, codes]: ReferenceRow) => codes.some(linked) ? 0 : oemBrands.has(brand) ? 1 : 2;
  // Array sort is stable: rows of one tier keep the list's alphabetical order.
  const ranked = rows.map((row, index) => ({ row, index })).sort((a, b) => tier(a.row) - tier(b.row));
  const picked: { row: ReferenceRow; index: number }[] = [];
  let left = referenceInitialCodes;
  for (const { row: [brand, codes], index } of ranked) {
    if (picked.length === referenceInitialRows || left === 0) break;
    const ordered = [...codes.filter(linked), ...codes.filter(code => !linked(code))];
    const shown = ordered.slice(0, Math.min(rowCap(brand), left));
    left -= shown.length;
    picked.push({ row: shown.length < codes.length ? [brand, shown, codes.length - shown.length] : [brand, codes], index });
  }
  return { rows: picked.sort((a, b) => a.index - b.index).map(({ row }) => row), rowCount: rows.length, rest: restUrl };
}
