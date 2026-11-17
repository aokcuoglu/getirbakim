import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import type { ManualRow } from "../src/modules/suppliers/manual-template";

// Bulk price/stock CSV (#832) end to end in an isolated copy of the schema: an xlsx import, a CSV applied on top of it,
// and later uploads with the same and with a changed price cell. Nothing touches the shared database's tables.
const skip = !process.env.DATABASE_URL && "DATABASE_URL not set";
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let adminId = "";
const list = "test-yaglar";
const row = (code: string, price: number | null, stock: number | null): ManualRow => ({ sheet: "Ürünler", row: 2, code, name: `Yağ ${code}`, brand: "MOTUL",
  categoryId: 957, price, stock, barcode: null, description: null, viscosity: null, package: "1 L", approvals: null, imageUrl: null });

before(async () => {
  if (skip) return;
  schema = await isolatedSchema("manual_bulk_test");
  adminId = (await schema.pool.query<{ id: string }>("INSERT INTO accounts(name,email,password_hash,role,approved) VALUES('Test','admin@example.invalid','x','admin',true) RETURNING id::text")).rows[0].id;
  await schema.pool.query(`INSERT INTO source_categories(source,category_id,name,slug,path_ids,source_url,raw) VALUES('trodo',957,'Motor oils','motor-oils','{957}','https://example.invalid','{}')`);
  await schema.pool.query(`INSERT INTO source_category_labels(source,category_id,locale,name,slug) VALUES('trodo',957,'tr','Motor yağları','motor-yaglari')`);
});
after(async () => { await schema?.drop(); });

async function importList(rows: ManualRow[], listGroup = list) {
  const { saveManualDraft, importManualDraft } = await import("../src/modules/suppliers/manual-import");
  const id = await saveManualDraft(schema.pool, { listGroup, listName: "Test yağlar", fileName: "liste.xlsx", parsed: { rows, issues: [], sheets: [{ name: "Ürünler", rows: rows.length }] }, by: adminId });
  await importManualDraft(schema.pool, id, async () => assert.fail("no downloads"));
}

async function applyCsv(lines: string[], listGroup = list) {
  const { parseManualBulkCsv } = await import("../src/modules/suppliers/manual-bulk-csv");
  const { saveManualBulkDraft, applyManualBulkDraft } = await import("../src/modules/suppliers/manual-bulk");
  const parsed = parseManualBulkCsv(new TextEncoder().encode(["Marka;Stok Kodu;Liste Fiyatı;İskonto Oranı;Kârlılık Oranı;Stok Adedi", ...lines].join("\r\n")));
  const id = await saveManualBulkDraft(schema.pool, { listGroup, listName: "Test yağlar", fileName: "fiyat.csv", parsed, by: adminId });
  return { id, apply: () => applyManualBulkDraft(schema.pool, id, adminId) };
}

const item = async (code: string, listGroup = list) => (await schema.pool.query<{ id: string; price_data: Record<string, number> | null; stock_data: { stok: number } | null; price: number | null; markup: string | null; vat: string | null; changes: number }>(
  `SELECT i.id,i.price_data,i.stock_data,c.price_kurus AS price,p.markup_percent AS markup,p.vat_percent AS vat,
    (SELECT count(*)::int FROM supplier_item_changes h WHERE h.item_id=i.id AND h.import_id IS NULL) AS changes
  FROM supplier_items i LEFT JOIN commerce_catalog c ON c.id=i.id LEFT JOIN commerce_product_pricing p ON p.supplier_item_id=i.id
  WHERE i.supplier='manual' AND i.list_group=$1 AND i.code=$2`, [listGroup, code])).rows[0];

