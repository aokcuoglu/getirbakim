import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { manualKind, manualSearchTerms, pickSameProducts, sameLinked, sameScope, type SameEntry } from "../src/modules/admin/product-matching-same";
import { matchingBack, safeMatchingBack, withMatchingFlag } from "../src/modules/admin/product-matching-back";
import { bulkAcceptableSql, bulkCandidateReasons, isBulkReason, isPatternBulkReason, wholeBulkReasons } from "../src/modules/admin/product-matching-sql";

// The "Eşleşenler" tab's order must stay the SQL it replaced (#504): ORDER BY <column> ASC|DESC NULLS LAST, then
// (primary_price-selling_price) DESC NULLS LAST, then primary_id (position).
const entry = (primary_id: string, position: number, selling: string | null, selling_price: number | null, primary_price: number | null, codes = "", manual = false): SameEntry =>
  ({ primary_id, position, selling, selling_price, primary_price, codes, manual });
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
  assert.equal(sameScope("manual"), "manual");
  // "split" is the manual view's old name; saved links keep working.
  assert.equal(sameScope("split"), "manual");
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

test("linked narrows to groups with a hand-linked offer", () => {
  const entries = [
    entry("a", 0, "dinamik", 100, 120, "AAA1", true), entry("b", 1, "basbug", 100, 100, "AAA2"),
    entry("c", 2, "dinamik", 90, 150, "BBB1", true), entry("d", 3, "dinamik", 80, 90, "AAA3", true),
    ...Array.from({ length: 28 }, (_, index) => entry(`m${index}`, 10 + index, "dinamik", 100, 200 + index, "", true)),
  ];
  assert.deepEqual(ids(entries, { linked: true, pageSize: 100 }).filter(id => !id.startsWith("m")).sort(), ["a", "c", "d"]);
  assert.equal(ids(entries, { linked: true, pageSize: 100 }).includes("b"), false);
  assert.deepEqual(ids(entries, { linked: true, scope: "dinamik", q: "AAA", pageSize: 100 }).sort(), ["a", "d"]);
  assert.deepEqual(ids(entries, { linked: true, scope: "basbug" }), []);
  assert.deepEqual(ids(entries, { linked: true, q: "BBB" }), ["c"]);
  assert.deepEqual(ids(entries, { linked: true, sort: "primary", dir: "asc", pageSize: 3 }), ["d", "a", "c"]);
  const page2 = pickSameProducts(entries, { scope: "all", q: "", linked: true, page: 2, pageSize: 25 });
  assert.equal(page2.total, 31);
  assert.equal(page2.listed.length, 6);
  assert.equal(pickSameProducts(entries, { scope: "all", q: "", linked: false, page: 1, pageSize: 100 }).total, 32);
  assert.equal(pickSameProducts(entries, { scope: "all", q: "", page: 1, pageSize: 100 }).total, 32);
  assert.equal(sameLinked("manual"), true);
  assert.equal(sameLinked("x"), false);
  assert.equal(sameLinked(undefined), false);
});

// "Elle kararlar" search (#523): codes compare compacted, names as db search_normalize writes them.
test("manual decision search requires every word, each as a code or a normalized text", () => {
  assert.deepEqual(manualSearchTerms("FEBI 100261"), [{ code: "FEBI", text: "febi" }, { code: "100261", text: "100261" }]);
  assert.deepEqual(manualSearchTerms("hu 7008-z"), [{ code: "HU", text: "hu" }, { code: "7008Z", text: "7008 z" }]);
  assert.deepEqual(manualSearchTerms("Yağ  Filtresi"), [{ code: "YAG", text: "yag" }, { code: "FILTRESI", text: "filtresi" }]);
  assert.deepEqual(manualSearchTerms("febi FEBI - /"), [{ code: "FEBI", text: "febi" }]);
  assert.deepEqual(manualSearchTerms("  "), []);
  assert.deepEqual(manualSearchTerms(undefined), []);
  assert.equal(manualSearchTerms("a b c d e f g h").length, 6);
  assert.equal(manualSearchTerms("x".repeat(120))[0].code.length, 80);
});

