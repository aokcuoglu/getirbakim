import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import { activeBulk, ManualImportError, updateManualItem, withOverrides, type downloadImage, type ManualOverrides, type ManualValues } from "../src/modules/suppliers/manual-import";

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
const unchanged = { price: null, stock: null, barcode: null, description: null, viscosity: null, package: null, approvals: null, imageUrl: null };

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

test("saving the item page keeps the CSV values in force and does not replace them with the form's", async () => {
  const bulk = { price: { list: 1000, discount: 10, file: 812.5 }, stock: { value: 9, file: 3 } };
  const { pool, statements, params } = fakePool({ overrides: { description: "Eski", bulk } });
  await updateManualItem(pool, itemId, { ...unchanged, price: 1, stock: 1, description: "Yeni" }, null, noDownload);
  const insert = statements.findIndex(sql => sql.startsWith("INSERT INTO manual_item_overrides"));
  assert.deepEqual(JSON.parse(params[insert][2] as string), { description: "Yeni", bulk });
  const update = statements.findIndex(sql => sql.startsWith("WITH old AS"));
  assert.deepEqual(JSON.parse(params[update][2] as string), { nf: 900, list: 1000, discount: 10 });
  assert.deepEqual(JSON.parse(params[update][3] as string), { stok: 9 });
});
