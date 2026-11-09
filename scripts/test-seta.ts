import assert from "node:assert/strict";
import test from "node:test";
import { prepareSetaImport, setaProductData } from "../src/modules/suppliers/seta-import";

// Shapes copied from the live response (2026-10-11).
const filter = {
  product_no: "STO-026", product_name: "GOLF VII 1.2TSI 1.4 TSI (12>), JETTA IV 1.4 TSI (11>)  ", price: "105.00", currency: "TRY" as const, stock: true,
  image: "https://b2b-admin.setafilter.com.tr/uploads/stock/STO-026/a.jpeg", oems: ["04E 115 561 D", "04E 115 561 T"],
  category: "Yağ Filtreleri", brand: "Volkswagen", cross: { Mahle: "OC977/1", Mann: "W 712/95" },
};
const part = {
  product_no: "SMT-HYN-00058", product_name: "TERMOSTAT HYUNDAİ H100 KMY KİA BONGO 15 88°", price: "150.00", currency: "TRY" as const, stock: true,
  image: "https://b2b-admin.setafilter.com.tr/uploads/stock/x.png", oems: ["25510-4A750"], category: "Yedek Parça ", brand: null, cross: [] as [],
};

test("rows map onto the storefront's shared field names", () => {
  const data = setaProductData(filter);
  assert.equal(data.ac, "Yağ Filtresi");
  assert.equal(data.ac2, "GOLF VII 1.2TSI 1.4 TSI (12>), JETTA IV 1.4 TSI (11>)");
  assert.equal(data.uk, "SETA");
  assert.equal(data.oe, "04E 115 561 D / 04E 115 561 T");
  assert.equal(data.dc, "TRY");
  assert.equal(data.category, "filtre");
  assert.equal(data.vehicle_brand, "Volkswagen");
});

test("spare parts are named by their description; an empty cross array becomes an object", () => {
  const data = setaProductData(part);
  assert.equal(data.ac, "TERMOSTAT HYUNDAİ H100 KMY KİA BONGO 15 88°");
  assert.equal(data.ac2, "");
  assert.equal(data.category, "yedek-parca");
  assert.deepEqual(data.cross, {});
});

test("a missing category is taken from the code prefix", () => {
  const data = setaProductData({ ...filter, product_no: "STA-700", category: null });
  assert.equal(data.ac, "Hava Filtresi");
  assert.equal(data.category, "filtre");
  assert.equal(data.source_category, null);
});

test("price is TRY cost, stock is an availability flag, zero price stays unpriced", () => {
  const result = prepareSetaImport([filter, { ...part, price: "0.00", stock: false }]);
  const [a, b] = result.items;
  assert.deepEqual(a.price_data, { nf: 105, price: "105.00" });
  assert.deepEqual(a.stock_data, { stok: 1 });
  assert.equal(b.price_data, null);
  assert.deepEqual(b.stock_data, { stok: 0 });
  assert.equal(result.quality.missingPrices, 1);
  assert.equal(result.quality.outOfStock, 1);
});

test("codes are trimmed; identical duplicates merge, differing ones are flagged", () => {
  const same = prepareSetaImport([filter, { ...filter, product_no: " STO-026 " }]);
  assert.equal(same.items.length, 1);
  assert.equal(same.items[0].product_count, 2);
  assert.equal(same.items[0].conflicting, false);
  const differing = prepareSetaImport([filter, { ...filter, price: "110.00" }]);
  assert.equal(differing.items[0].conflicting, true);
  assert.equal(differing.quality.conflictingCodes, 1);
});

test("empty lists, other currencies and malformed prices are contract errors", () => {
  assert.throws(() => prepareSetaImport([]));
  assert.throws(() => prepareSetaImport([{ ...filter, currency: "EUR" }]));
  assert.throws(() => prepareSetaImport([{ ...filter, price: "1,05" }]));
  assert.throws(() => prepareSetaImport({ data: [filter] }));
});
