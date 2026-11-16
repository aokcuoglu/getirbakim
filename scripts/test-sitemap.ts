import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { contentSignals, hasAdminContent, hasMinimumContent, minimumContentSql, productContent, productIndexable, productIndexPolicy, type ProductContent }
  from "../src/modules/seo/indexing";
import { absoluteUrl, categoryPath, makePath } from "../src/modules/seo/paths";
import { productPath } from "../src/modules/seo/product-path";
import { shownProductName } from "../src/modules/store/product-name";
import { parseSitemapFile, productChunkRange, productChunks, renderSitemapIndex, renderUrlset, sitemapEnabled, sitemapFiles,
  sitemapUrlLimit, staticPaths, withAncestors } from "../src/modules/seo/sitemap";
import { siteUrl } from "../src/lib/site";
import { legalLinks } from "../src/content/legal";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";

// The chunked sitemap (#634): pure helpers, then the queries against an isolated copy of the schema. Nothing is written
// to the shared database's tables.

describe("sitemap helpers", () => {
  test("productIndexable: demo and unavailable cards are noindex, store rows are indexed, supplier rows need minimum content", () => {
    const bare: ProductContent = { enrichment: false, descriptionFitment: false, supplierOem: false, adminContent: false };
    const full: ProductContent = { enrichment: true, descriptionFitment: true, supplierOem: true, adminContent: true };
    assert.equal(productIndexable({ supplier: "demo", source: "store" }, full), false);
    assert.equal(productIndexable({ supplier: "basbug", source: "store" }, bare), true);
    assert.equal(productIndexable({ supplier: "basbug", source: "supplier", unavailable: true }, full), false);
    assert.equal(productIndexable({ supplier: "basbug", source: "supplier" }, bare), false);
    assert.equal(productIndexable({ supplier: "dinamik", source: "supplier", unavailable: false }, full), true);
    for (const signal of ["enrichment", "descriptionFitment", "supplierOem", "adminContent"] as const) {
      assert.equal(productIndexable({ supplier: "basbug", source: "supplier" }, { ...bare, [signal]: true }), true, signal);
    }
    assert.deepEqual(productIndexPolicy.minimumContent, ["enrichment", "descriptionFitment", "supplierOem", "adminContent"]);
    assert.equal(productIndexPolicy.supplierCatalog, true);
    assert.equal(productIndexPolicy.unavailable, false);
  });

  test("productContent reads the page's loaders; the SQL condition holds every minimum-content signal", () => {
    assert.deepEqual(productContent({ enrichment: null, descriptionModels: [], oem: "", adminContent: false }),
      { enrichment: false, descriptionFitment: false, supplierOem: false, adminContent: false });
    assert.deepEqual(productContent({ enrichment: {}, descriptionModels: [{}], oem: "1K0 129 620", adminContent: true }),
      { enrichment: true, descriptionFitment: true, supplierOem: true, adminContent: true });
    assert.equal(hasMinimumContent({ enrichment: false, descriptionFitment: false, supplierOem: true, adminContent: false }), true);
    assert.equal(hasMinimumContent({ enrichment: false, descriptionFitment: false, supplierOem: false, adminContent: true }), true);
    assert.equal(hasMinimumContent({ enrichment: false, descriptionFitment: false, supplierOem: false, adminContent: false }), false);
    const sql = minimumContentSql();
    for (const signal of productIndexPolicy.minimumContent) assert.ok(sql.includes(contentSignals[signal].sql), signal);
  });

  test("hasAdminContent counts what an admin wrote or added, not SEO text or hide decisions (#664)", () => {
    const none = { override: null, images: [], specs: [], references: [], addedVehicles: [] };
    const override = { name: null, description: null, short_description: null };
    assert.equal(hasAdminContent(none), false);
    assert.equal(hasAdminContent({ ...none, override }), false);
    assert.equal(hasAdminContent({ ...none, override: { ...override, name: "   " } }), false);
    assert.equal(hasAdminContent({ ...none, override: { ...override, name: "\n" } }), false);
    assert.equal(hasAdminContent({ ...none, specs: [{ action: "hide" }], references: [{ action: "hide" }] }), false);
    assert.equal(hasAdminContent({ ...none, override: { ...override, name: "Ad" } }), true);
    assert.equal(hasAdminContent({ ...none, override: { ...override, description: "Açıklama" } }), true);
    assert.equal(hasAdminContent({ ...none, override: { ...override, short_description: "Kısa" } }), true);
    assert.equal(hasAdminContent({ ...none, images: [{}] }), true);
    assert.equal(hasAdminContent({ ...none, specs: [{ action: "hide" }, { action: "set" }] }), true);
    assert.equal(hasAdminContent({ ...none, references: [{ action: "add" }] }), true);
    assert.equal(hasAdminContent({ ...none, addedVehicles: [{}] }), true);
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
    assert.equal(files.length, 6 + productChunks);
    assert.deepEqual(files.slice(0, 7), ["pages.xml", "categories.xml", "makes.xml", "manufacturers.xml", "models.xml", "model-categories.xml", "products-00.xml"]);
    assert.equal(files.at(-1), "products-63.xml");
    assert.deepEqual(parseSitemapFile("products-07.xml"), { kind: "products", index: 7 });
    assert.deepEqual(parseSitemapFile("manufacturers.xml"), { kind: "manufacturers" });
    assert.deepEqual(parseSitemapFile("models.xml"), { kind: "models" });
    assert.deepEqual(parseSitemapFile("model-categories.xml"), { kind: "modelCategories" });
    assert.deepEqual(files.map(file => parseSitemapFile(file)).filter(Boolean).length, files.length);
    for (const bad of ["products-64.xml", "products-7.xml", "x.xml", "pages", "products-00.xml.gz", "model_categories.xml", "models"]) assert.equal(parseSitemapFile(bad), null, bad);
  });

  test("XML is escaped and a file stops at the URL limit", () => {
    const xml = renderUrlset([{ url: "https://a.test/katalog?brand=a&b", lastModified: "2026-11-15T00:00:00Z" }, { url: "https://a.test/<x>" }]);
    assert.match(xml, /<loc>https:\/\/a\.test\/katalog\?brand=a&amp;b<\/loc><lastmod>2026-11-15T00:00:00Z<\/lastmod>/);
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
    assert.equal(productPath({ id: "abc", name: "Fren", name_overridden: false, display_brand: "BOSCH", display_code: "1" }), "/urun/bosch-fren-1-abc");
    assert.equal(categoryPath("fren-252"), "/kategori/fren-252");
    assert.equal(makePath("alfa-romeo"), "/yedek-parca/alfa-romeo");
    assert.equal(absoluteUrl(siteUrl, "/katalog"), `${siteUrl}/katalog`);
    assert.equal(staticPaths[0].path, "");
    assert.equal(staticPaths.length, 8 + legalLinks.length);
    for (const link of legalLinks) assert.match(staticPaths.find(page => page.path === `/${link.slug}`)?.lastModified ?? "", /^\d{4}-\d{2}-\d{2}/);
  });
});

