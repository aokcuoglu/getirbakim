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
