import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CatalogCategoryChips } from "../src/components/catalog-category-chips";
import { CategoryCards } from "../src/components/category-cards";
import { SocialLinks } from "../src/components/social-links";
import { VehicleModelListView } from "../src/components/vehicle-model-list-view";
import { HomeProductCardView } from "../src/components/home-product-card-view";
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
  for (const file of ["category-cards", "vehicle-model-list", "vehicle-model-list-view"]) {
    const source = readFileSync(new URL(`../src/components/${file}.tsx`, import.meta.url), "utf8");
    for (const match of source.matchAll(/className="([^"]*)"/g)) assert.ok(match[1].length <= 120, `${file}: ${match[1].slice(0, 60)}…`);
  }
});

test("the components use the named classes", () => {
  const source = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
  const controls = source("../src/components/catalog-controls.tsx");
  for (const name of ["facet-tree-link", "facet-trigger", "facet-options"]) assert.ok(controls.includes(name), `catalog-controls.tsx: ${name}`);
  assert.ok(source("../src/components/catalog-category-chips.tsx").includes("category-chip"));
  assert.ok(source("../src/app/(store)/katalog/catalog-view.tsx").includes("make-list-item"));
});

// #1133: the per-page shell (header, footer, 404) is named classes too; the checkout footer and the locale selects are gone from other pages.
const source = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

test("every named shell class exists in storefront.css", () => {
  for (const name of ["site-topbar-locale", "site-logo", "site-nav-robot", "site-nav-help", "site-nav-all", "site-nav-catalog", "site-nav-item", "site-nav-trigger", "tap-44",
    "sheet-account-row", "site-footer", "site-footer-grid", "site-footer-bar", "site-footer-bar-end", "footer-links", "footer-links-accent", "footer-group-title",
    "social-list", "social-link", "cookie-preferences", "store-not-found", "store-not-found-title", "store-not-found-text", "store-cta"]) {
    assert.ok(defined(name), `.${name} is missing from storefront.css`);
  }
});

test("SocialLinks use the named classes and stay small", () => {
  const html = renderToStaticMarkup(<SocialLinks />);
  assert.ok(classesOf(html).has("social-list") && classesOf(html).has("social-link"));
  assert.ok(Buffer.byteLength(html) <= 1300, `social links ${Buffer.byteLength(html)} bytes`);
});

test("the shell stays free of the heavy per-page parts", () => {
  assert.ok(!source("../src/components/layout/site-header.tsx").includes("@/components/site/select"), "site-header.tsx imports the Select");
  assert.ok(!source("../src/components/layout/store-route.tsx").includes("FooterVariants"), "store-route.tsx still has FooterVariants");
  assert.ok(!source("../src/app/(store)/not-found.tsx").includes("@/components/ui/button"), "not-found.tsx imports ui/button");
  assert.match(source("../src/components/site-footer.tsx"), /export async function CheckoutFooter/);
  assert.ok(source("../src/components/site-footer.tsx").includes('<RouteFrame except="checkout">'), "SiteFooter must keep except=\"checkout\" (double footer otherwise)");
  assert.ok(source("../src/app/(store)/siparis-olustur/layout.tsx").includes("<CheckoutFooter"), "siparis-olustur/layout.tsx must render CheckoutFooter");
});

