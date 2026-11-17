import ExcelJS from "exceljs";
import { type ManualBulkColumnKey } from "./manual-bulk-csv";
import { manualCost, parseDecimalText } from "./manual-cost";

// Fixed xlsx template of manual supplier lists (first list: lubricants). Columns are found by their header text, in any
// order and on any sheet; a sheet without the "Ürün Kodu" header (the category list, notes) is skipped.
// Kept free of server imports: the admin upload, the template download and one-off conversion scripts share it.
export const manualColumns = [
  { key: "code", header: "Ürün Kodu", required: true, width: 18, note: "Listede tekil olmalı. Sayı gibi görünen kodlar metin olarak okunur." },
  { key: "name", header: "Ürün Adı", required: true, width: 52, note: "Mağazada görünen ad. Marka ayrı gösterilir; adın başına yazmayın." },
  { key: "brand", header: "Marka", required: true, width: 16, note: "Üretici markası (MOTUL, CASTROL…)." },
  { key: "category", header: "Kategori", required: true, width: 30, note: "Açılır listeden seçin (Kategoriler sayfası)." },
  { key: "price", header: "Fiyat", required: false, width: 12, note: "KDV hariç alış fiyatı, TL. Liste Fiyatı doluysa maliyet oradan hesaplanır, bu hücre yalnız karşılaştırılır. İkisi de boşsa ürün satışa kapalı listelenir." },
  { key: "listPrice", header: "Liste Fiyatı", required: false, width: 12, note: "KDV hariç liste fiyatı, TL. Doluysa maliyet = Liste Fiyatı × (1 − İskonto Oranı / 100)." },
  { key: "discount", header: "İskonto Oranı", required: false, width: 12, note: "Yüzde, 0–100 (örn. 12,5). Boşsa 0 sayılır; Liste Fiyatı olmadan girilemez." },
  { key: "stock", header: "Stok", required: false, width: 10, note: "Adet. Boşsa \"stok bilgisi yok\" görünür ve satışa kapalı kalır." },
  { key: "barcode", header: "Barkod", required: false, width: 16, note: "EAN/GTIN." },
  { key: "description", header: "Açıklama", required: false, width: 60, note: "Kullanım alanı ve öne çıkan özellikler (en fazla 3.000 karakter)." },
  { key: "viscosity", header: "Viskozite", required: false, width: 12, note: "Örn. 5W-30, 75W-90, ISO VG 46." },
  { key: "package", header: "Ambalaj", required: false, width: 14, note: "Kapasite: 1 L, 4 L, 500 ml, 16 kg. Koli: 4 × 4 L." },
  { key: "approvals", header: "Onaylar/Normlar", required: false, width: 44, note: "Örn. API SP; ACEA C3; VW 504 00." },
  { key: "imageUrl", header: "Resim Linki", required: false, width: 44, note: "Doğrudan resim dosyası linki (https). Arama sayfası linkleri yok sayılır." },
] as const;
export type ManualColumnKey = (typeof manualColumns)[number]["key"];

export type ManualCategory = { id: number; name: string; path: { id: number; name: string }[] };
export type ManualRow = {
  sheet: string; row: number; code: string; name: string; brand: string; categoryId: number;
  price: number | null; stock: number | null; barcode: string | null; description: string | null;
  viscosity: string | null; package: string | null; approvals: string | null; imageUrl: string | null;
  /** Only present when the cell is filled: uploads of the old template keep product_data.file unchanged (#843). */
  listPrice?: number; discount?: number;
};
export type ManualIssue = { sheet: string; row: number | null; code: string | null; field: ManualColumnKey | ManualBulkColumnKey | null; level: "error" | "warning"; message: string };
export type ManualParseResult = { rows: ManualRow[]; issues: ManualIssue[]; sheets: { name: string; rows: number }[] };

const categorySheet = "Kategoriler";
const maxRows = 20000;
/** Case, accent and whitespace insensitive comparison key (headers, category and brand names). */
export const fold = (value: string) => value.toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
export const categoryLabel = (category: ManualCategory) => category.path.map(node => node.name).join(" › ");

