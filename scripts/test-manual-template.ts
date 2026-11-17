import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { buildManualTemplate, imageLink, normalizePackage, normalizeViscosity, parseDecimal, parseManualWorkbook, type ManualCategory } from "../src/modules/suppliers/manual-template";

const categories: ManualCategory[] = [
  { id: 956, name: "Yağlar ve sıvılar", path: [{ id: 956, name: "Yağlar ve sıvılar" }] },
  { id: 957, name: "Motor yağları", path: [{ id: 956, name: "Yağlar ve sıvılar" }, { id: 957, name: "Motor yağları" }] },
];
const row = { sheet: "MOTUL", code: "109461", name: "2100 Power+ 10W40 4 Litre Motor Yağı", brand: "MOTUL", categoryId: 957, price: 812.5, stock: 3,
  barcode: null, description: "Kullanım alanı.\n\nÖzel teknolojiler: X", viscosity: "10W-40", package: "4 L", approvals: "ACEA A3/B4", imageUrl: "https://example.com/a.jpg" };

test("a filled template reads back unchanged, with the category list and a dropdown", async () => {
  const parsed = await parseManualWorkbook(await buildManualTemplate(categories, [row]), categories);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.sheets, [{ name: "MOTUL", rows: 1 }]);
  assert.deepEqual(parsed.rows, [{ ...row, row: 2 }]);
});

test("the empty template has every column and no products", async () => {
  const parsed = await parseManualWorkbook(await buildManualTemplate(categories), categories);
  assert.deepEqual(parsed.rows, []);
  assert.match(parsed.issues[0].message, /ürün satırı yok/);
});

async function workbook(rows: (string | number | null)[][], header = ["Ürün Kodu", "Ürün Adı", "Marka", "Kategori", "Fiyat", "Stok", "Ambalaj", "Resim Linki"]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Liste");
  sheet.addRow(header);
  for (const values of rows) sheet.addRow(values);
  return Buffer.from(await book.xlsx.writeBuffer());
}

test("rows with errors are reported and left out; warnings keep the row", async () => {
  const parsed = await parseManualWorkbook(await workbook([
    [113165, "2000 Protect 20W50", "MOTUL", "motor yağları", "1.234,50", 2, "1LT (Bidon/Varil/Şişe)", "https://www.google.com/search?tbm=isch&q=x"],
    [113165, "Tekrar", "MOTUL", "Motor yağları", null, null, "4 L", null],
    ["A-1", "Bilinmeyen kategori", "MOTUL", "Filtreler", null, null, "4 L", null],
    ["A-2", "Fiyat hatalı", "MOTUL", "Motor yağları", "on lira", 1.5, null, null],
    ["A-3", null, null, "Motor yağları", null, null, null, null],
  ]), categories);
  assert.deepEqual(parsed.rows.map(r => [r.code, r.price, r.stock, r.package, r.imageUrl, r.categoryId]), [["113165", 1234.5, 2, "1 L", null, 957]]);
  const errors = parsed.issues.filter(issue => issue.level === "error").map(issue => [issue.code, issue.field]);
  assert.deepEqual(errors, [["113165", "code"], ["A-1", "category"], ["A-2", "price"], ["A-2", "stock"], ["A-3", "name"], ["A-3", "brand"]]);
  assert.ok(parsed.issues.some(issue => issue.code === "113165" && issue.field === "imageUrl" && issue.level === "warning"));
});

test("a sheet without the required headers is an error", async () => {
  const parsed = await parseManualWorkbook(await workbook([["X", "Ad"]], ["Ürün Kodu", "Ürün Adı"]), categories);
  assert.match(parsed.issues[0].message, /Zorunlu sütun yok: Marka, Kategori/);
});

