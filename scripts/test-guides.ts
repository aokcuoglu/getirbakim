import test from "node:test";
import assert from "node:assert/strict";
import { guideBySlug, guideCategoryKeys, guideCategoryLabels, guidePath, guides, guidesForCategory } from "../src/content/guides";
import { guideBodies } from "../src/content/guides/bodies";
import { categoryGuideNote, categoryGuideNotes } from "../src/content/category-guides";
import { catalogDescription } from "../src/app/(store)/katalog/catalog-descriptions";
import { slugPattern } from "../src/modules/seo/paths";
import { legacyCategoryIds } from "../src/modules/store/category-tree";

const day = /^\d{4}-\d{2}-\d{2}$/;

test("every guide has a body and every body a guide", () => {
  assert.deepEqual(Object.keys(guideBodies).sort(), guides.map(guide => guide.slug).sort());
});

test("slugs are valid and unique", () => {
  for (const guide of guides) assert.match(guide.slug, slugPattern);
  assert.equal(new Set(guides.map(guide => guide.slug)).size, guides.length);
  assert.equal(guidePath("a-b"), "/rehber/a-b");
  assert.equal(guideBySlug(guides[0].slug), guides[0]);
});

test("dates, answer, sources, categories and related paths are well formed", () => {
  for (const guide of guides) {
    assert.match(guide.published, day);
    assert.match(guide.updated, day);
    assert.ok(guide.updated >= guide.published, guide.slug);
    assert.ok(guide.answer.length > 0 && guide.answer.length <= 400, `${guide.slug} answer length ${guide.answer.length}`);
    assert.ok(guide.sources.length > 0, guide.slug);
    assert.ok(guide.categories.length > 0, guide.slug);
    for (const category of guide.categories) { assert.ok(category in legacyCategoryIds, `${guide.slug}: ${category}`); assert.ok(guideCategoryLabels[category], `label for ${category}`); }
    for (const link of guide.related ?? []) assert.ok(link.path.startsWith("/"), link.path);
  }
});

test("guides are found by category", () => {
  assert.ok(guideCategoryKeys.includes("filtre"));
  assert.deepEqual(guidesForCategory("filtre").map(guide => guide.slug), ["yag-filtresi-ne-zaman-degisir", "hava-filtresi-ve-polen-filtresi-farki"]);
  assert.deepEqual(guidesForCategory("fren").map(guide => guide.slug), ["fren-balatasi-ne-zaman-degisir-nasil-secilir"]);
  assert.deepEqual(guidesForCategory("aksesuar"), []);
});

test("every top-level category has a distinct guide note", () => {
  assert.deepEqual(Object.keys(categoryGuideNotes).sort(), [...guideCategoryKeys].sort());
  const texts = new Set<string>();
  for (const [slug, note] of Object.entries(categoryGuideNotes)) {
    assert.ok(note.heading.length > 0 && note.heading.endsWith("?"), slug);
    assert.ok(note.text.length >= 150 && note.text.length <= 450, `${slug} length ${note.text.length}`);
    const sentences = note.text.split(/(?<=[.!?])\s+/);
    assert.ok(sentences.length >= 2 && sentences.length <= 4, `${slug} sentences ${sentences.length}`);
    assert.doesNotMatch(note.text, /\d/, slug);
    const intro = catalogDescription(slug) ?? "";
    assert.notEqual(note.text, intro, slug);
    for (const sentence of sentences) assert.ok(!intro.includes(sentence), `${slug} repeats: ${sentence}`);
    texts.add(note.text);
  }
  assert.equal(texts.size, guideCategoryKeys.length);
});

test("the guide note shows only on a plain first page of a top-level category", () => {
  const filtre = categoryGuideNote({ category: "filtre" });
  assert.deepEqual(filtre?.guides.map(guide => guide.slug), guidesForCategory("filtre").map(guide => guide.slug));
  assert.equal(filtre?.guides.length, 2);
  assert.deepEqual(categoryGuideNote({ category: "aksesuar" })?.guides, []);
  assert.ok(guidesForCategory("yedek-parca").length > 0);
  for (const query of [{ category: "filtre", page: "2" }, { category: "filtre", sort: "price-asc" as const }, { category: "filtre", brand: "BOSCH" }, { category: "filtre", q: "yağ" }, { category: "filtre", make: "ford" }, { category: "fren-diskleri-269" }, {}])
    assert.equal(categoryGuideNote(query), undefined, JSON.stringify(query));
  assert.equal(categoryGuideNote({ category: "filtre" }, { manufacturer: true }), undefined);
  assert.equal(categoryGuideNote({ category: "filtre" }, { vehicle: true }), undefined);
});
