import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductFitment } from "../src/components/product-fitment";
import { ProductReferences } from "../src/components/product-references";
import { fitmentInitialGroups, fitmentView, initialFitmentView, type FitmentSource } from "../src/modules/store/product-fitment-view";
import { initialReferenceView, referenceInitialCodes, referenceInitialRows, referenceRowCodes, type ReferenceRow } from "../src/modules/store/product-reference-view";

// #1211: a product page with hundreds of reference brands and dozens of fitted models keeps its HTML small (budget
// ≤ 150 KB): the OEM list prints a capped selection, the fitment list its first light group headers.

const rest = "/api/product-references/9db4f695-185e-4d35-b8e4-190bfb549e91?v=abc";
const codes = (brand: string, count: number) => Array.from({ length: count }, (_, index) => `${brand}-${index + 1}`);
const brand = (index: number) => `MARKA ${String(index).padStart(3, "0")}`;
const source = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

test("initialReferenceView ships a list within the caps whole", () => {
  const each = Math.min(referenceRowCodes, Math.floor(referenceInitialCodes / referenceInitialRows));
  const rows: ReferenceRow[] = Array.from({ length: referenceInitialRows }, (_, index) => [brand(index), codes(brand(index), each)]);
  rows[0] = [rows[0][0], [["0 986 1", "/urun/a-1"], ...codes("A", each - 1)]];
  const view = initialReferenceView(rows, new Set(), rest);
  assert.deepEqual(view, { rows, rowCount: referenceInitialRows });
  assert.equal("rest" in view, false);
  assert.deepEqual(initialReferenceView([], new Set(), rest), { rows: [], rowCount: 0 });
});

test("initialReferenceView cuts past any cap and names the rest", () => {
  // One row too many, one number too many in a row, or too many numbers in all.
  const many: ReferenceRow[] = Array.from({ length: referenceInitialRows + 1 }, (_, index) => [brand(index), ["1"]]);
  assert.equal(initialReferenceView(many, new Set(), rest).rest, rest);
  assert.equal(initialReferenceView(many, new Set(), rest).rows.length, referenceInitialRows);
  const wide: ReferenceRow[] = [["BOSCH", codes("B", referenceRowCodes + 1)]];
  assert.deepEqual(initialReferenceView(wide, new Set(), rest), { rows: [["BOSCH", codes("B", referenceRowCodes), 1]], rowCount: 1, rest });
  const full: ReferenceRow[] = Array.from({ length: 20 }, (_, index) => [brand(index), codes(brand(index), referenceRowCodes)]);
  const capped = initialReferenceView(full, new Set(), rest);
  assert.equal(capped.rows.length, referenceInitialCodes / referenceRowCodes);
  assert.equal(capped.rows.reduce((sum, [, shown]) => sum + shown.length, 0), referenceInitialCodes);
  assert.equal(capped.rowCount, 20);
  assert.equal(capped.rest, rest);
});

test("initialReferenceView prints linked rows, then vehicle makers' OEM rows, then the others, in alphabetical order", () => {
  const rows: ReferenceRow[] = [];
  for (let index = 0; index < 40; index++) rows.push([brand(index), [`${index}`]]);
  // Linked rows and OEM rows at the end of the alphabet still make the cut.
  rows[39] = [brand(39), ["39", ["39-L", "/urun/x-39"]]];
  rows[38] = [brand(38), [["38-L", "/katalog?q=38L&searchBy=code"]]];
  const oem = new Set([brand(30), brand(31), brand(32)]);
  const view = initialReferenceView(rows, oem, rest);
  const printed = view.rows.map(([name]) => name);
  assert.equal(printed.length, referenceInitialRows);
  for (const name of [brand(38), brand(39), brand(30), brand(31), brand(32)]) assert.ok(printed.includes(name), name);
  // The remaining places go to the other brands in alphabetical order.
  assert.deepEqual(printed.filter(name => ![brand(38), brand(39), ...oem].includes(name)), Array.from({ length: referenceInitialRows - 5 }, (_, index) => brand(index)));
  assert.deepEqual(printed, [...printed].sort((a, b) => a.localeCompare(b)));
  // A cut row puts its linked numbers first; a whole row keeps its order.
  assert.deepEqual(view.rows.find(([name]) => name === brand(39)), [brand(39), ["39", ["39-L", "/urun/x-39"]]]);
  const linkedLast: ReferenceRow[] = [["FEBI", [...codes("F", 8), ["F-L", "/urun/f-l"]]]];
  assert.deepEqual(initialReferenceView(linkedLast, new Set(), rest).rows, [["FEBI", [["F-L", "/urun/f-l"], ...codes("F", referenceRowCodes - 1)], 9 - referenceRowCodes]]);
});