test("values are normalized the way the storefront reads them", () => {
  assert.equal(normalizeViscosity("10W40"), "10W-40");
  assert.equal(normalizeViscosity("SAE 75W-90"), "75W-90");
  assert.equal(normalizeViscosity("ISO VG 46"), "ISO VG 46");
  assert.equal(normalizePackage("4LT (Bidon/Varil/Şişe)"), "4 L");
  assert.equal(normalizePackage("0.300 L"), "300 ml");
  assert.equal(normalizePackage("4x4 Litre"), "4 × 4 L");
  assert.equal(normalizePackage("16KG"), "16 kg");
  assert.equal(normalizePackage(null), null);
  assert.equal(parseDecimal("1.234,56"), 1234.56);
  assert.equal(parseDecimal("1234.56"), 1234.56);
  assert.equal(parseDecimal("12 TL"), 12);
  assert.equal(parseDecimal("abc"), "invalid");
  assert.deepEqual(imageLink("https://www.google.com/search?tbm=isch&q=x"), { url: null, ignored: "Google arama linki, resim değil" });
  assert.deepEqual(imageLink("ftp://x/y.png"), { url: null, ignored: "Yalnız http(s) linkleri kabul edilir" });
  assert.equal(imageLink("https://cdn.example.com/a.webp").url, "https://cdn.example.com/a.webp");
});

// List price and discount columns (#843).
const priceHeader = ["Ürün Kodu", "Ürün Adı", "Marka", "Kategori", "Fiyat", "Liste Fiyatı", "İskonto Oranı", "Ambalaj"];
const priced = (values: (string | number | null)[][]) => workbook(values.map(([code, price, list, discount]) => [code, "Motor yağı", "MOTUL", "Motor yağları", price, list, discount, "4 L"]), priceHeader);

test("the empty template has the list price and discount columns", async () => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await buildManualTemplate(categories) as unknown as ArrayBuffer);
  const headers = (book.getWorksheet("Ürünler")!.getRow(1).values as unknown[]).filter(Boolean);
  assert.ok(headers.includes("Liste Fiyatı") && headers.includes("İskonto Oranı"));
  assert.ok(headers.indexOf("Liste Fiyatı") === headers.indexOf("Fiyat") + 1);
});

test("a list price and discount give the cost and read back unchanged", async () => {
  const filled = { ...row, price: 875, listPrice: 1000, discount: 12.5 };
  const parsed = await parseManualWorkbook(await buildManualTemplate(categories, [filled]), categories);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.rows, [{ ...filled, row: 2 }]);
});

test("a list price alone means no discount; the price cell is only compared", async () => {
  const parsed = await parseManualWorkbook(await priced([
    ["A", null, 1000, null],
    ["B", 101.5, 117, "12,95"],
    ["C", 875.005, 1000, 12.5],
    ["D", "", 500, "%100"],
  ]), categories);
  assert.deepEqual(parsed.rows.map(r => [r.code, r.price, r.listPrice, r.discount]), [["A", 1000, 1000, 0], ["B", 101.8485, 117, 12.95], ["C", 875, 1000, 12.5], ["D", null, 500, 100]]);
  const warnings = parsed.issues.map(issue => [issue.code, issue.field, issue.level]);
  assert.deepEqual(warnings, [["B", "price", "warning"], ["D", "discount", "warning"]]);
  assert.match(parsed.issues[0].message, /hesaplanan kullanılacak: 101,5 ≠ 101,8485$/);
  assert.match(parsed.issues[1].message, /%100/);
});

test("percent cells: a % format holds the fraction, text may carry %, a bare fraction is flagged", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Liste");
  sheet.addRow(priceHeader);
  sheet.addRow(["A", "Ad", "MOTUL", "Motor yağları", null, 1000, 0.2, "4 L"]).getCell(7).numFmt = "0%";
  sheet.addRow(["B", "Ad", "MOTUL", "Motor yağları", null, 1000, "12,5%", "4 L"]);
  sheet.addRow(["C", "Ad", "MOTUL", "Motor yağları", null, 1000, 0.2, "4 L"]);
  const parsed = await parseManualWorkbook(Buffer.from(await book.xlsx.writeBuffer()), categories);
  assert.deepEqual(parsed.rows.map(r => [r.code, r.discount, r.price]), [["A", 20, 800], ["B", 12.5, 875], ["C", 0.2, 998]]);
  assert.deepEqual(parsed.issues.map(issue => [issue.code, issue.field, issue.level]), [["C", "discount", "warning"]]);
  assert.match(parsed.issues[0].message, /1'den küçük/);
});

