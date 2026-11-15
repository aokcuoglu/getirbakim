import assert from "node:assert/strict";
import test from "node:test";
import { productIdFromHref, productIdFromSegment, productIdPath } from "../src/modules/seo/product-id";
import { productPath, productSlug } from "../src/modules/seo/product-path";

const id = "0000df72-b78a-4fca-92ec-700be2e7baf2";
const product = (name: string, display_brand: string, display_code: string) => ({ id, name, display_brand, display_code });
const slug = (name: string, brand: string, code: string) => productSlug({ name, display_brand: brand, display_code: code });

test("brand, name and part number as ASCII words before the id", () => {
  assert.equal(productPath(product("FREN BALATASI ARKA", "BOSCH", "BCH 0986494803")), `/urun/bosch-fren-balatasi-arka-bch-0986494803-${id}`);
  // The brand's own prefix in the part number is dropped; a supplier prefix stays.
  assert.equal(slug("AMORTISOR ARKA RL FIAT 500L EGEA 12>", "MONROE", "MONROE G1345"), "monroe-amortisor-arka-rl-fiat-500l-egea-12-g1345");
});

test("Turkish and accented letters fold by hand", () => {
  assert.equal(slug("Yağ Filtresi", "FİLTRON", "OP 525/1"), "filtron-yag-filtresi-op-525-1");
  assert.equal(slug("İç Çamurluk ISITMALI", "ÖZEL", "ŞĞ 1"), "ozel-ic-camurluk-isitmali-sg-1");
  assert.equal(slug("YAG FILTRESI", "CITROËN", "1"), "citroen-yag-filtresi-1");
  assert.equal(slug("INSIGNIA PARCA", "OPEL", "1"), "opel-insignia-parca-1");
  assert.equal(slug("YAG FILTRESI", "X", "1"), slug("Yağ Filtresi", "X", "1"));
});

test("the readable name's dropped filler and repeats are dropped from the slug too", () => {
  assert.equal(slug("YAG FILTRESI GENEL GENEL", "MANN", "W 712"), "mann-yag-filtresi-w-712");
  assert.equal(slug("FILTRE FILTRE", "MANN", "W 712"), "mann-filtre-w-712");
  assert.equal(slug("BOSCH FREN BALATASI", "BOSCH", "0986"), "bosch-fren-balatasi-0986");
});

test("an unspecified brand is left out; a name equal to the part number is written once", () => {
  assert.equal(slug("FREN BALATASI", "Belirtilmemiş", "AB 12"), "fren-balatasi-ab-12");
  assert.equal(slug("0986494803", "BOSCH", "0986494803"), "bosch-0986494803");
  assert.equal(slug("BOSCH 0986494803", "BOSCH", "BOSCH 0986494803"), "bosch-0986494803");
});

test("long names are cut at a word to 50 characters and the whole stays within 100", () => {
  const name = "ON FREN BALATASI DISK TIPI HAVALANDIRMALI KALIN YUKSEK PERFORMANS SERAMIK KAPLAMALI TAKIM 4 LU";
  const long = slug(name, "FEBI BILSTEIN", "FEBI 123456");
  // The brand's first word is dropped from the number; what stands between brand and number is the name.
  assert.ok(long.startsWith("febi-bilstein-") && long.endsWith("-123456"), long);
  const shown = long.slice("febi-bilstein-".length, -"-123456".length);
  assert.ok(shown.length <= 50 && name.toLowerCase().replace(/ /g, "-").startsWith(shown), shown);
  assert.ok(long.length <= 100);
  // A part number and brand that fill the budget leave no room: the name goes, brand and number stay whole.
  const crowded = slug("FREN BALATASI", "A".repeat(40), `${"B".repeat(30)} ${"C".repeat(30)}`);
  assert.equal(crowded, `${"a".repeat(40)}-${"b".repeat(30)}-${"c".repeat(30)}`);
  // A single long word still stays within its own limit rule: the first word is kept when the name is the only part.
  assert.equal(slug("X".repeat(70), "Belirtilmemiş", ""), "x".repeat(70));
});

test("nothing left gives the bare id address", () => {
  assert.equal(productPath(product("!!!", "Belirtilmemiş", "")), `/urun/${id}`);
  assert.equal(productPath(product("", "", "")), productIdPath(id));
});

test("addresses are valid, idempotent paths", () => {
  const pattern = new RegExp(`^/urun/(?:[a-z0-9]+(?:-[a-z0-9]+)*-)?${id}$`);
  for (const sample of [product("Ön Fren Diski (2 adet)", "TRW", "DF 4150 S"), product("A/B.C", "X&Y", "1/2"), product("ÇİFT  BOŞLUK", " KALE  RADYATOR ", "KALE 12345")]) {
    assert.match(productPath(sample), pattern);
    assert.equal(productPath(sample), productPath(sample));
  }
  assert.equal(slug("RADYATOR", "KALE RADYATOR", "KALE 12345"), "kale-radyator-12345");
});

test("the id is read from the end of a segment, whatever comes before", () => {
  assert.equal(productIdFromSegment(`bosch-fren-balatasi-0986479c20-${id}`), id);
  assert.equal(productIdFromSegment(id), id);
  assert.equal(productIdFromSegment(`SLUG-${id.toUpperCase()}`), id);
  assert.equal(productIdFromSegment(`x-0986479c20-${id}`), id);
  assert.equal(productIdFromSegment("abc"), null);
  assert.equal(productIdFromSegment("x-00000000-0000-4000-8000-00000000000"), null);
  assert.equal(productIdFromSegment(`${id}-x`), null);
  assert.equal(productIdFromSegment(`x${id}`), null);
});

test("hrefs: the id of a product link with a query or hash; other links give none", () => {
  const path = productPath(product("Fren", "BOSCH", "1"));
  assert.equal(productIdFromHref(path), id);
  assert.equal(productIdFromHref(`${path}#haber-ver`), id);
  assert.equal(productIdFromHref(`${path}?x=1#uyumlu-araclar`), id);
  assert.equal(productIdFromHref(`/urun/${id}`), id);
  assert.equal(productIdFromHref("/katalog"), null);
  assert.equal(productIdFromHref(`/yonetim/urun/${id}`), null);
  assert.equal(productIdFromHref(""), null);
});

test("round trip: the id of any address is the product's", () => {
  for (const sample of [product("Fren", "BOSCH", "1"), product("", "", ""), product("0986", "BOSCH", "0986")]) {
    assert.equal(productIdFromSegment(productPath(sample).slice("/urun/".length)), sample.id);
  }
});