// Suffix differences are mostly other parts (FEBI 100261 vs 1002610, #524): only reviewed safe endings are merged in
// bulk (#535), so suffix is a pattern-checked bulk reason; prefix and leading_zero are bulk as a whole.
test("bulk merge covers prefix and leading_zero, and suffix only through reviewed patterns", () => {
  assert.deepEqual([...bulkCandidateReasons].sort(), ["leading_zero", "prefix", "suffix"]);
  assert.deepEqual([...wholeBulkReasons].sort(), ["leading_zero", "prefix"]);
  for (const reason of ["prefix", "leading_zero", "suffix"]) assert.equal(isBulkReason(reason), true, reason);
  assert.equal(isBulkReason("oem"), false);
  assert.equal(isPatternBulkReason("suffix"), true);
  assert.equal(isPatternBulkReason("prefix"), false);
  assert.equal(isPatternBulkReason("leading_zero"), false);
  assert.equal(isPatternBulkReason("oem"), false);
  // The SQL rule lets suffix in only with a 'same' verdict; prefix/leading_zero are listed whole.
  assert.match(bulkAcceptableSql, /c\.reason IN \('prefix','leading_zero'\) OR c\.reason='suffix' AND product_suffix_verdict\(a\.brand,a\.part_number,b\.part_number\)='same'/);
  assert.match(bulkAcceptableSql, /c\.name_conflict IS NOT TRUE/);
});

// The "back" field of the matching forms (#560): only this page, with its query, is a valid return path.
test("safeMatchingBack keeps this page and its query", () => {
  assert.equal(safeMatchingBack("/yonetim/urun-eslestirme"), "/yonetim/urun-eslestirme");
  assert.equal(safeMatchingBack("/yonetim/urun-eslestirme?tab=same&q=abc&page=2"), "/yonetim/urun-eslestirme?tab=same&q=abc&page=2");
});

test("safeMatchingBack rejects anything else", () => {
  for (const value of ["//evil", "//evil.com/yonetim/urun-eslestirme", "https://x", "https://x/yonetim/urun-eslestirme", "/yonetim/urunler",
    "/yonetim/urun-eslestirme/../urunler", "/yonetim/urun-eslestirme#x", "/yonetim/urun-eslestirme?a=b\nc", "/yonetim/urun-eslestirme\n", "/yonetim/urun-eslestirme?a=b\u0000", "/\\evil", "%2F%2Fevil",
    "/yonetim%2F%2Fevil", "/yonetim/urun-eslestirme-x", "/YONETIM/urun-eslestirme", "", undefined, null, 5])
    assert.equal(safeMatchingBack(value), "/yonetim/urun-eslestirme", String(value));
});

test("withMatchingFlag appends to the existing query", () => {
  assert.equal(withMatchingFlag("/yonetim/urun-eslestirme", "refreshed=1"), "/yonetim/urun-eslestirme?refreshed=1");
  assert.equal(withMatchingFlag("/yonetim/urun-eslestirme?tab=same", "refreshed=1"), "/yonetim/urun-eslestirme?tab=same&refreshed=1");
});

test("withMatchingFlag drops earlier result flags and keeps the rest", () => {
  const url = new URL(`http://x${withMatchingFlag("/yonetim/urun-eslestirme?tab=same&error=refresh&refreshed=1&q=ab&carried_hidden=1&carried_oem=1&images=2&refs=1&specs=3", "refreshed=1")}`);
  assert.equal(url.pathname, "/yonetim/urun-eslestirme");
  assert.deepEqual([...url.searchParams], [["tab", "same"], ["q", "ab"], ["refreshed", "1"]]);
});

test("matchingBack schema falls back to the plain page when back is missing", () => {
  assert.equal(matchingBack.parse(undefined), "/yonetim/urun-eslestirme");
  assert.equal(z.object({ back: matchingBack }).parse({}).back, "/yonetim/urun-eslestirme");
  assert.equal(z.object({ back: matchingBack }).parse({ back: "/yonetim/urun-eslestirme?tab=same" }).back, "/yonetim/urun-eslestirme?tab=same");
});

test("manual decision kind filter accepts only merge and split", () => {
  assert.equal(manualKind("merge"), "merge");
  assert.equal(manualKind("split"), "split");
  for (const raw of [undefined, "", "all", "MERGE", "merge ", "constructor", "__proto__", "1"]) assert.equal(manualKind(raw), null);
});
