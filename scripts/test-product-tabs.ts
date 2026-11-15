import assert from "node:assert/strict";
import { test } from "node:test";
import { productTab, productTabHref, productTabs, tabOfAnchor, visibleProductTabs } from "../src/modules/admin/product-tabs";

const id = "11111111-1111-4111-8111-111111111111";

test("productTab falls back to the default for unknown or hidden values", () => {
  assert.equal(productTab(undefined, false), "bilgiler");
  assert.equal(productTab("olmayan", false), "bilgiler");
  assert.equal(productTab("eslestirme", false), "eslestirme");
  assert.equal(productTab("bilgiler", true), "fiyat");
  assert.equal(productTab("gorseller", true), "fiyat");
  assert.equal(productTab("gecmis", true), "gecmis");
});

test("a merged product shows only price, matching and history", () => {
  assert.deepEqual(visibleProductTabs(true).map(tab => tab.key), ["fiyat", "eslestirme", "gecmis"]);
  assert.equal(visibleProductTabs(false).length, productTabs.length);
});

test("productTabHref omits the default tab, puts params before the hash and encodes values", () => {
  assert.equal(productTabHref(id, "bilgiler"), `/yonetim/urunler/${id}`);
  assert.equal(productTabHref(id, "fiyat"), `/yonetim/urunler/${id}?tab=fiyat`);
  assert.equal(productTabHref(id, "fiyat", { merged: true }), `/yonetim/urunler/${id}`);
  assert.equal(productTabHref(id, "eslestirme", { params: { eq_q: "1K0 615 301", linked: "1", skipped: undefined }, hash: "muadil" }),
    `/yonetim/urunler/${id}?tab=eslestirme&eq_q=1K0+615+301&linked=1#muadil`);
  assert.equal(productTabHref(id, "bilgiler", { params: new URLSearchParams("tab=gecmis&eq_q=a%26b"), hash: "magaza" }), `/yonetim/urunler/${id}?eq_q=a%26b#magaza`);
});

test("tabOfAnchor maps every old card anchor to its tab", () => {
  const expected = { magaza: "bilgiler", fiyat: "fiyat", gorseller: "gorseller", referanslar: "referanslar", ozellikler: "referanslar",
    "arac-uyumu": "arac-uyumu", birlestir: "eslestirme", muadil: "eslestirme", gecmis: "gecmis" };
  for (const [anchor, tab] of Object.entries(expected)) {
    assert.equal(tabOfAnchor(anchor), tab);
    assert.equal(tabOfAnchor(`#${anchor}`), tab);
  }
  assert.equal(tabOfAnchor("#baska"), undefined);
  assert.equal(tabOfAnchor(""), undefined);
});
