import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { after, before, describe, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { descriptionLimit, feedDisabledReason, feedDropGuard, feedEnabled, feedFileKey, feedItem, feedManifestKey, feedPublishDecision,
  feedSkipReason, merchantCategoryId, minimumImageSide, parseManifest, renderFeedFooter, renderFeedHeader, renderFeedItem, titleLimit, xmlText,
  type FeedSource } from "../src/modules/seo/merchant-feed";
import { offerAvailability, outOfStockLabel, productOffer, unconfirmedStockLabel, type ProductJsonLdInput } from "../src/modules/seo/structured-data";
import { productPath } from "../src/modules/seo/product-path";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";
import type { FeedStore } from "../src/modules/seo/merchant-feed.server";

// The product feed (#643): the pure item builder and XML, then the chunk loader and a whole run against an isolated copy
// of the schema with an in-memory store. Nothing is written to the shared database's tables or to object storage.

const base = "https://getirbakim.com";
const now = new Date("2026-11-17T10:00:00Z");
const row: FeedSource = {
  id: "0b6f4c2e-1111-4a5b-8c9d-000000000001", supplier: "basbug", source: "supplier", code: "BOS 0986479C20", name: "FREN DISKI ON",
  name_overridden: false, description: "Havalandırmalı ön fren diski", oem: "1K0 615 301", display_brand: "BOSCH", display_code: "BOSCH 0986479C20",
  price_kurus: 124950, available: true, stock_label: "Tedarikçide mevcut", pricing_snapshot: { source: "supplier" },
  image: { src: "/api/product-media/9db4f695-185e-4d35-b8e4-190bfb549e91", width: 800, height: 600 }, gtin: null, productType: ["Fren Sistemi", "Fren Diski"],
};
const item = (changes: Partial<FeedSource>) => feedItem({ ...row, ...changes }, base, now);

describe("feed items", () => {
  test("an in-stock row: price in TRY with two decimals, canonical link, absolute image, identity fields", () => {
    const entry = item({})!;
    assert.equal(entry.id, row.id);
    assert.equal(entry.price, "1249.50 TRY");
    assert.equal(entry.salePrice, undefined);
    assert.equal(entry.availability, "in_stock");
    assert.equal(entry.condition, "new");
    assert.equal(entry.link, `${base}${productPath(row)}`);
    assert.equal(entry.imageLink, `${base}/api/product-media/9db4f695-185e-4d35-b8e4-190bfb549e91`);
    assert.equal(entry.brand, "BOSCH");
    assert.equal(entry.mpn, "0986479C20");
    assert.equal(entry.gtin, undefined);
    assert.equal(entry.identifierExists, undefined);
    assert.equal(entry.googleProductCategory, merchantCategoryId);
    assert.equal(entry.productType, "Fren Sistemi > Fren Diski");
    assert.match(entry.title, /^BOSCH .*0986479C20$/);
    assert.match(entry.description, /^BOSCH 0986479C20 .*OEM: 1K0 615 301\./);
  });

  test("a running campaign: price is the regular price, sale_price the campaign's, with its window", () => {
    const entry = item({ price_kurus: 99900, pricing_snapshot: { source: "override", price_kind: "sale", list_price_kurus: 124950, sale_until: "2026-11-20T21:00:00Z" } })!;
    assert.equal(entry.price, "1249.50 TRY");
    assert.equal(entry.salePrice, "999.00 TRY");
    assert.equal(entry.salePriceEffectiveDate, "2026-11-17T10:00:00Z/2026-11-20T21:00:00Z");
    const open = item({ price_kurus: 99900, pricing_snapshot: { price_kind: "sale", list_price_kurus: 124950 } })!;
    assert.equal(open.salePrice, "999.00 TRY");
    assert.equal(open.salePriceEffectiveDate, undefined);
    // A fixed admin price is no campaign.
    assert.equal(item({ pricing_snapshot: { price_kind: "fixed", fixed_price_kurus: 124950 } })!.salePrice, undefined);
  });

  test("no brand: no brand field, identifier_exists=no without a GTIN; a GTIN is written when known", () => {
    const unbranded = item({ display_brand: "Belirtilmemiş", display_code: "XY 123" })!;
    assert.equal(unbranded.brand, undefined);
    assert.equal(unbranded.identifierExists, "no");
    assert.equal(unbranded.mpn, "XY 123");
    assert.equal(item({ display_code: "   " })!.mpn, undefined);
    assert.equal(item({ display_code: "A".repeat(90) })!.mpn, "A".repeat(70));
    assert.doesNotMatch(unbranded.title, /Belirtilmemiş/);
    const barcoded = item({ display_brand: "Belirtilmemiş", gtin: "4006381333931" })!;
    assert.equal(barcoded.gtin, "4006381333931");
    assert.equal(barcoded.identifierExists, undefined);
  });

  test("rows that stay out, with their reason", () => {
    const cases: [Partial<FeedSource>, string][] = [
      [{ supplier: "demo" }, "demo"],
      [{ price_kurus: null }, "noPrice"],
      [{ price_kurus: 0 }, "noPrice"],
      [{ image: null }, "noImage"],
      [{ image: { src: "/a", width: minimumImageSide - 1, height: 600 } }, "noImage"],
      [{ stock_label: unconfirmedStockLabel }, "notAvailable"],
      [{ available: false, stock_label: outOfStockLabel }, "notAvailable"],
      [{ available: false, stock_label: "Stok bilgisi güncelleniyor" }, "notAvailable"],
      [{ unavailable: true }, "notAvailable"],
    ];
    for (const [changes, reason] of cases) {
      assert.equal(feedSkipReason({ ...row, ...changes }), reason, JSON.stringify(changes));
      assert.equal(item(changes), null, JSON.stringify(changes));
    }
    assert.equal(feedSkipReason({ ...row, image: { src: "/a", width: minimumImageSide, height: minimumImageSide } }), null);
  });

  test("the feed's availability follows the page's Offer rule", () => {
    const labels = ["Tedarikçide mevcut", "Diğer depoda mevcut", unconfirmedStockLabel, outOfStockLabel, "Stok bilgisi güncelleniyor", "Stok bilgisi bulunamadı"];
    for (const available of [true, false]) for (const stockLabel of labels) for (const priceKurus of [null, 0, 100]) for (const unavailable of [false, true]) {
      const input: ProductJsonLdInput = { path: "/urun/x", supplier: "basbug", name: "x", sku: "x", mpn: "x", brand: "x", images: [], priceKurus, available, stockLabel, unavailable };
      const offer = productOffer(input, base, now);
      const availability = offerAvailability(input);
      assert.equal(offer === null, availability === null);
      if (offer) assert.equal(offer.availability, availability === "in_stock" ? "https://schema.org/InStock" : "https://schema.org/OutOfStock");
      const inFeed = feedSkipReason({ ...row, price_kurus: priceKurus, available, stock_label: stockLabel, unavailable }) === null;
      assert.equal(inFeed, availability === "in_stock", `${available} ${stockLabel} ${priceKurus} ${unavailable}`);
    }
  });

  test("XML: escaped text, control characters dropped, title and description within Google's limits", () => {
    assert.equal(xmlText("A & B <C> \"d\" 'e'"), "A &amp; B &lt;C&gt; &quot;d&quot; &apos;e&apos;");
    assert.equal(xmlText("a\u0000b\u0007c\u000Bd\tline\n\uD800e"), "abcd\tline\ne");
    const long = item({ name: `${"UZUN PARCA ADI ".repeat(30)}SON`, description: "Çok uzun açıklama metni. ".repeat(100) })!;
    assert.ok(long.title.length <= titleLimit, `${long.title.length}`);
    assert.ok(long.description.length <= descriptionLimit, `${long.description.length}`);
    const xml = renderFeedHeader(base) + renderFeedItem(item({ name: "FILTRE & CONTA <SET>\u0001" })!) + renderFeedFooter();
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<rss version="2\.0" xmlns:g="http:\/\/base\.google\.com\/ns\/1\.0">\n<channel>\n/);
    assert.match(xml, /<g:title>[^<]*&amp; [^<]*&lt;[^<]*&gt;[^<]*<\/g:title>/);
    assert.doesNotMatch(xml, /\u0001/);
    assert.match(xml, /<g:price>1249\.50 TRY<\/g:price>/);
    assert.match(xml, /<g:google_product_category>899<\/g:google_product_category>/);
    assert.doesNotMatch(xml, /<g:sale_price>|<g:gtin>|<g:shipping>/);
    assert.ok(xml.endsWith("</channel>\n</rss>\n"));
  });

  test("drop guard and publish decision; a snapshot checkout publishes the empty feed on purpose", () => {
    assert.equal(feedDropGuard(0, 0), true);
    assert.equal(feedDropGuard(100, 0), true);
    assert.equal(feedDropGuard(101, 50), false);
    assert.equal(feedDropGuard(1000, 500), true);
    assert.equal(feedDropGuard(1000, 499), false);
    assert.deepEqual(feedPublishDecision({ previousItems: 1000, items: 900, checkoutMode: "live", force: false }), { publish: true });
    const refused = feedPublishDecision({ previousItems: 1000, items: 10, checkoutMode: "live", force: false });
    assert.equal(refused.publish, false);
    assert.deepEqual(feedPublishDecision({ previousItems: 1000, items: 10, checkoutMode: "live", force: true }), { publish: true, note: "drop guard overridden with --force" });
    const snapshot = feedPublishDecision({ previousItems: 1000, items: 0, checkoutMode: "snapshot", force: false });
    assert.equal(snapshot.publish, true);
    assert.match(snapshot.publish ? snapshot.note ?? "" : "", /snapshot/);
  });

  test("file names, staging and the run's preconditions", () => {
    assert.equal(feedFileKey("google.xml.gz"), "feeds/google.xml.gz");
    for (const bad of ["google.xml", "constructor", "__proto__", "../google.xml.gz", "google.json"]) assert.equal(feedFileKey(bad), null, bad);
    assert.equal(feedManifestKey, "feeds/google.json");
    const original = process.env.APP_ENV;
    try {
      process.env.APP_ENV = "staging";
      assert.equal(feedEnabled(), false);
      process.env.APP_ENV = "production";
      assert.equal(feedEnabled(), true);
    } finally {
      if (original === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = original;
    }
    assert.equal(feedDisabledReason({ APP_ENV: "staging", SITE_URL: base, S3_BUCKET: "b" }), "APP_ENV is staging");
    assert.equal(feedDisabledReason({ APP_ENV: "production", S3_BUCKET: "b" }), "SITE_URL is not set");
    assert.equal(feedDisabledReason({ APP_ENV: "production", SITE_URL: base }), "S3_BUCKET is not set");
    assert.equal(feedDisabledReason({ APP_ENV: "production", SITE_URL: base, S3_BUCKET: "b" }), null);
    assert.equal(parseManifest(null), null);
    assert.equal(parseManifest("not json"), null);
    assert.equal(parseManifest('{"items":12}')?.items, 12);
  });
});

describe("feed queries and run", () => {
  let schema: Awaited<ReturnType<typeof isolatedSchema>>;
  let feed: typeof import("../src/modules/seo/merchant-feed.server");
  let catalog: typeof import("../src/modules/store/catalog");
  let closeDb: () => Promise<void>;
  const ids: Record<string, string> = {};
  const [basbug, , dinamik] = storefrontCompanies();
  const env = { SITE_URL: "https://shop.test", S3_BUCKET: "feed-test" };

  type Item = { supplier?: "basbug" | "dinamik"; code: string; brand: string; oe?: string; cost?: number; stock?: number; seenDaysAgo?: number; barcodes?: string[] };
  async function item(key: string, { supplier = "basbug", code, brand, oe, cost = 100, stock = 2, seenDaysAgo = 0, barcodes = [] }: Item) {
    const product = { uk: brand, ac: `${key} PARCA`, ac2: "", dc: "TL", ...(oe ? { oe } : {}),
      ...Object.fromEntries(barcodes.map((code, index) => [`barkod${index + 1}`, code])) };
    const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
      product_count,price_count,stock_count,presence,first_seen_at,last_seen_at,changed_at)
      VALUES($1,$2,'G',$3,$4,$5,$6,$7,1,1,1,'present',now()-interval '40 days',now()-$8*interval '1 day'-interval '1 hour',now()-interval '1 hour') RETURNING id::text`,
    [supplier, supplier === "basbug" ? basbug : dinamik, supplier === "basbug" ? "MRK" : "ALL", code, product, { nf: cost }, { stok: stock }, seenDaysAgo]);
    ids[key] = rows[0].id;
  }
  const products: Record<string, string> = {};
  async function productOf(key: string) {
    products[key] = (await schema.pool.query<{ id: string }>(`INSERT INTO products(brand,part_number,name,brand_label,code) VALUES('FEEDMARKA',$1,$1,'FEEDMARKA',$1) RETURNING id::text`,
      [key.toUpperCase()])).rows[0].id;
    await schema.pool.query("INSERT INTO product_sources(supplier_item_id,product_id) VALUES($1,$2)", [ids[key], products[key]]);
  }
  let media = "";
  async function image(key: string, width = 600, height = 400) {
    if (!products[key]) await productOf(key);
    await schema.pool.query("INSERT INTO product_override_images(product_id,media_id,position,width,height) VALUES($1,$2,0,$3,$4)", [products[key], media, width, height]);
  }
  const allSources = async () => {
    const names = await feed.loadCategoryNames();
    const sources = [];
    let checked = 0;
    for (let index = 0; index < 64; index++) {
      const chunk = await feed.loadFeedChunk(index, names);
      checked += chunk.checked;
      sources.push(...chunk.sources);
    }
    return { sources, checked, byId: new Map(sources.map(source => [source.id, source])) };
  };
  const memoryStore = () => {
    const objects = new Map<string, Buffer>();
    const store: FeedStore = {
      async read(key) { return objects.get(key)?.toString("utf8") ?? null; },
      async write(key, body) { objects.set(key, "text" in body ? Buffer.from(body.text) : await readFile(body.path)); },
    };
    return { objects, store };
  };

  before(async () => {
    schema = await isolatedSchema("merchant_feed_test");
    media = (await schema.pool.query<{ id: string }>(`INSERT INTO product_media_objects(bucket,object_key,sha256,content_type,size_bytes,source_url)
      VALUES('product-media','products/fe/feed.webp',$1,'image/webp',1000,'https://example.test/f.webp') RETURNING id::text`, ["f".repeat(64)])).rows[0].id;
    await schema.pool.query(`INSERT INTO source_categories(source,category_id,parent_id,name,slug,path_ids,source_url,raw) VALUES
      ('trodo',100,NULL,'Fren Sistemi','fren-sistemi','{100}','','{}'),('trodo',101,100,'Balata','balata','{100,101}','','{}')`);
    await schema.pool.query(`INSERT INTO source_category_labels(source,category_id,locale,name,slug) VALUES
      ('trodo',100,'tr','Fren Sistemi','fren-sistemi-100'),('trodo',101,'tr','Balata','balata-101')`);
    // In: image, stock and an OEM (minimum content); an admin barcode and category.
    await item("full", { code: "BOS 0986A11", brand: "BOSCH", oe: "0986A11" });
    await image("full");
    await schema.pool.query("INSERT INTO product_override_references(product_id,kind,action,brand,number) VALUES($1,'ean','add','','4006381333931')", [products.full]);
    await schema.pool.query("INSERT INTO product_overrides(product_id,category_id) VALUES($1,101)", [products.full]);
    // Dinamik barcodes: one valid GTIN (with an invalid code next to it), and two different valid ones (none written).
    await item("barcode", { supplier: "dinamik", code: "SACHS 1000", brand: "SACHS", oe: "1K0 129 620", barcodes: ["5901234123457", "ABC1234"] });
    await image("barcode");
    await item("twoBarcodes", { supplier: "dinamik", code: "SACHS 2000", brand: "SACHS", oe: "1K0 129 621", barcodes: ["5901234123457", "4006381333931"] });
    await image("twoBarcodes");
    // Out: no image, an image under 100 px, no stock, a stale price (no price in live checkout), hidden, no minimum content.
    await item("noImage", { code: "MAH 1", brand: "MAHLE", oe: "111" });
    await item("smallImage", { code: "MAH 2", brand: "MAHLE", oe: "222" });
    await image("smallImage", 80, 80);
    await item("outOfStock", { code: "MAH 3", brand: "MAHLE", oe: "333", stock: 0 });
    await image("outOfStock");
    await item("stale", { code: "MAH 4", brand: "MAHLE", oe: "444", seenDaysAgo: 30 });
    await image("stale");
    await item("hidden", { code: "NGK 5", brand: "NGK", oe: "555" });
    await image("hidden");
    await schema.pool.query("INSERT INTO commerce_item_overrides(supplier_item_id,product_id,hidden) VALUES($1,$1,true)", [ids.hidden]);
    await item("bare", { code: "SOY 6", brand: "SOYLU" });
    // A group of two offers: the primary is listed and sold at the cheaper secondary's price; the secondary has no page.
    await item("groupPrimary", { code: "FEB 7", brand: "FEBI", oe: "777", cost: 100 });
    await item("groupSecondary", { supplier: "dinamik", code: "FEBI 7", brand: "FEBI", cost: 60 });
    await image("groupPrimary");
    await schema.pool.query("INSERT INTO product_offers(item_id,primary_id) VALUES($1,$1),($2,$1)", [ids.groupPrimary, ids.groupSecondary]);
    const [{ db }, feedModule, catalogModule] = await Promise.all([import("../src/lib/db"), import("../src/modules/seo/merchant-feed.server"),
      import("../src/modules/store/catalog")]);
    feed = feedModule;
    catalog = catalogModule;
    closeDb = () => db.end();
  });
  after(async () => { await closeDb?.(); await schema?.drop(); });

  test("the chunks hold the indexable rows only, once each", async () => {
    const { sources, checked } = await allSources();
    assert.equal(checked, sources.length);
    assert.deepEqual(sources.map(source => source.id).sort(), ["full", "barcode", "twoBarcodes", "noImage", "smallImage", "outOfStock", "stale", "groupPrimary"]
      .map(key => ids[key]).sort());
  });

  test("feed items: exactly the in-stock rows with an image, with barcode and category", async () => {
    const { sources, byId } = await allSources();
    const entered = sources.filter(source => feedSkipReason(source) === null).map(source => source.id).sort();
    assert.deepEqual(entered, [ids.full, ids.barcode, ids.twoBarcodes, ids.groupPrimary].sort());
    assert.equal(feedSkipReason(byId.get(ids.noImage)!), "noImage");
    assert.equal(feedSkipReason(byId.get(ids.smallImage)!), "noImage");
    assert.equal(feedSkipReason(byId.get(ids.outOfStock)!), "notAvailable");
    assert.equal(feedSkipReason(byId.get(ids.stale)!), "noPrice");
    assert.equal(byId.get(ids.full)!.gtin, "4006381333931");
    assert.deepEqual(byId.get(ids.full)!.productType, ["Fren Sistemi", "Balata"]);
    assert.equal(byId.get(ids.barcode)!.gtin, "5901234123457");
    assert.equal(byId.get(ids.twoBarcodes)!.gtin, null);
    assert.equal(byId.get(ids.full)!.image?.src, `/api/product-media/${media}`);
  });

  test("prices are the store's own anonymous price: the best grouped offer, never an account's discount", async () => {
    const { byId } = await allSources();
    for (const key of ["full", "barcode", "groupPrimary"]) {
      const [shown] = await catalog.withBestOffers([(await catalog.getProduct(ids[key]))!]);
      assert.equal(byId.get(ids[key])!.price_kurus, shown.price_kurus, key);
      assert.equal(feedItem(byId.get(ids[key])!, base, now)!.price, `${(shown.price_kurus! / 100).toFixed(2)} TRY`, key);
    }
    const secondary = await catalog.getProduct(ids.groupSecondary);
    assert.equal(byId.get(ids.groupPrimary)!.price_kurus, secondary!.price_kurus);
    assert.ok(secondary!.price_kurus! < (await catalog.getProduct(ids.groupPrimary))!.price_kurus!);
  });

  test("a run writes the gzipped feed and its manifest; the drop guard keeps the old file", async () => {
    const { objects, store } = memoryStore();
    const run = await feed.runMerchantFeed({ env, store, now });
    assert.equal(run.status, "completed", run.error ?? run.reason);
    assert.equal(run.items, 4);
    assert.deepEqual(run.skipped, { demo: 0, noPrice: 1, notAvailable: 1, noImage: 2 });
    assert.equal(run.checkoutMode, "live");
    const xml = gunzipSync(objects.get("feeds/google.xml.gz")!).toString("utf8");
    assert.equal(xml.match(/<item>/g)?.length, 4);
    assert.match(xml, new RegExp(`<g:link>https://shop\\.test/urun/[a-z0-9-]+-${ids.full}</g:link>`));
    assert.match(xml, /<g:gtin>4006381333931<\/g:gtin>/);
    assert.match(xml, /<g:product_type>Fren Sistemi &gt; Balata<\/g:product_type>/);
    const manifest = parseManifest(objects.get(feedManifestKey)!.toString("utf8"))!;
    assert.equal(manifest.items, 4);
    assert.equal(manifest.bytes, objects.get("feeds/google.xml.gz")!.length);

    // A previous feed of 500 items: four is a drop of more than half.
    const previous = JSON.stringify({ ...manifest, items: 500 });
    objects.set(feedManifestKey, Buffer.from(previous));
    objects.set("feeds/google.xml.gz", Buffer.from("old"));
    const guarded = await feed.runMerchantFeed({ env, store, now });
    assert.equal(guarded.status, "failed");
    assert.match(guarded.reason ?? "", /--force/);
    assert.equal(objects.get("feeds/google.xml.gz")!.toString(), "old");
    assert.equal(objects.get(feedManifestKey)!.toString(), previous);
    const forced = await feed.runMerchantFeed({ env, store, now, force: true });
    assert.equal(forced.status, "completed");
    assert.equal(forced.note, "drop guard overridden with --force");
    assert.equal(parseManifest(objects.get(feedManifestKey)!.toString("utf8"))!.items, 4);
  });

  test("snapshot checkout: the empty feed is published past the drop guard, the manifest says why", async () => {
    const { objects, store } = memoryStore();
    objects.set(feedManifestKey, Buffer.from(JSON.stringify({ items: 500 })));
    await schema.pool.query("UPDATE commerce_settings SET basbug_checkout_mode='snapshot'");
    try {
      const run = await feed.runMerchantFeed({ env, store, now });
      assert.equal(run.status, "completed", run.error ?? run.reason);
      assert.equal(run.checkoutMode, "snapshot");
      assert.equal(run.items, 0);
      assert.ok(run.skipped.notAvailable >= 4);
      const xml = gunzipSync(objects.get("feeds/google.xml.gz")!).toString("utf8");
      assert.equal(xml.includes("<item>"), false);
      assert.ok(xml.endsWith("</channel>\n</rss>\n"));
      const manifest = parseManifest(objects.get(feedManifestKey)!.toString("utf8"))!;
      assert.equal(manifest.items, 0);
      assert.equal(manifest.checkoutMode, "snapshot");
      assert.match(manifest.note ?? "", /snapshot/);
    } finally {
      await schema.pool.query("UPDATE commerce_settings SET basbug_checkout_mode='live'");
    }
  });

  test("a dry run counts without touching the store; a run without SITE_URL is disabled", async () => {
    const store: FeedStore = { read: () => assert.fail("read"), write: () => assert.fail("write") };
    const dry = await feed.runMerchantFeed({ dryRun: true, env: {}, store, now });
    assert.equal(dry.status, "completed");
    assert.equal(dry.items, 4);
    assert.ok(dry.bytes > 0);
    const disabled = await feed.runMerchantFeed({ env: { S3_BUCKET: "b" }, store, now });
    assert.equal(disabled.status, "disabled");
    assert.equal(disabled.reason, "SITE_URL is not set");
  });
});
