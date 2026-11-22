import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { config, proxy } from "../src/proxy";
import { legacyRedirect } from "../src/modules/seo/legacy-redirects";
import { resolveListing } from "../src/modules/store/listing-resolve";
import type { StoreCategory } from "../src/modules/store/category-tree";
import type { VehicleBrand } from "../src/modules/store/vehicle-catalog";
import type { VehicleModelGroup } from "../src/modules/store/vehicle-model-groups";
import { catalogPath, categoryPath, legacyListingPaths, listingPath, listingPaths, listingUrl, makePath, makesPath, manufacturerPath, modelPath, searchPath } from "../src/modules/seo/paths";

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

test("a model page sits under its make; a model without the make is ignored", () => {
  assert.equal(modelPath("volkswagen", "golf-7"), "/yedek-parca/volkswagen/golf-7");
  assert.equal(listingPath({ makeSlug: "volkswagen", modelSlug: "golf-7" }), "/yedek-parca/volkswagen/golf-7");
  assert.equal(listingPath({ makeSlug: "volkswagen", modelSlug: "golf-7", categorySlug: "fren" }), "/kategori/fren/volkswagen/golf-7");
  assert.equal(listingPath({ modelSlug: "golf-7" }), "/katalog");
  assert.equal(listingPath({ modelSlug: "golf-7", categorySlug: "fren" }), "/kategori/fren");
  const query = { make: "volkswagen", model: "golf-7", brands: '["BOSCH"]', page: "2" };
  assert.equal(listingUrl(query), "/yedek-parca/volkswagen/golf-7?brands=%5B%22BOSCH%22%5D");
  assert.equal(listingUrl(query, { page: "3", sort: "price-asc" }), "/yedek-parca/volkswagen/golf-7?brands=%5B%22BOSCH%22%5D&page=3&sort=price-asc");
  assert.equal(listingUrl(query, { model: undefined, brands: undefined }), "/yedek-parca/volkswagen");
  assert.equal(listingUrl({ category: "filtre", page: "3" }, { page: "1" }), "/kategori/filtre");
  assert.equal(listingUrl({ category: "filtre" }, { page: "2" }), "/kategori/filtre?page=2");
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

test("a manufacturer page keeps its slug in the path and ignores category and vehicle", () => {
  assert.equal(manufacturerPath("bosch"), "/marka/bosch");
  assert.equal(listingPath({ manufacturerSlug: "bosch" }), "/marka/bosch");
  assert.equal(listingPath({ manufacturerSlug: "bosch", categorySlug: "fren", makeSlug: "bmw" }), "/marka/bosch");
  const query = { manufacturer: "bosch", brands: '["BOSCH AV"]', page: "2" };
  assert.equal(listingUrl(query), "/marka/bosch?brands=%5B%22BOSCH+AV%22%5D");
  assert.equal(listingUrl(query, { page: "3" }), "/marka/bosch?brands=%5B%22BOSCH+AV%22%5D&page=3");
  assert.equal(listingUrl(query, { brands: undefined }), "/marka/bosch");
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
    ["/car-parts/bmw?make=audi&page=2", "/yedek-parca/bmw?page=2"],
    ["/katalog?category=fren&make=audi", "/kategori/fren"],
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
    // A catalog brand without a category is a manufacturer page (#660); with a category it stays the category's filter.
    ["/katalog?brand=BOSCH", "/marka/bosch"],
    ["/katalog?brand=MANN-FILTER&page=2", "/marka/mann-filter?page=2"],
    ["/katalog?brand=KALE%20RADYAT%C3%96R&_rsc=x", "/marka/kale-radyator"],
    ["/katalog?category=fren&brand=BOSCH", "/kategori/fren?brand=BOSCH"],
    ["/katalog?category=Fren%20Disk&brand=BOSCH", "/marka/bosch"],
    ["/katalog?brand=", null],
    ["/katalog?brand=%26", null],
  ];
  for (const [from, to] of cases) assert.equal(redirect(from), to, from);
});

const categories: StoreCategory[] = [
  { id: 252, parentId: 3, name: "Fren sistemi", slug: "fren", path: [3, 252], position: 0 },
  { id: 956, parentId: null, name: "Yağlar", slug: "yag", path: [956], position: 1 },
];
const makes: VehicleBrand[] = [{ id: "16", name: "BMW" }, { id: "5", name: "AUDI" }, { id: "121", name: "VOLKSWAGEN" }];
const golf7: VehicleModelGroup = { slug: "golf-7", name: "GOLF 7", family: "GOLF", generation: 7, dateFrom: "2012-08", dateTo: "2022-01",
  models: [{ id: "10585", brandId: "121", name: "GOLF VII (5G1, BQ1, BE1, BE2)", dateFrom: "2012-08", dateTo: "2021-10" }] };
const lookups = {
  categories: async () => categories,
  findMake: async (slug: string) => makes.find(make => make.name.toLowerCase() === slug),
  findModel: async (make: VehicleBrand, slug: string) => make.name === "VOLKSWAGEN" && slug === golf7.slug ? golf7 : undefined,
};
const resolve = (input: { category?: string; make?: string; model?: string; search?: Record<string, string> }) =>
  resolveListing({ ...input, search: input.search ?? {} }, lookups);

test("a listing's path segments win over the query and an unknown segment is a 404", async () => {
  const category = await resolve({ category: "fren", search: { category: "yag", page: "2" } });
  assert.equal(category?.query.category, "fren");
  assert.equal(category?.category?.id, 252);
  assert.equal(category?.query.page, "2");
  const make = await resolve({ make: "bmw", search: { make: "audi" } });
  assert.equal(make?.query.make, "bmw");
  assert.equal(make?.make?.name, "BMW");
  const both = await resolve({ category: "yag", make: "audi", search: { category: "fren", make: "bmw" } });
  assert.deepEqual([both?.query.category, both?.query.make, both?.make?.name], ["yag", "audi", "AUDI"]);
  // /yedek-parca/<make> and /katalog ignore a query category; /katalog ignores a query make.
  assert.equal((await resolve({ make: "bmw", search: { category: "fren" } }))?.query.category, undefined);
  const catalog = await resolve({ search: { category: "fren", make: "bmw", q: "disk" } });
  assert.deepEqual([catalog?.query.category, catalog?.query.make, catalog?.query.q, catalog?.category, catalog?.make], [undefined, undefined, "disk", undefined, undefined]);
  for (const input of [{ category: "Fren" }, { make: "BMW" }, { category: "fren", make: "BMW" }, { category: "fren disk" },
    { category: "yok-1" }, { make: "yok" }, { category: "fren", make: "yok" }, { category: "yok", make: "bmw" }])
    assert.equal(await resolve(input), null, JSON.stringify(input));
});

test("a model page needs its make and a known model of that make", async () => {
  const model = await resolve({ make: "volkswagen", model: "golf-7", search: { model: "golf-6", make: "bmw", page: "2" } });
  assert.deepEqual([model?.query.make, model?.query.model, model?.query.page, model?.make?.name, model?.model?.slug],
    ["volkswagen", "golf-7", "2", "VOLKSWAGEN", "golf-7"]);
  // A query model is ignored where the path has none.
  assert.equal((await resolve({ make: "volkswagen", search: { model: "golf-7" } }))?.query.model, undefined);
  assert.equal((await resolve({ search: { make: "volkswagen", model: "golf-7" } }))?.query.model, undefined);
  for (const input of [{ model: "golf-7" }, { make: "volkswagen", model: "golf-6" }, { make: "volkswagen", model: "Golf-7" },
    { make: "volkswagen", model: "golf 7" }, { make: "bmw", model: "golf-7" }, { make: "yok", model: "golf-7" }])
    assert.equal(await resolve(input), null, JSON.stringify(input));
});

test("no redirect chain: a target and every new address is left alone", () => {
  const targets = ["/automakers", "/car-parts/bmw?category=fren&page=2", "/katalog?category=fren&q=x", "/car-parts/bmw?sort=newest", "/katalog?brand=BOSCH&page=2", "/katalog?category=fren&brand=BOSCH"].map(redirect);
  const current = ["/katalog", "/katalog?q=x", "/arac-markalari", "/yedek-parca/bmw", "/yedek-parca/volkswagen/golf-7", "/kategori/fren", "/kategori/fren/bmw?page=2", "/kategori/fren?category=yag", "/marka/bosch", "/marka/bosch?page=2", "/marka/bosch?brand=BOSCH"];
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
  const catalog = config.matcher.filter(entry => typeof entry !== "string" && entry.source === catalogPath);
  assert.deepEqual(catalog.map(entry => typeof entry !== "string" ? entry.has : undefined), [[{ type: "query", key: "category" }], [{ type: "query", key: "brand" }]]);
});

// Next's proxy adapter turns a same-host Location into a relative one (checked with curl in the PR).
test("the proxy answers an old address with a 301 on the request's own host", () => {
  for (const [from, to] of [["/car-parts/bmw?category=fren&page=2", "/kategori/fren/bmw?page=2"], ["/automakers", "/arac-markalari"], ["/katalog?category=yag", "/kategori/yag"], ["/katalog?brand=BOSCH&page=2", "/marka/bosch?page=2"]]) {
    const response = proxy(new NextRequest(new URL(from, "https://shop.example.invalid")));
    assert.equal(response.status, 301, from);
    const location = new URL(response.headers.get("location") ?? "");
    assert.equal(location.origin, "https://shop.example.invalid", from);
    assert.equal(location.pathname + location.search, to, from);
  }
  assert.equal(proxy(new NextRequest(new URL("/katalog?q=x", "https://shop.example.invalid"))).status, 200);
});

// A shared cache would keep a Set-Cookie with the body (#642); the /stats tracker routes are public and never slide a session (#1290).
test("the stats routes are outside the proxy's session sliding", () => {
  for (const path of ["/stats/js/script.js", "/stats/api/event"]) {
    const request = new NextRequest(new URL(path, "https://shop.example.invalid"), { headers: { cookie: "gb_session=abc" } });
    assert.equal(proxy(request).headers.get("set-cookie"), null, path);
  }
  const last = config.matcher.at(-1);
  const source = typeof last === "string" ? last : last?.source ?? "";
  assert.match(source, /stats\//);
});

test("every listing path has its route and the old routes are gone", () => {
  const store = join(process.cwd(), "src/app/(store)");
  assert.deepEqual([...listingPaths], ["/katalog", "/yedek-parca/", "/kategori/", "/marka/"]);
  for (const route of ["katalog/page.tsx", "arac-markalari/page.tsx", "yedek-parca/[make]/page.tsx", "yedek-parca/[make]/[model]/page.tsx", "kategori/[category]/page.tsx", "kategori/[category]/[make]/page.tsx", "marka/[manufacturer]/page.tsx"])
    assert.ok(existsSync(join(store, route)), route);
  for (const route of ["automakers", "car-parts"]) assert.ok(!existsSync(join(store, route)), route);
});
