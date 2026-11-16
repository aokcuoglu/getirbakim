import assert from "node:assert/strict";
import test from "node:test";
import { BasbugImportError, prepareBasbugImport } from "../src/modules/suppliers/basbug-import";
import { fallbackReason, prepareBasbugItemCheck } from "../src/modules/suppliers/basbug-item-refresh";
import { basbugStockLabel, basbugWarehouseStock } from "../src/modules/suppliers/basbug-stock";

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

test("warehouse availability distinguishes absent data from zero and uses only the MRK legacy fallback", () => {
  assert.equal(basbugWarehouseStock(stock, "MRK"), 1);
  assert.equal(basbugWarehouseStock({ ...stock, sDepo: "IZM" }, "IZM"), null);
  assert.equal(basbugWarehouseStock(null, "MRK"), null);
  const data = { ...stock, depolar: { MRK: { stok: 0, sYol: 0 }, IZM: { stok: 3, sYol: 0 } } };
  assert.equal(basbugWarehouseStock(data, "MRK"), 0);
  assert.equal(basbugStockLabel(basbugWarehouseStock(data, "IZM")), "Stok var");
  assert.equal(basbugStockLabel(basbugWarehouseStock(data, "MRK")), "Stok yok");
  assert.equal(basbugStockLabel(basbugWarehouseStock(data, "KYS")), "Veri yok");
});

test("other depot data survives a missing MRK row without pretending the primary stock is known", () => {
  const result = prepareBasbugImport({ products: { malzemeListesi: [product] }, prices: { fiyatListesi: [price] }, stock: { stokListesi: [] },
    warehouseStocks: { IZM: { stokListesi: [{ ...stock, sDepo: "MRK,TRK", stok: 1 }] }, KYS: { stokListesi: [] } } });
  assert.equal(result.quality.missingStocks, 1);
  assert.equal(basbugWarehouseStock(result.items[0].stock_data, "MRK"), null);
  assert.equal(basbugWarehouseStock(result.items[0].stock_data, "IZM"), 1);
  assert.equal(basbugWarehouseStock(result.items[0].stock_data, "KYS"), null);
});

test("a repeated row that only fills an empty field merges instead of conflicting", () => {
  // FILT AP 026/5: the same product twice, ac2 empty in one row and "HAVA FILTRESI" in the other.
  const result = prepareBasbugImport({ products: { malzemeListesi: [{ ...product, ac2: "" }, { ...product, ac2: "HAVA FILTRESI" }] },
    prices: { fiyatListesi: [price] }, stock: { stokListesi: [stock] } });
  assert.equal(result.items[0].conflicting, false);
  assert.equal((result.items[0].product_data as { ac2: string }).ac2, "HAVA FILTRESI");
  assert.equal(result.quality.conflictingCodes, 0);
  // Two different filled values still conflict, also after a merge.
  const clash = prepareBasbugImport({ products: { malzemeListesi: [{ ...product, ac2: "" }, { ...product, ac2: "HAVA FILTRESI" }, { ...product, ac2: "YAG FILTRESI" }] },
    prices: { fiyatListesi: [price] }, stock: { stokListesi: [stock] } });
  assert.equal(clash.items[0].conflicting, true);
  assert.equal((clash.items[0].source_variants.products as unknown[]).length, 3);
});

test("a MalzemeAra answer maps to the stored price fields and the MRK stock (#763)", () => {
  // The verified field set of one item (16 Nov 2026): numbers as JSON numbers, product fields alongside.
  const response = { no: "FILT AP 026/5", ac: "HAVA FILTRESI", uk: "MANN", dc: "EUR", nf: 62.92, mif: 68.5, k: 0, sMrk: 1, sIzm: 0, sAnk: 2, sAdn: 0, sErz: 0, sYol: 3 };
  // sYol is in transit, not a depot.
  assert.deepEqual(prepareBasbugItemCheck("FILT AP 026/5", response),
    { price: { no: "FILT AP 026/5", nf: 62.92, mif: 68.5, k: 0 }, depots: { MRK: 1, IZM: 0, ANK: 2, ADN: 0, ERZ: 0 } });
  // Another code in the answer, or a missing or textual depot stock, is a broken contract rather than a stock of zero.
  assert.throws(() => prepareBasbugItemCheck("FILT AP 026/6", response), (error: unknown) => error instanceof BasbugImportError && error.reason === "contract");
  const withoutStock: Record<string, unknown> = { ...response };
  delete withoutStock.sMrk;
  assert.throws(() => prepareBasbugItemCheck("FILT AP 026/5", withoutStock), (error: unknown) => fallbackReason(error) === "upstream" && error instanceof Error && error.name === "ZodError");
  assert.throws(() => prepareBasbugItemCheck("FILT AP 026/5", { ...response, sMrk: "1" }));
  const withoutDepot: Record<string, unknown> = { ...response };
  delete withoutDepot.sErz;
  assert.throws(() => prepareBasbugItemCheck("FILT AP 026/5", withoutDepot));
});

test("supplier errors map to order-line fallback reasons", () => {
  const timeout = new Error("timed out"); timeout.name = "TimeoutError";
  assert.equal(fallbackReason(timeout), "timeout");
  assert.equal(fallbackReason(new DOMException("timed out", "TimeoutError")), "timeout");
  for (const reason of ["busy", "paused", "config", "contract", "upstream"] as const)
    assert.equal(fallbackReason(new BasbugImportError(reason)), reason);
  // SETA and Dinamik errors carry the same `reason` field.
  assert.equal(fallbackReason({ reason: "busy" }), "busy");
  assert.equal(fallbackReason(new BasbugImportError("rejected")), "upstream");
  assert.equal(fallbackReason(new Error("socket hang up")), "upstream");
  assert.equal(fallbackReason("text"), "upstream");
});