// #1212: repeated lists and cards are client views fed finished props, so their markup goes out once (HTML) instead of
// twice (HTML and the RSC payload). The server components only build the props.
test("VehicleModelListView renders the families and links to the model pages", () => {
  const html = renderToStaticMarkup(<VehicleModelListView makeSlug="volkswagen" sections={[{ id: "vehicle-models", title: "Volkswagen modelleri", families: [
    ["Golf", [["golf-8", "Golf VIII", "2019–günümüz"], ["golf-7", "Golf VII", "2012–2020"]]],
    ["Passat", [["passat-b8", "Passat B8", ""]]],
    ["Polo", [["polo-6", "Polo VI", "2017–günümüz"]]],
  ] }]} />);
  assert.equal(html.split('class="model-family"').length - 1, 3);
  assert.equal(html.split('class="model-link"').length - 1, 4);
  assert.deepEqual([...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]),
    ["/yedek-parca/volkswagen/golf-8", "/yedek-parca/volkswagen/golf-7", "/yedek-parca/volkswagen/passat-b8", "/yedek-parca/volkswagen/polo-6"]);
  assert.ok(html.includes('<h2 id="vehicle-models"') && html.includes('<h3 class="model-family-title">Golf</h3>'));
  // No years, no empty span.
  assert.ok(html.includes(">Passat B8</a>"));
});

test("the listing views are client components and their server adapters render no markup of their own", () => {
  for (const file of ["vehicle-model-list-view", "catalog-product-card", "home-product-card-view"]) {
    assert.ok(source(`../src/components/${file}.tsx`).startsWith('"use client";'), `${file}.tsx must start with "use client"`);
  }
  for (const file of ["catalog-product", "home-product-card", "vehicle-model-list"]) {
    const text = source(`../src/components/${file}.tsx`);
    assert.ok(!text.includes("<article") && !text.includes("<section"), `${file}.tsx renders markup on the server`);
    assert.ok(!text.startsWith('"use client"'), `${file}.tsx must stay a server component`);
  }
});

// #1295: the home category tabs are Base UI's Tabs.List / Tabs.Tab with named classes, not the TabsTrigger class list.
test("the home tab classes exist in storefront.css", () => {
  for (const name of ["home-tabs", "home-tab"]) assert.ok(defined(name), `.${name} is missing from storefront.css`);
  assert.ok(source("../src/components/home-controls.tsx").includes('className="home-tab"'), "home-controls.tsx: home-tab");
});

test("HomeProductCardView keeps the home card markup", () => {
  const priced = renderToStaticMarkup(<HomeProductCardView model={{ href: "/urun/a-1", title: "Yağ Filtresi BOSCH 123", categoryHref: "/kategori/filtre",
    categoryName: "Filtreler", amount: "900,00 ₺", regular: "1.350,00 ₺" }} />);
  assert.ok(priced.startsWith('<article class="home-card">'));
  for (const name of ["home-card-image", "home-card-text", "home-card-category", "home-card-title", "home-card-price", "home-card-amount", "home-card-regular"]) {
    assert.ok(classesOf(priced).has(name), name);
  }
  for (const text of ['href="/kategori/filtre">Filtreler</a>', 'href="/urun/a-1">Yağ Filtresi BOSCH 123</a>', "900,00 ₺", "Önceki fiyat: </span>1.350,00 ₺"]) {
    assert.ok(priced.includes(text), text);
  }
  assert.ok(!priced.includes("KDV") && !classesOf(priced).has("home-card-tax"), "the tax note is once per section, not per card");
  const unavailable = renderToStaticMarkup(<HomeProductCardView model={{ href: "/urun/a-1", title: "T", categoryHref: "/katalog", categoryName: "Yedek parçalar",
    note: { text: "Şu an tedarik edilemiyor · Gelince haber ver", href: "/urun/a-1#haber-ver" } }} />);
  assert.ok(unavailable.includes('<a class="home-card-note home-card-note-link" href="/urun/a-1#haber-ver">Şu an tedarik edilemiyor · Gelince haber ver</a>'));
  assert.ok(!classesOf(unavailable).has("home-card-amount") && !classesOf(unavailable).has("home-card-tax"));
  const noPrice = renderToStaticMarkup(<HomeProductCardView model={{ href: "/urun/a-1", title: "T", categoryHref: "/katalog", categoryName: "Yedek parçalar",
    note: { text: "Fiyat bilgisi güncelleniyor" } }} />);
  assert.ok(noPrice.includes('<span class="home-card-note">Fiyat bilgisi güncelleniyor</span>'));
});