function cellText(value: ExcelJS.CellValue): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if ("richText" in value) return value.richText.map(part => part.text).join("").trim() || null;
  if ("hyperlink" in value) return (value.hyperlink || value.text || "").trim() || null;
  if ("result" in value) return value.result === undefined || value.result === null || typeof value.result === "object" && !(value.result instanceof Date) ? null : cellText(value.result as ExcelJS.CellValue);
  return null;
}

// Turkish ("1.234,56") and plain ("1234.56") decimals; a bare number cell arrives as a number already.
export function parseDecimal(value: ExcelJS.CellValue): number | null | "invalid" {
  if (typeof value === "number") return Number.isFinite(value) ? value : "invalid";
  return parseDecimalText(cellText(value));
}

/**
 * A percent cell: a "%"-formatted number cell (also a formula's result) holds the fraction (0,125 → 12,5); text may
 * carry "%". A value below 1 written without "%" is read as written but flagged, since it was probably meant as a fraction.
 */
export function parsePercent(cell: Pick<ExcelJS.Cell, "value" | "numFmt">): { value: number | null | "invalid"; fraction?: boolean } {
  const raw = cell.value;
  const value = raw !== null && typeof raw === "object" && "result" in raw ? (raw.result ?? null) as ExcelJS.CellValue : raw;
  // A quoted "%" in the format is literal text, not percent scaling. (ExcelJS drops the backslash of an escaped \% when
  // reading, so that one cannot be told apart and scales.)
  const percentFormat = (cell.numFmt ?? "").replace(/"[^"]*"/g, "").includes("%");
  let parsed: number | null | "invalid";
  let marked = false;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { value: "invalid" };
    parsed = percentFormat ? Math.round(value * 1_000_000) / 10_000 : value;
    marked = percentFormat;
  } else {
    const text = cellText(value);
    marked = Boolean(text?.includes("%"));
    parsed = parseDecimal(text?.replace(/%/g, "") ?? null);
  }
  return { value: parsed, ...(!marked && typeof parsed === "number" && parsed > 0 && parsed < 1 ? { fraction: true } : {}) };
}

const decimals = (value: number) => {
  const text = String(value);
  return text.includes("e") ? 99 : (text.split(".")[1] ?? "").length;
};
const formatAmount = (value: number) => value.toLocaleString("tr-TR", { maximumFractionDigits: 4 });

/** A formula cell without a usable cached result (an error such as #DIV/0!, or never calculated). */
export function formulaFailed(value: ExcelJS.CellValue) {
  if (value === null || typeof value !== "object" || value instanceof Date || !("formula" in value || "sharedFormula" in value)) return false;
  const result = (value as { result?: unknown }).result;
  return result === undefined || result === null || typeof result === "object" && !(result instanceof Date);
}

// SAE grades are written one way (10W-40, as the storefront's engine-oil matching reads them); anything else as typed.
export function normalizeViscosity(value: string | null) {
  if (!value) return null;
  const match = /^(?:SAE\s*)?(\d{1,2})W\s*-?\s*(\d{1,3})$/i.exec(value.trim());
  return match ? `${match[1]}W-${match[2]}` : value.trim();
}

const units: Record<string, string> = { LITRE: "L", LT: "L", L: "L", KG: "kg", ML: "ml", GR: "g", G: "g" };
const amount = (value: string, unit: string) => {
  let number = Number(value.replace(",", "."));
  let symbol = units[unit];
  if (symbol === "L" && number < 1) { number = Math.round(number * 1000); symbol = "ml"; }
  return `${number.toLocaleString("en-US", { maximumFractionDigits: 3, useGrouping: false })} ${symbol}`;
};
/** Capacity only ("4 L", "500 ml", "16 kg"; cartons "4 × 4 L"); container words (bidon, varil) are dropped. */
export function normalizePackage(value: string | null) {
  if (!value) return null;
  const text = value.toLocaleUpperCase("tr").replace(/İ/g, "I");
  const carton = /(\d+)\s*[X×]\s*(\d+(?:[.,]\d+)?)\s*(LITRE|LT|KG|ML|GR|G|L)\b/.exec(text);
  if (carton) return `${carton[1]} × ${amount(carton[2], carton[3])}`;
  const single = /^(\d+(?:[.,]\d+)?)\s*(LITRE|LT|KG|ML|GR|G|L)\b/.exec(text.trim());
  return single ? amount(single[1], single[2]) : value.trim();
}

