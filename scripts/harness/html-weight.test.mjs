import assert from "node:assert/strict";
import test from "node:test";
import { budgetFor, clientProps, flightOf, markupStats, parseBudget } from "./html-weight.mjs";

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
  assert.match(name, /^Card \(card-abc\.js\)$/);
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
