import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../src/app/llms.txt/route";
import { aiCrawlers, privatePaths, robotsPolicy } from "../src/modules/seo/crawlers";
import { llmsTxt } from "../src/modules/seo/llms";
import { listingIndexable, minIndexableListingProducts } from "../src/modules/seo/indexing";
import { legalLinks } from "../src/content/legal";

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
  const open = ["/", "/katalog", "/kategori/fren", "/kategori/fren?page=2", "/katalog?brand=BOSCH", "/kategori/fren/bmw", "/yedek-parca/bmw", "/yedek-parca/volkswagen/golf-7", "/yedek-parca/volkswagen/golf-7?page=2", "/arac-markalari", "/urun/x", "/api/product-media/1", "/api/manufacturer-logos/bosch?v=abc", "/_next/image?url=%2Fa.png&w=640&q=75", "/servisler", "/llms.txt"];
  const closed = ["/yonetim/urunler", "/api/search/suggest", "/api/bakim-seti/gorsel?urun=1", "/sepet", "/giris?next=%2F", "/garaj", "/siparis/abc", "/siparis/abc/sozlesme", "/siparisler", "/siparis-olustur", "/servisler/basvuru", "/katalog?q=fren", "/kategori/fren?sort=price-asc", "/kategori/fren?brands=%5B%22BOSCH%22%5D&page=2", "/yedek-parca/bmw?fits=vehicle", "/yedek-parca/volkswagen/golf-7?sort=price-asc", "/yedek-parca/volkswagen/golf-7?brands=%5B%22BOSCH%22%5D", "/kategori/fren/bmw?q=disk", "/katalog?q=0986&searchBy=code"];
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
  // Make, category and catalog listings keep their rule (#638): no product threshold in this slice.
  assert.equal(listingIndexable({ make: "volkswagen" }, 0), true);
  assert.equal(listingIndexable({ category: "fren" }, 3), true);
  assert.equal(listingIndexable({ q: "fren" }, 500), false);
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
