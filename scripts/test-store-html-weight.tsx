import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CatalogCategoryChips } from "../src/components/catalog-category-chips";
import { CategoryCards } from "../src/components/category-cards";
import type { StoreCategory } from "../src/modules/store/category-tree";

// #642: the listing markup repeated per category carries named classes, not utility lists. A card or chip that grows
// back to its old size (~600 / ~330 bytes) fails here before the HTML does on a real page.
// next/image does not load under tsx, so the cards render with their icon; the image has its own class (checked below).
const css = readFileSync(new URL("../src/app/storefront.css", import.meta.url), "utf8");
const categories = Array.from({ length: 8 }, (_, index) => ({
  id: index + 1, slug: `kategori-${index + 1}`, name: `Kategori ${index + 1}`, imagePath: null,
})) as unknown as StoreCategory[];

const classesOf = (html: string) => new Set([...html.matchAll(/\sclass="([^"]*)"/g)].flatMap((match) => match[1].split(/\s+/)));
const defined = (name: string) => new RegExp(`\\.${name}\\s*[{,]`).test(css);

test("CategoryCards use named classes and stay small", () => {
  for (const variant of ["default", "related"] as const) {
    // The placeholder icon is lucide's svg, not the markup this guards.
    const html = renderToStaticMarkup(<CategoryCards categories={categories} variant={variant} />).replace(/<svg[\s\S]*?<\/svg>/g, "");
    const cards = html.split("<a ").slice(1);
    assert.equal(cards.length, 8);
    for (const card of cards) assert.ok(Buffer.byteLength(card) <= 420, `${variant} card ${Buffer.byteLength(card)} bytes`);
    for (const name of ["category-card", "category-card-image"]) assert.ok(classesOf(html).has(name), name);
    assert.equal(classesOf(html).has("category-card-related"), variant === "related");
  }
});

test("CatalogCategoryChips use the named chip class and stay small", () => {
  const html = renderToStaticMarkup(<CatalogCategoryChips categories={categories} />);
  const chips = html.split("<li ").slice(1);
  assert.equal(chips.length, 8);
  for (const chip of chips) assert.ok(Buffer.byteLength(chip) <= 190, `chip ${Buffer.byteLength(chip)} bytes`);
  assert.ok(classesOf(html).has("category-chip"));
});

test("every named listing class exists in storefront.css", () => {
  for (const name of ["facet-tree-link", "facet-trigger", "facet-search", "facet-search-input", "facet-options", "facet-options-open", "facet-options-folded",
    "category-card", "category-card-related", "category-card-image", "category-chip", "make-list-item", "model-family", "model-family-title", "model-family-list"]) {
    assert.ok(defined(name), `.${name} is missing from storefront.css`);
  }
});

test("the changed components keep no long utility list in a class literal", () => {
  for (const file of ["category-cards", "vehicle-model-list"]) {
    const source = readFileSync(new URL(`../src/components/${file}.tsx`, import.meta.url), "utf8");
    for (const match of source.matchAll(/className="([^"]*)"/g)) assert.ok(match[1].length <= 120, `${file}: ${match[1].slice(0, 60)}…`);
  }
});
