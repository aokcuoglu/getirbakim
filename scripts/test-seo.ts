import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../src/app/llms.txt/route";
import { aiCrawlers, privatePaths, robotsPolicy } from "../src/modules/seo/crawlers";
import { llmsTxt } from "../src/modules/seo/llms";
import { isGatedListing, listingIndexable, minIndexableListingProducts } from "../src/modules/seo/indexing";
import { categoryNameInText } from "../src/modules/store/category-tree";
import { modelListingTitle, vehicleModelCategoryLabels, vehicleModelLabels, withModelYears } from "../src/modules/store/vehicle-model-groups";
import { legalLinks } from "../src/content/legal";
import { sitemapMaxWarmIntervalMs, sitemapRevalidateSeconds, sitemapTtlSeconds, sitemapWarmIntervalMs } from "../src/modules/seo/sitemap";
import { startSitemapWarmup, warmIntervalMs, warmSitemaps } from "../src/modules/seo/sitemap-warmup";

type Group = { userAgent?: string | string[]; allow?: string | string[]; disallow?: string | string[] };
const list = (value: string | string[] | undefined) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const production = robotsPolicy({ staging: false, site: "https://shop.example.invalid" });
const groups = production.rules as Group[];

function pattern(rule: string) {
  const anchored = rule.endsWith("$");
  const body = rule.replace(/\$$/, "").replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

function allowed(group: Group, url: string) {
  const matches = [
    ...list(group.allow).map(rule => ({ rule, allow: true })),
    ...list(group.disallow).map(rule => ({ rule, allow: false })),
  ].filter(entry => pattern(entry.rule).test(url));
  if (!matches.length) return true;
  const longest = Math.max(...matches.map(entry => entry.rule.length));
  return matches.filter(entry => entry.rule.length === longest).some(entry => entry.allow);
}

test("staging blocks everything and publishes no sitemap", () => {
  const staging = robotsPolicy({ staging: true, site: "https://shop.example.invalid" });
  assert.deepEqual(staging, { rules: { userAgent: "*", disallow: "/" } });
});

test("production has a general group and an AI crawler group with identical bodies", () => {
  assert.equal(groups.length, 2);
  assert.equal(groups[0].userAgent, "*");
  assert.deepEqual(groups[1].userAgent, aiCrawlers);
  assert.deepEqual(groups[0].allow, groups[1].allow);
  assert.deepEqual(groups[0].disallow, groups[1].disallow);
  assert.equal(production.sitemap, "https://shop.example.invalid/sitemap.xml");
});

test("robots rules open the public store and close private and unbounded URLs", () => {
  const open = ["/", "/katalog", "/kategori/fren", "/kategori/fren?page=2", "/katalog?brand=BOSCH", "/kategori/fren/bmw", "/yedek-parca/bmw", "/yedek-parca/volkswagen/golf-7", "/yedek-parca/volkswagen/golf-7?page=2", "/kategori/fren/volkswagen/golf-7", "/arac-markalari", "/urun/x", "/api/product-media/1", "/api/manufacturer-logos/bosch?v=abc", "/_next/image?url=%2Fa.png&w=640&q=75", "/servisler", "/llms.txt", "/marka/bosch", "/marka/bosch?page=2"];
  const closed = ["/yonetim/urunler", "/api/search/suggest", "/api/bakim-seti/gorsel?urun=1", "/sepet", "/giris?next=%2F", "/garaj", "/siparis/abc", "/siparis/abc/sozlesme", "/siparisler", "/siparis-olustur", "/servisler/basvuru", "/katalog?q=fren", "/kategori/fren?sort=price-asc", "/kategori/fren?brands=%5B%22BOSCH%22%5D&page=2", "/yedek-parca/bmw?fits=vehicle", "/yedek-parca/volkswagen/golf-7?sort=price-asc", "/yedek-parca/volkswagen/golf-7?brands=%5B%22BOSCH%22%5D", "/kategori/fren/volkswagen/golf-7?sort=price-asc", "/kategori/fren/bmw?q=disk", "/katalog?q=0986&searchBy=code", "/marka/bosch?sort=price-asc", "/marka/bosch?q=x"];
  for (const group of groups) {
    for (const url of open) assert.equal(allowed(group, url), true, `${url} should be allowed`);
    for (const url of closed) assert.equal(allowed(group, url), false, `${url} should be blocked`);
  }
});

test("a model listing is indexed only as a plain listing with enough products", () => {
  const model = { make: "volkswagen", model: "golf-7" };
  assert.equal(minIndexableListingProducts, 10);
  assert.equal(listingIndexable(model, 9), false);
  assert.equal(listingIndexable(model, 10), true);
  assert.equal(listingIndexable({ ...model, page: "2" }, 500), false);
  assert.equal(listingIndexable({ ...model, brands: '["BOSCH"]' }, 500), false);
  assert.equal(listingIndexable({ ...model, sort: "price-asc" }, 500), false);
  // Plain make, category and catalog listings keep their rule (#638): no product threshold.
  assert.equal(listingIndexable({ make: "volkswagen" }, 0), true);
  assert.equal(listingIndexable({ category: "fren" }, 3), true);
  assert.equal(listingIndexable({}, 0), true);
  assert.equal(listingIndexable({ q: "fren" }, 500), false);
});

test("model × category and make × category listings share the model pages' product minimum (#673)", () => {
  for (const query of [{ category: "fren", make: "volkswagen", model: "golf-7" }, { category: "fren", make: "volkswagen" }]) {
    assert.equal(isGatedListing(query), true);
    assert.equal(listingIndexable(query, 9), false);
    assert.equal(listingIndexable(query, 10), true);
    assert.equal(listingIndexable({ ...query, page: "2" }, 500), false);
    assert.equal(listingIndexable({ ...query, brands: '["BOSCH"]' }, 500), false);
  }
  assert.equal(isGatedListing({ make: "volkswagen", model: "golf-7" }), true);
  // The root category narrowed to a make or model repeats the make or model page: never indexed, whatever its size.
  for (const query of [{ category: "yedek-parca", make: "volkswagen", model: "golf-7" }, { category: "yedek-parca", make: "volkswagen" }]) {
    assert.equal(listingIndexable(query, 5000), false);
  }
  assert.equal(listingIndexable({ category: "yedek-parca" }, 5000), true);
  for (const query of [{}, { make: "volkswagen" }, { category: "fren" }]) assert.equal(isGatedListing(query), false);
});

test("model × category texts: years in one parenthesis, a title within 60 characters, all-caps words kept (#673)", () => {
  assert.equal(withModelYears("Volkswagen Golf 7", "2012–2022"), "Volkswagen Golf 7 (2012–2022)");
  assert.equal(withModelYears("Fiat Egea (Tipo 356)", "2015–günümüz"), "Fiat Egea (Tipo 356, 2015–günümüz)");
  assert.equal(withModelYears("Volkswagen Golf 7", null), "Volkswagen Golf 7");
  assert.equal(categoryNameInText("Fren Diskleri"), "fren diskleri");
  assert.equal(categoryNameInText("ABS Sensörü"), "ABS sensörü");
  assert.equal(categoryNameInText("LED Far ve AC Parçaları"), "LED far ve AC parçaları");
  assert.equal(categoryNameInText("A Sınıfı İç Aydınlatma"), "a sınıfı iç aydınlatma");
  const golf = { name: "GOLF VII (5G1)", dateFrom: "2012-08", dateTo: "2022-12" };
  assert.deepEqual(vehicleModelCategoryLabels("VOLKSWAGEN", golf, "fren sistemi"),
    { heading: "Volkswagen Golf VII (5G1, 2012–2022) fren sistemi", title: "Volkswagen Golf VII (5G1, 2012–2022) fren sistemi" });
  // Too long: the start year stays before the category name is cut, so generations of the same name keep apart titles.
  const sprinter = { name: "SPRINTER 3,5-T", dateFrom: "2006-01", dateTo: "2018-12" };
  const parts = "motor soğutma sistemi ve radyatör parçaları";
  const title = vehicleModelCategoryLabels("MERCEDES-BENZ", sprinter, parts).title;
  assert.ok(title.length <= 60, title);
  assert.equal(title, "Mercedes-Benz Sprinter 3,5-T (2006–) motor soğutma sistemi…");
  assert.notEqual(title, vehicleModelCategoryLabels("MERCEDES-BENZ", { ...sprinter, dateFrom: "2018-01", dateTo: null }, parts).title);
  // The model page: years while they fit; past the budget the name with "parçaları" (#673: always within 60).
  assert.equal(modelListingTitle("Volkswagen Golf 7", golf, "yedek parçaları"), "Volkswagen Golf 7 (2012–2022) yedek parçaları");
  // Long category names on a long model: the page part (before " | Getirbakim") stays within 60 characters.
  const golf7 = { name: "GOLF VII", dateFrom: "2012-08", dateTo: "2022-12" };
  assert.equal(vehicleModelCategoryLabels("VOLKSWAGEN", golf7, categoryNameInText("ABS Sensörleri ve Halkaları")).title,
    "Volkswagen Golf VII (2012–2022) ABS sensörleri ve halkaları");
  const longest = { name: "BLUEBIRD SYLPHY (G10) ESTATE COMBI VAN", dateFrom: "2000-08", dateTo: "2005-12" };
  for (const parts of ["yedek parçaları", "motor soğutma sistemi ve radyatör parçaları", "ABS sensörleri ve halkaları"]) {
    for (const title of [vehicleModelCategoryLabels("NISSAN", longest, parts).title, vehicleModelLabels("NISSAN", longest).title]) {
      assert.ok(title.length <= 60, `${title} (${title.length})`);
    }
  }
  assert.equal(vehicleModelLabels("MERCEDES-BENZ", { ...sprinter, name: "SPRINTER 3,5-T PLATFORM CHASSIS" }).title, "Mercedes-Benz Sprinter 3,5-T Platform Chassis parçaları");
});

test("llms.txt links are absolute, cover the legal pages and categories, and avoid private paths", () => {
  const site = "https://shop.example.invalid";
  const text = llmsTxt(site);
  assert.ok(text.startsWith("# Getirbakim"));
  const targets = [...text.matchAll(/\]\(([^)]+)\)/g)].map(match => match[1]);
  assert.ok(targets.length > 10);
  for (const target of targets) assert.ok(target.startsWith(`${site}/`), target);
  for (const { slug } of legalLinks) assert.ok(text.includes(`${site}/${slug})`), slug);
  for (const slug of ["yedek-parca", "fren", "filtre", "yag", "silecek", "aksesuar"]) assert.ok(text.includes(`/kategori/${slug})`), slug);
  for (const target of targets) {
    const path = target.slice(site.length);
    for (const blocked of privatePaths) assert.ok(!path.startsWith(blocked), `${path} is private`);
  }
});

