import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { productIndexable, productIndexPolicy } from "../src/modules/seo/indexing";
import { absoluteUrl, categoryPagePath, makePagePath, productPagePath } from "../src/modules/seo/sitemap-urls";
import { parseSitemapFile, productChunkRange, productChunks, renderSitemapIndex, renderUrlset, sitemapEnabled, sitemapFiles,
  sitemapUrlLimit, staticPaths, withAncestors } from "../src/modules/seo/sitemap";
import { siteUrl } from "../src/lib/site";
import { legalLinks } from "../src/content/legal";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";

// The chunked sitemap (#634): pure helpers, then the queries against an isolated copy of the schema. Nothing is written
// to the shared database's tables.

describe("sitemap helpers", () => {
  test("productIndexable: demo and unavailable cards are noindex, store rows and the supplier catalog follow the policy", () => {
    assert.equal(productIndexable({ supplier: "demo", source: "store" }), false);
    assert.equal(productIndexable({ supplier: "basbug", source: "store" }), true);
    assert.equal(productIndexable({ supplier: "basbug", source: "supplier" }), productIndexPolicy.supplierCatalog);
    assert.equal(productIndexable({ supplier: "dinamik", source: "supplier", unavailable: false }), productIndexPolicy.supplierCatalog);
    assert.equal(productIndexable({ supplier: "basbug", source: "supplier", unavailable: true }), false);
    assert.equal(productIndexPolicy.supplierCatalog, true);
  });

  test("product files cover the uuid space in order, without gaps or overlaps", () => {
    const ranges = Array.from({ length: productChunks }, (_, index) => productChunkRange(index));
    assert.equal(ranges[0].from, "00000000-0000-0000-0000-000000000000");
    assert.equal(ranges[0].to, "03ffffff-ffff-ffff-ffff-ffffffffffff");
    assert.equal(ranges.at(-1)?.to, "ffffffff-ffff-ffff-ffff-ffffffffffff");
    const byte = (uuid: string) => parseInt(uuid.slice(0, 2), 16);
    ranges.forEach((range, index) => {
      assert.ok(range.from < range.to);
      if (index > 0) assert.equal(byte(range.from), byte(ranges[index - 1].to) + 1, `range ${index} follows range ${index - 1}`);
    });
  });

  test("file names round-trip; unknown names are rejected", () => {
    const files = sitemapFiles();
    assert.equal(files.length, 3 + productChunks);
    assert.deepEqual(files.slice(0, 4), ["pages.xml", "categories.xml", "makes.xml", "products-00.xml"]);
    assert.equal(files.at(-1), "products-63.xml");
    assert.deepEqual(parseSitemapFile("products-07.xml"), { kind: "products", index: 7 });
    assert.deepEqual(files.map(file => parseSitemapFile(file)).filter(Boolean).length, files.length);
    for (const bad of ["products-64.xml", "products-7.xml", "x.xml", "pages", "products-00.xml.gz"]) assert.equal(parseSitemapFile(bad), null, bad);
  });

  test("XML is escaped and a file stops at the URL limit", () => {
    const xml = renderUrlset([{ url: "https://a.test/katalog?category=a&b", lastModified: "2026-11-15T00:00:00Z" }, { url: "https://a.test/<x>" }]);
    assert.match(xml, /<loc>https:\/\/a\.test\/katalog\?category=a&amp;b<\/loc><lastmod>2026-11-15T00:00:00Z<\/lastmod>/);
    assert.match(xml, /<loc>https:\/\/a\.test\/&lt;x&gt;<\/loc><\/url>/);
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    const original = console.error;
    let logged = "";
    console.error = (message: string) => { logged = message; };
    try {
      const many = renderUrlset(Array.from({ length: sitemapUrlLimit + 2 }, (_, index) => ({ url: `https://a.test/${index}` })));
      assert.equal(many.match(/<loc>/g)?.length, sitemapUrlLimit);
      assert.match(logged, /45002 URLs/);
    } finally { console.error = original; }
    const index = renderSitemapIndex(["https://a.test/sitemaps/pages.xml?a&b"]);
    assert.match(index, /<sitemapindex xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">\n<sitemap><loc>https:\/\/a\.test\/sitemaps\/pages\.xml\?a&amp;b<\/loc><\/sitemap>/);
    assert.equal(renderSitemapIndex([]).includes("<sitemap>"), false);
  });

  test("withAncestors keeps categories with products and their ancestors", () => {
    const nodes = [{ id: 1, path: [1] }, { id: 2, path: [1, 2] }, { id: 3, path: [1, 2, 3] }, { id: 4, path: [1, 4] }, { id: 5, path: [5] }];
    assert.deepEqual(withAncestors(nodes, [3]).map(node => node.id), [1, 2, 3]);
    assert.deepEqual(withAncestors(nodes, [4, 4, 99]).map(node => node.id), [1, 4]);
    assert.deepEqual(withAncestors(nodes, []), []);
  });

  test("staging serves empty sitemaps", () => {
    const original = process.env.APP_ENV;
    try {
      process.env.APP_ENV = "staging";
      assert.equal(sitemapEnabled(), false);
      process.env.APP_ENV = "production";
      assert.equal(sitemapEnabled(), true);
      delete process.env.APP_ENV;
      assert.equal(sitemapEnabled(), true);
    } finally {
      if (original === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = original;
    }
  });

  test("page paths match the pages' canonicals; legal pages carry their date", () => {
    assert.equal(productPagePath("abc"), "/urun/abc");
    assert.equal(categoryPagePath("fren-252"), "/katalog?category=fren-252");
    assert.equal(makePagePath("alfa-romeo"), "/car-parts/alfa-romeo");
    assert.equal(absoluteUrl("/katalog"), `${siteUrl}/katalog`);
    assert.equal(staticPaths[0].path, "");
    assert.equal(staticPaths.length, 8 + legalLinks.length);
    for (const link of legalLinks) assert.match(staticPaths.find(page => page.path === `/${link.slug}`)?.lastModified ?? "", /^\d{4}-\d{2}-\d{2}/);
  });
});

describe("sitemap queries", () => {
  let schema: Awaited<ReturnType<typeof isolatedSchema>>;
  let queries: typeof import("../src/modules/seo/sitemap.server");
  let catalog: typeof import("../src/modules/store/catalog");
  let closeDb: () => Promise<void>;
  const ids: Record<string, string> = {};
  const [basbug, , dinamik] = storefrontCompanies();

  type Item = { supplier?: "basbug" | "dinamik"; code: string; brand: string; warehouse?: string; presence?: "present" | "inactive";
    conflicting?: boolean; category?: string };
  async function item(key: string, { supplier = "basbug", code, brand, warehouse, presence = "present", conflicting = false, category }: Item) {
    const product = { uk: brand, ac: `${key} PARCA`, ac2: "", dc: "TL", ...(category ? { category } : {}),
      ...(supplier === "dinamik" ? { marka: brand, stokAdi: `${key} PARCA` } : {}) };
    const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
      product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
      VALUES($1,$2,'G',$3,$4,$5,'{"nf":100}','{"stok":2}',1,1,1,$6,$7,now()-interval '10 days',now()-interval '1 hour',now()-interval '1 hour') RETURNING id::text`,
    [supplier, supplier === "basbug" ? basbug : dinamik, warehouse ?? (supplier === "basbug" ? "MRK" : "ALL"), code, product, conflicting, presence]);
    ids[key] = rows[0].id;
  }
  async function storeProduct(key: string, supplier: "basbug" | "demo", code: string) {
    ids[key] = (await schema.pool.query<{ id: string }>(`INSERT INTO store_products(supplier,code,name,brand,price_kurus,stock)
      VALUES($1,$2,'MAGAZA PARCA','BOSCH',1000,3) RETURNING id::text`, [supplier, code])).rows[0].id;
  }
  const allChunks = async () => {
    const rows = [];
    for (let index = 0; index < productChunks; index++) {
      const chunk = await queries.loadProductChunk(index);
      const { from, to } = productChunkRange(index);
      for (const row of chunk) assert.ok(row.id >= from && row.id <= to, `${row.id} lies in file ${index}`);
      rows.push(...chunk);
    }
    return rows;
  };

  before(async () => {
    schema = await isolatedSchema("sitemap_test");
    await item("listed", { code: "MAH 20020", brand: "MAHLE" });
    await item("dinamik", { supplier: "dinamik", code: "SACHS 1000", brand: "SACHS", category: "fren" });
    await item("depot", { code: "MAH 30030", brand: "MAHLE", warehouse: "IST" });
    await item("conflicting", { code: "SAC 2222", brand: "SACHS", conflicting: true });
    await item("inactive", { code: "LMI 4444", brand: "LEMFORDER", presence: "inactive" });
    await item("primary", { code: "BOS 0986A11", brand: "BOSCH" });
    await item("secondary", { supplier: "dinamik", code: "BOSCH 0986A11", brand: "BOSCH" });
    await item("hidden", { code: "NGK 5555", brand: "NGK" });
    await storeProduct("store", "basbug", "STORE 1");
    await storeProduct("demo", "demo", "DEMO 1");
    await schema.pool.query("INSERT INTO product_offers(item_id,primary_id) VALUES($1,$1),($2,$1)", [ids.primary, ids.secondary]);
    await schema.pool.query("INSERT INTO commerce_item_overrides(supplier_item_id,product_id,hidden) VALUES($1,$1,true)", [ids.hidden]);
    // Category tree: 100 > 101 (enriched product) and 100 > 102 (empty); 200 empty root; 252 = legacy "fren".
    await schema.pool.query(`INSERT INTO source_categories(source,category_id,parent_id,name,slug,path_ids,source_url,raw) VALUES
      ('trodo',100,NULL,'Fren Sistemi','fren-sistemi','{100}','','{}'),('trodo',101,100,'Balata','balata','{100,101}','','{}'),
      ('trodo',102,100,'Disk','disk','{100,102}','','{}'),('trodo',200,NULL,'Aydınlatma','aydinlatma','{200}','','{}'),
      ('trodo',252,NULL,'Fren','fren','{252}','','{}')`);
    await schema.pool.query(`INSERT INTO source_category_labels(source,category_id,locale,name,slug) VALUES
      ('trodo',100,'tr','Fren Sistemi','fren-sistemi-100'),('trodo',101,'tr','Balata','balata-101'),('trodo',102,'tr','Disk','disk-102'),
      ('trodo',200,'tr','Aydınlatma','aydinlatma-200'),('trodo',252,'tr','Fren','fren')`);
    await schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,payload)
      VALUES($1,'MAH 20020','MAHLE','https://example.test/p','test','MAHLE','20020','{}')`, [ids.listed]);
    // The enrichment was imported after the row last changed: the sitemap's lastmod follows the newer time.
    await schema.pool.query(`INSERT INTO product_enrichment_shared_links(supplier_item_id,supplier_code,supplier_brand,donor_item_id,donor_oem,status,imported_at)
      VALUES($1,'MAH 20020','MAHLE',$1,'','complete',now())`, [ids.listed]);
    await schema.pool.query("INSERT INTO product_source_categories(supplier_item_id,source,category_id) VALUES($1,'trodo',101)", [ids.listed]);
    await schema.pool.query("INSERT INTO vehicle_brands(id,name,display_name) VALUES(1,'VW','VOLKSWAGEN'),(2,'ALFA','ALFA ROMEO')");
    await schema.pool.query("INSERT INTO storefront_make_fits(brand_id,supplier_item_id) VALUES(2,$1)", [ids.listed]);
    const [{ db }, queriesModule, catalogModule] = await Promise.all([import("../src/lib/db"), import("../src/modules/seo/sitemap.server"),
      import("../src/modules/store/catalog")]);
    queries = queriesModule;
    catalog = catalogModule;
    closeDb = () => db.end();
  });
  after(async () => { await closeDb?.(); await schema?.drop(); });

  test("the product files list each listed product exactly once", async () => {
    const listed = (await allChunks()).map(row => row.id);
    assert.equal(new Set(listed).size, listed.length);
    assert.deepEqual(listed.sort(), [ids.listed, ids.dinamik, ids.primary, ids.store].sort());
  });

  test("a product is in the sitemap exactly when its page is indexable", async () => {
    const listed = new Set((await allChunks()).map(row => row.id));
    for (const [key, id] of Object.entries(ids)) {
      const { product } = await catalog.getStoreProduct(id);
      assert.equal(Boolean(product && productIndexable(product)), listed.has(id), `${key}: page indexable ⇔ in the sitemap`);
    }
  });

  test("lastmod is the newer of the row's change and its enrichment import", async () => {
    const rows = new Map((await allChunks()).map(row => [row.id, row.lastmod]));
    const expected = async (sql: string, id: string) => (await schema.pool.query<{ at: string }>(
      `SELECT to_char((${sql}) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at`, [id])).rows[0].at;
    assert.equal(rows.get(ids.listed), await expected("SELECT imported_at FROM product_enrichment_shared_links WHERE supplier_item_id=$1", ids.listed));
    assert.equal(rows.get(ids.dinamik), await expected("SELECT changed_at FROM supplier_items WHERE id=$1", ids.dinamik));
    assert.equal(rows.get(ids.store), await expected("SELECT updated_at FROM store_products WHERE id=$1", ids.store));
    for (const value of rows.values()) assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  test("categories: those with products and their ancestors, legacy categories included", async () => {
    assert.deepEqual((await queries.loadCategorySlugs()).sort(), ["balata-101", "fren", "fren-sistemi-100"]);
  });

  test("makes: only makes with a fitted product", async () => {
    assert.deepEqual(await queries.loadMakeSlugs(), ["alfa-romeo"]);
  });
});
