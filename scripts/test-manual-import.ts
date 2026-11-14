import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import { ManualImportError, updateManualItem, type downloadImage, type ManualValues } from "../src/modules/suppliers/manual-import";

// updateManualItem against a recorded fake pool: no database, the statements and their order are what is checked.
const itemId = "da883a2e-1351-430e-a296-0a46c114a546";
const file: ManualValues = { code: "100047", name: "Motor Yağı 5W-30 4 L", brand: "MOTUL", categoryId: 957, price: 812.5, stock: 3,
  barcode: null, description: null, viscosity: "5W-30", package: "4 L", approvals: null, imageUrl: null };
const category = { id: 957, name: "Motor yağları", path: [{ id: 956, name: "Yağlar ve sıvılar" }, { id: 957, name: "Motor yağları" }] };

function fakePool(options: { file?: ManualValues; storedImage?: string; failOn?: RegExp } = {}) {
  const statements: string[] = [];
  let released = false;
  const run = async (sql: string) => {
    statements.push(sql.replace(/\s+/g, " ").trim());
    if (options.failOn?.test(sql)) throw Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });
    if (/FROM supplier_items WHERE id=\$1 AND supplier/.test(sql))
      return { rows: [{ list_group: "madeni-yaglar", code: file.code, product_data: { list_name: "Madeni yağlar", file: options.file ?? file } }], rowCount: 1 };
    if (/FROM source_categories/.test(sql)) return { rows: [category], rowCount: 1 };
    if (/FROM product_media_objects/.test(sql))
      return { rows: options.storedImage ? [{ source_url: options.storedImage, id: "img-1", width: 800, height: 600 }] : [], rowCount: options.storedImage ? 1 : 0 };
    if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ locked: true }], rowCount: 1 };
    if (/SELECT id,code FROM supplier_items/.test(sql)) return { rows: [{ id: itemId, code: file.code }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  const pool = { query: run, connect: async () => ({ query: run, release: () => { released = true; } }) } as unknown as Pool;
  return { pool, statements, released: () => released };
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
