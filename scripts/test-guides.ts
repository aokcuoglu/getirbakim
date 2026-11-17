import test from "node:test";
import assert from "node:assert/strict";
import { guideBySlug, guideCategoryKeys, guidePath, guides, guidesForCategory } from "../src/content/guides";
import { guideBodies } from "../src/content/guides/bodies";
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
    for (const category of guide.categories) assert.ok(category in legacyCategoryIds, `${guide.slug}: ${category}`);
    for (const link of guide.related ?? []) assert.ok(link.path.startsWith("/"), link.path);
  }
});

test("guides are found by category", () => {
  assert.ok(guideCategoryKeys.includes("filtre"));
  assert.deepEqual(guidesForCategory("filtre").map(guide => guide.slug), ["yag-filtresi-ne-zaman-degisir"]);
  assert.deepEqual(guidesForCategory("fren"), []);
});
