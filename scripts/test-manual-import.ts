import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import { activeBulk, bulkFileCells, fileFilled, ManualImportError, manualPricing, panelOverrides, updateManualItem, withOverrides, type downloadImage, type ManualItemEdit, type ManualOverrides, type ManualValues } from "../src/modules/suppliers/manual-import";
import { readManualPriceEdit } from "../src/modules/suppliers/manual-item-form";
import { hasGrouping, parseDecimalText, parsePanelDecimal } from "../src/modules/suppliers/manual-cost";

// updateManualItem against a recorded fake pool: no database, the statements and their order are what is checked.
const itemId = "da883a2e-1351-430e-a296-0a46c114a546";
const file: ManualValues = { code: "100047", name: "Motor Yağı 5W-30 4 L", brand: "MOTUL", categoryId: 957, price: 812.5, stock: 3,
  barcode: null, description: null, viscosity: "5W-30", package: "4 L", approvals: null, imageUrl: null };
const category = { id: 957, name: "Motor yağları", path: [{ id: 956, name: "Yağlar ve sıvılar" }, { id: 957, name: "Motor yağları" }] };

function fakePool(options: { file?: ManualValues; storedImage?: string; failOn?: RegExp; overrides?: ManualOverrides } = {}) {
  const statements: string[] = [];
  const params: unknown[][] = [];
  let released = false;
  const run = async (sql: string, values: unknown[] = []) => {
    statements.push(sql.replace(/\s+/g, " ").trim());
    params.push(values);
    if (options.failOn?.test(sql)) throw Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });
    if (/FROM supplier_items WHERE id=\$1 AND supplier/.test(sql))
      return { rows: [{ list_group: "madeni-yaglar", code: file.code, product_data: { list_name: "Madeni yağlar", file: options.file ?? file } }], rowCount: 1 };
    if (/FROM manual_item_overrides WHERE list_group=\$1 AND code=\$2/.test(sql))
      return { rows: options.overrides ? [{ fields: options.overrides }] : [], rowCount: options.overrides ? 1 : 0 };
    if (/FROM source_categories/.test(sql)) return { rows: [category], rowCount: 1 };
    if (/FROM product_media_objects/.test(sql))
      return { rows: options.storedImage ? [{ source_url: options.storedImage, id: "img-1", width: 800, height: 600 }] : [], rowCount: options.storedImage ? 1 : 0 };
    if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ locked: true }], rowCount: 1 };
    if (/SELECT id,code FROM supplier_items/.test(sql)) return { rows: [{ id: itemId, code: file.code }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  const pool = { query: run, connect: async () => ({ query: run, release: () => { released = true; } }) } as unknown as Pool;
  return { pool, statements, params, released: () => released };
}

const noDownload: typeof downloadImage = async link => assert.fail(`unexpected download: ${link}`);
const unchanged: ManualItemEdit = { barcode: null, description: null, viscosity: null, package: null, approvals: null, imageUrl: null };

test("an unchanged save takes the row without waiting on the matcher's key locks and bounds every lock wait", async () => {
  const { pool, statements, released } = fakePool();
  assert.deepEqual(await updateManualItem(pool, itemId, unchanged, null, noDownload), { changed: false });
  const begin = statements.indexOf("BEGIN");
  assert.match(statements[begin + 1], /^SET LOCAL lock_timeout = '\d+s'$/);
  const update = statements.find(sql => sql.startsWith("WITH old AS"));
  assert.match(update ?? "", /FOR NO KEY UPDATE/);
  assert.equal(statements.at(-1), "SELECT pg_advisory_unlock($1,$2)");
  assert.ok(released());
});

test("a lock wait that runs out is reported as locked, rolled back and unlocked", async () => {
  const { pool, statements, released } = fakePool({ failOn: /^WITH old AS/ });
  await assert.rejects(updateManualItem(pool, itemId, unchanged, null, noDownload),
    (error: unknown) => error instanceof ManualImportError && error.reason === "locked");
  assert.ok(statements.includes("ROLLBACK"));
  assert.ok(!statements.includes("COMMIT"));
  assert.equal(statements.at(-1), "SELECT pg_advisory_unlock($1,$2)");
  assert.ok(released());
});

test("an image link already stored is reused without downloading it again", async () => {
  const link = "https://example.com/motul.jpg";
  const { pool } = fakePool({ storedImage: link });
  const downloads: string[] = [];
  await updateManualItem(pool, itemId, { ...unchanged, imageUrl: link }, null, async url => { downloads.push(url); throw new Error("offline"); });
  assert.deepEqual(downloads, []);
});

test("a CSV value holds while the upload carries the same cell and gives way once the cell changes", () => {
  const overrides: ManualOverrides = { bulk: { price: { list: 1000, discount: 12.5, file: 812.5 }, stock: { value: 9, file: 3 } } };
  assert.deepEqual([withOverrides(file, overrides).price, withOverrides(file, overrides).stock], [875, 9]);
  const changed = { ...file, price: 900, stock: 4 };
  assert.deepEqual(activeBulk(changed, overrides), {});
  assert.deepEqual([withOverrides(changed, overrides).price, withOverrides(changed, overrides).stock], [900, 4]);
  // An empty file cell matches a CSV value taken over an empty cell; the panel value fills empty cells as before.
  const empty = { ...file, price: null, stock: null, package: null };
  const filled = withOverrides(empty, { price: 700, package: "1 L", bulk: { price: { list: 500, discount: 0, file: null } } });
  assert.deepEqual([filled.price, filled.stock, filled.package], [500, null, "1 L"]);
  assert.deepEqual(withOverrides(empty, { price: 700 }).price, 700);
});

test("saving the item page without touching price and stock keeps the CSV values in force", async () => {
  const bulk = { price: { list: 1000, discount: 10, file: 812.5 }, stock: { value: 9, file: 3 } };
  const { pool, statements, params } = fakePool({ overrides: { description: "Eski", bulk } });
  await updateManualItem(pool, itemId, { ...unchanged, description: "Yeni" }, null, noDownload);
  const insert = statements.findIndex(sql => sql.startsWith("INSERT INTO manual_item_overrides"));
  assert.deepEqual(JSON.parse(params[insert][2] as string), { description: "Yeni", bulk });
  const update = statements.findIndex(sql => sql.startsWith("WITH old AS"));
  assert.deepEqual(JSON.parse(params[update][2] as string), { nf: 900, list: 1000, discount: 10 });
  assert.deepEqual(JSON.parse(params[update][3] as string), { stok: 9 });
});

// List price and discount cells of the upload (#843).
const listed: ManualValues = { ...file, price: 875, listPrice: 1000, discount: 12.5 };

test("a CSV price compares the upload's list price and discount cells too", () => {
  // An older record (no fileList) against an old-template file stays in force.
  assert.ok(activeBulk(file, { bulk: { price: { list: 1000, discount: 20, file: 812.5 } } }).price);
  // Same cost, other cells: the file changed, so the CSV gives way.
  assert.equal(activeBulk(listed, { bulk: { price: { list: 1000, discount: 20, file: 875 } } }).price, undefined);
  const recorded: ManualOverrides = { bulk: { price: { list: 1000, discount: 20, ...bulkFileCells(listed) } } };
  assert.deepEqual(bulkFileCells(listed), { file: 875, fileList: 1000, fileDiscount: 12.5 });
  assert.deepEqual(bulkFileCells(file), { file: 812.5 });
  assert.ok(activeBulk(listed, recorded).price);
  assert.equal(withOverrides(listed, recorded).price, 800);
  assert.deepEqual(manualPricing(listed, recorded), { list: 1000, discount: 20 });
  const discountChanged = { ...listed, price: 850, discount: 15 };
  assert.equal(activeBulk(discountChanged, recorded).price, undefined);
  assert.deepEqual(manualPricing(discountChanged, recorded), { list: 1000, discount: 15 });
  assert.equal(manualPricing(file, undefined), undefined);
});

test("a list price filled at 100% discount is a filled price: a panel price does not replace it", () => {
  const free = { ...file, price: null, listPrice: 500, discount: 100 };
  assert.ok(fileFilled(free, "price"));
  assert.equal(withOverrides(free, { price: 700 }).price, null);
  assert.ok(!fileFilled({ ...file, price: null }, "price"));
});

test("saving the item page keeps the upload's list price and discount in price_data", async () => {
  const { pool, statements, params } = fakePool({ file: listed });
  await updateManualItem(pool, itemId, { ...unchanged, description: "Yeni" }, null, noDownload);
  const insert = statements.findIndex(sql => sql.startsWith("INSERT INTO manual_item_overrides"));
  assert.deepEqual(JSON.parse(params[insert][2] as string), { description: "Yeni" });
  const update = statements.findIndex(sql => sql.startsWith("WITH old AS"));
  assert.deepEqual(JSON.parse(params[update][2] as string), { nf: 875, list: 1000, discount: 12.5 });
});

// List price, discount and stock saved on the item page (#842): written like a CSV edit, last edit wins.
async function save(edit: ManualItemEdit, options: Parameters<typeof fakePool>[0] = {}) {
  const { pool, statements, params } = fakePool(options);
  const result = await updateManualItem(pool, itemId, { ...unchanged, ...edit }, null, noDownload);
  const insert = statements.findIndex(sql => sql.startsWith("INSERT INTO manual_item_overrides"));
  const update = statements.findIndex(sql => sql.startsWith("WITH old AS"));
  return { result, fields: JSON.parse(params[insert][2] as string) as ManualOverrides, price: JSON.parse(params[update][2] as string),
    stock: JSON.parse(params[update][3] as string), history: /INSERT INTO supplier_item_changes/.test(statements[update]) };
}

test("a list price and discount saved on the item page override a filled cell and set the cost", async () => {
  const saved = await save({ pricing: { list: 1000, discount: 12.5 } });
  assert.deepEqual(saved.fields, { bulk: { price: { list: 1000, discount: 12.5, file: 812.5, by: "panel" } } });
  assert.deepEqual(saved.price, { nf: 875, list: 1000, discount: 12.5 });
  assert.deepEqual(saved.stock, { stok: 3 });
  assert.ok(saved.history);
  // Recorded against the upload's list price cells too.
  const listedSave = await save({ pricing: { list: 1100, discount: 0 } }, { file: listed });
  assert.deepEqual(listedSave.fields.bulk?.price, { list: 1100, discount: 0, file: 875, fileList: 1000, fileDiscount: 12.5, by: "panel" });
  assert.deepEqual(listedSave.price, { nf: 1100, list: 1100, discount: 0 });
});

test("editing price keeps a CSV stock in force, and editing stock keeps a CSV price", async () => {
  const bulk = { price: { list: 1000, discount: 10, file: 812.5 }, stock: { value: 9, file: 3 } };
  const price = await save({ pricing: { list: 2000, discount: 50 } }, { overrides: { bulk } });
  assert.deepEqual(price.fields.bulk, { price: { list: 2000, discount: 50, file: 812.5, by: "panel" }, stock: bulk.stock });
  assert.deepEqual([price.price, price.stock], [{ nf: 1000, list: 2000, discount: 50 }, { stok: 9 }]);
  const stock = await save({ stock: 0 }, { overrides: { bulk } });
  assert.deepEqual(stock.fields.bulk, { price: bulk.price, stock: { value: 0, file: 3, by: "panel" } });
  assert.deepEqual([stock.price, stock.stock], [{ nf: 900, list: 1000, discount: 10 }, { stok: 0 }]);
});

test("emptying price or stock on the item page returns to the upload's values", async () => {
  const overrides: ManualOverrides = { bulk: { price: { list: 1000, discount: 10, file: 812.5, by: "panel" }, stock: { value: 9, file: 3, by: "panel" } } };
  const cleared = await save({ pricing: null, stock: null }, { overrides });
  assert.deepEqual(cleared.fields, {});
  assert.deepEqual([cleared.price, cleared.stock], [{ nf: 812.5 }, { stok: 3 }]);
  // An older panel price filling an empty cell is dropped too: the product is unpriced again.
  const empty = { ...file, price: null, stock: null };
  const legacy = await save({ pricing: null, stock: null }, { file: empty, overrides: { price: 700, stock: 2 } });
  assert.deepEqual(legacy.fields, {});
  assert.deepEqual([legacy.price, legacy.stock], [null, null]);
});

test("a value equal to the one in force is not an edit, and an older panel value moves to bulk once edited", () => {
  assert.deepEqual(panelOverrides(file, {}, { pricing: { list: 812.5, discount: 0 }, stock: 3 }), {});
  assert.deepEqual(panelOverrides(listed, {}, { pricing: { list: 1000, discount: 12.5 } }), {});
  const empty = { ...file, price: null, stock: null };
  assert.deepEqual(panelOverrides(empty, { price: 700, stock: 2 }, {}), { price: 700, stock: 2 });
  assert.deepEqual(panelOverrides(empty, { price: 700, stock: 2 }, { pricing: { list: 700, discount: 0 }, stock: 2 }), { price: 700, stock: 2 });
  assert.deepEqual(panelOverrides(empty, { price: 700, stock: 2 }, { pricing: { list: 800, discount: 5 } }),
    { stock: 2, bulk: { price: { list: 800, discount: 5, file: null, by: "panel" } } });
  // Other fields still fill only what the upload leaves empty.
  assert.deepEqual(panelOverrides(file, {}, { viscosity: "0W-20", package: "1 L", barcode: "123" }), { barcode: "123" });
});

test("a panel price gives way once the upload's cell changes, like a CSV value", () => {
  const overrides = panelOverrides(file, {}, { pricing: { list: 1000, discount: 20 }, stock: 7 });
  assert.deepEqual([withOverrides(file, overrides).price, withOverrides(file, overrides).stock], [800, 7]);
  const changed = { ...file, price: 900 };
  assert.deepEqual(activeBulk(changed, overrides), { stock: { value: 7, file: 3, by: "panel" } });
  assert.equal(withOverrides(changed, overrides).price, 900);
});

const form = (values: Record<string, string>) => (key: string) => values[key]?.trim() || null;

test("the item form saves only the price or stock group the admin changed, and validates only that group", () => {
  const shown = { was_listPrice: "812.5", was_discount: "0", was_stock: "3", listPrice: "812.5", discount: "0", stock: "3" };
  assert.deepEqual(readManualPriceEdit(form(shown)), {});
  // Turkish decimals equal to the shown value are not an edit.
  assert.deepEqual(readManualPriceEdit(form({ ...shown, listPrice: "812,50", discount: "" })), {});
  assert.deepEqual(readManualPriceEdit(form({ ...shown, listPrice: "1000,5", discount: "12,5" })), { pricing: { list: 1000.5, discount: 12.5 } });
  // One separator, "," or "." as the decimal point; thousands grouping is refused, not guessed (100 000× risk).
  assert.deepEqual(readManualPriceEdit(form({ ...shown, listPrice: "10,5" })), { pricing: { list: 10.5, discount: 0 } });
  assert.deepEqual(readManualPriceEdit(form({ ...shown, listPrice: "10.5" })), { pricing: { list: 10.5, discount: 0 } });
  for (const listPrice of ["10,12345", "1.000,50", "1,000.5", "1.000.000"])
    assert.equal(readManualPriceEdit(form({ ...shown, listPrice })), "invalid", listPrice);
  assert.deepEqual(readManualPriceEdit(form({ ...shown, stock: "0" })), { stock: 0 });
  assert.deepEqual(readManualPriceEdit(form({ ...shown, listPrice: "", discount: "", stock: "" })), { pricing: null, stock: null });
  // Emptying the list price leaves the prefilled 0 discount: that is not a discount without a list price.
  assert.deepEqual(readManualPriceEdit(form({ ...shown, listPrice: "" })), { pricing: null });
  for (const changed of [{ discount: "120" }, { listPrice: "0" }, { listPrice: "10.12345" }, { listPrice: "", discount: "5" }, { listPrice: "abc" },
    { stock: "1,5" }, { stock: "1.000" }, { stock: "-1" }])
    assert.equal(readManualPriceEdit(form({ ...shown, ...changed })), "invalid", JSON.stringify(changed));
});

test("an untouched price with more than four decimals does not block saving the description", async () => {
  const precise = { ...file, price: 812.12345 };
  const shown = { was_listPrice: "812.12345", was_discount: "0", was_stock: "3", listPrice: "812.12345", discount: "0", stock: "3" };
  const edit = readManualPriceEdit(form(shown));
  assert.deepEqual(edit, {});
  assert.notEqual(edit, "invalid");
  const saved = await save({ ...(edit as ManualItemEdit), description: "Yeni" }, { file: precise });
  assert.deepEqual(saved.fields, { description: "Yeni" });
  assert.deepEqual([saved.price, saved.stock], [{ nf: 812.12345 }, { stok: 3 }]);
});

test("panel amounts take one separator as the decimal point and refuse thousands grouping; uploads keep their reading", () => {
  assert.equal(parsePanelDecimal("10,5"), 10.5);
  assert.equal(parsePanelDecimal("10.5"), 10.5);
  assert.equal(parsePanelDecimal("10,12345"), 10.12345);
  assert.equal(parsePanelDecimal(" 1 000 "), 1000);
  assert.equal(parsePanelDecimal(""), null);
  for (const text of ["1.000,50", "1,000.5", "1.000.000", "-5", "12 TL", ",5"]) assert.equal(parsePanelDecimal(text), "invalid", text);
  assert.ok(hasGrouping("1.000,50") && hasGrouping("1,000.5") && !hasGrouping("10,5"));
  // The xlsx/CSV parser is unchanged.
  assert.equal(parseDecimalText("1.000,50"), 1000.5);
  assert.equal(parseDecimalText("10,12345"), 1012345);
});
