import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { config, proxy } from "../src/proxy";
import { legacyRedirect } from "../src/modules/seo/legacy-redirects";
import { catalogPath, categoryPath, legacyListingPaths, listingPath, listingPaths, listingUrl, makePath, makesPath, searchPath } from "../src/modules/seo/paths";

// The Turkish listing addresses and the one-step 301s from the old ones (#638).

const redirect = (url: string) => {
  const parsed = new URL(url, "https://shop.example.invalid");
  return legacyRedirect(parsed.pathname, parsed.searchParams);
};

test("listing paths put the category first and the make after it", () => {
  assert.equal(listingPath(), "/katalog");
  assert.equal(listingPath({ makeSlug: "bmw" }), "/yedek-parca/bmw");
  assert.equal(listingPath({ categorySlug: "fren-diskleri-269" }), "/kategori/fren-diskleri-269");
  assert.equal(listingPath({ makeSlug: "bmw", categorySlug: "fren" }), "/kategori/fren/bmw");
  assert.equal(makesPath, "/arac-markalari");
  assert.equal(makePath("alfa-romeo"), "/yedek-parca/alfa-romeo");
  assert.equal(categoryPath("fren"), "/kategori/fren");
});

test("listingUrl keeps filters in the query, never the make or the category, and drops the page", () => {
  const query = { make: "bmw", category: "fren", brands: '["BOSCH"]', sort: "price-asc", page: "3" };
  assert.equal(listingUrl(query), "/kategori/fren/bmw?brands=%5B%22BOSCH%22%5D&sort=price-asc");
  assert.equal(listingUrl(query, { page: "4" }), "/kategori/fren/bmw?brands=%5B%22BOSCH%22%5D&sort=price-asc&page=4");
  assert.equal(listingUrl(query, { brands: undefined, sort: undefined }), "/kategori/fren/bmw");
  assert.equal(listingUrl(query, { category: undefined }), "/yedek-parca/bmw?brands=%5B%22BOSCH%22%5D&sort=price-asc");
  assert.equal(listingUrl({ q: "disk" }, { category: "fren" }), "/kategori/fren?q=disk");
  assert.equal(listingUrl({ brand: "MANN-FILTER" }), "/katalog?brand=MANN-FILTER");
  assert.equal(listingUrl({}), "/katalog");
});

test("searchPath is the catalog search", () => {
  assert.equal(searchPath({ q: "fren diski" }), "/katalog?q=fren+diski");
  assert.equal(searchPath({ q: "06A115561B", searchBy: "code" }), "/katalog?q=06A115561B&searchBy=code");
});

test("old listing addresses move to the new ones in one step", () => {
  const cases: [string, string | null][] = [
    ["/automakers", "/arac-markalari"],
    ["/automakers?x=1", "/arac-markalari?x=1"],
    ["/car-parts/bmw", "/yedek-parca/bmw"],
    ["/car-parts/bmw/", "/yedek-parca/bmw"],
    ["/car-parts/bmw?page=2", "/yedek-parca/bmw?page=2"],
    ["/car-parts/bmw?category=fren&page=2", "/kategori/fren/bmw?page=2"],
    ["/car-parts/bmw?category=fren&sort=newest", "/kategori/fren/bmw?sort=newest"],
    ["/katalog?category=fren", "/kategori/fren"],
    ["/katalog?category=fren-diskleri-269&brands=%5B%22BOSCH%22%5D&page=2", "/kategori/fren-diskleri-269?brands=%5B%22BOSCH%22%5D&page=2"],
    ["/katalog?category=fren&category=yag", "/kategori/fren"],
    ["/katalog?category=fren&_rsc=abc", "/kategori/fren"],
    // An invalid category is dropped; /katalog itself then stays where it is.
    ["/car-parts/bmw?category=Fren%20Disk", "/yedek-parca/bmw"],
    ["/katalog?category=Fren%20Disk", null],
    ["/katalog?category=", null],
    ["/katalog?q=x", null],
    ["/katalog", null],
    // An invalid make is not redirected (the old path answers 404).
    ["/car-parts/BMW!", null],
    ["/car-parts/bmw/x", null],
    ["/car-parts", null],
  ];
  for (const [from, to] of cases) assert.equal(redirect(from), to, from);
});

test("no redirect chain: a target and every new address is left alone", () => {
  const targets = ["/automakers", "/car-parts/bmw?category=fren&page=2", "/katalog?category=fren&q=x", "/car-parts/bmw?sort=newest"].map(redirect);
  const current = ["/katalog", "/katalog?q=x", "/arac-markalari", "/yedek-parca/bmw", "/kategori/fren", "/kategori/fren/bmw?page=2", "/kategori/fren?category=yag"];
  for (const path of [...targets, ...current]) {
    assert.ok(path);
    assert.equal(redirect(path), null, path);
  }
});

test("the proxy matcher covers every old listing address", () => {
  const sources = config.matcher.map(entry => typeof entry === "string" ? entry : entry.source);
  for (const old of legacyListingPaths) {
    const source = old.endsWith("/") ? `${old}:path*` : old;
    assert.ok(sources.includes(source), `${source} is missing from the proxy matcher`);
  }
  const catalog = config.matcher.find(entry => typeof entry !== "string" && entry.source === catalogPath);
  assert.deepEqual(catalog && typeof catalog !== "string" ? catalog.has : undefined, [{ type: "query", key: "category" }]);
});

// Next's proxy adapter turns a same-host Location into a relative one (checked with curl in the PR).
test("the proxy answers an old address with a 301 on the request's own host", () => {
  for (const [from, to] of [["/car-parts/bmw?category=fren&page=2", "/kategori/fren/bmw?page=2"], ["/automakers", "/arac-markalari"], ["/katalog?category=yag", "/kategori/yag"]]) {
    const response = proxy(new NextRequest(new URL(from, "https://shop.example.invalid")));
    assert.equal(response.status, 301, from);
    const location = new URL(response.headers.get("location") ?? "");
    assert.equal(location.origin, "https://shop.example.invalid", from);
    assert.equal(location.pathname + location.search, to, from);
  }
  assert.equal(proxy(new NextRequest(new URL("/katalog?q=x", "https://shop.example.invalid"))).status, 200);
});

test("every listing path has its route and the old routes are gone", () => {
  const store = join(process.cwd(), "src/app/(store)");
  assert.deepEqual([...listingPaths], ["/katalog", "/yedek-parca/", "/kategori/"]);
  for (const route of ["katalog/page.tsx", "arac-markalari/page.tsx", "yedek-parca/[make]/page.tsx", "kategori/[category]/page.tsx", "kategori/[category]/[make]/page.tsx"])
    assert.ok(existsSync(join(store, route)), route);
  for (const route of ["automakers", "car-parts"]) assert.ok(!existsSync(join(store, route)), route);
});