const css = source("../src/app/storefront.css");
const defined = (name: string) => new RegExp(`\\.${name}\\s*[{,>]`).test(css);

test("ProductReferences prints every row it is given, its links and the show-all button", () => {
  const rows: ReferenceRow[] = Array.from({ length: 30 }, (_, index) => [brand(index), index % 5 === 0 ? [[`${index}-L`, `/urun/p-${index}`], ...codes("C", 8)] : codes("C", 2)]);
  const view = initialReferenceView(rows, new Set(), rest);
  const html = renderToStaticMarkup(<ProductReferences view={view} title="BOSCH 0 258 986 507 OEM ve muadil numaraları"/>);
  assert.ok(html.startsWith('<section class="mt-[42px] scroll-mt-[110px]" id="oem-numaralari"><h2 class="reference-title">BOSCH 0 258 986 507 OEM ve muadil numaraları</h2>'));
  assert.ok(html.includes('<dl class="reference-list" tabindex="0" aria-label="OEM ve muadil numaraları">'));
  const printed = html.split('<div class="reference-row">').slice(1);
  assert.equal(printed.length, view.rows.length);
  for (const [name, shown] of view.rows) {
    assert.ok(html.includes(`<dt>${name}</dt>`), name);
    for (const code of shown) if (typeof code !== "string") assert.ok(html.includes(`<a class="reference-link" href="${code[1]}">${code[0]}</a>`), code[0]);
  }
  assert.ok(html.includes(`<span class="reference-more">+${9 - referenceRowCodes} numara</span>`));
  assert.ok(html.includes(`>Tüm ${rows.length} markayı göster</button>`));
  assert.ok(html.includes('class="fitment-text-button w-full"'));
  // A row is its brand, its numbers and at most a short count: no class list per number.
  for (const row of printed) {
    const bare = `<div class="reference-row">${row.replace(/<a class="reference-link" href="[^"]*">[^<]*<\/a>|<span>[^<]*<\/span>/g, "").split("</dl>")[0]}`;
    assert.ok(Buffer.byteLength(bare) <= 120, `row ${Buffer.byteLength(bare)} bytes: ${bare}`);
  }
  // A list printed whole has no button.
  const whole = renderToStaticMarkup(<ProductReferences view={initialReferenceView(rows.slice(0, 3).map(([name]) => [name, ["1"]]), new Set(), rest)} title="T"/>);
  assert.ok(!whole.includes("<button") && !whole.includes("reference-more"));
});

test("ProductFitment prints the first groups with no svg in a group header", () => {
  const sources: FitmentSource[] = Array.from({ length: 12 }, (_, index) => ({ engineAndCodes: "2.0 TDI CRBC", fuel: "Diesel", ps: 150, kw: 110, cc: 1968,
    from: "04/2013", to: "03/2017", makeKey: "VOLKSWAGEN", makeLabel: "Volkswagen", modelLabel: `Volkswagen Model ${index + 1}`, modelHref: `/yedek-parca/volkswagen/model-${index + 1}` }));
  const view = initialFitmentView(fitmentView(sources), "/api/product-fitments/9db4f695-185e-4d35-b8e4-190bfb549e91?v=abc");
  const html = renderToStaticMarkup(<ProductFitment view={view}/>);
  const groups = html.split('class="fitment-group"').slice(1);
  assert.equal(groups.length, fitmentInitialGroups);
  for (const group of groups) assert.ok(!group.split("</a></div>")[0].includes("<svg"), "a group header carries an svg");
  for (const name of ["fitment-toolbar", "fitment-select", "fitment-search", "fitment-status", "fitment-text-button"]) assert.ok(html.includes(`class="${name}`), name);
  assert.ok(html.includes(">Tüm 12 modeli göster</button>"));
  assert.ok(!html.includes('data-slot="button"') && !html.includes('data-slot="native-select'));
});

test("the product page lists use plain controls and named classes", () => {
  for (const file of ["product-references", "product-fitment"]) {
    const text = source(`../src/components/${file}.tsx`);
    for (const ui of ["@/components/ui/native-select", "@/components/ui/button"]) assert.ok(!text.includes(ui), `${file}.tsx imports ${ui}`);
  }
  for (const match of source("../src/components/product-references.tsx").matchAll(/className="([^"]*)"/g)) {
    assert.ok(match[1].length <= 120, `product-references.tsx: ${match[1].slice(0, 60)}…`);
  }
  for (const name of ["fitment-toolbar", "fitment-select", "fitment-search", "fitment-status", "fitment-alert", "fitment-text-button",
    "reference-title", "reference-list", "reference-row", "reference-link", "reference-more"]) {
    assert.ok(defined(name), `.${name} is missing from storefront.css`);
  }
  assert.ok(!defined("reference-codes"), ".reference-codes is unused");
});
