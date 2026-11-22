import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement as stubElement } from "react";

// next/image does not load under tsx (its default import is a module object): swap it for a plain <img> before any
// component imports it, so the slide-image guards below can render the images. Components must therefore stay
// dynamically imported inside the tests of this file: a static import would load the real next/image first.
const nodeRequire = createRequire(import.meta.url);
const imageId = realpathSync(nodeRequire.resolve("next/image"));
const StubImage = ({ src, alt, className }: { src: string; alt: string; className?: string }) => stubElement("img", { src, alt, className });
nodeRequire.cache[imageId] = { id: imageId, filename: imageId, loaded: true, exports: Object.assign(StubImage, { __esModule: true, default: StubImage }) } as unknown as NodeJS.Module;

import test from "node:test";
import { homeCollectionSize, homeRailSize, spreadByBrand } from "@/modules/store/home-rail";
import { popularVehicleMakes, splitPopularBrands, turkeyPopularMakes } from "@/modules/store/vehicle-catalog";

test("splitPopularBrands orders popular makes by Türkiye rank and keeps the rest as received", () => {
  const brands = ["AUDI", "Citroën", "FORD", "BMW", "FIAT", "SKODA"].map(name => ({ name }));
  const { popular, others } = splitPopularBrands(brands);
  assert.deepEqual(popular.map(brand => brand.name), ["FIAT", "FORD", "Citroën"]);
  assert.deepEqual(others.map(brand => brand.name), ["AUDI", "BMW", "SKODA"]);
});

test("splitPopularBrands skips makes the list does not have", () => {
  assert.deepEqual(splitPopularBrands([{ name: "RENAULT" }]), { popular: [{ name: "RENAULT" }], others: [] });
  assert.deepEqual(splitPopularBrands([]), { popular: [], others: [] });
});

test("popularVehicleMakes leads with the Türkiye makes and has no duplicates", () => {
  assert.deepEqual(popularVehicleMakes.slice(0, 10), turkeyPopularMakes);
  assert.equal(new Set(popularVehicleMakes).size, popularVehicleMakes.length);
});

test("home first-screen copy is policy-backed and makes no unsupported claims", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const { homeFeatured, homeHero, homeTrust } = await import("@/content/home");
  assert.equal(homeTrust.length, 3);
  assert.equal(homeFeatured.length, 2);
  const copy = JSON.stringify({ homeHero, homeTrust, homeFeatured });
  assert.doesNotMatch(copy, /ücretsiz|bedava/i);
  assert.doesNotMatch(copy, /uyumlu|uyar|garanti/i);
  const policy = JSON.stringify((JSON.parse(readFileSync("src/content/legal-pages.json", "utf8")) as Record<string, unknown>)["teslimat-ve-iade"]);
  assert.ok(policy.includes("14 gün içinde gerekçe göstermeden"));
  assert.match(homeTrust.map(item => item.title).join(" "), /cayma/i);
  const trustCopy = homeTrust.map(item => `${item.title} ${item.text}`).join(" ");
  const days: string[] = trustCopy.match(/\d+ gün/g) ?? [];
  assert.ok(days.includes("14 gün"));
  for (const day of days) assert.ok(policy.includes(day), `${day} is not in teslimat-ve-iade`);
  for (const { image } of homeFeatured) assert.ok(existsSync(`public/media/site/images/${image}`), image);
  assert.doesNotMatch(readFileSync("src/app/(store)/page.tsx", "utf8"), /promotions/);
  assert.doesNotMatch(readFileSync("src/components/home-controls.tsx", "utf8"), /promotions/);
});

