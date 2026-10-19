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