/** A direct image link, or null with the reason it was ignored. */
export function imageLink(value: string | null): { url: string | null; ignored?: string } {
  if (!value) return { url: null };
  let url: URL;
  try { url = new URL(value); } catch { return { url: null, ignored: "Geçerli bir link değil" }; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { url: null, ignored: "Yalnız http(s) linkleri kabul edilir" };
  if (/(^|\.)google\.[a-z.]+$/.test(url.hostname) && (url.pathname.startsWith("/search") || url.pathname.startsWith("/imgres")))
    return { url: null, ignored: "Google arama linki, resim değil" };
  return { url: url.toString() };
}

export function gtinValid(code: string) {
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false;
  const digits = code.padStart(14, "0").split("").map(Number);
  const sum = digits.slice(0, 13).reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - sum % 10) % 10 === digits[13];
}

export async function parseManualWorkbook(buffer: Buffer | ArrayBuffer, categories: ManualCategory[]): Promise<ManualParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const byName = new Map<string, ManualCategory>();
  for (const category of categories) {
    byName.set(fold(category.name), category);
    byName.set(fold(categoryLabel(category)), category);
    byName.set(String(category.id), category);
  }
  const rows: ManualRow[] = [];
  const issues: ManualIssue[] = [];
  const sheets: ManualParseResult["sheets"] = [];
  const seen = new Map<string, { sheet: string; row: number }>();
  for (const sheet of workbook.worksheets) {
    if (sheet.name === categorySheet) continue;
    let headerRow = 0;
    const columns = new Map<ManualColumnKey, number>();
    for (let r = 1; r <= Math.min(sheet.rowCount, 10) && !headerRow; r++) {
      const values = sheet.getRow(r);
      values.eachCell((cell, col) => {
        const column = manualColumns.find(c => fold(c.header) === fold(cellText(cell.value) ?? ""));
        if (column) columns.set(column.key, col);
      });
      if (columns.has("code")) headerRow = r; else columns.clear();
    }
    if (!headerRow) continue;
    const missing = manualColumns.filter(c => c.required && !columns.has(c.key)).map(c => c.header);
    if (missing.length) {
      issues.push({ sheet: sheet.name, row: headerRow, code: null, field: null, level: "error", message: `Zorunlu sütun yok: ${missing.join(", ")}` });
      continue;
    }
    let count = 0;
    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
      const line = sheet.getRow(r);
      const raw = (key: ManualColumnKey) => columns.has(key) ? line.getCell(columns.get(key)!).value : null;
      const text = (key: ManualColumnKey) => cellText(raw(key));
      if (manualColumns.every(c => !text(c.key))) continue;
      if (rows.length + count >= maxRows) {
        issues.push({ sheet: sheet.name, row: r, code: null, field: null, level: "error", message: `Bir dosyada en fazla ${maxRows.toLocaleString("tr-TR")} ürün olabilir` });
        break;
      }
      count++;
      const code = text("code");
      const issue = (field: ManualColumnKey | null, level: ManualIssue["level"], message: string) =>
        issues.push({ sheet: sheet.name, row: r, code, field, level, message });
      const before = issues.filter(i => i.level === "error").length;
      if (!code) issue("code", "error", "Ürün kodu boş");
      else if (code.length > 120) issue("code", "error", "Ürün kodu 120 karakterden uzun");
      else if (seen.has(code)) issue("code", "error", `Kod tekrar ediyor (ilk: ${seen.get(code)!.sheet} satır ${seen.get(code)!.row})`);
      const name = text("name");
      if (!name) issue("name", "error", "Ürün adı boş"); else if (name.length > 300) issue("name", "error", "Ürün adı 300 karakterden uzun");
      const brand = text("brand");
      if (!brand) issue("brand", "error", "Marka boş"); else if (brand.length > 80) issue("brand", "error", "Marka 80 karakterden uzun");
      const categoryText = text("category");
      const category = categoryText ? byName.get(fold(categoryText)) : undefined;
      if (!categoryText) issue("category", "error", "Kategori boş");
      else if (!category) issue("category", "error", `Kategori bulunamadı: "${categoryText}" (Kategoriler sayfasındaki adlardan biri olmalı)`);
      const filePrice = parseDecimal(raw("price"));
      if (filePrice === "invalid") issue("price", "error", `Fiyat sayı değil: "${text("price")}"`);
      const listFailed = formulaFailed(raw("listPrice"));
      const listValue = listFailed ? "invalid" : parseDecimal(raw("listPrice"));
      const listPrice = typeof listValue === "number" ? listValue : null;
      if (listFailed) issue("listPrice", "error", "Liste Fiyatı formülü hesaplanamadı");
      else if (listValue === "invalid") issue("listPrice", "error", `Liste Fiyatı sayı değil: "${text("listPrice")}"`);
      else if (listPrice !== null && listPrice <= 0) issue("listPrice", "error", "Liste Fiyatı sıfırdan büyük olmalı");
      else if (listPrice !== null && decimals(listPrice) > 4) issue("listPrice", "error", "Liste Fiyatı en fazla dört ondalıklı olabilir");
      const discountFailed = formulaFailed(raw("discount"));
      const percent: ReturnType<typeof parsePercent> = discountFailed ? { value: "invalid" }
        : columns.has("discount") ? parsePercent(line.getCell(columns.get("discount")!)) : { value: null };
      const discount = typeof percent.value === "number" ? percent.value : null;
      if (discountFailed) issue("discount", "error", "İskonto formülü hesaplanamadı");
      else if (percent.value === "invalid") issue("discount", "error", `İskonto Oranı sayı değil: "${text("discount")}"`);
      else if (discount !== null && (discount < 0 || discount > 100)) issue("discount", "error", `İskonto Oranı 0–100 arasında olmalı: ${text("discount")}`);
      else if (discount !== null && listValue === null) issue("discount", "error", "İskonto girildi ama Liste Fiyatı yok; Liste Fiyatı da girin");
      else if (percent.fraction) issue("discount", "warning", "İskonto Oranı 1'den küçük okundu; yüzde olarak yazın (12,5)");
      const validList = listPrice !== null && listPrice > 0 && decimals(listPrice) <= 4 ? listPrice : null;
      const validDiscount = discount !== null && discount >= 0 && discount <= 100 ? discount : null;
      let price = typeof filePrice === "number" && filePrice > 0 ? filePrice : null;
      if (validList !== null) {
        const cost = manualCost(validList, validDiscount ?? 0);
        if (typeof filePrice === "number" && Math.abs(filePrice - cost) > 0.01)
          issue("price", "warning", `Fiyat, liste fiyatı ve iskontodan hesaplanan maliyetle uyuşmuyor; hesaplanan kullanılacak: ${formatAmount(filePrice)} ≠ ${formatAmount(cost)}`);
        if (validDiscount === 100) issue("discount", "warning", "İskonto %100: maliyet 0 olur, ürün satışa kapanır");
        price = cost > 0 ? cost : null;
      } else if (filePrice !== "invalid" && listValue === null && price === null) issue("price", "warning", "Fiyat yok; satışa kapalı listelenecek");
      const stockValue = parseDecimal(raw("stock"));
      if (stockValue === "invalid" || (typeof stockValue === "number" && !Number.isInteger(stockValue))) issue("stock", "error", `Stok tam sayı değil: "${text("stock")}"`);
      const barcode = text("barcode")?.replace(/\s/g, "") || null;
      if (barcode && !gtinValid(barcode)) issue("barcode", "warning", `Barkod geçerli bir EAN/GTIN değil: ${barcode}`);
      const description = text("description");
      if (description && description.length > 3000) issue("description", "error", "Açıklama 3.000 karakterden uzun");
      const pack = normalizePackage(text("package"));
      if (!pack) issue("package", "warning", "Ambalaj eksik");
      const approvals = text("approvals");
      if (approvals && approvals.length > 1000) issue("approvals", "error", "Onaylar/Normlar 1.000 karakterden uzun");
      const image = imageLink(text("imageUrl"));
      if (image.ignored) issue("imageUrl", "warning", `Resim linki yok sayıldı: ${image.ignored}`);
      if (code && !seen.has(code)) seen.set(code, { sheet: sheet.name, row: r });
      if (issues.filter(i => i.level === "error").length > before) continue;
      rows.push({
        sheet: sheet.name, row: r, code: code!, name: name!, brand: brand!, categoryId: category!.id,
        price, stock: typeof stockValue === "number" ? stockValue : null,
        barcode, description, viscosity: normalizeViscosity(text("viscosity")), package: pack, approvals, imageUrl: image.url,
        ...(validList !== null ? { listPrice: validList, discount: validDiscount ?? 0 } : {}),
      });
    }
    sheets.push({ name: sheet.name, rows: count });
  }
  if (!sheets.length) issues.push({ sheet: "", row: null, code: null, field: null, level: "error", message: "Şablon başlığı (\"Ürün Kodu\" sütunu) hiçbir sayfada bulunamadı" });
  else if (!rows.length && !issues.some(i => i.level === "error")) issues.push({ sheet: "", row: null, code: null, field: null, level: "error", message: "Dosyada ürün satırı yok" });
  return { rows, issues, sheets };
}

