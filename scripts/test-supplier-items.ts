import assert from "node:assert/strict";
import { test } from "node:test";
import type { QueryResultRow } from "pg";
import {
  SUPPLIER_MAX_PAGE, SUPPLIER_PAGE_SIZE, pageBounds, requestedPage, supplierItemPage, withSale, type CatalogSale, type SupplierItemQuery,
} from "../src/modules/admin/supplier-items";

type Row = { id: string; code: string };
const ids = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(from + i).padStart(12, "0")}`);

test("requested page reads the URL, never below 1 or past the cap", () => {
  assert.equal(requestedPage(undefined), 1);
  assert.equal(requestedPage(""), 1);
  assert.equal(requestedPage("abc"), 1);
  assert.equal(requestedPage("2.5"), 1);
  assert.equal(requestedPage("-4"), 1);
  assert.equal(requestedPage("7"), 7);
  assert.equal(requestedPage(String(SUPPLIER_MAX_PAGE)), SUPPLIER_MAX_PAGE);
  assert.equal(requestedPage("18000"), SUPPLIER_MAX_PAGE);
});

test("page bounds cap the page count and say when rows remain past it", () => {
  assert.deepEqual(pageBounds(0), { pages: 1, capped: false });
  assert.deepEqual(pageBounds(50), { pages: 1, capped: false });
  assert.deepEqual(pageBounds(51), { pages: 2, capped: false });
  assert.deepEqual(pageBounds(SUPPLIER_MAX_PAGE * SUPPLIER_PAGE_SIZE), { pages: SUPPLIER_MAX_PAGE, capped: false });
  assert.deepEqual(pageBounds(SUPPLIER_MAX_PAGE * SUPPLIER_PAGE_SIZE + 1), { pages: SUPPLIER_MAX_PAGE, capped: true });
  assert.deepEqual(pageBounds(940_408), { pages: SUPPLIER_MAX_PAGE, capped: true });
});

test("storefront fields merge by id in the rows' order; unsold rows read null", () => {
  const rows: Row[] = [{ id: "c", code: "C" }, { id: "a", code: "A" }, { id: "b", code: "B" }];
  const sales: CatalogSale[] = [
    { id: "a", price_kurus: 1250, available: true, stock_label: "Stokta" },
    { id: "c", price_kurus: 99, available: false, stock_label: null },
    { id: "a", price_kurus: 1, available: false, stock_label: "ikinci" },
  ];
  assert.deepEqual(withSale(rows, sales), [
    { id: "c", code: "C", sale_price_kurus: 99, sale_available: false, sale_stock_label: null },
    { id: "a", code: "A", sale_price_kurus: 1250, sale_available: true, sale_stock_label: "Stokta" },
    { id: "b", code: "B", sale_price_kurus: null, sale_available: null, sale_stock_label: null },
  ]);
});

/** A fake pool over `total` rows: records every statement and answers count, page and catalog reads. */
function fakeQuery(total: number, onSale: (id: string) => boolean = () => true) {
  const all = ids(total).map((id, i) => ({ id, code: `K${String(i).padStart(7, "0")}` }));
  const calls: { text: string; values: unknown[] }[] = [];
  const query: SupplierItemQuery = async <T extends QueryResultRow>(text: string, values: unknown[]) => {
    calls.push({ text, values });
    if (text.startsWith("SELECT count(*)")) return { rows: [{ count: total }] as unknown as T[] };
    if (text.includes("FROM commerce_catalog")) {
      const wanted = values[0] as string[];
      return { rows: wanted.filter(onSale).reverse().map(id => ({ id, price_kurus: 100, available: true, stock_label: "Stokta" })) as unknown as T[] };
    }
    const [limit, offset] = values.slice(-2) as number[];
    return { rows: all.slice(offset, offset + limit) as unknown as T[] };
  };
  return { query, calls };
}

test("a page reads count and rows together, then one catalog read for its ids", async () => {
  const { query, calls } = fakeQuery(120, id => id.endsWith("51"));
  const result = await supplierItemPage<Row>({ where: "supplier=$1", values: ["seta"], order: "code,id", page: "2", query });
  assert.deepEqual([result.total, result.page, result.pages, result.capped], [120, 2, 3, false]);
  assert.equal(result.items.length, 50);
  assert.equal(result.items[0].code, "K0000050");
  assert.equal(result.items[1].sale_price_kurus, 100);
  assert.equal(result.items[0].sale_price_kurus, null);
  assert.equal(calls.length, 3);
  assert.match(calls[1].text, /^SELECT \* FROM supplier_items WHERE supplier=\$1 ORDER BY code,id LIMIT \$2 OFFSET \$3$/);
  assert.deepEqual(calls[1].values, ["seta", 50, 50]);
  assert.equal(calls[2].text, "SELECT id,price_kurus,available,stock_label FROM commerce_catalog WHERE id = ANY($1::uuid[])");
  assert.deepEqual(calls[2].values, [result.items.map(item => item.id)]);
});

test("a page past the end re-reads the last page; a page past the cap is clamped before reading", async () => {
  const short = fakeQuery(120);
  const end = await supplierItemPage<Row>({ where: "true", values: [], order: "code,id", page: "9", query: short.query });
  assert.deepEqual([end.page, end.pages, end.items.length, end.items[0].code], [3, 3, 20, "K0000100"]);
  assert.deepEqual(short.calls.filter(call => call.text.includes("LIMIT")).map(call => call.values.at(-1)), [400, 100]);

  const deep = fakeQuery(SUPPLIER_MAX_PAGE * SUPPLIER_PAGE_SIZE + 500);
  const capped = await supplierItemPage<Row>({ where: "true", values: [], order: "code,id", page: "18000", query: deep.query });
  assert.deepEqual([capped.page, capped.pages, capped.capped], [SUPPLIER_MAX_PAGE, SUPPLIER_MAX_PAGE, true]);
  assert.deepEqual(deep.calls.filter(call => call.text.includes("LIMIT")).map(call => call.values.at(-1)), [(SUPPLIER_MAX_PAGE - 1) * SUPPLIER_PAGE_SIZE]);
});

test("a known total replaces the count; an empty page skips the catalog read", async () => {
  const { query, calls } = fakeQuery(0);
  const result = await supplierItemPage<Row>({ where: "true", values: [], order: "code,id", page: undefined, total: Promise.resolve(0), query });
  assert.deepEqual([result.total, result.page, result.pages, result.items], [0, 1, 1, []]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /LIMIT \$1 OFFSET \$2$/);
});
