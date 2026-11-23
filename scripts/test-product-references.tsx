import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FitmentPanel, ProductFitment } from "../src/components/product-fitment";
import { ProductReferences } from "../src/components/product-references";
import { loadedPublicList, publicListFetch } from "../src/components/public-list-fetch";
import { fitmentInitialGroups, fitmentView, initialFitmentView, isFitmentGroup, type FitmentRow, type FitmentSource } from "../src/modules/store/product-fitment-view";
import { initialReferenceView, isReferenceRow, referenceInitialCodes, referenceInitialRows, referenceRowCodes, type ReferenceCode, type ReferenceRow } from "../src/modules/store/product-reference-view";

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

test("a vehicle maker's OEM row is not capped per row: it takes what is left of the total after every row's first numbers", () => {
  const oem = new Set(["FORD"]);
  const counts = (view: ReturnType<typeof initialReferenceView>) => new Map(view.rows.map(([name, printed, more]) => [name, { count: printed.length, more }]));
  // Within the totals a long OEM row goes out whole; a parts brand's as long a row would be cut.
  const short: ReferenceRow[] = [["BOSCH", codes("B", 2)], ["FORD", codes("F", 20)]];
  assert.deepEqual(initialReferenceView(short, oem, rest), { rows: short, rowCount: 2 });
  assert.equal(initialReferenceView(short, new Set(), rest).rest, rest);
  // Past the caps every printed row gets referenceRowCodes numbers first, then the OEM row takes the rest of the total.
  const rows: ReferenceRow[] = [["AAA", [["A-L", "/urun/a"], ...codes("A", 9)]], ["BOSCH", codes("B", 10)], ["FORD", codes("F", 40)], ["NGK", codes("N", 10)]];
  const view = counts(initialReferenceView(rows, oem, rest));
  assert.deepEqual(view.get("AAA"), { count: referenceRowCodes, more: 10 - referenceRowCodes });
  assert.deepEqual(view.get("BOSCH"), { count: referenceRowCodes, more: 10 - referenceRowCodes });
  assert.deepEqual(view.get("NGK"), { count: referenceRowCodes, more: 10 - referenceRowCodes });
  assert.deepEqual(view.get("FORD"), { count: 40, more: undefined });
  // An OEM row longer than what is left is cut there; the rows after it keep their first numbers.
  const huge = initialReferenceView([["FORD", codes("F", 100)], ["NGK", ["1"]]], oem, rest);
  assert.deepEqual(huge.rows, [["FORD", codes("F", referenceInitialCodes - 1), 100 - (referenceInitialCodes - 1)], ["NGK", ["1"]]]);
  assert.equal(huge.rowCount, 2);
  // When the printed rows' first numbers use up the total, the OEM row keeps referenceRowCodes like the others.
  const many: ReferenceRow[] = [["FORD", codes("F", 40)], ...Array.from({ length: 30 }, (_, index): ReferenceRow => [brand(index), codes(brand(index), 10)])];
  const crowded = initialReferenceView(many, oem, rest);
  assert.deepEqual(counts(crowded).get("FORD"), { count: referenceRowCodes, more: 40 - referenceRowCodes });
  assert.equal(crowded.rows.length, referenceInitialCodes / referenceRowCodes);
  assert.equal(crowded.rows.reduce((sum, [, printed]) => sum + printed.length, 0), referenceInitialCodes);
});

