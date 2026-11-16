import { fold, type ManualIssue } from "./manual-template";

// Bulk price/stock CSV of one manual list (#832): the admin downloads the list, edits list price, discount, markup and
// stock in Excel and uploads it back. Kept free of server imports like manual-template.ts; the database side is
// manual-bulk.ts. An empty cell changes nothing; "-" in the markup column returns the product to the global rate.
export const manualBulkColumns = [
  { key: "brand", header: "Marka" },
  { key: "code", header: "Stok Kodu" },
  { key: "listPrice", header: "Liste Fiyatı" },
  { key: "discount", header: "İskonto Oranı" },
  { key: "markup", header: "Kârlılık Oranı" },
  { key: "stock", header: "Stok Adedi" },
] as const;
export type ManualBulkColumnKey = (typeof manualBulkColumns)[number]["key"];

export type ManualBulkRow = {
  row: number; brand: string; code: string; listPrice: number | null; discount: number | null;
  markup: number | "reset" | null; stock: number | null;
};
/** One list item as the diff sees it: list/discount from price_data (old rows: list = nf, discount 0), markup per product. */
export type ManualBulkCurrent = {
  id: string; code: string; brand: string; list: number | null; discount: number; markup: number | null; stock: number | null;
  cost: number | null; filePrice: number | null; fileStock: number | null; fixedPrice: boolean;
};
export type ManualBulkChange = {
  id: string; row: number; code: string; brand: string;
  listPrice?: [number | null, number]; discount?: [number, number]; cost?: [number | null, number];
  markup?: [number | null, number | null]; stock?: [number | null, number];
};
export type ManualBulkDiff = { changes: ManualBulkChange[]; unchanged: number; issues: ManualIssue[] };

const maxRows = 20000;

/** Cost (KDV hariç alış) of a list price less a discount percent, rounded to 4 decimals. */
export function manualCost(list: number, discount: number) {
  return Math.round(list * (100 - discount) * 100) / 10000;
}

/** UTF-8 (with or without BOM), UTF-16LE with BOM (Excel "Unicode text"), else Windows Turkish (Excel's TR "CSV"). */
export function decodeCsv(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1254").decode(bytes);
  }
}

/** RFC 4180 (quoted fields, "" escapes, CRLF or LF); the delimiter (; , or tab) is the one the header line uses most. */
export function parseCsv(text: string): { delimiter: string; rows: string[][] } {
  const body = text.replace(/^﻿/, "");
  const header = body.split(/\r?\n/, 1)[0] ?? "";
  const counts = [";", ",", "\t"].map(symbol => [symbol, header.split(symbol).length - 1] as const);
  const delimiter = counts.reduce((best, entry) => entry[1] > best[1] ? entry : best, counts[0])[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (quoted) {
      if (char !== "\"") field += char;
      else if (body[index + 1] === "\"") { field += "\""; index++; }
      else quoted = false;
      continue;
    }
    // A quote opens a quoted field only at its start; elsewhere (="00123") it is text, as Excel reads it.
    if (char === "\"" && !field) { quoted = true; started = true; }
    else if (char === delimiter) { row.push(field); field = ""; started = false; }
    else if (char === "\r" || char === "\n") {
      if (char === "\r" && body[index + 1] === "\n") index++;
      row.push(field); rows.push(row); row = []; field = ""; started = false;
    } else { field += char; started = true; }
  }
  if (field || started || row.length) { row.push(field); rows.push(row); }
  return { delimiter, rows };
}

/**
 * A number cell. With "," decimals (";" or tab delimiter, Turkish Excel) "," is the decimal mark and "." groups thousands ("1.234,56");
 * a dot that does not group threes ("1234.56") or follows a lone zero ("0.250") is still read as a decimal. With the "," delimiter "." is the decimal mark.
 * %, TL, ₺ and spaces are dropped. Empty → null; anything else → "invalid".
 */
export function parseBulkNumber(text: string, decimal: "," | "."): number | null | "invalid" {
  const value = text.replace(/[\s %₺]|TL/gi, "");
  if (!value) return null;
  let normalized: string;
  if (decimal === ",") {
    if (value.includes(",")) {
      if (!/^-?(\d{1,3}(\.\d{3})+|\d+),\d+$/.test(value)) return "invalid";
      normalized = value.replace(/\./g, "").replace(",", ".");
    } else if (/^-?\d{1,3}(\.\d{3})+$/.test(value) && !/^-?0\./.test(value)) normalized = value.replace(/\./g, "");
    else normalized = value;
  } else normalized = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(value) ? value.replace(/,/g, "") : value;
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : "invalid";
}