describe("sitemap queries", () => {
  let schema: Awaited<ReturnType<typeof isolatedSchema>>;
  let queries: typeof import("../src/modules/seo/sitemap.server");
  let catalog: typeof import("../src/modules/store/catalog");
  let enrichments: typeof import("../src/modules/store/product-enrichment");
  let fitments: typeof import("../src/modules/store/description-fitment.server");
  let pageAdminContent: (itemId: string) => Promise<boolean>;
  let closeDb: () => Promise<void>;
  const ids: Record<string, string> = {};
  const [basbug, , dinamik] = storefrontCompanies();

  type Item = { supplier?: "basbug" | "dinamik"; code: string; brand: string; warehouse?: string; presence?: "present" | "inactive";
    conflicting?: boolean; category?: string; oe?: string };
  async function item(key: string, { supplier = "basbug", code, brand, warehouse, presence = "present", conflicting = false, category, oe }: Item) {
    const product = { uk: brand, ac: `${key} PARCA`, ac2: "", dc: "TL", ...(category ? { category } : {}), ...(oe ? { oe } : {}),
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
    // Minimum content (#641): an enrichment, a supplier OEM, or vehicle models read from the description.
    await item("listed", { code: "MAH 20020", brand: "MAHLE" });
    await item("dinamik", { supplier: "dinamik", code: "SACHS 1000", brand: "SACHS", category: "fren", oe: "1K0 129 620" });
    // Not sold from this warehouse: its legacy category "filtre" holds no listed product.
    await item("depot", { code: "MAH 30030", brand: "MAHLE", warehouse: "IST", category: "filtre" });
    await item("conflicting", { code: "SAC 2222", brand: "SACHS", conflicting: true });
    await item("inactive", { code: "LMI 4444", brand: "LEMFORDER", presence: "inactive" });
    await item("primary", { code: "BOS 0986A11", brand: "BOSCH", oe: "0986A11" });
    await item("secondary", { supplier: "dinamik", code: "BOSCH 0986A11", brand: "BOSCH" });
    await item("hidden", { code: "NGK 5555", brand: "NGK", oe: "5555" });
    await item("bare", { code: "SOY 1930", brand: "SOYLU" });
    await item("fitOnly", { supplier: "dinamik", code: "ORJINAL 1520900Q0H", brand: "ORIJINAL" });
    // The description fitment sits on the grouped secondary offer: its primary shows it (getDescriptionFitments).
    await item("offerPrimary", { code: "FEB 175566", brand: "FEBI" });
    await item("offerSecondary", { supplier: "dinamik", code: "FEBI 175566", brand: "FEBI" });
    await item("oemHidden", { code: "LMI 6666", brand: "LEMFORDER", oe: "6Q0 407 151" });
    // Its enrichment link names another brand than the row: the page shows no enrichment.
    await item("staleLink", { code: "MAH 7777", brand: "MAHLE" });
    await storeProduct("store", "basbug", "STORE 1");
    await storeProduct("demo", "demo", "DEMO 1");
    await schema.pool.query("INSERT INTO product_offers(item_id,primary_id) VALUES($1,$1),($2,$1),($3,$3),($4,$3)",
      [ids.primary, ids.secondary, ids.offerPrimary, ids.offerSecondary]);
    await schema.pool.query("INSERT INTO commerce_item_overrides(supplier_item_id,product_id,hidden) VALUES($1,$1,true)", [ids.hidden]);
    // An admin's name, brand and part number (#602, #575) move the address with the page's shown values.
    await schema.pool.query("INSERT INTO commerce_item_overrides(supplier_item_id,product_id,name,brand,part_number) VALUES($1,$1,'YAG FILTRESI GENEL','ÖZEL MARKA','ÖZ 1')", [ids.listed]);
    await schema.pool.query("INSERT INTO commerce_item_overrides(supplier_item_id,product_id,hide_oem) VALUES($1,$1,true)", [ids.oemHidden]);
    // Category tree: 100 > 101 (enriched product) and 100 > 102 (empty); 200 empty root; 252 = legacy "fren", 241 = legacy "filtre".
    await schema.pool.query(`INSERT INTO source_categories(source,category_id,parent_id,name,slug,path_ids,source_url,raw) VALUES
      ('trodo',100,NULL,'Fren Sistemi','fren-sistemi','{100}','','{}'),('trodo',101,100,'Balata','balata','{100,101}','','{}'),
      ('trodo',102,100,'Disk','disk','{100,102}','','{}'),('trodo',200,NULL,'Aydınlatma','aydinlatma','{200}','','{}'),
      ('trodo',252,NULL,'Fren','fren','{252}','','{}'),('trodo',241,NULL,'Filtre','filtre','{241}','','{}')`);
    await schema.pool.query(`INSERT INTO source_category_labels(source,category_id,locale,name,slug) VALUES
      ('trodo',100,'tr','Fren Sistemi','fren-sistemi-100'),('trodo',101,'tr','Balata','balata-101'),('trodo',102,'tr','Disk','disk-102'),
      ('trodo',200,'tr','Aydınlatma','aydinlatma-200'),('trodo',252,'tr','Fren','fren'),('trodo',241,'tr','Filtre','filtre')`);
    await schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,payload)
      VALUES($1,'MAH 20020','MAHLE','https://example.test/p','test','MAHLE','MAH 20020','{"specifications":[],"oemNumbers":{},"crossReferences":{},"vehicles":[]}')`, [ids.listed]);
    // The enrichment was imported after the row last changed: the sitemap's lastmod follows the newer time.
    await schema.pool.query(`INSERT INTO product_enrichment_shared_links(supplier_item_id,supplier_code,supplier_brand,donor_item_id,donor_oem,status,imported_at)
      VALUES($1,'MAH 20020','MAHLE',$1,'','complete',now()),($2,'MAH 7777','MAHLE FILTRE',$1,'','complete',now())`, [ids.listed, ids.staleLink]);
    await schema.pool.query("INSERT INTO product_source_categories(supplier_item_id,source,category_id) VALUES($1,'trodo',101)", [ids.listed]);
    await schema.pool.query("INSERT INTO vehicle_brands(id,name,display_name) VALUES(1,'VW','VOLKSWAGEN'),(2,'ALFA','ALFA ROMEO')");
    await schema.pool.query("INSERT INTO vehicle_models(id,brand_id,name) VALUES(10,1,'GOLF IV')");
    await schema.pool.query(`INSERT INTO product_model_fitments(supplier_item_id,model_id,source_text) VALUES($1,10,'GOLF IV'),($2,10,'GOLF IV')`,
      [ids.fitOnly, ids.offerSecondary]);
    await schema.pool.query("INSERT INTO storefront_make_fits(brand_id,supplier_item_id) VALUES(2,$1)", [ids.listed]);
    const [{ db }, queriesModule, catalogModule, enrichmentModule, fitmentModule] = await Promise.all([import("../src/lib/db"),
      import("../src/modules/seo/sitemap.server"), import("../src/modules/store/catalog"), import("../src/modules/store/product-enrichment"),
      import("../src/modules/store/description-fitment.server")]);
    queries = queriesModule;
    catalog = catalogModule;
    enrichments = enrichmentModule;
    fitments = fitmentModule;
    const [overrideModule, imageModule, referenceModule, specModule, fitmentOverrideModule] = await Promise.all([import("../src/modules/store/product-overrides"),
      import("../src/modules/store/product-images"), import("../src/modules/store/product-references"), import("../src/modules/store/product-specs"),
      import("../src/modules/store/product-fitments")]);
    // The page's loaders of the admin's edits, as the metadata reads them.
    pageAdminContent = async itemId => {
      const [override, uploads, references, specs, fitmentOverrides] = await Promise.all([overrideModule.getItemOverride(itemId), imageModule.getItemImages(itemId),
        referenceModule.getItemReferences(itemId), specModule.getItemSpecs(itemId), fitmentOverrideModule.getItemFitments(itemId)]);
      return hasAdminContent({ override, images: uploads.images, specs, references, addedVehicles: fitmentOverrides.added });
    };
    closeDb = () => db.end();
    // Admin content (#664): signal-less rows whose product carries an admin edit. Sources first, so the follow-sources
    // trigger has no edit to project while they are linked.
    const adminKeys = ["adminName", "adminDescription", "adminShort", "adminImage", "adminSpec", "adminRef", "adminVehicle", "adminSeoOnly", "adminHideOnly", "adminBlankName", "adminSecondary", "adminSecondaryRow"];
    for (const [index, key] of adminKeys.entries()) await item(key, { code: `ADM ${9000 + index}`, brand: "ADMINMARKA" });
    const product: Record<string, string> = {};
    for (const key of adminKeys.filter(key => key !== "adminSecondaryRow")) {
      product[key] = (await schema.pool.query<{ id: string }>(`INSERT INTO products(brand,part_number,name,brand_label,code) VALUES('ADMINMARKA',$1,$2,'ADMINMARKA',$3) RETURNING id::text`,
        [key.toUpperCase(), `ADM ${key}`, key])).rows[0].id;
      await schema.pool.query("INSERT INTO product_sources(supplier_item_id,product_id) VALUES($1,$2)", [ids[key], product[key]]);
    }
    const override = (key: string, columns: string, values: string) => schema.pool.query(`INSERT INTO product_overrides(product_id,${columns}) VALUES($1,${values})`, [product[key]]);
    // A grouped secondary row shares its primary's product: only the primary is listed, once.
    await schema.pool.query("INSERT INTO product_sources(supplier_item_id,product_id) VALUES($1,$2)", [ids.adminSecondaryRow, product.adminSecondary]);
    await schema.pool.query("INSERT INTO product_offers(item_id,primary_id) VALUES($1,$1),($2,$1)", [ids.adminSecondary, ids.adminSecondaryRow]);
    await override("adminSecondary", "short_description", "'Kısa'");
    // Only a line break: neither the SQL nor the page counts it.
    await override("adminBlankName", "name", "E'\\n'");
    await override("adminName", "name", "'Yönetici adı'");
    await override("adminDescription", "description", "'Yönetici açıklaması'");
    await override("adminShort", "short_description", "'Kısa açıklama'");
    // 101 is a category with a listed product already; 102 and 200 would count as a direct category of their own.
    await override("adminSeoOnly", "seo_title,seo_description,category_id", "'SEO başlığı','SEO açıklaması',101");
    const media = (await schema.pool.query<{ id: string }>(`INSERT INTO product_media_objects(bucket,object_key,sha256,content_type,size_bytes,source_url)
      VALUES('product-media','products/ad/admin.webp',$1,'image/webp',1000,'https://example.test/a.webp') RETURNING id::text`, ["a".repeat(64)])).rows[0].id;
    await schema.pool.query("INSERT INTO product_override_images(product_id,media_id,position,width,height) VALUES($1,$2,0,600,400)", [product.adminImage, media]);
    await schema.pool.query(`INSERT INTO product_override_specs(product_id,action,key,value) VALUES($1,'set','Genişlik','10 mm'),($2,'hide','Boy',NULL)`, [product.adminSpec, product.adminHideOnly]);
    await schema.pool.query(`INSERT INTO product_override_references(product_id,kind,action,brand,number) VALUES($1,'oem','add','VW','1K0 129 620'),($2,'oem','hide','VW','1K0 129 621')`,
      [product.adminRef, product.adminHideOnly]);
    await schema.pool.query(`INSERT INTO vehicle_types(id,model_id,name,cc,fuel_type,fuel_name,hp,kwt,year_of_constr_from,search_text)
      VALUES(900,10,'1.6',1600,'Petrol','Benzin',100,74,'2000-01-01','golf')`);
    await schema.pool.query("INSERT INTO product_override_fitments(product_id,vehicle_type_id,mode) VALUES($1,900,'add')", [product.adminVehicle]);
    await schema.pool.query("INSERT INTO vehicle_types(id,model_id,name,cc,fuel_type,fuel_name,hp,kwt,year_of_constr_from,search_text) VALUES(901,10,'1.8',1800,'Petrol','Benzin',120,88,'2000-01-01','golf')");
    await schema.pool.query("INSERT INTO product_override_fitments(product_id,vehicle_type_id,mode) VALUES($1,901,'remove')", [product.adminHideOnly]);
    await schema.pool.query("INSERT INTO product_override_image_settings(product_id,hide_automatic) VALUES($1,true)", [product.adminHideOnly]);
    // #674: a make with a series but no fitted product of either source.
    await schema.pool.query("INSERT INTO vehicle_brands(id,name,display_name) VALUES(3,'OPEL','OPEL'); INSERT INTO vehicle_models(id,brand_id,name) VALUES(30,3,'ASTRA J')");
  });
  after(async () => { await closeDb?.(); await schema?.drop(); });

  test("the product files list each listed product exactly once", async () => {
    const listed = (await allChunks()).map(row => row.id);
    assert.equal(new Set(listed).size, listed.length);
    assert.deepEqual(listed.sort(), [ids.listed, ids.dinamik, ids.primary, ids.store, ids.fitOnly, ids.offerPrimary,
      ids.adminName, ids.adminDescription, ids.adminShort, ids.adminImage, ids.adminSpec, ids.adminRef, ids.adminVehicle, ids.adminSecondary].sort());
  });

  test("a listed product's address is the page's canonical one, overrides and store rows included", async () => {
    const rows = await allChunks();
    assert.equal(rows.length, 14);
    for (const row of rows) {
      const product = await catalog.getStorefrontProduct(row.id);
      assert.ok(product, row.id);
      assert.equal(row.path, productPath(product), row.id);
    }
    assert.equal(rows.find(row => row.id === ids.listed)?.path, `/urun/ozel-marka-yag-filtresi-genel-oz-1-${ids.listed}`);
    // An all-caps admin name is shown as written, so the sitemap, the card and the page agree; supplier rows keep the readable name.
    const listed = await catalog.getStorefrontProduct(ids.listed);
    assert.equal(listed?.name_overridden, true);
    assert.equal(shownProductName(listed!), "YAG FILTRESI GENEL");
    assert.equal((await catalog.getStorefrontProduct(ids.dinamik))?.name_overridden, false);
    assert.equal(rows.find(row => row.id === ids.store)?.path, `/urun/bosch-magaza-parca-store-1-${ids.store}`);
  });

  test("a product is in the sitemap exactly when its page is indexable", async () => {
    const listed = new Set((await allChunks()).map(row => row.id));
    for (const [key, id] of Object.entries(ids)) {
      const { product } = await catalog.getStoreProduct(id);
      // The page's loaders: its enrichment, the description's models, the OEM it shows and the admin's edits.
      const indexable = product ? productIndexable(product, productContent({
        enrichment: await enrichments.getProductEnrichment({ id: product.id, code: product.code, brand: product.brand }),
        descriptionModels: await fitments.getDescriptionFitments(product.id), oem: product.oem, adminContent: await pageAdminContent(product.id) })) : false;
      assert.equal(indexable, listed.has(id), `${key}: page indexable ⇔ in the sitemap`);
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
    // Description fitments (#767): the row's own, and those of a grouped offer, both through derived_at.
    assert.equal(rows.get(ids.fitOnly), await expected("SELECT derived_at FROM product_model_fitments WHERE supplier_item_id=$1", ids.fitOnly));
    assert.equal(rows.get(ids.offerPrimary), await expected("SELECT derived_at FROM product_model_fitments WHERE supplier_item_id=$1", ids.offerSecondary));
  });

  test("an admin edit, a price edit included, advances lastmod (#767)", async () => {
    const productOf = async (key: string) => (await schema.pool.query<{ product_id: string }>("SELECT product_id::text FROM product_sources WHERE supplier_item_id=$1", [ids[key]])).rows[0].product_id;
    const lastmod = async (key: string) => (await allChunks()).find(row => row.id === ids[key])?.lastmod;
    const at = async (offset: string) => (await schema.pool.query<{ at: string }>(
      `SELECT to_char((now()+interval '${offset}') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at`)).rows[0].at;
    const before = await lastmod("adminImage");
    await schema.pool.query("INSERT INTO product_override_changes(product_id,field,new_value,changed_at) VALUES($1,'image_removed','x',now()+interval '1 hour')", [await productOf("adminImage")]);
    assert.equal(await lastmod("adminImage"), await at("1 hour"));
    assert.notEqual(before, await lastmod("adminImage"));
    await schema.pool.query("INSERT INTO product_override_changes(product_id,field,new_value,changed_at) VALUES($1,'price_kurus','500',now()+interval '2 hours')", [await productOf("adminRef")]);
    assert.equal(await lastmod("adminRef"), await at("2 hours"));
  });

  test("categories: those with listed products and their ancestors, legacy categories included", async () => {
    assert.deepEqual((await queries.loadCategorySlugs()).sort(), ["balata-101", "fren", "fren-sistemi-100"]);
  });

  test("makes: only makes with a fitted product, engine-level or read from a description (#674)", async () => {
    // VOLKSWAGEN has description fits only (product_model_fitments), ALFA ROMEO engine-level ones only, OPEL none.
    assert.deepEqual(await queries.loadMakeSlugs(), ["volkswagen", "alfa-romeo"]);
  });
});