/** The empty template, or a filled one (rows grouped into one sheet per `sheet`). */
export async function buildManualTemplate(categories: ManualCategory[], rows: Omit<ManualRow, "row">[] = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Getirbakim";
  const sorted = [...categories].sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b), "tr"));
  const sheetNames = rows.length ? [...new Set(rows.map(row => row.sheet))] : ["Ürünler"];
  for (const sheetName of sheetNames) {
    const sheet = workbook.addWorksheet(sheetName.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = manualColumns.map(column => ({ header: column.header, key: column.key, width: column.width }));
    const header = sheet.getRow(1);
    header.font = { bold: true };
    manualColumns.forEach((column, index) => {
      const cell = header.getCell(index + 1);
      cell.note = `${column.required ? "Zorunlu. " : "İsteğe bağlı. "}${column.note}`;
      if (column.required) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDE8F7" } };
    });
    sheet.getColumn("code").numFmt = "@";
    sheet.getColumn("barcode").numFmt = "@";
    for (const row of rows.filter(row => row.sheet === sheetName)) sheet.addRow({
      ...row, category: categories.find(category => category.id === row.categoryId)?.name ?? "",
    });
    const categoryColumn = manualColumns.findIndex(column => column.key === "category") + 1;
    const letter = sheet.getColumn(categoryColumn).letter;
    (sheet as unknown as { dataValidations: { add(range: string, rule: object): void } }).dataValidations.add(`${letter}2:${letter}${maxRows + 1}`, {
      type: "list", allowBlank: true, formulae: [`${categorySheet}!$A$2:$A$${sorted.length + 1}`],
      showErrorMessage: true, errorStyle: "stop", errorTitle: "Kategori", error: "Kategoriler sayfasındaki adlardan birini seçin.",
    });
  }
  const list = workbook.addWorksheet(categorySheet);
  list.columns = [{ header: "Kategori", key: "name", width: 40 }, { header: "Yol", key: "path", width: 70 }, { header: "No", key: "id", width: 8 }];
  list.getRow(1).font = { bold: true };
  for (const category of sorted) list.addRow({ name: category.name, path: categoryLabel(category), id: category.id });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
