import assert from "node:assert/strict";
import test from "node:test";
import { pickSameProducts, sameScope, type SameEntry } from "../src/modules/admin/product-matching-same";
import { bulkCandidateReasons, isBulkReason } from "../src/modules/admin/product-matching-sql";

// The "Eşleşenler" tab's order must stay the SQL it replaced (#504): ORDER BY <column> ASC|DESC NULLS LAST, then
// (primary_price-selling_price) DESC NULLS LAST, then primary_id (position).
const entry = (primary_id: string, position: number, selling: string | null, selling_price: number | null, primary_price: number | null, codes = ""): SameEntry =>
  ({ primary_id, position, selling, selling_price, primary_price, codes });
const ids = (entries: SameEntry[], options: Partial<Parameters<typeof pickSameProducts>[1]> = {}) =>
  pickSameProducts(entries, { scope: "all", q: "", page: 1, pageSize: 25, ...options }).listed.map(item => item.primary_id);

test("a sorted column puts NULL last in both directions", () => {
  const entries = [entry("a", 1, null, null, 500), entry("b", 2, "basbug", 300, 300), entry("c", 3, "dinamik", 100, 400)];
  assert.deepEqual(ids(entries, { sort: "selling" }), ["c", "b", "a"]);
  assert.deepEqual(ids(entries, { sort: "selling", dir: "desc" }), ["b", "c", "a"]);
  const primary = [entry("a", 1, "basbug", 100, null), entry("b", 2, "basbug", 100, 200), entry("c", 3, "basbug", 100, 300)];
  assert.deepEqual(ids(primary, { sort: "primary" }), ["b", "c", "a"]);
  assert.deepEqual(ids(primary, { sort: "primary", dir: "desc" }), ["c", "b", "a"]);
});

test("ties fall back to the largest saving (NULL last), then position", () => {
  const entries = [
    entry("d", 4, "dinamik", 100, 150), entry("a", 1, "dinamik", 100, 400), entry("n", 0, null, null, 400),
    entry("c", 3, "dinamik", 100, 150), entry("b", 2, "dinamik", 100, 150),
  ];
  // Default order: saving 300, then the 50s by position, then the group without a saving.
  assert.deepEqual(ids(entries), ["a", "b", "c", "d", "n"]);
  // Equal selling prices: the same fallback; the NULL selling price stays last.
  assert.deepEqual(ids(entries, { sort: "selling", dir: "desc" }), ["a", "b", "c", "d", "n"]);
  // Unknown sort keys are ignored, not looked up on the object.
  assert.deepEqual(ids(entries, { sort: "constructor" }), ["a", "b", "c", "d", "n"]);
});

test("scope keeps groups by the supplier sold now; none is nothing sold; split and unknown values are recognised", () => {
  const entries = [entry("a", 1, "dinamik", 100, 200), entry("b", 2, "basbug", 100, 100), entry("c", 3, null, null, 100), entry("d", 4, "manual", 90, 100)];
  assert.deepEqual(ids(entries, { scope: "none" }), ["c"]);
  assert.deepEqual(ids(entries, { scope: "dinamik" }), ["a"]);
  assert.deepEqual(ids(entries, { scope: "basbug" }), ["b"]);
  assert.deepEqual(ids(entries, { scope: "all" }), ["a", "d", "b", "c"]);
  assert.equal(sameScope("split"), "split");
  assert.equal(sameScope("none"), "none");
  assert.equal(sameScope(undefined), "all");
  assert.equal(sameScope("everything"), "all");
});

test("q matches inside any offer code but not across two codes", () => {
  const entries = [entry("a", 1, "basbug", 100, 100, "W71295 HU7008Z"), entry("b", 2, "basbug", 100, 100, "OC90"), entry("c", 3, "basbug", 100, 100, "")];
  assert.deepEqual(ids(entries, { q: "7008" }), ["a"]);
  assert.deepEqual(ids(entries, { q: "OC9" }), ["b"]);
  assert.deepEqual(ids(entries, { q: "95HU" }), []);
  assert.deepEqual(ids(entries, { q: "" }), ["a", "b", "c"]);
});

test("pages are cut after filtering and sorting; total counts the filtered groups", () => {
  const entries = Array.from({ length: 30 }, (_, index) => entry(`p${index}`, index, "dinamik", 100, 100 + index));
  const first = pickSameProducts(entries, { scope: "all", q: "", page: 1, pageSize: 25 });
  const second = pickSameProducts(entries, { scope: "all", q: "", page: 2, pageSize: 25 });
  assert.equal(first.total, 30);
  assert.equal(first.listed[0].primary_id, "p29");
  assert.deepEqual(second.listed.map(item => item.primary_id), ["p4", "p3", "p2", "p1", "p0"]);
  assert.deepEqual(pickSameProducts(entries, { scope: "all", q: "", page: 9, pageSize: 25 }).listed, []);
});

// Suffix differences are mostly other parts (FEBI 100261 vs 1002610, #524): never merged in bulk.
test("bulk merge covers prefix and leading_zero, never suffix", () => {
  assert.deepEqual([...bulkCandidateReasons].sort(), ["leading_zero", "prefix"]);
  assert.equal(isBulkReason("suffix"), false);
  assert.equal(isBulkReason("leading_zero"), true);
  assert.equal(isBulkReason("prefix"), true);
});
