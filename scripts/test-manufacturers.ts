import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { manufacturerSlug } from "../src/modules/seo/manufacturer-path";
import { buildManufacturerDirectory, featuredManufacturers, manufacturerIndexable, manufacturerDescriptionLimit, manufacturerTexts, manufacturerTrail, unindexedManufacturerSlugs, type ManufacturerRow } from "../src/modules/store/manufacturers";

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
  // A label written like another brand's name: the store shows that brand's name, so the name's brand owns it (#811).
  { id: "10", name: "SKF", label: "SKF-AV", items: 20 },
  { id: "11", name: "SKF VKM", label: "SKF", items: 50 },
  // Two brands with one name: the larger owns the name (and the page).
  { id: "12", name: "DAYCO", label: "DAYCO", items: 5 },
  { id: "13", name: "DAYCO", label: "DAYCO BELT", items: 9 },
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

test("a master brand name belongs to its brand first (#811: the store shows master names)", () => {
  const directory = buildManufacturerDirectory(rows);
  const page = (slug: string) => { const match = directory.find(slug); return match?.kind === "page" ? match.manufacturer : undefined; };
  assert.deepEqual(page("skf")?.labels, ["SKF", "SKF-AV"]);
  assert.deepEqual(page("skf-vkm")?.labels, ["SKF VKM"]);
  assert.equal(directory.pathForLabel("SKF"), "/marka/skf");
  assert.equal(directory.pathForLabel("SKF VKM"), "/marka/skf-vkm");
  assert.deepEqual(page("dayco"), { id: "13", name: "DAYCO", slug: "dayco", labels: ["DAYCO", "DAYCO BELT"] });
  assert.equal(directory.pathForLabel("DAYCO"), "/marka/dayco");
  assert.equal(directory.pathForLabel("DAYCO BELT"), "/marka/dayco");
});

test("home tiles resolve labels to their manufacturer page under the shown master name (#811)", () => {
  const directory = buildManufacturerDirectory(rows);
  assert.equal(directory.manufacturerFor("BLUE PRINT")?.name, "BLUEPRINT");
  assert.equal(directory.manufacturerFor("BOSCH-X"), null);
  assert.deepEqual(directory.labelsOf("MANN"), ["MANN", "MANN-FILTER"]);
  assert.deepEqual(directory.labelsOf("NO SUCH LABEL"), []);
  assert.deepEqual(featuredManufacturers(["BLUE PRINT", "BOSCH", "BOSCH AV", "MANN-FILTER", "GATES", "NO SUCH LABEL"], ["BLUEPRINT", "BOSCH", "MANN"], directory),
    [{ brand: "BLUEPRINT", href: "/marka/blueprint" }, { brand: "BOSCH", href: "/marka/bosch" }, { brand: "MANN", href: "/marka/mann" }]);
});

test("supplier_item_brand is declared identically in db/commerce.sql and db/product-matching.sql", () => {
  const body = (file: string) => {
    const sql = readFileSync(file, "utf8"), start = sql.indexOf("CREATE OR REPLACE FUNCTION supplier_item_brand(");
    assert.ok(start >= 0, file);
    return sql.slice(start, sql.indexOf("$$;", start) + 3);
  };
  assert.equal(body("db/commerce.sql"), body("db/product-matching.sql"));
  const tables = (file: string) => {
    const sql = readFileSync(file, "utf8"), start = sql.indexOf("CREATE TABLE IF NOT EXISTS brands (");
    assert.ok(start >= 0, file);
    // Through the guarded supplier_brands_brand_idx block (created only when missing, #964).
    const end = sql.indexOf("END $$;", sql.indexOf("CREATE INDEX supplier_brands_brand_idx", start));
    assert.ok(end > start, file);
    return sql.slice(start, end);
  };
  assert.equal(tables("db/commerce.sql").replace(/^--.*\n/gm, ""), tables("db/product-matching.sql").replace(/^--.*\n/gm, ""));
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
  assert.match(bosch.description, /^BOSCH üreticisinin 20\.509 yedek parça/);
  assert.match(bosch.intro, /^BOSCH üreticisinin 20\.509 yedek parça/);
  for (const text of Object.values(bosch)) assert.doesNotMatch(text, /\bmarka/);
  for (const key of ["title", "heading", "intro", "description"] as const) assert.notEqual(bosch[key], febi[key], key);
  // A long description ends at a word boundary with "…", never mid-word.
  const long = manufacturerTexts("A VERY LONG MANUFACTURER NAME ".repeat(3).trim(), 1_000_000).description;
  assert.ok(long.length <= 160, String(long.length));
  assert.match(long, /[^\s,.:;]…$/);
  const full = `A VERY LONG MANUFACTURER NAME `.repeat(3).trim() + " üreticisinin 1.000.000 yedek parça ve bakım ürünü: ürün kodu veya OEM numarasıyla ara, fiyat ve stok durumunu gör. Siparişten önce araç uyumluluğunu kontrol et.";
  assert.ok(full.startsWith(long.slice(0, -1)) && [" ", ",", ":", "."].includes(full[long.length - 1]), long);
  assert.equal(manufacturerDescriptionLimit, 160);
  assert.ok(bosch.description.length >= 100 && bosch.description.length <= 160, bosch.description);
  assert.deepEqual(manufacturerTrail({ name: "BOSCH", slug: "bosch" }).map(crumb => crumb.path), ["/", "/katalog", "/marka/bosch"]);
});