const headerKey = (value: string) => fold(value).replace(/ı/g, "i");
const decimals = (value: number) => {
  const text = String(value);
  return text.includes("e") ? 99 : (text.split(".")[1] ?? "").length;
};
const columnHeader = (key: ManualBulkColumnKey) => manualBulkColumns.find(column => column.key === key)!.header;

export function parseManualBulkCsv(bytes: Uint8Array): { rows: ManualBulkRow[]; issues: ManualIssue[] } {
  const { delimiter, rows: lines } = parseCsv(decodeCsv(bytes));
  const issues: ManualIssue[] = [];
  const rows: ManualBulkRow[] = [];
  const fail = (message: string) => ({ rows, issues: [...issues, { sheet: "", row: null, code: null, field: null, level: "error" as const, message }] });
  const header = lines[0];
  if (!header || header.every(cell => !cell.trim())) return fail("Dosya boş");
  const columns = new Map<ManualBulkColumnKey, number>();
  header.forEach((cell, index) => {
    const column = manualBulkColumns.find(entry => headerKey(entry.header) === headerKey(cell));
    if (column && !columns.has(column.key)) columns.set(column.key, index);
  });
  const missing = (["brand", "code"] as const).filter(key => !columns.has(key)).map(columnHeader);
  if (missing.length) return fail(`Zorunlu sütun yok: ${missing.join(", ")}`);
  // Excel's Turkish "CSV" uses ";" and its "Unicode text" tabs, both with "," decimals; a "," file is the plain format.
  const decimal = delimiter === "," ? "." : ",";
  let count = 0;
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index];
    if (line.every(cell => !cell.trim())) continue;
    const row = index + 1;
    if (count++ >= maxRows) {
      issues.push({ sheet: "", row, code: null, field: null, level: "error", message: `Bir dosyada en fazla ${maxRows.toLocaleString("tr-TR")} satır olabilir` });
      break;
    }
    const cell = (key: ManualBulkColumnKey) => columns.has(key) ? (line[columns.get(key)!] ?? "").trim() : "";
    const code = cell("code").replace(/^="(.*)"$/, "$1").trim();
    // The export writes a brand starting with = + - @ as '… so Excel keeps it text.
    const brand = cell("brand").replace(/^'(?=[=+\-@])/, "");
    const errors: ManualIssue[] = [];
    const issue = (field: ManualBulkColumnKey, message: string) => errors.push({ sheet: "", row, code: code || null, field, level: "error", message });
    if (!code) issue("code", "Stok Kodu boş");
    if (!brand) issue("brand", "Marka boş");
    const number = (key: ManualBulkColumnKey) => {
      const value = parseBulkNumber(cell(key), decimal);
      if (value === "invalid") { issue(key, `${columnHeader(key)} sayı değil: "${cell(key)}"`); return null; }
      return value;
    };
    const listPrice = number("listPrice");
    if (listPrice !== null && listPrice <= 0) issue("listPrice", "Liste Fiyatı sıfırdan büyük olmalı");
    const discount = number("discount");
    if (discount !== null && (discount < 0 || discount > 100)) issue("discount", `İskonto Oranı 0–100 arasında olmalı: ${cell("discount")}`);
    const markup = cell("markup") === "-" ? "reset" as const : number("markup");
    if (typeof markup === "number" && (markup < 0 || markup > 1000 || decimals(markup) > 2))
      issue("markup", `Kârlılık Oranı 0–1.000 arasında, en fazla iki ondalıklı olmalı: ${cell("markup")}`);
    const stock = number("stock");
    if (stock !== null && (stock < 0 || !Number.isInteger(stock))) issue("stock", `Stok Adedi sıfır ya da pozitif tam sayı olmalı: ${cell("stock")}`);
    issues.push(...errors);
    if (!errors.length) rows.push({ row, brand, code, listPrice, discount, markup, stock });
  }
  if (!rows.length && !issues.length) return fail("Dosyada ürün satırı yok");
  return { rows, issues };
}

const stripZeros = (code: string) => code.replace(/^0+(?=.)/, "");