test("hero images are content-hashed static imports (#1217)", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (path: string) => readFileSync(path, "utf8");
  assert.match(read("src/components/hero-backdrop.tsx").match(/<img [^>]*>/)?.[0] ?? "", /width=\{[^}]+\}\s+height=\{[^}]+\}/);
  for (const path of ["src/app/(store)/page.tsx", "src/app/(store)/katalog/catalog-view.tsx"]) {
    assert.doesNotMatch(read(path), /\/media\/site\/images\/(Hero_image|brake-system-banner|mobile-catalog)/, path);
  }
  assert.doesNotMatch(read("src/components/catalog-sticky-finder.tsx"), /\/media\/site\/images\//);
  assert.doesNotMatch(read("src/components/navigation/category-sheet.tsx"), /\/media\/site\/images\//);
});

test("HeroBackdrop preloads exactly the URLs its <source> and <img> use (#1217)", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { HeroBackdrop } = await import("@/components/hero-backdrop");
  const image = (name: string, width: number) => ({ src: `/_next/static/media/${name}.abc.webp?dpl=x`, width, height: 100 });
  const html = renderToStaticMarkup(createElement(HeroBackdrop, { mobile: image("m", 750), desktop: image("d", 1920), desktop2x: image("d2", 3840) }));
  const srcSet = `/_next/static/media/d.abc.webp?dpl=x 1920w, /_next/static/media/d2.abc.webp?dpl=x 3840w`;
  const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`, "i"))?.[1]?.replaceAll("&amp;", "&");
  const links = html.match(/<link [^>]*>/g) ?? [];
  const sources = html.match(/<source [^>]*>/g) ?? [];
  assert.equal(links.length, 2);
  assert.equal(sources.length, 2);
  assert.equal(attr(links[0], "href"), attr(sources[0], "srcSet"));
  assert.equal(attr(links[1], "imageSrcSet"), srcSet);
  assert.equal(attr(links[1], "imageSrcSet"), attr(sources[1], "srcSet"));
  assert.equal(attr(links[1], "href"), attr(html.match(/<img [^>]*>/)?.[0] ?? "", "src"));
});

type Callback = (entries: { isIntersecting: boolean }[]) => void;

function fakeObserver() {
  const state = { options: undefined as IntersectionObserverInit | undefined, observed: 0, disconnected: 0, callback: undefined as Callback | undefined };
  class Fake {
    constructor(callback: Callback, options?: IntersectionObserverInit) { state.callback = callback; state.options = options; }
    observe() { state.observed++; }
    disconnect() { state.disconnected++; }
  }
  return { state, Observer: Fake as unknown as typeof IntersectionObserver };
}

test("armOnApproach arms once when the node nears the viewport and then disconnects", async () => {
  const { armOnApproach } = await import("@/components/home-arming");
  const { state, Observer } = fakeObserver();
  let armed = 0;
  armOnApproach({} as Element, () => { armed++; }, Observer);
  assert.deepEqual(state.options, { rootMargin: "200px 0px" });
  assert.equal(state.observed, 1);
  state.callback?.([{ isIntersecting: false }]);
  assert.equal(armed, 0);
  assert.equal(state.disconnected, 0);
  state.callback?.([{ isIntersecting: true }]);
  assert.equal(armed, 1);
  assert.equal(state.disconnected, 1);
});

test("armOnApproach cleanup disconnects the observer", async () => {
  const { armOnApproach } = await import("@/components/home-arming");
  const { state, Observer } = fakeObserver();
  armOnApproach({} as Element, () => undefined, Observer)();
  assert.equal(state.disconnected, 1);
});

test("armOnApproach without IntersectionObserver arms asynchronously and can be cancelled", async () => {
  const { armOnApproach } = await import("@/components/home-arming");
  let armed = 0;
  armOnApproach({} as Element, () => { armed++; }, undefined);
  assert.equal(armed, 0);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(armed, 1);
  armOnApproach({} as Element, () => { armed++; }, undefined)();
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(armed, 1);
});

test("HomeCarousel keeps every slide in the HTML with the deferral classes; HomeGridPager defers pages after the first", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { HomeCarousel, HomeGridPager } = await import("@/components/home-controls");
  const slides = Array.from({ length: 7 }, (_, index) => createElement("a", { key: index, href: `/s${index}` }, `slide ${index}`));
  const carousel = renderToStaticMarkup(createElement(HomeCarousel, { label: "Ürünler", columns: 5, children: slides }));
  for (let index = 0; index < 7; index++) assert.ok(carousel.includes(`href="/s${index}"`));
  assert.match(carousel, /min-\[48\.0625rem\]:\*:nth-\[n\+6\]:\[content-visibility:hidden\]/);
  const item = carousel.match(/<div[^>]*data-slot="carousel-item"[^>]*>/)?.[0] ?? "";
  assert.doesNotMatch(item, /content-visibility/);
  const entries = Array.from({ length: 20 }, (_, index) => createElement("span", { key: index }, `m${index}`));
  const pager = renderToStaticMarkup(createElement(HomeGridPager, { label: "Markalar", kind: "makes", children: entries }));
  const items = pager.match(/<div[^>]*data-slot="carousel-item"[^>]*>/g) ?? [];
  assert.equal(items.length, 2);
  assert.doesNotMatch(items[0], /content-visibility/);
  assert.match(items[1], /content-visibility:hidden/);
});

test("home request-budget source guards (#1226)", async () => {
  const { readFileSync } = await import("node:fs");
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const controls = readFileSync("src/components/home-controls.tsx", "utf8");
  assert.doesNotMatch(controls, /requestIdleCallback|addEventListener\("load"/);
  const newsletter = readFileSync("src/components/newsletter-signup.tsx", "utf8");
  assert.doesNotMatch(newsletter, /backgroundImage|style=/);
  assert.match(newsletter, /loading="lazy"/);
  assert.match(readFileSync("src/components/home-highlights.tsx", "utf8"), /prefetch=\{false\}/);
  const { HomeTrustLine } = await import("@/components/home-highlights");
  assert.equal((renderToStaticMarkup(createElement(HomeTrustLine)).match(/<a /g) ?? []).length, 3);
});

test("spreadByBrand moves the first N of each brand up front, keeps order and never drops items", () => {
  const items = ["DEPO", "DEPO", "DEPO", "BOSCH", "DEPO", "FEBI", "BOSCH", "BOSCH"].map((display_brand, id) => ({ display_brand, id }));
  const spread = spreadByBrand(items, 2);
  assert.deepEqual(spread.map(item => item.id), [0, 1, 3, 5, 6, 2, 4, 7]);
  assert.equal(spread.length, items.length);
  assert.deepEqual(spreadByBrand(items.filter(item => item.display_brand === "DEPO"), 2).map(item => item.id), [0, 1, 2, 4]);
  assert.deepEqual(spreadByBrand([], 2), []);
  assert.ok(homeRailSize > 0 && homeCollectionSize > 0);
});

test("HomeCarousel renders <img> only in the first slides until armed; every link stays (#1289)", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { HomeCarousel } = await import("@/components/home-controls");
  const { HomeProductCardView } = await import("@/components/home-product-card-view");
  const cards = Array.from({ length: 8 }, (_, index) => createElement(HomeProductCardView, { key: index, model: { href: `/urun/p-${index}`, title: `Ürün ${index}`, image: `/img/${index}.jpg`, categoryHref: "/katalog", categoryName: "Parça", amount: "1,00 ₺" } }));
  const html = renderToStaticMarkup(createElement(HomeCarousel, { label: "Ürünler", columns: 5, children: cards }));
  assert.equal((html.match(/<img /g) ?? []).length, 5);
  for (let index = 0; index < 8; index++) assert.ok(html.includes(`href="/urun/p-${index}"`));
  assert.equal((html.match(/<span class="home-card-img rounded-md bg-muted"><\/span>/g) ?? []).length, 3);
  assert.equal((html.match(/class="home-card-image"[^>]*aria-hidden="true"[^>]*tabindex="-1"|tabindex="-1"[^>]*aria-hidden="true"/g) ?? []).length, 8);
});

test("the home card image link is always named, hidden and out of the tab order (#1313)", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { HomeProductCardView } = await import("@/components/home-product-card-view");
  const { SlideImages } = await import("@/components/home-slide-images");
  const model = { href: "/urun/p-1", title: "Ürün 1", categoryHref: "/katalog", categoryName: "Parça", amount: "1,00 ₺" };
  const withImage = createElement(HomeProductCardView, { model: { ...model, image: "/img/1.jpg" } });
  const armed = renderToStaticMarkup(withImage);
  const deferred = renderToStaticMarkup(createElement(SlideImages.Provider, { value: false }, withImage));
  const noImage = renderToStaticMarkup(createElement(HomeProductCardView, { model }));
  assert.ok(armed.includes("<img "));
  assert.ok(deferred.includes("<span ") && !deferred.includes("<img "));
  for (const html of [armed, deferred, noImage]) {
    const tag = html.match(/<a [^>]*class="home-card-image"[^>]*>/)?.[0] ?? "";
    assert.ok(tag.includes('aria-label="Ürün 1"') && tag.includes('aria-hidden="true"') && tag.includes('tabindex="-1"'), tag);
  }
});

test("HomeGridPager renders tile logos on page 0 only; every tile link stays (#1289)", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { HomeGridPager } = await import("@/components/home-controls");
  const { HomeMakeTile } = await import("@/components/home-tiles");
  const tiles = Array.from({ length: 20 }, (_, index) => createElement(HomeMakeTile, { key: index, href: `/yedek-parca/m${index}`, label: `M${index}`, logo: [`/logo/${index}.svg`, 40, 40] }));
  const html = renderToStaticMarkup(createElement(HomeGridPager, { label: "Markalar", kind: "makes", children: tiles }));
  assert.equal((html.match(/<img /g) ?? []).length, 18);
  for (let index = 0; index < 20; index++) assert.ok(html.includes(`href="/yedek-parca/m${index}"`));
  assert.ok(html.includes('aria-label="M19"') && html.includes("make-tile-name"));
});

test("the e-mail address is not in the footer markup or the Organization JSON-LD (#1289)", async () => {
  const { readFileSync } = await import("node:fs");
  assert.doesNotMatch(readFileSync("src/components/site-footer.tsx", "utf8"), /mailto:|contactEmail/);
  const { siteJsonLd } = await import("@/lib/site");
  assert.doesNotMatch(JSON.stringify(siteJsonLd), /"email"/);
});

test("IntentLink renders a plain anchor and the four eager-prefetch call sites use it (#1283)", async () => {
  const { readFileSync } = await import("node:fs");
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { IntentLink } = await import("@/components/intent-link");
  const html = renderToStaticMarkup(createElement(IntentLink, { href: "/sepet", className: "cart-x", "aria-label": "Sepetim" }, "Sepet"));
  assert.equal(html, '<a class="cart-x" aria-label="Sepetim" href="/sepet">Sepet</a>');
  const intentSource = readFileSync("src/components/intent-link.tsx", "utf8");
  assert.ok(intentSource.includes("prefetch={armed ? null : false}"));
  for (const handler of ["onPointerEnter", "onTouchStart", "onFocus"]) assert.match(intentSource, new RegExp(`${handler}=\\{event => \\{ setArmed\\(true\\)`), handler);
  for (const [file, href] of [["home-highlights.tsx", "categoryPath"], ["maintenance-robot-banner.tsx", "/bakim-robotu"], ["navigation/cart-badge.tsx", "/sepet"], ["navigation/header-tools.tsx", "/sepet"]]) {
    const source = readFileSync(`src/components/${file}`, "utf8");
    assert.match(source, /<IntentLink /, file);
    assert.ok(source.includes(href), file);
    assert.doesNotMatch(source, /<Link[^>]*href=\{?"?\/?(sepet|bakim-robotu)/, file);
  }
  assert.doesNotMatch(readFileSync("src/components/home-highlights.tsx", "utf8").split("HomeFeaturedCards")[1], /<Link /);
});
