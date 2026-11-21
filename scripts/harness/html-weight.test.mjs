import assert from "node:assert/strict";
import test from "node:test";
import { budgetFor, clientProps, flightOf, lighthouseMetrics, markdownTable, markupStats, median, parseBudget, samplePaths } from "./html-weight.mjs";

const pushes = [
  [1, '1:I["x",["static/chunks/card-abc.js"],"Card"]\n'],
  [1, '2:["$","$L1",null,{"title":"Merhaba","items":[1,2,3]}]\n'],
  [3, "ignored"],
];
const jsonLd = '{"@type":"Product"}';
const fixture = `<html><body><div class="a b">x</div><p class="long-class-name">y</p><script type="application/ld+json">${jsonLd}</script>`
  + pushes.map((push) => `<script>self.__next_f.push(${JSON.stringify(push)})</script>`).join("") + "</body></html>";

test("flightOf joins the type-1 pushes and counts the script bytes", () => {
  const { flight, bytes } = flightOf(fixture);
  assert.equal(flight, pushes[0][1] + pushes[1][1]);
  const expected = pushes.reduce((sum, push) => sum + Buffer.byteLength(`<script>self.__next_f.push(${JSON.stringify(push)})</script>`), 0);
  assert.equal(bytes, expected);
});

test("clientProps sums the props of a client component by the module row's name", () => {
  const stats = clientProps(flightOf(fixture).flight);
  assert.equal(stats.length, 1);
  const [name, entry] = stats[0];
  assert.match(name, /^Card \(card-abc\.js#x\)$/);
  assert.equal(entry.count, 1);
  assert.deepEqual(Object.keys(entry.props).sort(), ["items", "title"]);
  assert.ok(entry.bytes > 0);
});

test("markupStats counts class attributes, module rows and JSON-LD", () => {
  const stats = markupStats(fixture);
  assert.equal(stats.classBytes, "a b".length + "long-class-name".length);
  assert.equal(stats.moduleBytes, Buffer.byteLength(pushes[0][1].trimEnd()));
  assert.equal(stats.jsonLdBytes, jsonLd.length);
});

test("budgetFor lets the longest matching prefix decide; / matches only the home page", () => {
  const budget = parseBudget("/urun/=160, /=410,/urun/special=200");
  assert.deepEqual(budget, [["/urun/", 160], ["/", 410], ["/urun/special", 200]]);
  assert.equal(budgetFor(budget, "/"), 410);
  assert.equal(budgetFor(budget, "/?x=1"), 410);
  assert.equal(budgetFor(budget, "/urun/abc"), 160);
  assert.equal(budgetFor(budget, "/urun/special"), 200);
  assert.equal(budgetFor(budget, "/urun/special/sub?x=1"), 200);
  assert.equal(budgetFor(budget, "/katalog"), undefined);
  assert.equal(budgetFor([], "/"), undefined);
});

test("budgetFor matches on a segment boundary", () => {
  const budget = parseBudget("/marka=300");
  assert.equal(budgetFor(budget, "/marka"), 300);
  assert.equal(budgetFor(budget, "/marka/bosch"), 300);
  assert.equal(budgetFor(budget, "/markalar"), undefined);
  assert.equal(budgetFor(parseBudget("/urun=1"), "/urunler"), undefined);
});

test("parseBudget rejects anything but prefix=positive number", () => {
  for (const spec of ["", "  ", undefined, "bad", "/x=abc", "/x=", "/x=0", "/x=-5", "urun=5", "/a=1,", "/a=1,/b", "/a=1e3"]) {
    assert.throws(() => parseBudget(spec), /--budget/, String(spec));
  }
});

test("clientProps keeps two default-like modules of one chunk apart", () => {
  const flight = '1:I["10",["static/chunks/shared.js"],""]\n2:I["11",["static/chunks/shared.js"],""]\n'
    + '3:["$","$L1",null,{"href":"/a"}]\n4:["$","$L2",null,{"size":24}]\n';
  const names = clientProps(flight).map(([name]) => name).sort();
  assert.deepEqual(names, ["default (shared.js#10)", "default (shared.js#11)"]);
});

test("samplePaths picks the fitment product and strips the fragment", () => {
  const html = '<a href="/urun/plain-1">a</a><a href="/urun/fit-2#uyumlu-araclar">b</a><a href="/urun/fit-3#uyumlu-araclar">c</a>';
  assert.deepEqual(samplePaths(html), { product: "/urun/plain-1", fitmentProduct: "/urun/fit-2" });
  assert.deepEqual(samplePaths("<p>none</p>"), { product: undefined, fitmentProduct: undefined });
});

test("lighthouseMetrics reads the three audits and returns null on a missing audit or runtimeError", () => {
  const audit = (numericValue) => ({ numericValue });
  const lhr = { audits: { "largest-contentful-paint": audit(2500), "cumulative-layout-shift": audit(0.05), "total-blocking-time": audit(120) } };
  assert.deepEqual(lighthouseMetrics(lhr), { lcpMs: 2500, cls: 0.05, tbtMs: 120 });
  assert.equal(lighthouseMetrics({ audits: { "largest-contentful-paint": audit(1) } }), null);
  assert.equal(lighthouseMetrics({ ...lhr, runtimeError: { code: "NO_FCP" } }), null);
  assert.equal(lighthouseMetrics(undefined), null);
});

test("median handles odd, even and empty input", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), undefined);
});

test("markdownTable prints em dashes for missing vitals and ok / +N for the budget", () => {
  const row = (path, htmlKB, extra = {}) => ({ path, htmlKB, rscKB: 100, rscPct: 50, gzipKB: 40, ttfbMs: 30, ...extra });
  const table = markdownTable([row("/katalog", 335.6), row("/kategori/filtre", 384.5, { lcpMs: 2300, cls: 0.1, tbtMs: 80 }), row("/", 368.3)], parseBudget("/katalog=350,/kategori/=350"));
  const lines = table.split("\n");
  assert.equal(lines[0], "| Route | HTML KB | RSC KB (%) | gzip KB | TTFB ms | LCP s | CLS | TBT ms | Target KB | Status |");
  assert.equal(lines[2], "| /katalog | 335.6 | 100.0 (50) | 40.0 | 30 | — | — | — | ≤350 | ok |");
  assert.equal(lines[3], "| /kategori/filtre | 384.5 | 100.0 (50) | 40.0 | 30 | 2.30 | 0.100 | 80 | ≤350 | +35 |");
  assert.equal(lines[4], "| / | 368.3 | 100.0 (50) | 40.0 | 30 | — | — | — | — | — |");
});
