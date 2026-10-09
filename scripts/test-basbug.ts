import assert from "node:assert/strict";
import test from "node:test";
import { prepareBasbugImport } from "../src/modules/suppliers/basbug-import";

const product = { no: "TEST 001", ac: "Test", ac2: "", uk: "MARKA", oe: "60 607 218", lgk: "FIAT", m: "MODEL", mo: "", y: "07-", b: "ADET", dc: "EUR", lf: 4.05, mkk: "" };
const price = { no: product.no, nf: 3.01, mif: 3.27, k: 0 };
const stock = { no: product.no, stok: 1, sYol: 0, sDepo: "MRK", sFarkliDepo: 1 };

test("duplicates consolidate without converting source currency or stock into saleable values", () => {
  const result = prepareBasbugImport({ products: { malzemeListesi: [product, product] }, prices: { fiyatListesi: [price, price] }, stock: { stokListesi: [stock] } });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].product_count, 2);
  assert.equal(result.items[0].conflicting, false);
  assert.equal(result.items[0].product_data.dc, "EUR");
  assert.equal(result.items[0].product_data.oe, "60 607 218");
  assert.equal(result.items[0].stock_data?.stok, 1);
  assert.equal(result.quality.duplicateCodes, 1);
});

test("missing prices and stock remain absent, orphan records are counted", () => {
  const result = prepareBasbugImport({ products: { malzemeListesi: [product] }, prices: { fiyatListesi: [{ ...price, no: "OTHER" }] }, stock: { stokListesi: [] } });
  assert.equal(result.items[0].price_data, null);
  assert.equal(result.items[0].stock_data, null);
  assert.equal(result.quality.missingPrices, 1);
  assert.equal(result.quality.missingStocks, 1);
  assert.equal(result.quality.orphanPrices, 1);
});

test("conflicting duplicates are flagged rather than silently overwriting", () => {
  const result = prepareBasbugImport({ products: { malzemeListesi: [product] }, prices: { fiyatListesi: [price, { ...price, nf: 9 }] }, stock: { stokListesi: [stock] } });
  assert.equal(result.items[0].conflicting, true);
  assert.equal(result.items[0].price_data?.nf, 3.01);
  assert.equal(result.quality.conflictingCodes, 1);
  assert.equal(result.items[0].source_variants.prices?.length, 2);
});

test("JSON field order alone does not create a conflict", () => {
  const result = prepareBasbugImport({ products: { malzemeListesi: [product, Object.fromEntries(Object.entries(product).reverse())] }, prices: { fiyatListesi: [price] }, stock: { stokListesi: [stock] } });
  assert.equal(result.quality.conflictingCodes, 0);
});

test("malformed or empty product responses cannot replace a successful snapshot", () => {
  for (const products of [{ malzemeListesi: [] }, { malzemeListesi: [{ ...product, no: "" }] }, { malzemeListesi: [{ ...product, lf: "4.05" }] }]) {
    assert.throws(() => prepareBasbugImport({ products, prices: { fiyatListesi: [price] }, stock: { stokListesi: [stock] } }));
  }
});

test("warehouse stocks attach per-depot flags to the primary stock record", () => {
  const depot = (sDepo: string, stok: number) => ({ stokListesi: [{ ...stock, sDepo, stok }] });
  const result = prepareBasbugImport({ products: { malzemeListesi: [product] }, prices: { fiyatListesi: [price] }, stock: depot("MRK", 1),
    warehouseStocks: { MRK: depot("MRK", 1), IZM: depot("IZM", 0), IAN: { stokListesi: [{ ...stock, sDepo: "IAN" }, { ...stock, sDepo: "IAN", stok: 0 }] }, TRK: { stokListesi: [] } } });
  const item = result.items[0];
  assert.deepEqual(item.stock_data?.depolar, { MRK: { stok: 1, sYol: 0 }, IZM: { stok: 0, sYol: 0 }, IAN: { stok: 1, sYol: 0 } });
  assert.equal(item.stock_count, 1);
  assert.equal(item.conflicting, true);
  assert.equal(item.source_variants.warehouseStocks?.IAN.length, 2);
});