test("invalid list price and discount cells are row errors", async () => {
  const parsed = await parseManualWorkbook(await priced([
    ["A", 100, null, 10],
    ["B", null, 1000, 120],
    ["C", null, 0, null],
    ["D", null, 1000.12345, null],
    ["E", null, "bin", null],
  ]), categories);
  assert.deepEqual(parsed.rows, []);
  assert.deepEqual(parsed.issues.filter(issue => issue.level === "error").map(issue => [issue.code, issue.field]),
    [["A", "discount"], ["B", "discount"], ["C", "listPrice"], ["D", "listPrice"], ["E", "listPrice"]]);
});

test("a price within 0.01 of the computed cost is not flagged", async () => {
  const parsed = await parseManualWorkbook(await priced([["A", 101.85, 117, 12.95]]), categories);
  assert.deepEqual(parsed.issues, []);
});

test("percent formula cells use their result; literal % in a format and text below 1 are flagged", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Liste");
  sheet.addRow(priceHeader);
  const add = (code: string, discount: ExcelJS.CellValue, numFmt?: string) => {
    const cell = sheet.addRow([code, "Ad", "MOTUL", "Motor yağları", null, 1000, null, "4 L"]).getCell(7);
    cell.value = discount;
    if (numFmt) cell.numFmt = numFmt;
  };
  sheet.getCell("J1").value = 0.2;
  add("A", { formula: "0.125", result: 0.125 }, "0%");
  add("B", { formula: "J1", result: 0.2 }, "0.00%");
  add("C", "0,125");
  add("D", 0.5, "0.00\" %\"");
  const parsed = await parseManualWorkbook(Buffer.from(await book.xlsx.writeBuffer()), categories);
  assert.deepEqual(parsed.rows.map(r => [r.code, r.discount, r.price]), [["A", 12.5, 875], ["B", 20, 800], ["C", 0.125, 998.75], ["D", 0.5, 995]]);
  assert.deepEqual(parsed.issues.map(issue => [issue.code, issue.field, issue.level]), [["C", "discount", "warning"], ["D", "discount", "warning"]]);
});

test("a list price or discount formula without a result is a row error, not an empty cell", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Liste");
  sheet.addRow(priceHeader);
  sheet.addRow(["A", "Ad", "MOTUL", "Motor yağları", null, 1000, null, "4 L"]).getCell(7).value = { formula: "1/0", result: { error: "#DIV/0!" } };
  sheet.addRow(["B", "Ad", "MOTUL", "Motor yağları", null, 1000, null, "4 L"]).getCell(7).value = { formula: "J1" } as ExcelJS.CellValue;
  sheet.addRow(["C", "Ad", "MOTUL", "Motor yağları", null, null, 10, "4 L"]).getCell(6).value = { formula: "1/0", result: { error: "#DIV/0!" } };
  const parsed = await parseManualWorkbook(Buffer.from(await book.xlsx.writeBuffer()), categories);
  assert.deepEqual(parsed.rows, []);
  assert.deepEqual(parsed.issues.map(issue => [issue.code, issue.field, issue.level, issue.message]), [
    ["A", "discount", "error", "İskonto formülü hesaplanamadı"],
    ["B", "discount", "error", "İskonto formülü hesaplanamadı"],
    ["C", "listPrice", "error", "Liste Fiyatı formülü hesaplanamadı"],
  ]);
});