test("PostgreSQL: a confirmed CSV writes cost, list price, discount, markup and stock; later uploads follow the last edit", { skip }, async () => {
  const { ManualImportError } = await import("../src/modules/suppliers/manual-import");
  await schema.pool.query("UPDATE commerce_settings SET markup_percent=30,vat_percent=20");
  await importList([row("A1", 100, 5), row("B2", 200, 1)]);
  assert.deepEqual((await item("A1")).price_data, { nf: 100 });
  assert.equal((await item("A1")).price, 15600);
  // B2 has its own VAT rate: resetting the markup keeps it.
  const b2 = (await item("B2")).id;
  await schema.pool.query("INSERT INTO commerce_product_pricing(supplier_item_id,markup_percent,vat_percent,updated_by) VALUES($1,50,10,$2)", [b2, adminId]);

  const draft = await applyCsv(["MOTUL;A1;1.000;12,5;40;9", "MOTUL;B2;;;-;"]);
  const report = (await schema.pool.query("SELECT kind,status,report FROM manual_uploads WHERE id=$1", [draft.id])).rows[0];
  assert.equal(report.kind, "bulk"); assert.equal(report.status, "draft"); assert.equal(report.report.updated, 2); assert.equal(report.report.errors, 0);
  assert.equal((await item("A1")).price, 15600); // Nothing changes before the confirmation.
  assert.deepEqual(await draft.apply(), { listGroup: list, changed: 2 });

  let a1 = await item("A1");
  assert.deepEqual(a1.price_data, { nf: 875, list: 1000, discount: 12.5 });
  assert.deepEqual(a1.stock_data, { stok: 9 });
  assert.equal(Number(a1.markup), 40); assert.equal(a1.vat, null);
  assert.equal(a1.price, 147000); // 875 × 1,40 × 1,20
  assert.equal(a1.changes, 1);
  const b = await item("B2");
  assert.equal(b.markup, null); assert.equal(Number(b.vat), 10);
  assert.equal(b.price, 28600); // 200 × 1,30 × 1,10
  assert.equal(b.changes, 0);
  await assert.rejects(draft.apply(), (error: unknown) => error instanceof ManualImportError && error.reason === "decided");

  // Resetting a markup without a VAT rate removes the product's own record.
  await (await applyCsv(["MOTUL;A1;;;-;"])).apply();
  assert.equal((await schema.pool.query("SELECT count(*)::int AS n FROM commerce_product_pricing WHERE supplier_item_id=$1", [a1.id])).rows[0].n, 0);

  // The same file again: the CSV values still apply.
  await importList([row("A1", 100, 5), row("B2", 200, 1)]);
  a1 = await item("A1");
  assert.deepEqual(a1.price_data, { nf: 875, list: 1000, discount: 12.5 });
  assert.deepEqual(a1.stock_data, { stok: 9 });
  // A changed price cell wins; the unchanged stock cell keeps the CSV stock.
  await importList([row("A1", 120, 5), row("B2", 200, 1)]);
  a1 = await item("A1");
  assert.deepEqual(a1.price_data, { nf: 120 });
  assert.deepEqual(a1.stock_data, { stok: 9 });
  const fields = (await schema.pool.query("SELECT fields FROM manual_item_overrides WHERE list_group=$1 AND code='A1'", [list])).rows[0].fields;
  assert.deepEqual(fields, { bulk: { stock: { value: 9, file: 5 } } });

  // An xlsx confirmation cannot apply a CSV draft, and a CSV with errors is refused.
  const { importManualDraft } = await import("../src/modules/suppliers/manual-import");
  const invalid = await applyCsv(["MOTUL;ZZ;;;;1"]);
  await assert.rejects(importManualDraft(schema.pool, invalid.id), (error: unknown) => error instanceof ManualImportError && error.reason === "not-found");
  await assert.rejects(invalid.apply(), (error: unknown) => error instanceof ManualImportError && error.reason === "invalid");
});

test("PostgreSQL: xlsx list price and discount cells are stored and compared with a CSV's (#843)", { skip }, async () => {
  const group = "test-liste-fiyat";
  const listed = (discount: number, price: number) => ({ ...row("L1", price, 2), listPrice: 1000, discount });
  await importList([listed(12.5, 875)], group);
  assert.deepEqual((await item("L1", group)).price_data, { nf: 875, list: 1000, discount: 12.5 });
  const fieldsOf = async () => (await schema.pool.query("SELECT fields FROM manual_item_overrides WHERE list_group=$1 AND code='L1'", [group])).rows[0]?.fields;

  await (await applyCsv(["MOTUL;L1;;20;;"], group)).apply();
  assert.deepEqual((await item("L1", group)).price_data, { nf: 800, list: 1000, discount: 20 });
  assert.deepEqual((await fieldsOf()).bulk.price, { list: 1000, discount: 20, file: 875, fileList: 1000, fileDiscount: 12.5 });

  // The same file again: the CSV value stays.
  await importList([listed(12.5, 875)], group);
  assert.deepEqual((await item("L1", group)).price_data, { nf: 800, list: 1000, discount: 20 });
  // A changed discount cell wins and the CSV price is dropped.
  await importList([listed(15, 850)], group);
  assert.deepEqual((await item("L1", group)).price_data, { nf: 850, list: 1000, discount: 15 });
  assert.equal((await fieldsOf())?.bulk?.price, undefined);
});