test("long linked OEM rows do not crowd out the linked equivalents after them (#1211 review)", () => {
  const linkedCodes = (name: string, count: number): ReferenceCode[] => [[`${name}-L`, `/katalog?q=${name}`], ...codes(name, count - 1)];
  const rows: ReferenceRow[] = [["AUDI", linkedCodes("AUDI", 40)], ["BMW", linkedCodes("BMW", 40)], ["SETA", [["S-1", "/urun/s-1"], ["S-2", "/urun/s-2"]]]];
  const view = initialReferenceView(rows, new Set(["AUDI", "BMW"]), rest);
  assert.deepEqual(view.rows.map(([name, printed, more]) => [name, printed.length, more]), [["AUDI", 40, undefined], ["BMW", 30, 10], ["SETA", 2, undefined]]);
  assert.deepEqual(view.rows[2], ["SETA", [["S-1", "/urun/s-1"], ["S-2", "/urun/s-2"]]]);
  assert.equal(view.rows.reduce((sum, [, printed]) => sum + printed.length, 0), referenceInitialCodes);
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
  // The scroll box is a labelled region holding the list.
  assert.ok(html.includes('<div class="reference-list" tabindex="0" role="region" aria-label="OEM ve muadil numaraları"><dl>'));
  assert.ok(html.includes('<p class="sr-only" role="status"></p>'));
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
  // Every brand printed, only numbers left out: the button speaks of numbers.
  const numbers = renderToStaticMarkup(<ProductReferences view={initialReferenceView([["BOSCH", codes("B", 10)]], new Set(), rest)} title="T"/>);
  assert.ok(numbers.includes(">Tüm numaraları göster</button>") && !numbers.includes("markayı göster"));
  // A list printed whole has no button and no status line.
  const whole = renderToStaticMarkup(<ProductReferences view={initialReferenceView(rows.slice(0, 3).map(([name]) => [name, ["1"]]), new Set(), rest)} title="T"/>);
  assert.ok(!whole.includes("<button") && !whole.includes("reference-more") && !whole.includes('role="status"'));
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

// #1324: past 24 engine rows the printed groups ship their counts; a group's panel loads its rows when opened.
const fitted = (models: number, rows: number): FitmentSource[] => Array.from({ length: models * rows }, (_, index) => ({ engineAndCodes: `MOTORKOD${index}`,
  fuel: "Diesel", ps: 150, kw: 110, cc: 1968, from: "04/2013", to: "03/2017", makeKey: "VOLKSWAGEN", makeLabel: "Volkswagen",
  modelLabel: `Volkswagen Model ${Math.floor(index / rows) + 1}` }));
const fitmentRest = "/api/product-fitments/9db4f695-185e-4d35-b8e4-190bfb549e91?v=abc";

test("ProductFitment prints a held-back group's row count and no engine text", () => {
  const html = renderToStaticMarkup(<ProductFitment view={initialFitmentView(fitmentView(fitted(9, 7)), fitmentRest)}/>);
  assert.equal(html.split('class="fitment-group"').length - 1, fitmentInitialGroups);
  assert.equal(html.split('<span class="fitment-count">7 seçenek</span>').length - 1, fitmentInitialGroups);
  assert.ok(!html.includes("MOTORKOD"));
  assert.ok(html.includes(">Tüm 9 modeli göster</button>"));
});

test("ProductFitment with up to six held-back groups prints them all with their model options", () => {
  const view = initialFitmentView(fitmentView(fitted(3, 10)), fitmentRest);
  assert.equal(view.rest, fitmentRest);
  const html = renderToStaticMarkup(<ProductFitment view={view}/>);
  assert.ok(!html.includes("modeli göster"));
  for (const index of [1, 2, 3]) assert.ok(html.includes(`<option value="Volkswagen Model ${index}">Volkswagen Model ${index}</option>`), `Model ${index}`);
  assert.ok(!html.includes("Modeller yükleniyor…"));
  assert.ok(html.includes("10 seçenek") && !html.includes("MOTORKOD"));
});

test("FitmentPanel shows placeholder rows while loading, a retry after a failure, and the rows once loaded", () => {
  const panel = (state: "ready" | "loading" | "failed", rows: FitmentRow[] = [], busy = false, linked = false) =>
    renderToStaticMarkup(<FitmentPanel model="Volkswagen Golf VII (5G1)" rows={rows} count={3} linked={linked} state={state} busy={busy} showLoading={false} onRetry={() => {}}/>);
  const region = '<div class="overflow-x-auto border-t border-border" tabindex="0" role="region" aria-label="Volkswagen Golf VII (5G1) motor seçenekleri"';
  const loading = panel("loading", [], true);
  assert.ok(loading.startsWith(`${region} aria-busy="true">`));
  assert.ok(loading.includes(">Motor / motor kodu</th>") && loading.includes(">Veri bağlantısı</th>"));
  assert.equal(loading.match(/<tr(?=[^>]*aria-hidden="true")(?=[^>]*fitment-row)[^>]*>/g)?.length, 3);
  // Word-wide bars, so a placeholder row wraps like a real one; a linked model's rows add the source engine's line.
  const bars = (html: string) => html.split('class="inline-block h-3.5 rounded-sm bg-muted align-middle').length - 1;
  assert.equal(bars(loading), 3 * 8);
  assert.equal(bars(panel("loading", [], true, true)), 3 * 11);
  const failed = panel("failed");
  assert.ok(failed.startsWith(`${region}>`));
  assert.ok(failed.includes("<span>Motor seçenekleri yüklenemedi.</span>"));
  assert.ok(/<button type="button" class="fitment-text-button"[^>]*>Tekrar dene<\/button>/.test(failed));
  assert.ok(!failed.includes("<table"));
  // A retry keeps the button, busy, and the region busy.
  const retrying = panel("failed", [], true);
  assert.ok(retrying.startsWith(`${region} aria-busy="true">`));
  assert.ok(retrying.includes('aria-busy="true" aria-disabled="true">Tekrar dene</button>'));
  const ready = panel("ready", [["2.0 TDI CRBC", "Diesel", 150, 110, 1968, "04/2013", "03/2017", 10, "2.0 TDI"]]);
  assert.ok(ready.startsWith(`${region}>`));
  assert.ok(ready.includes("<strong class=\"font-medium\">2.0 TDI</strong><small>Kaynak motor bilgisi: 2.0 TDI CRBC</small><small>Dizel</small>"));
  assert.ok(!ready.includes("skeleton") && !ready.includes("Tekrar dene"));
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

// A rolling deploy can answer the new page's list URL from an older task (#1211 review): a list of another shape takes
// the failed-load path ("Tekrar dene") instead of reaching the component.
test("publicListFetch rejects a list of another shape and asks again on the next try", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let body: unknown;
  globalThis.fetch = async () => Response.json(body);
  const fitments = "/api/product-fitments/9db4f695-185e-4d35-b8e4-190bfb549e91?v=old";
  body = { v: "old", groups: [{ make: "VOLKSWAGEN", model: "Volkswagen Golf VII (5G1)", rows: [{ engine: "2.0 TDI", fuel: "Diesel", ps: 150, kw: 110, cc: 1968, from: "04/2013" }] }] };
  await assert.rejects(publicListFetch(fitments, "groups", isFitmentGroup, "Uyumlu araçlar yüklenemedi."), /Uyumlu araçlar yüklenemedi\./);
  assert.equal(loadedPublicList(fitments), null);
  body = { v: "old", groups: [{ make: "VOLKSWAGEN", model: "Volkswagen Golf VII (5G1)", rows: [["2.0 TDI", "Diesel", 150, 110, 1968, "04/2013"]] }] };
  assert.equal((await publicListFetch(fitments, "groups", isFitmentGroup, "Uyumlu araçlar yüklenemedi.")).length, 1);
  const references = "/api/product-references/9db4f695-185e-4d35-b8e4-190bfb549e91?v=old";
  body = { v: "old", rows: [{ brand: "BOSCH", codes: ["1"] }] };
  await assert.rejects(publicListFetch(references, "rows", isReferenceRow, "Numaraların tamamı yüklenemedi."), /Numaraların tamamı yüklenemedi\./);
  body = { v: "old", rows: [["BOSCH", ["1", ["2", "/urun/b-2"]]]] };
  assert.deepEqual(await publicListFetch(references, "rows", isReferenceRow, "Numaraların tamamı yüklenemedi."), [["BOSCH", ["1", ["2", "/urun/b-2"]]]]);
  assert.deepEqual(loadedPublicList(references), [["BOSCH", ["1", ["2", "/urun/b-2"]]]]);
  for (const value of [["BOSCH"], ["BOSCH", [1]], ["BOSCH", [["2"]]], [1, []], {}]) assert.equal(isReferenceRow(value), false, JSON.stringify(value));
});
