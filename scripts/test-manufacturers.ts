import assert from "node:assert/strict";
import { test } from "node:test";
import { manufacturerSlug } from "../src/modules/seo/manufacturer-path";
import { buildManufacturerDirectory, manufacturerIndexable, manufacturerTexts, manufacturerTrail, unindexedManufacturerSlugs, type ManufacturerRow } from "../src/modules/store/manufacturers";

// Manufacturer pages (#660): slugs, the label directory, the index rule and the page texts. Pure.

test("a manufacturer slug is the name as lower case ASCII words", () => {
  const cases: [string, string][] = [
    ["BOSCH", "bosch"], ["MANN-FILTER", "mann-filter"], ["FEBI BILSTEIN", "febi-bilstein"], ["M.MARELLI", "m-marelli"],
    ["MEAT & DORIA", "meat-doria"], ["LUBRİCO", "lubrico"], ["KALE RADYATÖR", "kale-radyator"], ["CITROËN", "citroen"],
    ["  BLUE  PRINT ", "blue-print"], ["", ""], ["&.-", ""], ["Belirtilmemiş", "belirtilmemis"],
  ];
  for (const [name, slug] of cases) assert.equal(manufacturerSlug(name), slug, name);
});

const rows: ManufacturerRow[] = [
  { id: "1", name: "BOSCH", label: "BOSCH", items: 100 },
  { id: "1", name: "BOSCH", label: "BOSCH AV", items: 20 },
  { id: "2", name: "BLUEPRINT", label: "BLUE PRINT", items: 40 },
  { id: "2", name: "BLUEPRINT", label: "BLUEPRINT", items: 5 },
  { id: "3", name: "MANN", label: "MANN-FILTER", items: 30 },
  // Same slug as BOSCH (3) but smaller: no page.
  { id: "4", name: "Bosch", label: "BOSCH-X", items: 3 },
  // A name without a slug: no page.
  { id: "5", name: "&", label: "&", items: 50 },
  // A label listed under two brands by different suppliers: the brand with more of its items owns it.
  { id: "6", name: "GATES", label: "GATES", items: 10 },
  { id: "7", name: "CONTI", label: "GATES", items: 2 },
  { id: "7", name: "CONTI", label: "CONTITECH", items: 8 },
  // Two equal brands on one slug: the older (smaller id) wins.
  { id: "9", name: "TRW", label: "TRW", items: 7 },
  { id: "8", name: "T.R.W", label: "T.R.W", items: 7 },
];

test("the directory: label union, pages, aliases and collisions", () => {
  const directory = buildManufacturerDirectory(rows);
  const page = (slug: string) => { const match = directory.find(slug); return match?.kind === "page" ? match.manufacturer : undefined; };
  assert.deepEqual(page("bosch"), { id: "1", name: "BOSCH", slug: "bosch", labels: ["BOSCH", "BOSCH AV"] });
  // The brand name joins the labels when it is no other brand's label (MANN, CONTI).
  assert.deepEqual(page("mann")?.labels, ["MANN", "MANN-FILTER"]);
  assert.deepEqual(page("conti")?.labels, ["CONTI", "CONTITECH"]);
  assert.deepEqual(page("gates")?.labels, ["GATES"]);
  assert.deepEqual(page("blueprint")?.labels, ["BLUE PRINT", "BLUEPRINT"]);
  assert.equal(page("t-r-w")?.id, "8");
  assert.equal(directory.find("trw")?.kind, "page");
  // Aliases: a label's own slug leads to its brand's page; a page slug is never an alias.
  assert.deepEqual(directory.find("blue-print"), { kind: "alias", slug: "blueprint" });
  assert.deepEqual(directory.find("mann-filter"), { kind: "alias", slug: "mann" });
  assert.deepEqual(directory.find("bosch-av"), { kind: "alias", slug: "bosch" });
  assert.equal(directory.find("bosch-x"), null);
  assert.equal(directory.find(""), null);
  assert.equal(directory.find("yok-boyle-marka"), null);
  assert.ok(!directory.all.some(entry => entry.id === "4" || entry.id === "5"));
  // pathForLabel: the label's brand page, null without one.
  assert.equal(directory.pathForLabel("BOSCH AV"), "/marka/bosch");
  assert.equal(directory.pathForLabel("BLUE PRINT"), "/marka/blueprint");
  assert.equal(directory.pathForLabel("MANN"), "/marka/mann");
  assert.equal(directory.pathForLabel("GATES"), "/marka/gates");
  assert.equal(directory.pathForLabel("BOSCH-X"), null);
  assert.equal(directory.pathForLabel("&"), null);
  assert.equal(directory.pathForLabel("NO SUCH LABEL"), null);
  assert.deepEqual(directory.all.map(entry => entry.slug), [...directory.all.map(entry => entry.slug)].sort());
});

test("a manufacturer page is indexed as a plain listing with enough products", () => {
  assert.equal(manufacturerIndexable("bosch", {}, 9), false);
  assert.equal(manufacturerIndexable("bosch", {}, 10), true);
  assert.equal(manufacturerIndexable("bosch", { page: "2" }, 500), false);
  assert.equal(manufacturerIndexable("bosch", { brands: '["BOSCH"]' }, 500), false);
  assert.equal(manufacturerIndexable("bosch", { sort: "price-asc" }, 500), false);
  assert.equal(manufacturerIndexable("bosch", { q: "disk" }, 500), false);
  for (const slug of ["orijinal", "taiwan", "belirtilmemis"]) {
    assert.ok(unindexedManufacturerSlugs.includes(slug), slug);
    assert.equal(manufacturerIndexable(slug, {}, 100_000), false, slug);
  }
});

test("the page texts name the manufacturer and its count", () => {
  const bosch = manufacturerTexts("BOSCH", 20509), febi = manufacturerTexts("FEBI", 12);
  assert.equal(bosch.title, "BOSCH yedek parçaları");
  assert.match(bosch.description, /^BOSCH marka 20\.509 yedek parça/);
  for (const key of ["title", "heading", "intro", "description"] as const) assert.notEqual(bosch[key], febi[key], key);
  assert.ok(manufacturerTexts("A VERY LONG MANUFACTURER NAME ".repeat(5), 1_000_000).description.length <= 180);
  assert.ok(bosch.description.length <= 180);
  assert.deepEqual(manufacturerTrail({ name: "BOSCH", slug: "bosch" }).map(crumb => crumb.path), ["/", "/katalog", "/marka/bosch"]);
});