test("PostgreSQL: a CSV draft is read one page at a time, errors first, pages clamped (#840)", { skip }, async () => {
  const { manualDraft } = await import("../src/modules/suppliers/manual-bulk");
  const { manualBulkPageSize } = await import("../src/modules/suppliers/manual-bulk-paging");
  const insert = async (kind: "bulk" | "list", report: object) => (await schema.pool.query<{ id: string }>(
    `INSERT INTO manual_uploads(list_group,list_name,file_name,rows,report,uploaded_by,kind) VALUES('paging','Paging','x.csv','[]',$1,$2,$3) RETURNING id`,
    [JSON.stringify(report), adminId, kind])).rows[0].id;
  const changes = Array.from({ length: 250 }, (_, i) => ({ id: `c${i}`, row: i + 2 }));
  // 150 findings alternating warning (even index) and error (odd index): 75 errors then 75 warnings.
  const issues = Array.from({ length: 150 }, (_, i) => ({ level: i % 2 ? "error" : "warning", row: i + 2, message: `m${i}` }));
  const id = await insert("bulk", { sheets: [], issues, errors: 75, warnings: 75, products: 250, added: 0, updated: 250, removed: 0, removedCodes: [], bulk: { unchanged: 0, changes } });
  const rows = (draft: Awaited<ReturnType<typeof manualDraft>>) => ({ changes: draft.report.bulk!.changes.map(change => change.row), issues: draft.report.issues });

  const first = await manualDraft(schema.pool, id, 1, 1);
  assert.equal(first.change_count, 250); assert.equal(first.issue_count, 150);
  assert.equal(rows(first).changes.length, manualBulkPageSize);
  assert.deepEqual(rows(first).changes.slice(0, 2), [2, 3]);
  assert.equal(rows(first).issues.length, manualBulkPageSize);
  assert.ok(rows(first).issues.slice(0, 75).every(issue => issue.level === "error"));
  assert.ok(rows(first).issues.slice(75).every(issue => issue.level === "warning"));

  const second = await manualDraft(schema.pool, id, 2, 2);
  assert.equal(rows(second).changes[0], 102);
  assert.deepEqual(rows(second).issues.map(issue => issue.level), Array(50).fill("warning"));
  // Stable: pages are consecutive slices of one order, so together they cover every finding once.
  const seen = [...rows(first).issues, ...rows(second).issues].map(issue => issue.row);
  assert.equal(new Set(seen).size, 150);

  // Past the last page → the last page; 0 → the first.
  const over = await manualDraft(schema.pool, id, 99, 99);
  assert.equal(rows(over).changes.length, 50); assert.equal(rows(over).changes[0], 202);
  assert.equal(rows(over).issues.length, 50);
  assert.equal(rows(await manualDraft(schema.pool, id, 0, 0)).changes[0], 2);

  const empty = await manualDraft(schema.pool, await insert("bulk", { sheets: [], issues: [], errors: 0, warnings: 0, products: 0, added: 0, updated: 0, removed: 0, removedCodes: [], bulk: { unchanged: 3, changes: [] } }), 1, 1);
  assert.deepEqual(rows(empty), { changes: [], issues: [] }); assert.equal(empty.change_count, 0); assert.equal(empty.issue_count, 0);

  // An xlsx draft is returned whole.
  const list = Array.from({ length: 120 }, (_, i) => ({ level: "warning", row: i, message: "w" }));
  const xlsx = await manualDraft(schema.pool, await insert("list", { sheets: [], issues: list, errors: 0, warnings: 120, products: 0, added: 0, updated: 0, removed: 0, removedCodes: [] }), 1, 1);
  assert.equal(xlsx.report.issues.length, 120); assert.equal(xlsx.report.bulk, undefined);
});

test("PostgreSQL: a list price, discount and stock saved on the item page act like a CSV edit (#842)", { skip }, async () => {
  const { updateManualItem } = await import("../src/modules/suppliers/manual-import");
  const group = "test-panel-fiyat";
  const fieldsOf = async () => (await schema.pool.query("SELECT fields FROM manual_item_overrides WHERE list_group=$1 AND code='P1'", [group])).rows[0]?.fields;
  await importList([row("P1", 100, 5)], group);
  const id = (await item("P1", group)).id;
  const noDownload = async () => assert.fail("no downloads");
  await updateManualItem(schema.pool, id, { pricing: { list: 1000, discount: 20 }, stock: 8 }, adminId, noDownload);
  let p1 = await item("P1", group);
  assert.deepEqual(p1.price_data, { nf: 800, list: 1000, discount: 20 });
  assert.deepEqual(p1.stock_data, { stok: 8 });
  assert.equal(p1.price, 124800); // 800 × 1,30 × 1,20 (settings of the first test)
  assert.equal(p1.changes, 1);
  assert.deepEqual((await fieldsOf()).bulk, { price: { list: 1000, discount: 20, file: 100, by: "panel" }, stock: { value: 8, file: 5, by: "panel" } });

  // The same file again: the panel values stay; a changed price cell wins, the unchanged stock cell keeps the panel stock.
  await importList([row("P1", 100, 5)], group);
  assert.deepEqual((await item("P1", group)).price_data, { nf: 800, list: 1000, discount: 20 });
  await importList([row("P1", 120, 5)], group);
  p1 = await item("P1", group);
  assert.deepEqual([p1.price_data, p1.stock_data], [{ nf: 120 }, { stok: 8 }]);
  assert.deepEqual((await fieldsOf()).bulk, { stock: { value: 8, file: 5, by: "panel" } });

  // A later CSV is the last edit: its record carries no panel mark.
  await (await applyCsv(["MOTUL;P1;;;;6"], group)).apply();
  assert.deepEqual((await fieldsOf()).bulk.stock, { value: 6, file: 5 });
  // Emptying the stock on the item page returns to the file's cell.
  await updateManualItem(schema.pool, id, { stock: null }, adminId, noDownload);
  assert.deepEqual((await item("P1", group)).stock_data, { stok: 5 });
  assert.equal((await fieldsOf())?.bulk, undefined);
});