test("llms.txt route answers with cacheable plain text", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.ok(response.headers.get("cache-control"));
  assert.ok((await response.text()).startsWith("# Getirbakim"));
});

test("the sitemap warm-up runs before the cached data goes stale or is evicted (#778)", () => {
  // A stale read starts the refresh, so a round must fall between "stale" and "evicted": interval < TTL - revalidate.
  assert.ok(sitemapWarmIntervalMs < (sitemapTtlSeconds - sitemapRevalidateSeconds) * 1000);
  assert.equal(warmIntervalMs(undefined), sitemapWarmIntervalMs);
  assert.equal(warmIntervalMs("60000"), 60_000);
  assert.equal(warmIntervalMs("999999999999"), sitemapMaxWarmIntervalMs);
});

test("warmSitemaps requests the slow files one after the other and never throws (#778)", async () => {
  const calls: string[] = [];
  let active = 0, overlapped = false;
  const fake = (async (url: string) => {
    calls.push(url);
    overlapped ||= ++active > 1;
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    if (url.endsWith("model-categories.xml")) throw new Error("boom");
    return new Response("<urlset/>", { status: url.endsWith("manufacturers.xml") ? 500 : 200 });
  }) as unknown as typeof fetch;
  const results = await warmSitemaps("http://127.0.0.1:3000", { fetch: fake });
  assert.deepEqual(calls, ["models.xml", "model-categories.xml", "manufacturers.xml"].map(file => `http://127.0.0.1:3000/sitemaps/${file}`));
  assert.deepEqual(results.map(({ file, ok }) => [file, ok]), [["models.xml", true], ["model-categories.xml", false], ["manufacturers.xml", false]]);
  assert.equal(overlapped, false);
});

test("startSitemapWarmup ticks on its interval, skips a running round and stops (#778)", async () => {
  let ticks = 0, active = 0, overlapped = false;
  const stop = startSitemapWarmup("http://127.0.0.1:3000", {
    intervalMs: 5, random: () => 0,
    warm: async () => { ticks++; overlapped ||= ++active > 1; await new Promise(resolve => setTimeout(resolve, 18)); active--; },
  });
  // unref'd timers do not keep the process alive; this pending timer does.
  await new Promise(resolve => setTimeout(resolve, 150));
  stop();
  const stopped = ticks;
  assert.ok(stopped >= 1, `ticks: ${stopped}`);
  assert.equal(overlapped, false);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(ticks, stopped);
});
