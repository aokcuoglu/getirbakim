import assert from "node:assert/strict";
import test from "node:test";
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
  assert.match(carousel, /nth-\[n\+6\]:\[content-visibility:hidden\]/);
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