/** What confirming the rows would change, checked against the list's current items (every presence state). */
export function diffManualBulk(rows: ManualBulkRow[], current: ManualBulkCurrent[]): ManualBulkDiff {
  const byCode = new Map(current.map(item => [item.code, item]));
  const byStripped = new Map<string, ManualBulkCurrent[]>();
  for (const item of current) byStripped.set(stripZeros(item.code), [...byStripped.get(stripZeros(item.code)) ?? [], item]);
  const seen = new Map<string, number>();
  const changes: ManualBulkChange[] = [];
  const issues: ManualIssue[] = [];
  let unchanged = 0;
  for (const row of rows) {
    const issue = (field: ManualBulkColumnKey | null, level: ManualIssue["level"], message: string) =>
      issues.push({ sheet: "", row: row.row, code: row.code, field, level, message });
    // Excel drops a code's leading zeros when it opens the CSV: one item whose code differs only by them is the same item.
    const candidates = byStripped.get(stripZeros(row.code)) ?? [];
    const exact = byCode.get(row.code);
    const item = exact ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (!item) { issue("code", "error", "Marka + Stok Kodu bu listede yok"); continue; }
    if (exact && candidates.length > 1)
      issue("code", "warning", `Listede baştaki sıfırlar dışında aynı olan başka kod var (${candidates.filter(entry => entry !== exact).map(entry => entry.code).join(", ")}); Excel sıfırları silmediyse doğru ürün güncellenir`);
    if (headerKey(item.brand) !== headerKey(row.brand)) { issue("brand", "error", `Marka bu ürünle uyuşmuyor (listede: ${item.brand})`); continue; }
    if (seen.has(item.id)) { issue("code", "error", `Ürün dosyada tekrar ediyor (ilk: satır ${seen.get(item.id)})`); continue; }
    seen.set(item.id, row.row);
    const list = row.listPrice ?? item.list;
    const discount = row.discount ?? item.discount;
    if (row.discount !== null && list === null) { issue("discount", "error", "İskonto girildi ama ürünün liste fiyatı yok; Liste Fiyatı da girin"); continue; }
    const change: ManualBulkChange = { id: item.id, row: row.row, code: item.code, brand: item.brand };
    if (list !== null && (list !== item.list || discount !== item.discount)) {
      if (list !== item.list && decimals(list) > 4) { issue("listPrice", "error", "Liste Fiyatı en fazla dört ondalıklı olabilir"); continue; }
      if (list !== item.list) change.listPrice = [item.list, list];
      if (discount !== item.discount) change.discount = [item.discount, discount];
      const cost = manualCost(list, discount);
      if (cost !== item.cost) change.cost = [item.cost, cost];
      if (item.list && list !== item.list && (list / item.list > 10 || item.list / list > 10))
        issue("listPrice", "warning", `Liste fiyatı 10 kattan fazla değişiyor: ${item.list} → ${list}`);
      if (discount === 100) issue("discount", "warning", "İskonto %100: maliyet 0 olur, ürün satışa kapanır");
      if (item.fixedPrice && change.cost) issue("listPrice", "warning", "Üründe panelden girilmiş sabit ya da kampanya fiyatı var; maliyet değişir, mağaza fiyatı değişmez");
    }
    const markup = row.markup === "reset" ? null : row.markup;
    if (row.markup !== null && markup !== item.markup) change.markup = [item.markup, markup];
    if (row.stock !== null && row.stock !== item.stock) change.stock = [item.stock, row.stock];
    if (change.listPrice || change.discount || change.cost || change.markup || change.stock) changes.push(change);
    else unchanged++;
  }
  return { changes, unchanged, issues };
}

export type ManualBulkExportRow = { brand: string; code: string; list: number | null; discount: number | null; markup: number | null; stock: number | null };

const csvNumber = (value: number | null) => {
  if (value === null) return "";
  const text = String(value).includes("e") ? value.toFixed(10).replace(/\.?0+$/, "") : String(value);
  return text.replace(".", ",");
};
const csvText = (value: string) => /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, "\"\"")}"` : value;
// Excel would read 00123 as 123, long numeric codes as 1,23E+12, 1E5 as 100000 and 1-2 or 3.4.2020 as dates: such
// codes are written as a text formula.
const csvCode = (code: string) => /^0\d+$|^\d{12,}$|^\d+[eE]\d+$|^\d{1,4}[-/.]\d{1,2}([-/.]\d{1,4})?$/.test(code) ? `="${code}"` : csvText(code);
// A brand starting with = + - @ would be a formula in Excel.
const csvBrand = (brand: string) => csvText(/^[=+\-@]/.test(brand) ? `'${brand}` : brand);

/** The list as Excel (Turkish) opens it: UTF-8 BOM, ";" delimiter, "," decimals, CRLF. */
export function buildManualBulkCsv(items: ManualBulkExportRow[]) {
  const lines = [manualBulkColumns.map(column => column.header).join(";"), ...items.map(item =>
    [csvBrand(item.brand), csvCode(item.code), csvNumber(item.list), csvNumber(item.list === null ? null : item.discount), csvNumber(item.markup), csvNumber(item.stock)].join(";"))];
  return `﻿${lines.join("\r\n")}\r\n`;
}
