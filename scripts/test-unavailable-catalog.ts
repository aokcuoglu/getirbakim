import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";
import { after, before, describe, test } from "node:test";
import pg from "pg";
import { isolatedSchema } from "./isolated-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";
import type { CatalogProduct } from "../src/modules/store/catalog";
import type { CatalogQuery } from "../src/modules/store/catalog-query";

// Products no supplier sells now (#475) in an isolated copy of the schema: db/storefront-catalog.sql and the store
// catalog reading it. Nothing is written to the shared database's tables.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let catalog: typeof import("../src/modules/store/catalog");
let closeDb: () => Promise<void>;
const ids: Record<string, string> = {};
const [basbug, , dinamik] = storefrontCompanies();
// A category listing reads the category tree, which calls connection() and needs a request scope: a static work store
// lets it run. Next reads the global AsyncLocalStorage when its storage module loads (before, ahead of the catalog import).
let workStorage: typeof import("next/dist/server/app-render/work-async-storage.external").workAsyncStorage;
const inRequest = <T>(run: () => Promise<T>) => workStorage.run({ route: "/test", forceStatic: true } as Parameters<typeof workStorage.run>[0], run);

type Item = { supplier: "basbug" | "dinamik"; code: string; brand: string; presence?: "present" | "pending_missing" | "inactive";
  group?: string; stock?: number | null; cost?: number; conflicting?: boolean; seenHoursAgo?: number };
async function item(key: string, { supplier, code, brand, presence = "present", group = "G", stock = 1, cost = 100, conflicting = false, seenHoursAgo = 1 }: Item) {
  const product = { uk: brand, ac: `${key} PARCA`, dc: "TL", ...(supplier === "dinamik" ? { marka: brand, stokAdi: `${key} PARCA` } : {}) };
  const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,1,1,$9,$10,now()-interval '10 days',now()-make_interval(hours=>$11),now()-make_interval(hours=>$11)) RETURNING id::text`,
  [supplier, supplier === "basbug" ? basbug : dinamik, group, supplier === "basbug" ? "MRK" : "ALL", code, product, { nf: cost },
    stock === null ? null : { stok: stock }, conflicting, presence, seenHoursAgo]);
  ids[key] = rows[0].id;
}

before(async () => {
  schema = await isolatedSchema("unavailable_test");
  // FALKON: Dinamik moved the brand's codes to a new scope; the old scope's rows are inactive.
  await item("falkonOld", { supplier: "dinamik", code: "FALKON 7001", brand: "FALKON", group: "FALKON", presence: "inactive", stock: 0 });
  await item("falkonNew", { supplier: "dinamik", code: "FALKON 7001", brand: "FALKON", group: "FALKON - AUTOKIT", stock: 3 });
  // A Başbuğ row dropped before it was ever linked; Dinamik sells the same product.
  await item("boschBasbug", { supplier: "basbug", code: "BOS 0986A11", brand: "BOSCH", presence: "inactive", stock: 0 });
  await item("boschDinamik", { supplier: "dinamik", code: "BOSCH 0986A11", brand: "BOSCH", stock: 2, cost: 50 });
  // A product whose rows are all dropped.
  await item("mannBasbug", { supplier: "basbug", code: "MAN W71295", brand: "MANN", presence: "inactive", stock: 0 });
  await item("mannDinamik", { supplier: "dinamik", code: "MANN W712/95", brand: "MANN", presence: "inactive", stock: 0 });
  // Not usable sources: a Dinamik price-list-only code and a conflicting observation.
  await item("noStockList", { supplier: "dinamik", code: "SACHS 1111", brand: "SACHS", presence: "inactive", stock: null });
  await item("conflicting", { supplier: "basbug", code: "SAC 2222", brand: "SACHS", presence: "inactive", conflicting: true });
  await item("pending", { supplier: "dinamik", code: "SACHS 3000", brand: "SACHS", presence: "pending_missing", stock: 0 });
  // The same Başbuğ code in two list groups, both dropped: the newest observation is the card.
  await item("lemforderOld", { supplier: "basbug", code: "LMI 4444", brand: "LEMFORDER", group: "G1", presence: "inactive", seenHoursAgo: 48 });
  await item("lemforderNew", { supplier: "basbug", code: "LMI 4444", brand: "LEMFORDER", group: "G2", presence: "inactive", seenHoursAgo: 24 });
  await item("ngk", { supplier: "basbug", code: "NGK 5555", brand: "NGK", stock: 4, cost: 10 });
  await schema.pool.query("INSERT INTO products(id,brand,part_number,name,brand_label,code) VALUES($1,'MANN','W71295','FILTRE','MANN','MAN W71295')", [ids.mannBasbug]);
  await schema.pool.query("INSERT INTO product_sources(supplier_item_id,product_id) VALUES($1,$1),($2,$1)", [ids.mannBasbug, ids.mannDinamik]);
  // Creates the Bosch product from the Dinamik row and links the dropped Başbuğ row to it (#475).
  await schema.pool.query("SELECT refresh_product_matches()");
  Object.assign(globalThis, { AsyncLocalStorage });
  workStorage = (await import("next/dist/server/app-render/work-async-storage.external")).workAsyncStorage;
  const [{ db }, module] = await Promise.all([import("../src/lib/db"), import("../src/modules/store/catalog")]);
  catalog = module;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

const unavailableIds = async () => (await schema.pool.query<{ id: string }>("SELECT id::text FROM commerce_unavailable_items")).rows.map(row => row.id).sort();

test("the matching refresh links a dropped row to the existing product of its key", async () => {
  const { rows } = await schema.pool.query("SELECT product_id::text FROM product_sources WHERE supplier_item_id=$1", [ids.boschBasbug]);
  assert.equal(rows[0]?.product_id, (await schema.pool.query("SELECT product_id::text FROM product_sources WHERE supplier_item_id=$1", [ids.boschDinamik])).rows[0].product_id);
  assert.deepEqual((await schema.pool.query("SELECT suppliers FROM products WHERE id=$1", [rows[0].product_id])).rows[0].suppliers, ["dinamik"]);
});

test("one card per unavailable product; sold or unusable rows are not cards", async () => {
  assert.deepEqual(await unavailableIds(), [ids.mannBasbug, ids.pending, ids.lemforderNew].sort());
});

test("an unavailable row shows its label's master brand name (#811)", async () => {
  const brand = (await schema.pool.query<{ id: string }>("INSERT INTO brands(key,name) VALUES('ZFLEMFORDER','ZF LEMFORDER') RETURNING id::text")).rows[0].id;
  await schema.pool.query(`INSERT INTO supplier_brands(supplier,label,brand_id) VALUES('basbug','LEMFORDER',$1)
    ON CONFLICT (supplier,label) DO UPDATE SET brand_id=EXCLUDED.brand_id`, [brand]);
  const row = await catalog.getStorefrontProduct(ids.lemforderNew);
  assert.equal(row?.unavailable, true);
  assert.equal(row?.brand, "LEMFORDER");
  assert.equal(row?.display_brand, "ZF LEMFORDER");
  const listed = (await schema.pool.query<{ display_brand: string }>("SELECT display_brand FROM storefront_catalog WHERE id=$1", [ids.lemforderNew])).rows[0];
  assert.equal(listed.display_brand, "ZF LEMFORDER");
});

test("an unavailable row has no price, cannot be ordered and says why", async () => {
  const row = await catalog.getStorefrontProduct(ids.pending);
  assert.ok(row);
  assert.equal(row.unavailable, true);
  assert.equal(row.price_kurus, null);
  assert.equal(row.available, false);
  assert.equal(row.max_quantity, 0);
  assert.equal(row.stock_label, "Şu an tedarik edilemiyor");
  // Cart and checkout read the saleable catalog only.
  assert.equal(await catalog.getProduct(ids.pending), undefined);
  assert.equal((await catalog.getStorefrontProduct(ids.ngk))?.unavailable, false);
});

test("listings put unavailable products last; 'Tedarik edilebilir' hides them", async () => {
  for (const query of [{}, { sort: "price-asc" as const }, { sort: "price-desc" as const }]) {
    const { items, total } = await catalog.browseProducts(query);
    assert.equal(total, 6, JSON.stringify(query));
    assert.deepEqual(items.map(row => Boolean(row.unavailable)), [false, false, false, true, true, true], JSON.stringify(query));
  }
  const supplied = await catalog.browseProducts({ availability: "supplied" });
  assert.equal(supplied.total, 3);
  assert.ok(supplied.items.every(row => !row.unavailable));
  assert.deepEqual(supplied.items.map(row => row.id).sort(), [ids.falkonNew, ids.boschDinamik, ids.ngk].sort());
});

// Cards are read by id array after their ids (#1135): the page keeps the order of its ids, and a grouped product is
// priced through its offers.
test("a listing page keeps its order and prices a grouped product by its cheapest sellable offer", async () => {
  const { invalidateListings } = await import("../src/modules/store/listing-epoch");
  const setSeen = (key: string, hours: number) => schema.pool.query(
    "UPDATE supplier_items SET changed_at=now()-make_interval(hours=>$2) WHERE id=$1", [ids[key], hours]);
  // Başbuğ sells the Bosch product again, dearer than Dinamik: the product has two offers.
  await schema.pool.query(`UPDATE supplier_items SET presence='present',last_seen_at=now(),stock_data='{"stok":2}',price_data='{"nf":80}'
    WHERE id=$1`, [ids.boschBasbug]);
  await setSeen("falkonNew", 3);
  await setSeen("boschDinamik", 2);
  await schema.pool.query("SELECT refresh_product_matches()");
  await invalidateListings();
  try {
    const { items, total } = await catalog.browseProducts({ sort: "newest" });
    assert.equal(total, 6);
    const unavailableOrder = (await schema.pool.query<{ id: string }>(
      "SELECT id::text FROM storefront_catalog WHERE unavailable ORDER BY updated_at DESC,id")).rows.map(row => row.id);
    assert.deepEqual(items.map(row => row.id), [ids.ngk, ids.boschDinamik, ids.falkonNew, ...unavailableOrder]);
    const bosch = items.find(row => row.id === ids.boschDinamik);
    const dinamikRow = await catalog.getProduct(ids.boschDinamik), basbugRow = await catalog.getProduct(ids.boschBasbug);
    assert.ok(dinamikRow?.price_kurus && basbugRow?.price_kurus && dinamikRow.price_kurus < basbugRow.price_kurus);
    assert.equal(bosch?.offers, 2);
    assert.equal(bosch?.offer_id, ids.boschDinamik);
    assert.equal(bosch?.price_kurus, dinamikRow.price_kurus);
    // The partner search (saleable rows) lists the plain search's first page in the same order and prices.
    const plain = (await catalog.browseProducts({ q: "PARCA" })).items.filter(row => !row.unavailable);
    const partner = await catalog.searchCatalogItems("PARCA", "all");
    assert.ok(partner.length >= 3);
    const card = (row: CatalogProduct) => [row.id, row.price_kurus, row.offer_id ?? null];
    assert.deepEqual(partner.map(card), plain.map(card));
  } finally {
    await schema.pool.query("UPDATE supplier_items SET presence='inactive',stock_data='{\"stok\":0}',price_data='{\"nf\":100}' WHERE id=$1", [ids.boschBasbug]);
    await setSeen("falkonNew", 1);
    await setSeen("boschDinamik", 1);
    await schema.pool.query("SELECT refresh_product_matches()");
    await invalidateListings();
  }
});

test("search finds unavailable products after saleable ones; the partner API never sees them", async () => {
  const falkon = await catalog.browseProducts({ q: "FALKON 7001", searchBy: "code" });
  assert.deepEqual(falkon.items.map(row => [row.id, Boolean(row.unavailable)]), [[ids.falkonNew, false]]);
  const lemforder = await catalog.browseProducts({ q: "LMI 4444", searchBy: "code" });
  assert.deepEqual(lemforder.items.map(row => [row.id, row.unavailable, row.price_kurus]), [[ids.lemforderNew, true, null]]);
  const sachs = await catalog.browseProducts({ q: "SACHS", searchBy: "code", sort: "newest" });
  assert.deepEqual(sachs.items.map(row => row.id), [ids.pending]);
  assert.deepEqual(await catalog.searchCatalogItems("LMI 4444", "code"), []);
  assert.deepEqual((await catalog.searchCatalogItems("FALKON 7001", "code")).map(row => row.id), [ids.falkonNew]);
});

test("old links lead to the page showing the product instead of a 404", async () => {
  assert.deepEqual(await catalog.getStoreProduct(ids.falkonOld), { primaryId: ids.falkonNew });
  assert.deepEqual(await catalog.getStoreProduct(ids.boschBasbug), { primaryId: ids.boschDinamik });
  assert.deepEqual(await catalog.getStoreProduct(ids.mannDinamik), { primaryId: ids.mannBasbug });
  assert.deepEqual(await catalog.getStoreProduct(ids.lemforderOld), { primaryId: ids.lemforderNew });
  assert.equal((await catalog.getStoreProduct(ids.pending)).product?.unavailable, true);
  assert.deepEqual(await catalog.getStoreProduct(ids.noStockList), {});
});

test("a row offered again is saleable at once", async () => {
  await schema.pool.query("UPDATE supplier_items SET presence='present',last_seen_at=now(),stock_data='{\"stok\":2}' WHERE id=$1", [ids.pending]);
  const row = await catalog.getStorefrontProduct(ids.pending);
  assert.equal(row?.unavailable, false);
  assert.equal(row?.available, true);
  assert.ok(row?.price_kurus);
  assert.ok(!(await unavailableIds()).includes(ids.pending));
});

// Dinamik price-list-only codes (#1068): a row of Dinamik's price list without a stock-list row carries only its code and
// brand label. With an enrichment matched to that code and brand and a category with a Turkish label, it becomes an
// unavailable card named after the category; without content it gets no card.
describe("Dinamik price-list-only codes", () => {
  async function priceOnly(key: string, { code, brand, group = "PRICE", conflicting = false, seenHoursAgo = 1 }:
    { code: string; brand: string; group?: string; conflicting?: boolean; seenHoursAgo?: number }) {
    const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
      product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
      VALUES('dinamik',$1,$2,'ALL',$3,$4,'{"nf":100}',NULL,1,1,0,$5,'present',now()-interval '10 days',now()-make_interval(hours=>$6),now()-make_interval(hours=>$6))
      RETURNING id::text`, [dinamik, group, code, { stokKodu: code, marka: brand }, conflicting, seenHoursAgo]);
    ids[key] = rows[0].id;
  }
  // The row's own enrichment (its donor) and its storefront link; `linkBrand` other than the label is a stale link.
  async function enrich(key: string, brand: string, categories: number[], linkBrand = brand) {
    const code = (await schema.pool.query<{ code: string }>("SELECT code FROM supplier_items WHERE id=$1", [ids[key]])).rows[0].code;
    await schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,payload)
      VALUES($1,$2,$3,'https://example.test/p','test',$3,$4,'{"specifications":[],"oemNumbers":{},"crossReferences":{},"vehicles":[]}')`,
    [ids[key], code, brand, code.slice(code.indexOf(" ") + 1)]);
    await schema.pool.query(`INSERT INTO product_enrichment_shared_links(supplier_item_id,supplier_code,supplier_brand,donor_item_id,donor_oem,status,imported_at)
      VALUES($1,$2,$3,$1,'','complete',now())`, [ids[key], code, linkBrand]);
    for (const category of categories) await schema.pool.query("INSERT INTO product_source_categories(supplier_item_id,source,category_id) VALUES($1,'trodo',$2)", [ids[key], category]);
  }
  const refresh = async () => (await schema.pool.query<{ n: number }>("SELECT storefront_price_only_refresh() AS n")).rows[0].n;
  const keys = ["qualifying", "bare", "noLabel", "staleLink", "soldElsewhere", "groupSold", "conflictingPrice", "duplicateOld", "duplicateNew", "hiddenPrice"];
  const cards = async () => {
    const shown = new Set(await unavailableIds());
    return keys.filter(key => shown.has(ids[key]));
  };

  before(async () => {
    await schema.pool.query(`INSERT INTO source_categories(source,category_id,parent_id,name,slug,path_ids,source_url,raw) VALUES
      ('trodo',300,NULL,'Brake system','brake-system','{300}','','{}'),('trodo',301,300,'Brake discs','brake-discs','{300,301}','','{}'),
      ('trodo',302,NULL,'Untranslated','untranslated','{302}','','{}')`);
    await schema.pool.query(`INSERT INTO source_category_labels(source,category_id,locale,name,slug) VALUES
      ('trodo',300,'tr','Fren sistemi','fren-sistemi-300'),('trodo',301,'tr','Fren diskleri','fren-diskleri-301')`);
    await priceOnly("qualifying", { code: "TRW DF4185", brand: "TRW" });
    await enrich("qualifying", "TRW", [300, 301]);
    await priceOnly("bare", { code: "TRW DF0001", brand: "TRW" });
    await priceOnly("noLabel", { code: "TRW DF0002", brand: "TRW" });
    await enrich("noLabel", "TRW", [302]);
    await priceOnly("staleLink", { code: "TRW DF0003", brand: "TRW" });
    await enrich("staleLink", "TRW", [301], "TRW OLD");
    // Sold under the same code from Dinamik's stock list in another scope.
    await priceOnly("soldElsewhere", { code: "FEBI 1000", brand: "FEBI" });
    await enrich("soldElsewhere", "FEBI", [301]);
    await item("febiStock", { supplier: "dinamik", code: "FEBI 1000", brand: "FEBI", group: "FEBI", stock: 3 });
    // Its product group is sold by a Başbuğ row.
    await priceOnly("groupSold", { code: "VALEO 826694", brand: "VALEO" });
    await enrich("groupSold", "VALEO", [301]);
    await item("valeoBasbug", { supplier: "basbug", code: "VAL 826694", brand: "VALEO", stock: 2 });
    await schema.pool.query("INSERT INTO products(id,brand,part_number,name,brand_label,code) VALUES($1,'VALEO','826694','DEBRIYAJ','VALEO','VAL 826694')", [ids.valeoBasbug]);
    await schema.pool.query("INSERT INTO product_sources(supplier_item_id,product_id) VALUES($1,$1),($2,$1)", [ids.valeoBasbug, ids.groupSold]);
    await priceOnly("conflictingPrice", { code: "TRW DF0004", brand: "TRW", conflicting: true });
    await enrich("conflictingPrice", "TRW", [301]);
    // The same code in two price-list scopes: the newest observation is the card.
    await priceOnly("duplicateOld", { code: "TRW DF0005", brand: "TRW", group: "OLD", seenHoursAgo: 5 });
    await enrich("duplicateOld", "TRW", [301]);
    await priceOnly("duplicateNew", { code: "TRW DF0005", brand: "TRW", group: "NEW" });
    await enrich("duplicateNew", "TRW", [301]);
    await priceOnly("hiddenPrice", { code: "TRW DF0006", brand: "TRW" });
    await enrich("hiddenPrice", "TRW", [301]);
    await schema.pool.query("INSERT INTO commerce_item_overrides(supplier_item_id,product_id,hidden) VALUES($1,$1,true)", [ids.hiddenPrice]);
  });

  test("only price-list-only rows with an enrichment and a Turkish category become cards, one per code", async () => {
    assert.deepEqual(await cards(), []);
    assert.ok(await refresh() > 0);
    assert.deepEqual(await cards(), ["qualifying", "duplicateNew"]);
    // A second run writes nothing.
    assert.equal(await refresh(), 0);
  });

  test("tasks share one rebuild per interval; a renamed card moves qualified_at", async () => {
    // A rebuild just ran: a task asking with an interval is skipped (null), an import or setup (no interval) is not.
    const due = async (seconds: number) => (await schema.pool.query<{ n: number | null }>(
      "SELECT storefront_price_only_refresh(make_interval(secs=>$1)) AS n", [seconds])).rows[0].n;
    assert.equal(await due(600), null);
    await schema.pool.query("UPDATE storefront_price_only_runs SET refreshed_at=now()-interval '11 minutes'");
    assert.equal(await due(600), 0);
    assert.equal(await due(600), null);
    const qualified = async () => (await schema.pool.query<{ at: Date }>("SELECT qualified_at AS at FROM storefront_price_only_items WHERE supplier_item_id=$1",
      [ids.qualifying])).rows[0].at;
    await schema.pool.query("UPDATE storefront_price_only_items SET qualified_at=now()-interval '1 day' WHERE supplier_item_id=$1", [ids.qualifying]);
    const before = await qualified();
    assert.equal(await refresh(), 0);
    assert.deepEqual(await qualified(), before);
    // Every listed row in category 301 (the list keeps the view's per-code and group checks to the view; the rows sold
    // under the same identity, soldElsewhere and groupSold, are not listed, #1081).
    await schema.pool.query("UPDATE source_category_labels SET name='Fren diski' WHERE category_id=301");
    assert.equal(await refresh(), 3);
    assert.ok((await qualified()) > before);
    await schema.pool.query("UPDATE source_category_labels SET name='Fren diskleri' WHERE category_id=301");
    assert.equal(await refresh(), 3);
  });

  test("a price-only card is named after its deepest category, keeps its real brand and cannot be ordered", async () => {
    const row = await catalog.getStorefrontProduct(ids.qualifying);
    assert.ok(row);
    assert.equal(row.unavailable, true);
    assert.equal(row.price_only, true);
    assert.equal(row.name, "Fren diskleri");
    assert.equal(row.brand, "TRW");
    assert.equal(row.display_brand, "TRW");
    assert.equal(row.price_kurus, null);
    assert.equal(row.available, false);
    assert.equal(row.max_quantity, 0);
    assert.equal(row.stock_label, "Stok bilgisi bekleniyor");
    assert.equal(await catalog.getProduct(ids.qualifying), undefined);
    assert.deepEqual(await catalog.searchCatalogItems("TRW DF4185", "code"), []);
    // Other unavailable cards keep their label and are no price-only cards.
    assert.equal((await catalog.getStorefrontProduct(ids.lemforderNew))?.price_only, false);
    // Bare rows have no page.
    assert.deepEqual(await catalog.getStoreProduct(ids.bare), {});
    assert.equal(await catalog.getStorefrontProduct(ids.noLabel), undefined);
  });

  test("search finds a price-only card by its code, after saleable products", async () => {
    const found = await catalog.browseProducts({ q: "TRW DF4185", searchBy: "code" });
    assert.deepEqual(found.items.map(row => [row.id, row.unavailable, row.price_kurus]), [[ids.qualifying, true, null]]);
    assert.ok(!(await catalog.browseProducts({ q: "TRW DF0001", searchBy: "code" })).items.some(row => row.id === ids.bare));
  });

  test("search finds a price-only card by its name and brand too, through the card's stored fields (#1081)", async () => {
    const stored = (await schema.pool.query<{ doc: string; codes: string }>(
      "SELECT search_doc::text AS doc,search_codes AS codes FROM storefront_price_only_items WHERE supplier_item_id=$1", [ids.qualifying])).rows[0];
    assert.match(stored.doc, /'fren':1A/);
    assert.match(stored.doc, /'trw':\d+B/);
    assert.equal(stored.codes, "trwdf4185");
    // The plain search (summarizeSearch) and a filtered one (catalogRank) both list it.
    assert.ok((await catalog.browseProducts({ q: "fren diskleri" })).items.some(row => row.id === ids.qualifying));
    assert.ok((await catalog.browseProducts({ q: "trw fren" })).items.some(row => row.id === ids.qualifying));
    assert.ok((await catalog.browseProducts({ q: "fren diskleri", brand: "TRW" })).items.some(row => row.id === ids.qualifying));
    // A code search does not read names.
    assert.deepEqual((await catalog.browseProducts({ q: "fren diskleri", searchBy: "code" })).items, []);
    // Hidden by an admin: in the list, not a hit.
    assert.ok(!(await catalog.browseProducts({ q: "fren diskleri" })).items.some(row => row.id === ids.hiddenPrice));
  });

  test("price-only hits only fill the slots the other hits leave under the cap (#1081)", async () => {
    await item("trwSaleable", { supplier: "basbug", code: "TRW GDB1234", brand: "TRW", stock: 2 });
    const { parseSearchQuery } = await import("../src/modules/search/query");
    const hitIds = async (cap: number) => {
      const values: unknown[] = [];
      return (await schema.pool.query<{ id: string }>(catalog.searchHitIdsSql(parseSearchQuery("trw"), values, "all", cap), values)).rows.map(row => row.id);
    };
    assert.deepEqual(await hitIds(1), [ids.trwSaleable]);
    const all = await hitIds(50);
    assert.equal(all[0], ids.trwSaleable);
    assert.ok(all.includes(ids.qualifying) && all.includes(ids.duplicateNew));
    assert.equal(new Set(all).size, all.length);
    assert.deepEqual(new Set(await hitIds(2)).size, 2);
  });

  test("a code whose brand and part number another usable row carries gets no card, linked or not (#1081)", async () => {
    // Sold by Başbuğ under its own code, not grouped with it (no product_sources row).
    await priceOnly("identitySold", { code: "BREMBO 09.A123.11", brand: "BREMBO" });
    await enrich("identitySold", "BREMBO", [301]);
    await item("bremboBasbug", { supplier: "basbug", code: "BRE 09A12311", brand: "BREMBO", stock: 2 });
    // Dropped by Başbuğ: that row is the unavailable card.
    await priceOnly("identityDropped", { code: "ATE 24.0122-0101.1", brand: "ATE" });
    await enrich("identityDropped", "ATE", [301]);
    await item("ateBasbug", { supplier: "basbug", code: "ATE 240122-01011", brand: "ATE", presence: "inactive", stock: 0 });
    // Two price-list codes of one part: one card.
    await priceOnly("twinA", { code: "TEXTAR 2345601", brand: "TEXTAR" });
    await enrich("twinA", "TEXTAR", [301]);
    await priceOnly("twinB", { code: "TEXTAR 23456-01", brand: "TEXTAR" });
    await enrich("twinB", "TEXTAR", [301]);
    // The same part number under another brand is another product.
    await priceOnly("otherBrand", { code: "FEBI 09A12311", brand: "FEBI" });
    await enrich("otherBrand", "FEBI", [301]);
    await refresh();
    const listed = new Set((await schema.pool.query<{ id: string }>("SELECT supplier_item_id::text AS id FROM storefront_price_only_items")).rows.map(row => row.id));
    assert.deepEqual(["identitySold", "identityDropped", "otherBrand"].filter(key => listed.has(ids[key])), ["otherBrand"]);
    assert.equal([ids.twinA, ids.twinB].filter(id => listed.has(id)).length, 1);
    const shown = await unavailableIds();
    assert.ok(shown.includes(ids.ateBasbug));
    assert.ok(!shown.includes(ids.identitySold) && !shown.includes(ids.identityDropped));
    // The sold row dropped is the product's unavailable card; once unusable, the price-only card comes back.
    await schema.pool.query("UPDATE supplier_items SET presence='inactive',stock_data='{\"stok\":0}' WHERE id=$1", [ids.bremboBasbug]);
    await refresh();
    assert.ok(!(await schema.pool.query("SELECT 1 FROM storefront_price_only_items WHERE supplier_item_id=$1", [ids.identitySold])).rowCount);
    await schema.pool.query("UPDATE supplier_items SET conflicting=true WHERE id=$1", [ids.bremboBasbug]);
    await refresh();
    assert.ok((await schema.pool.query("SELECT 1 FROM storefront_price_only_items WHERE supplier_item_id=$1", [ids.identitySold])).rowCount);
  });

  test("'Gelince haber ver' stores the card's name and brand", async () => {
    const requests = await import("../src/modules/store/restock-requests");
    const result = await requests.createRestockRequest({ productId: ids.qualifying, email: "fiyat@example.invalid", consent: "on", website: "" });
    assert.equal(result.status, "success");
    const stored = (await schema.pool.query("SELECT supplier,code,brand,name FROM restock_requests WHERE supplier_item_id=$1", [ids.qualifying])).rows[0];
    assert.deepEqual(stored, { supplier: "dinamik", code: "TRW DF4185", brand: "TRW", name: "Fren diskleri" });
  });

  test("a stock-list row makes the code saleable at once; the next refresh drops it from the list", async () => {
    await schema.pool.query(`UPDATE supplier_items SET stock_data='{"stok":2}',product_data=product_data||'{"uk":"TRW","ac":"FREN DISKI","dc":"TL"}'::jsonb
      WHERE id=$1`, [ids.qualifying]);
    const row = await catalog.getStorefrontProduct(ids.qualifying);
    assert.equal(row?.unavailable, false);
    assert.equal(row?.price_only, false);
    assert.equal(row?.available, true);
    assert.ok(row?.price_kurus);
    assert.deepEqual(await cards(), ["duplicateNew"]);
    // Before the next refresh its stale price-only search fields still find it: once, as the saleable product.
    for (const query of [{ q: "trw diskleri" }, { q: "trw diskleri", brand: "TRW" }]) {
      const found = (await catalog.browseProducts(query)).items.filter(row => row.id === ids.qualifying);
      assert.deepEqual(found.map(row => [row.unavailable, row.price_only]), [[false, false]], JSON.stringify(query));
    }
    assert.equal(await refresh(), 1);
    assert.equal((await schema.pool.query("SELECT 1 FROM storefront_price_only_items WHERE supplier_item_id=$1", [ids.qualifying])).rowCount, 0);
  });
});

// Reads of the view by id array (#1158): equivalents and the exchange rate step.
describe("by-id catalog reads", () => {
  test("SETA equivalents: one row per SETA item, saleable and cheapest first, through grouped offers' references too", async () => {
    await item("eqOwn", { supplier: "basbug", code: "HEL 9001", brand: "HELLA", stock: 2 });
    await item("eqOffer", { supplier: "dinamik", code: "HELLA 9001", brand: "HELLA", stock: 2 });
    await item("setaCheap", { supplier: "dinamik", code: "SETA 1", brand: "SETA", stock: 2, cost: 20 });
    await item("setaDear", { supplier: "dinamik", code: "SETA 2", brand: "SETA", stock: 2, cost: 40 });
    await item("setaGone", { supplier: "dinamik", code: "SETA 3", brand: "SETA", stock: 0, cost: 5 });
    await item("setaInactive", { supplier: "dinamik", code: "SETA 4", brand: "SETA", presence: "inactive", stock: 0 });
    await schema.pool.query("INSERT INTO product_offers(item_id,primary_id) VALUES($1,$1),($2,$1)", [ids.eqOwn, ids.eqOffer]);
    // setaDear is stated by both rows: listed once; setaGone (sold out) after the saleable ones; setaInactive is not saleable.
    await schema.pool.query(`INSERT INTO product_seta_references(item_id,seta_item_id,brand,part_number) VALUES
      ($1,$3,'HELLA','OWN-1'),($1,$4,'HELLA','OWN-2'),($2,$4,'HELLA','OFFER-2'),($2,$5,'HELLA','OFFER-3'),($2,$6,'HELLA','OFFER-4')`,
    [ids.eqOwn, ids.eqOffer, ids.setaCheap, ids.setaDear, ids.setaGone, ids.setaInactive]);
    const rows = await catalog.getSetaEquivalents(ids.eqOwn);
    assert.deepEqual(rows.map(row => row.id), [ids.setaCheap, ids.setaDear, ids.setaGone]);
    assert.deepEqual(rows.map(row => row.available), [true, true, false]);
    assert.ok(rows[0].price_kurus! < rows[1].price_kurus!);
    assert.equal(rows[0].via_part, "OWN-1");
    assert.ok(["OWN-2", "OFFER-2"].includes(rows[1].via_part));
    assert.equal(rows[2].via_part, "OFFER-3");
    // A grouped offer's own page reads only its references.
    assert.deepEqual((await catalog.getSetaEquivalents(ids.eqOffer)).map(row => row.id).sort(), [ids.setaDear, ids.setaGone].sort());
  });

  test("decided equivalents: the equivalent's own row first, never a secondary offer row, id null when none is on sale", async () => {
    await item("decSource", { supplier: "basbug", code: "MEY 100", brand: "MEYLE", stock: 2 });
    await item("decOwn", { supplier: "basbug", code: "LEM 200", brand: "LEMFORDER", stock: 0 });
    await item("decOther", { supplier: "dinamik", code: "LEMFORDER 200", brand: "LEMFORDER", stock: 2 });
    await item("decPrimary", { supplier: "basbug", code: "TRW 300", brand: "TRW", stock: 0 });
    await item("decSecondary", { supplier: "dinamik", code: "TRW 300X", brand: "TRW", stock: 3 });
    await item("decGone", { supplier: "basbug", code: "SWG 400", brand: "SWAG", presence: "inactive", stock: 0 });
    const product = async (key: string, brand: string, part: string) => (await schema.pool.query(
      "INSERT INTO products(id,brand,part_number,name,brand_label,code) VALUES($1,$2,$3,'PARCA',$2,$3)", [ids[key], brand, part]));
    await product("decSource", "MEYLE", "100");
    await product("decOwn", "LEMFORDER", "200");
    await product("decPrimary", "TRW", "300");
    await product("decGone", "SWAG", "400");
    await schema.pool.query(`INSERT INTO product_sources(supplier_item_id,product_id) VALUES($1,$1),($2,$2),($3,$2),($4,$4),($5,$4),($6,$6)`,
      [ids.decSource, ids.decOwn, ids.decOther, ids.decPrimary, ids.decSecondary, ids.decGone]);
    await schema.pool.query("INSERT INTO product_offers(item_id,primary_id) VALUES($1,$1),($2,$1)", [ids.decPrimary, ids.decSecondary]);
    await schema.pool.query(`INSERT INTO product_equivalents(product_id,equivalent_id,kind,brand,part_number) VALUES
      ($1,$2,'brand','LEMFORDER','200'),($1,$3,'brand','TRW','300'),($1,$4,'brand','SWAG','400')`,
    [ids.decSource, ids.decOwn, ids.decPrimary, ids.decGone]);
    const rows = await catalog.getDecidedEquivalents(ids.decSource);
    const byCode = new Map(rows.map(row => [row.code, row]));
    // The equivalent's own row wins even while sold out; the secondary offer row is never listed.
    assert.equal(byCode.get("LEM 200")?.id, ids.decOwn);
    assert.equal(byCode.get("TRW 300")?.id, ids.decPrimary);
    assert.equal(byCode.get("400")?.id, null);
    assert.equal(byCode.get("400")?.href, null);
    assert.equal(rows.length, 3);
    assert.equal(rows.at(-1)?.id, null);
  });

  test("the rate step reads the newest succeeded import of the supplier and company; a TL row stays at 1", async () => {
    await item("eurRow", { supplier: "basbug", code: "VAL 500", brand: "VALEO", stock: 2, cost: 10 });
    await item("tlRow", { supplier: "basbug", code: "VAL 501", brand: "VALEO", stock: 2, cost: 10 });
    await schema.pool.query(`UPDATE supplier_items SET product_data=product_data||'{"dc":"EUR"}'::jsonb WHERE id=$1`, [ids.eurRow]);
    const rates = (satis: number) => JSON.stringify({ dovizListesi: [{ dovizCinsi: "EUR", satis }] });
    await schema.pool.query(`INSERT INTO supplier_imports(supplier,company,list_group,warehouse,started_at,completed_at,observations,quality,groups_data,currencies_data,status)
      VALUES('basbug',$1,'G','MRK',now()-interval '3 hours',now()-interval '3 hours','{}','{}','{}',$2,'succeeded'),
       ('basbug',$1,'G','MRK',now()-interval '2 hours',now()-interval '2 hours','{}','{}','{}',$3,'succeeded'),
       ('basbug',$1,'G','MRK',now()-interval '1 hour',now()-interval '1 hour','{}','{}','{}',$4,'failed')`,
    [basbug, rates(40), rates(45), rates(99)]);
    const eur = await catalog.getProduct(ids.eurRow), tl = await catalog.getProduct(ids.tlRow);
    assert.equal(Number(eur?.pricing_snapshot?.exchange_rate), 45);
    assert.equal(Number(tl?.pricing_snapshot?.exchange_rate), 1);
    assert.ok(eur?.price_kurus && tl?.price_kurus && eur.price_kurus > tl.price_kurus);
  });

  test("latest succeeded import is one definition (#1169)", async () => {
    const rates = (satis: number) => JSON.stringify({ dovizListesi: [{ dovizCinsi: "USD", satis }] });
    const runs: [string, string, string, string, number][] = [
      // id, supplier, company, status, hours ago: an older succeeded run, a newer failed one, and two succeeded runs
      // sharing completed_at (the higher id wins).
      ["00000000-0000-4000-8000-000000001169", "seta", "SETA-A", "succeeded", 5],
      ["00000000-0000-4000-8000-000000002169", "seta", "SETA-A", "failed", 1],
      ["00000000-0000-4000-8000-000000003169", "seta", "SETA-B", "succeeded", 4],
      ["00000000-0000-4000-8000-000000004169", "seta", "SETA-B", "succeeded", 4],
      ["00000000-0000-4000-8000-000000005169", "manual", "MANUAL", "succeeded", 6],
      ["00000000-0000-4000-8000-000000006169", "manual", "MANUAL", "succeeded", 2],
    ];
    for (const [index, [id, supplier, company, status, hours]] of runs.entries())
      await schema.pool.query(`INSERT INTO supplier_imports(id,supplier,company,list_group,warehouse,started_at,completed_at,observations,quality,groups_data,currencies_data,status)
        VALUES($1,$2,$3,'G','ALL',now()-make_interval(hours=>$4),now()-make_interval(hours=>$4),'{}','{}','{}',$5,$6)`, [id, supplier, company, hours, rates(index + 1), status]);
    const old = (await schema.pool.query(`SELECT DISTINCT ON (supplier,company) supplier,company,id::text,currencies_data,completed_at
      FROM supplier_imports WHERE status='succeeded' ORDER BY supplier,company,completed_at DESC,id DESC`)).rows;
    const view = (await schema.pool.query("SELECT supplier,company,id::text,currencies_data,completed_at FROM supplier_latest_imports ORDER BY supplier,company")).rows;
    assert.deepEqual(view, old);
    const latest = new Map(view.map(row => [`${row.supplier}/${row.company}`, row.id]));
    assert.equal(latest.get("seta/SETA-A"), runs[0][0]);
    assert.equal(latest.get("seta/SETA-B"), runs[3][0]);
    assert.equal(latest.get("manual/MANUAL"), runs[5][0]);
    for (const row of view) {
      const one = (await schema.pool.query("SELECT id::text,currencies_data,completed_at FROM supplier_latest_import($1,$2)", [row.supplier, row.company])).rows;
      assert.deepEqual(one, [{ id: row.id, currencies_data: row.currencies_data, completed_at: row.completed_at }]);
    }
    assert.deepEqual((await schema.pool.query("SELECT * FROM supplier_latest_import('seta','NONE')")).rows, []);
    // The function stays inlinable (db/schema.sql): neither read plans a Function Scan.
    const plan = async (sql: string) => (await schema.pool.query<{ "QUERY PLAN": string }>(`EXPLAIN ${sql}`)).rows.map(row => row["QUERY PLAN"]).join("\n");
    assert.doesNotMatch(await plan("SELECT * FROM supplier_latest_imports WHERE supplier='seta'"), /Function Scan/);
    assert.doesNotMatch(await plan(`SELECT latest.currencies_data FROM supplier_items i
      LEFT JOIN LATERAL supplier_latest_import(i.supplier,i.company) latest ON true WHERE i.supplier='basbug'`), /Function Scan/);
    // The refactored sites no longer carry their own copy of the step.
    const copy = /FROM supplier_imports[\s\S]{0,200}status='succeeded'[\s\S]{0,80}ORDER BY[^`]*completed_at DESC,\s*(?:\w+\.)?id DESC/;
    const data = await readFile("src/modules/admin/data.ts", "utf8");
    const adminPricing = data.slice(data.indexOf("export async function adminPricing"), data.indexOf("export", data.indexOf("export async function adminPricing") + 1));
    assert.ok(adminPricing.includes("supplier_latest_import("));
    for (const [file, text] of [["src/modules/admin/data.ts#adminPricing", adminPricing],
      ...await Promise.all(["db/commerce.sql", "src/modules/suppliers/price-anomalies.ts", "src/modules/admin/product-matching-sql.ts",
        "src/modules/admin/product-pricing-store.ts"].map(async file => [file, await readFile(file, "utf8")]))])
      assert.doesNotMatch(text, copy, file);
  });
});

// The listing's availability filter reads commerce_item_availability (#1242), a copy of commerce_catalog's
// available/stock_label expressions without the pricing joins.
describe("availability filter (#1242)", () => {
  async function observation(key: string, { supplier, stock, seenHoursAgo = 1, group = "AV" }:
    { supplier: "basbug" | "dinamik" | "seta" | "manual"; stock: Record<string, number> | null; seenHoursAgo?: number; group?: string }) {
    const company = { basbug, dinamik, seta: "SETA", manual: "MANUEL" }[supplier];
    const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
      product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
      VALUES($1,$2,$3,$4,$5,$6,'{"nf":100}',$7,1,1,1,false,'present',now()-interval '10 days',now()-make_interval(hours=>$8),now()-make_interval(hours=>$8))
      RETURNING id::text`, [supplier, company, group, supplier === "basbug" ? "MRK" : "ALL", `AV ${key}`,
      { uk: "AVTEST", ac: `${key} PARCA`, dc: "TL" }, stock, seenHoursAgo]);
    ids[key] = rows[0].id;
  }
  const columns = "id::text,available,stock_label";
  const difference = async (from: string, minus: string) => (await schema.pool.query(
    `SELECT ${columns} FROM ${from} EXCEPT ALL SELECT ${columns} FROM ${minus}`)).rows;

  before(async () => {
    await observation("avStock", { supplier: "basbug", stock: { stok: 3 } });
    await observation("avZero", { supplier: "basbug", stock: { stok: 0 } });
    await observation("avOtherDepot", { supplier: "basbug", stock: { stok: 0, sFarkliDepo: 2 } });
    await observation("avRoad", { supplier: "dinamik", stock: { stok: 0, sYol: 5 } });
    await observation("avManual", { supplier: "manual", stock: null, seenHoursAgo: 500 });
    await observation("avSeta", { supplier: "seta", stock: null });
    // Older than commerce_settings.max_age_hours, and a scope whose last success is stale.
    await observation("avStale", { supplier: "basbug", stock: { stok: 3 }, seenHoursAgo: 100 });
    await observation("avStaleScope", { supplier: "dinamik", stock: { stok: 3 }, group: "AV-STALE" });
    await schema.pool.query(`INSERT INTO supplier_sync_scopes(supplier,company,list_group,warehouse,stale_minutes,last_success_at)
      VALUES('dinamik',$1,'AV-STALE','ALL',60,now()-interval '1 day')`, [dinamik]);
    // A commerce-enabled scope whose short commerce window the row's last observation is past.
    await observation("avCommerceStale", { supplier: "dinamik", stock: { stok: 3 }, seenHoursAgo: 2, group: "AV-COMMERCE" });
    await schema.pool.query(`INSERT INTO supplier_sync_scopes(supplier,company,list_group,warehouse,commerce_enabled,commerce_interval_minutes,commerce_stale_minutes,last_success_at)
      VALUES('dinamik',$1,'AV-COMMERCE','ALL',true,15,30,now())`, [dinamik]);
    await observation("avHidden", { supplier: "dinamik", stock: { stok: 2 } });
    await schema.pool.query("INSERT INTO commerce_item_overrides(supplier_item_id,product_id,hidden) VALUES($1,$1,true)", [ids.avHidden]);
    const store = await schema.pool.query<{ id: string }>(`INSERT INTO store_products(supplier,code,name,brand,price_kurus,stock)
      VALUES('demo','AV-STORE-1','Depo ürünü','AVTEST',10000,2),('demo','AV-STORE-0','Depo ürünü','AVTEST',10000,0) RETURNING id::text`);
    [ids.avStore, ids.avStoreEmpty] = store.rows.map(row => row.id);
  });

  test("the availability view equals commerce_catalog's columns in both checkout modes", async () => {
    const mode = (await schema.pool.query<{ mode: string }>("SELECT basbug_checkout_mode AS mode FROM commerce_settings")).rows[0].mode;
    try {
      for (const checkout of ["live", "snapshot"]) {
        await schema.pool.query("UPDATE commerce_settings SET basbug_checkout_mode=$1", [checkout]);
        assert.deepEqual(await difference("commerce_catalog", "commerce_item_availability"), [], checkout);
        assert.deepEqual(await difference("commerce_item_availability", "commerce_catalog"), [], checkout);
        const labels = new Map((await schema.pool.query<{ id: string; stock_label: string }>(
          "SELECT id::text,stock_label FROM commerce_item_availability WHERE id=ANY($1::uuid[])",
          [Object.values(ids)])).rows.map(row => [row.id, row.stock_label]));
        assert.equal(labels.has(ids.avHidden), false, checkout);
        assert.equal(labels.get(ids.avStore), "Stokta mevcut: 2 adet");
        assert.equal(labels.get(ids.avStoreEmpty), "Stokta yok");
        // The fixture reaches every branch of the label.
        const expected: Record<string, string> = checkout === "live"
          ? { avStock: "Tedarikçide mevcut", avZero: "Stokta yok", avOtherDepot: "Diğer depoda mevcut", avRoad: "Tedarikçiye sevkiyat bekleniyor",
            avManual: "Stok bilgisi bulunamadı", avSeta: "Stok bilgisi bulunamadı", avStale: "Stok bilgisi güncelleniyor", avStaleScope: "Stok bilgisi güncelleniyor",
            avCommerceStale: "Stok bilgisi güncelleniyor" }
          : { avStock: "Stokta · Siparişten sonra teyit edilir", avZero: "Stokta yok", avOtherDepot: "Stokta · Siparişten sonra teyit edilir",
            avRoad: "Tedarikçiye sevkiyat bekleniyor", avManual: "Stok bilgisi bulunamadı", avSeta: "Stok bilgisi bulunamadı",
            avStale: "Stokta · Siparişten sonra teyit edilir", avStaleScope: "Stokta · Siparişten sonra teyit edilir",
            avCommerceStale: "Stokta · Siparişten sonra teyit edilir" };
        for (const [key, label] of Object.entries(expected)) assert.equal(labels.get(ids[key]), label, `${checkout} ${key}`);
      }
    } finally {
      await schema.pool.query("UPDATE commerce_settings SET basbug_checkout_mode=$1", [mode]);
    }
  });

  test("the availability rule is defined once (#1249)", async () => {
    const sql = await readFile("db/commerce.sql", "utf8");
    for (const fragment of ["'Stok bilgisi güncelleniyor'", "'Stokta mevcut: '", "'Tedarikçide mevcut'", "commerce_stale_minutes*interval"])
      assert.equal(sql.split(fragment).length - 1, 1, fragment);
    // commerce_catalog's supplier rows come from commerce_supplier_catalog (#1424): the supplier calls sit there.
    const supplierCalls = ["commerce_source_fresh(", "commerce_supplier_available(", "commerce_supplier_stock_label("];
    const calls: Record<string, string[]> = { commerce_supplier_catalog: supplierCalls, commerce_catalog: ["commerce_store_stock_label("],
      commerce_item_availability: [...supplierCalls, "commerce_store_stock_label("] };
    for (const [view, expected] of Object.entries(calls)) {
      const { rows: [{ def }] } = await schema.pool.query<{ def: string }>("SELECT pg_get_viewdef($1::regclass) AS def", [view]);
      for (const call of expected) assert.ok(def.includes(call), `${view} calls ${call}`);
      // The view stores the calls, not their inlined text: no copy of the rule sits beside them.
      for (const copy of ["'Stok bilgisi güncelleniyor'", "sFarkliDepo"]) assert.ok(!def.includes(copy), `${view} carries ${copy}`);
    }
  });

  // Migration guard for #1249: when the rule is changed on purpose, update this grid's old expressions or delete the test.
  // The expressions both views carried before #1249, frozen here: the functions must give the same result on every
  // combination of checkout mode, supplier, observation age, scope window, last success and stock document.
  const preFunctionGrid = `WITH g AS (
    SELECT mode,supplier,now()-ls*interval '1 minute' AS last_seen_at,max_age,ce,csm,
     CASE WHEN lsa IS NULL THEN NULL ELSE now()-lsa*interval '1 minute' END AS last_success_at,sm,sd::jsonb AS stock_data
    FROM unnest(ARRAY['live','snapshot']) mode, unnest(ARRAY['manual','basbug','dinamik','seta']) supplier,
     unnest(ARRAY[0,29,31,119,121,2159,2161,5000]) ls, unnest(ARRAY[1,36,72]) max_age, unnest(ARRAY[NULL,true,false]) ce,
     unnest(ARRAY[30,120]) csm, unnest(ARRAY[NULL,0,59,61,2159,2161,9000]::int[]) lsa, unnest(ARRAY[NULL,60]::int[]) sm,
     unnest(ARRAY[NULL,'null','{}','{"stok":0}','{"stok":3}','{"stok":0.5}','{"stok":-1}','{"stok":0,"sFarkliDepo":2}',
      '{"stok":null,"sFarkliDepo":1}','{"stok":0,"sFarkliDepo":0,"sYol":5}','{"sYol":1}','{"stok":"2"}',
      '{"stok":0,"sFarkliDepo":0,"sYol":0}','{"stok":1,"sFarkliDepo":1,"sYol":1}']::text[]) sd
  ), o AS (
    SELECT *,(supplier='manual' OR (last_seen_at>now()-make_interval(hours=>max_age)
     AND (NOT COALESCE(ce,false) OR last_seen_at>now()-csm*interval '1 minute')
     AND (last_success_at IS NULL OR last_success_at>now()-COALESCE(sm,2160)*interval '1 minute'))) AS old_fresh,
     commerce_source_fresh(supplier,last_seen_at,max_age,ce,csm,last_success_at,sm,now()) AS new_fresh
    FROM g
  ), r AS (
    SELECT *,(mode='snapshot' OR old_fresh) AND
     (COALESCE((stock_data->>'stok')::numeric,0)>0 OR COALESCE((stock_data->>'sFarkliDepo')::numeric,0)>0) AS old_available,
     CASE WHEN mode='snapshot' AND (COALESCE((stock_data->>'stok')::numeric,0)>0 OR COALESCE((stock_data->>'sFarkliDepo')::numeric,0)>0) THEN 'Stokta · Siparişten sonra teyit edilir'
     WHEN NOT old_fresh AND mode='live' THEN 'Stok bilgisi güncelleniyor'
     WHEN stock_data IS NULL THEN 'Stok bilgisi bulunamadı'
     WHEN (stock_data->>'stok')::numeric>0 THEN 'Tedarikçide mevcut'
     WHEN (stock_data->>'sFarkliDepo')::numeric>0 THEN 'Diğer depoda mevcut'
     WHEN (stock_data->>'sYol')::numeric>0 THEN 'Tedarikçiye sevkiyat bekleniyor'
     ELSE 'Stokta yok' END AS old_label,
     commerce_supplier_available(mode,new_fresh,stock_data) AS new_available,
     commerce_supplier_stock_label(mode,new_fresh,stock_data) AS new_label
    FROM o
  )
  SELECT count(*)::int AS cases,count(*) FILTER (WHERE old_fresh IS DISTINCT FROM new_fresh)::int AS fresh_diff,
   count(*) FILTER (WHERE old_available IS DISTINCT FROM new_available)::int AS available_diff,
   count(*) FILTER (WHERE old_label IS DISTINCT FROM new_label)::int AS label_diff,count(DISTINCT old_label)::int AS labels
  FROM r`;

  test("the functions equal the pre-#1249 expressions", async () => {
    const { rows: [grid] } = await schema.pool.query(preFunctionGrid);
    assert.deepEqual(grid, { cases: 225792, fresh_diff: 0, available_diff: 0, label_diff: 0, labels: 7 });
    const { rows } = await schema.pool.query<{ stock: number | null; same: boolean; label: string }>(`SELECT stock,
      (CASE WHEN stock>0 THEN 'Stokta mevcut: '||stock||' adet' ELSE 'Stokta yok' END) IS NOT DISTINCT FROM commerce_store_stock_label(stock) AS same,
      commerce_store_stock_label(stock) AS label FROM unnest(ARRAY[NULL,-1,0,1,250]::int[]) WITH ORDINALITY s(stock,n) ORDER BY n`);
    assert.deepEqual(rows, [
      { stock: null, same: true, label: "Stokta yok" }, { stock: -1, same: true, label: "Stokta yok" }, { stock: 0, same: true, label: "Stokta yok" },
      { stock: 1, same: true, label: "Stokta mevcut: 1 adet" }, { stock: 250, same: true, label: "Stokta mevcut: 250 adet" }]);
  });

  // An inlined function plans as the expression written in place; a function call left in the plan runs per row and
  // hides its expression from the planner (a STRICT or SET clause, or IMMUTABLE over a stable body, stops the inlining).
  test("both views inline the rule (#1249)", async () => {
    for (const [query, values] of [["SELECT * FROM commerce_catalog WHERE id=$1", [ids.avStock]],
      ["SELECT * FROM commerce_item_availability WHERE available", []]] as const) {
      const plan = (await schema.pool.query<{ "QUERY PLAN": string }>(`EXPLAIN (VERBOSE, COSTS OFF) ${query}`, [...values]))
        .rows.map(row => row["QUERY PLAN"]).join("\n");
      assert.doesNotMatch(plan, /commerce_(source_fresh|supplier_in_stock|supplier_available|supplier_stock_label|store_stock_label)\(/, query);
      // The inlined expressions are in the plan's output columns.
      assert.match(plan, /commerce_stale_minutes/, query);
      assert.match(plan, /Stok bilgisi güncelleniyor/, query);
      assert.match(plan, /Stokta mevcut: /, query);
    }
  });

  // Groups of a Başbuğ primary and a Dinamik offer (product_offers) under the GRUPTEST brand, created once by whichever
  // test needs them first: sold out with a stocked offer, sold out with a sold-out offer, and unknown stock (no stock
  // document) with a sold-out offer.
  let groupsReady: Promise<void> | undefined;
  const groups = () => groupsReady ??= (async () => {
    const fixtures = [["grpPrimary", "grpOffer", "7777", 0, 4], ["grpZeroPrimary", "grpZeroOffer", "7778", 0, 0],
      ["grpUnknownPrimary", "grpUnknownOffer", "7779", null, 0]] as const;
    for (const [primary, offer, number, primaryStock, offerStock] of fixtures) {
      await item(primary, { supplier: "basbug", code: `GRP ${number}`, brand: "GRUPTEST", stock: primaryStock });
      await item(offer, { supplier: "dinamik", code: `GRUPTEST ${number}`, brand: "GRUPTEST", stock: offerStock });
      await schema.pool.query("INSERT INTO products(id,brand,part_number,name,brand_label,code) VALUES($1,'GRUPTEST',$2,'PARCA','GRUPTEST',$3)",
        [ids[primary], number, `GRP ${number}`]);
      await schema.pool.query("INSERT INTO product_sources(supplier_item_id,product_id) VALUES($1,$1),($2,$1)", [ids[primary], ids[offer]]);
    }
    await schema.pool.query("SELECT refresh_product_matches()");
    const { rows } = await schema.pool.query<{ item_id: string; primary_id: string }>(
      "SELECT item_id::text,primary_id::text FROM product_offers WHERE item_id=ANY($1::uuid[])", [fixtures.map(([, offer]) => ids[offer])]);
    assert.deepEqual(new Map(rows.map(row => [row.item_id, row.primary_id])), new Map(fixtures.map(([primary, offer]) => [ids[offer], ids[primary]])));
    const { invalidateListings } = await import("../src/modules/store/listing-epoch");
    await invalidateListings();
  })();
  const groupListing = async (availability: "in_stock" | "out_of_stock") =>
    (await catalog.browseProducts({ brand: "GRUPTEST", availability })).items.map(row => row.id);

  test("'Stokta' lists a group whose primary is sold out by its stocked offer; the offer is never its own card", async () => {
    await groups();
    assert.deepEqual(await groupListing("in_stock"), [ids.grpPrimary]);
    assert.ok(!(await groupListing("out_of_stock")).includes(ids.grpOffer));
    // The primary's own row says "Stokta yok", but the card is sold through its offer (#1342).
    assert.ok(!(await groupListing("out_of_stock")).includes(ids.grpPrimary));
  });

  test("'Stokta yok' lists a group none of whose offers can be sold; an unknown-stock primary is in neither (#1342)", async () => {
    await groups();
    const [inStock, outOfStock] = [await groupListing("in_stock"), await groupListing("out_of_stock")];
    assert.ok(outOfStock.includes(ids.grpZeroPrimary) && !inStock.includes(ids.grpZeroPrimary));
    assert.ok(!outOfStock.includes(ids.grpUnknownPrimary) && !inStock.includes(ids.grpUnknownPrimary));
    // The sold-out offers are in the function's "Stokta yok" rows, but an offer is never its own card.
    assert.ok(!outOfStock.includes(ids.grpZeroOffer) && !outOfStock.includes(ids.grpUnknownOffer));
    const card = (await catalog.browseProducts({ brand: "GRUPTEST" })).items.find(row => row.id === ids.grpUnknownPrimary);
    assert.equal(card?.stock_label, "Stok bilgisi bulunamadı");
  });

  // A card is in at most one of "Stokta" and "Stokta yok"; unknown-stock and unsupplied cards are in neither (#1342).
  test("availability filters partition the listing (#1342)", async () => {
    await groups();
    const { invalidateListings } = await import("../src/modules/store/listing-epoch");
    await invalidateListings();
    for (const brand of ["AVTEST", "GRUPTEST"]) {
      const listing = (availability?: "in_stock" | "out_of_stock") => catalog.browseProducts({ brand, availability });
      const [all, inStock, outOfStock] = await Promise.all([listing(), listing("in_stock"), listing("out_of_stock")]);
      assert.ok(all.total > 0 && all.total === all.items.length, brand);
      const listedIds = (rows: CatalogProduct[]) => rows.map(row => row.id).sort();
      const outIds = new Set(listedIds(outOfStock.items));
      assert.deepEqual(listedIds(inStock.items).filter(id => outIds.has(id)), [], brand);
      const unknown = all.items.filter(row => !row.available && row.stock_label !== "Stokta yok").length;
      assert.equal(inStock.total + outOfStock.total + unknown, all.total, brand);
      assert.deepEqual(listedIds(outOfStock.items), listedIds(all.items.filter(row => !row.available && row.stock_label === "Stokta yok")), brand);
    }
  });

  // The planner read the view's "Stokta yok" set (expressions over jsonb) as ~155 rows for ~530k, and deep pages walked
  // the sorted listing through a nested loop over all of it (page 49: 48 s, #1286). The filter reads the same rows through
  // commerce_out_of_stock_ids, whose declared size only holds while the function is not inlined.
  test("out of stock lists the view's 'Stokta yok' rows through a sized, non-inlined function (#1286)", async () => {
    const companies = storefrontCompanies();
    const viewIds = async () => (await schema.pool.query<{ id: string }>(`SELECT id::text FROM commerce_item_availability
      WHERE (source='store' OR company=ANY($1::text[])) AND NOT available AND stock_label='Stokta yok' ORDER BY 1`, [companies])).rows.map(row => row.id);
    const functionIds = async () => (await schema.pool.query<{ id: string }>(
      "SELECT id::text FROM commerce_out_of_stock_ids($1::text[]) id ORDER BY 1", [companies])).rows.map(row => row.id);
    const mode = (await schema.pool.query<{ mode: string }>("SELECT basbug_checkout_mode AS mode FROM commerce_settings")).rows[0].mode;
    try {
      for (const checkout of ["live", "snapshot"]) {
        await schema.pool.query("UPDATE commerce_settings SET basbug_checkout_mode=$1", [checkout]);
        const expected = await viewIds();
        assert.ok(expected.includes(ids.avZero) && expected.includes(ids.avStoreEmpty), checkout);
        assert.deepEqual(await functionIds(), expected, checkout);
      }
    } finally {
      await schema.pool.query("UPDATE commerce_settings SET basbug_checkout_mode=$1", [mode]);
    }
    const plan = (await schema.pool.query<{ "QUERY PLAN": string }>("EXPLAIN SELECT id FROM commerce_out_of_stock_ids($1::text[]) id", [companies]))
      .rows.map(row => row["QUERY PLAN"]).join("\n");
    assert.match(plan, /Function Scan on commerce_out_of_stock_ids .*rows=500000/);
    // STABLE keeps the set on the calling statement's snapshot (a VOLATILE body could diverge from the outer scan).
    const { rows: [fn] } = await schema.pool.query<{ language: string; parallel: string; volatility: string }>(`SELECT l.lanname AS language,p.proparallel AS parallel,p.provolatile AS volatility
      FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.proname='commerce_out_of_stock_ids' AND p.pronamespace=current_schema()::regnamespace`);
    assert.deepEqual(fn, { language: "plpgsql", parallel: "r", volatility: "s" });
    const listed = (await catalog.browseProducts({ brand: "AVTEST", availability: "out_of_stock" })).items.map(row => row.id).sort();
    const shown = new Set((await schema.pool.query<{ id: string }>("SELECT id::text FROM storefront_catalog_entries WHERE display_brand='AVTEST'")).rows.map(row => row.id));
    assert.deepEqual(listed, (await viewIds()).filter(id => shown.has(id)));
    assert.ok(listed.includes(ids.avZero));
  });

  test("the availability clause does not scan commerce_catalog again", async () => {
    const source = await readFile("src/modules/store/stock-filter.ts", "utf8");
    const start = source.indexOf("export function stockClause("), end = source.indexOf("\n}", start);
    assert.ok(start >= 0 && end > start, "stockClause not found in stock-filter.ts");
    const body = source.slice(start, end);
    const stockFilter = await import("../src/modules/store/stock-filter"), { inStockIdsSql, stockClause } = stockFilter;
    const [inStock, outOfStock] = [stockClause("in_stock"), stockClause("out_of_stock")];
    assert.ok(inStock && outOfStock);
    assert.equal(inStock.clause, `catalog.id IN (${inStockIdsSql})`);
    // Out of stock goes through the sized function, never the view's expressions directly (#1286), and drops the cards in
    // stock through a grouped offer inside the function's subquery (#1342).
    assert.equal(outOfStock.clause, `catalog.id IN (SELECT id FROM commerce_out_of_stock_ids($1::text[]) id WHERE id NOT IN (${inStockIdsSql}))`);
    assert.doesNotMatch(outOfStock.clause, /stock_label='Stokta yok'/);
    // The NOT IN stays a hashed SubPlan only within work_mem: its reads ask for more than the session default (#1342).
    assert.match(outOfStock.workMem ?? "", /^\d+MB$/);
    assert.deepEqual([inStock.idSet, outOfStock.idSet], [false, false]);
    // Scoped (#1429): the bound ids' stock as one InitPlan array, never `catalog.id IN (…)` over it: out of stock then
    // planned nested loops (4-30 s). The array reaches the scoped ids through a one-row MATERIALIZED CTE (#1455), whose
    // WITH heads the whole statement (the UNION ALL in stock, the EXCEPT compound out of stock).
    const scope = { param: "$3::uuid[]", size: 10 };
    const clauses = [inStock.clause, outOfStock.clause];
    const fed = "((SELECT ids FROM scope)::uuid[])";
    for (const availability of ["in_stock", "out_of_stock"] as const) {
      const scoped = stockClause(availability, scope);
      assert.ok(scoped, availability);
      clauses.push(scoped.clause);
      assert.ok(scoped.clause.startsWith("catalog.id=ANY(ARRAY(") && scoped.clause.endsWith(")::uuid[])"), availability);
      assert.ok(scoped.clause.startsWith("catalog.id=ANY(ARRAY(WITH scope AS MATERIALIZED (SELECT $3::uuid[] AS ids) "), availability);
      assert.ok(scoped.clause.includes(`a.id=ANY(${fed})`) && scoped.clause.includes(`o.primary_id=ANY(${fed})`), availability);
      // The bound array is read once, by the CTE only.
      assert.equal(scoped.clause.split("$3::uuid[]").length - 1, 1, availability);
      const ids = availability === "in_stock" ? stockFilter.scopedInStockIdsSql(fed) : stockFilter.scopedOutOfStockIdsSql(fed);
      assert.equal(scoped.clause, `catalog.id=ANY(ARRAY(WITH scope AS MATERIALIZED (SELECT $3::uuid[] AS ids) ${ids})::uuid[])`, availability);
      assert.doesNotMatch(scoped.clause, /catalog\.id IN \(/, availability);
      assert.deepEqual([scoped.idSet, scoped.workMem], [true, undefined], availability);
    }
    assert.match(body, /catalog\.id=ANY\(ARRAY\(WITH scope AS MATERIALIZED \(SELECT \$\{scope\.param\} AS ids\) \$\{ids\}\)::uuid\[\]\)/);
    assert.doesNotMatch(body, /catalog\.id IN \(\$\{ids\}/);
    for (const clause of clauses) assert.doesNotMatch(clause, /commerce_catalog|storefront_catalog/);
    assert.match(source, /export const inStockIdsSql=`SELECT COALESCE\(o\.primary_id,a\.id\) FROM \(\$\{availabilitySql\}\) a /);
    assert.match(source, /export const availabilitySql = "SELECT \* FROM commerce_item_availability /);
    // catalog.ts keeps the public name and builds its availability clause here only.
    const catalogSource = await readFile("src/modules/store/catalog.ts", "utf8");
    assert.match(catalogSource, /export \{ availabilitySql \} from "\.\/stock-filter";/);
    assert.match(catalogSource, /const stock=stockClause\(query\.availability,/);
    assert.doesNotMatch(catalogSource, /commerce_out_of_stock_ids\(|inStockIdsSql/);
  });

  // The stock filter of a listing that binds a JS id array (search, category, model, garage vehicle, oils) reads those ids'
  // stock only (#1429). The oracle is the unscoped clause: over the same ids both must list the same cards, in both
  // checkout modes, for in and out of stock.
  describe("scoped stock filter (#1429)", () => {
    let stockFilter: typeof import("../src/modules/store/stock-filter");
    before(async () => {
      await groups();
      stockFilter = await import("../src/modules/store/stock-filter");
    });
    /** The listed cards of `scope` that `clause` keeps, read as catalogFilter's listing reads them, for `companies` (`$1`). */
    const listed = async (scope: string[], clause: string, companies = storefrontCompanies()) => (await schema.pool.query<{ id: string }>(
      `SELECT catalog.id::text AS id FROM (${catalog.catalogEntriesSql}) catalog WHERE ${catalog.listedOnly} AND catalog.id=ANY($2::uuid[]) AND ${clause} ORDER BY 1`,
      [companies, scope])).rows.map(row => row.id);
    const scoped = (availability: "in_stock" | "out_of_stock", size: number) => stockFilter.stockClause(availability, { param: "$2::uuid[]", size })!;

    test("lists the same cards as the whole stock set's clause over any id array", async () => {
      const { randomUUID } = await import("node:crypto");
      const scopes: Record<string, string[]> = {
        "all fixture ids": Object.values(ids),
        ...Object.fromEntries((["grp", "grpZero", "grpUnknown"] as const).flatMap(group => [
          [`${group} group`, [ids[`${group}Primary`], ids[`${group}Offer`]]], [`${group} primary alone`, [ids[`${group}Primary`]]]])),
        "a secondary offer alone": [ids.grpOffer],
        "store products": [ids.avStore, ids.avStoreEmpty],
        "a random uuid": [randomUUID()],
        "an empty array": [],
      };
      // The companies `$1` carries: the storefront's, and without Dinamik, whose offers then neither list nor sell a group.
      const companySets = { "all companies": storefrontCompanies(), "without Dinamik": storefrontCompanies().filter(company => company !== dinamik) };
      const mode = (await schema.pool.query<{ mode: string }>("SELECT basbug_checkout_mode AS mode FROM commerce_settings")).rows[0].mode;
      try {
        for (const checkout of ["live", "snapshot"]) {
          await schema.pool.query("UPDATE commerce_settings SET basbug_checkout_mode=$1", [checkout]);
          for (const availability of ["in_stock", "out_of_stock"] as const) {
            const whole = stockFilter.stockClause(availability)!;
            for (const [companiesName, companies] of Object.entries(companySets)) {
              for (const [name, scope] of Object.entries(scopes)) {
                const clause = scoped(availability, scope.length), label = `${checkout} ${availability} ${companiesName} ${name}`;
                assert.equal(clause.idSet, true, label);
                assert.deepEqual(await listed(scope, clause.clause, companies), await listed(scope, whole.clause, companies), label);
              }
            }
          }
          // Without Dinamik the group whose stocked offer is Dinamik's is sold out on both sides.
          const withoutDinamik = companySets["without Dinamik"];
          assert.deepEqual(await listed([ids.grpPrimary], scoped("out_of_stock", 1).clause, withoutDinamik), [ids.grpPrimary], checkout);
          assert.deepEqual(await listed([ids.grpPrimary], scoped("in_stock", 1).clause, withoutDinamik), [], checkout);
          // Not vacuous: both sides list cards, among them a primary sold only through its offer, which is never a card itself.
          const all = scopes["all fixture ids"];
          const [inStock, outOfStock] = [await listed(all, scoped("in_stock", all.length).clause), await listed(all, scoped("out_of_stock", all.length).clause)];
          assert.ok(inStock.includes(ids.grpPrimary) && inStock.includes(ids.avStore) && !inStock.includes(ids.grpOffer), checkout);
          assert.ok(outOfStock.includes(ids.grpZeroPrimary) && outOfStock.includes(ids.avZero) && outOfStock.includes(ids.avStoreEmpty), checkout);
          assert.ok(!outOfStock.includes(ids.grpPrimary) && !outOfStock.includes(ids.grpUnknownPrimary), checkout);
          assert.deepEqual(await listed([ids.grpPrimary], scoped("in_stock", 1).clause), [ids.grpPrimary], checkout);
        }
      } finally {
        await schema.pool.query("UPDATE commerce_settings SET basbug_checkout_mode=$1", [mode]);
      }
    });

    test("LISTING_STOCK_SCOPE_MAX_IDS bounds the scoped clause; 0 turns it off", async () => {
      const saved = process.env.LISTING_STOCK_SCOPE_MAX_IDS;
      const withMax = <T>(value: string | undefined, run: () => T) => {
        if (value === undefined) delete process.env.LISTING_STOCK_SCOPE_MAX_IDS;
        else process.env.LISTING_STOCK_SCOPE_MAX_IDS = value;
        try {
          return run();
        } finally {
          if (saved === undefined) delete process.env.LISTING_STOCK_SCOPE_MAX_IDS;
          else process.env.LISTING_STOCK_SCOPE_MAX_IDS = saved;
        }
      };
      const { stockScopeMaxIds, defaultStockScopeMaxIds, stockClause } = stockFilter;
      assert.equal(defaultStockScopeMaxIds, 30_000);
      for (const [value, expected] of [[undefined, 30_000], ["", 30_000], [" ", 30_000], ["0", 0], ["abc", 30_000], ["-5", 30_000], ["1.5", 30_000],
        ["12000", 12_000], ["50000", 50_000], ["999999", 50_000]] as const)
        assert.equal(withMax(value, stockScopeMaxIds), expected, `LISTING_STOCK_SCOPE_MAX_IDS=${value}`);
      // The ceiling is pricedByIdsMax: a scoped listing has at most that many rows, so a price order prices it by its ids.
      assert.match(await readFile("src/modules/store/catalog.ts", "utf8"), /const pricedByIdsMax=50_000;/);
      const scope = (size: number) => ({ param: "$2::uuid[]", size });
      for (const availability of ["in_stock", "out_of_stock"] as const) {
        const whole = stockClause(availability);
        assert.equal(withMax(undefined, () => stockClause(availability, scope(30_000)))?.idSet, true, availability);
        assert.equal(withMax("100", () => stockClause(availability, scope(100)))?.idSet, true, availability);
        // One id over the limit, the setting 0 (an empty array too) or no bound array: the whole set's clause, as before.
        for (const [value, size] of [[undefined, 30_001], ["100", 101], ["999999", 50_001], ["0", 5], ["0", 0]] as const)
          assert.deepEqual(withMax(value, () => stockClause(availability, scope(size))), whole, `${availability} ${value} ${size}`);
      }
      assert.equal(withMax(undefined, () => stockClause("out_of_stock", scope(30_001)))?.workMem, "32MB");
      assert.deepEqual(stockClause("supplied", scope(1)), { clause: "NOT catalog.unavailable", idSet: false });
      assert.equal(stockClause(undefined, scope(1)), undefined);
      // A brand's, manufacturer's or make's prefetched scope (#1455): the setting's limit, in stock at most 20,000 (its count
      // lost to the whole set's in the 20-30k band); none without a stock filter or with the setting at 0.
      const { prefetchedStockScopeMaxIds } = stockFilter;
      for (const [value, inStock, outOfStock] of [[undefined, 20_000, 30_000], ["12000", 12_000, 12_000], ["25000", 20_000, 25_000],
        ["999999", 20_000, 50_000], ["0", 0, 0]] as const) {
        assert.equal(withMax(value, () => prefetchedStockScopeMaxIds("in_stock")), inStock, `in_stock ${value}`);
        assert.equal(withMax(value, () => prefetchedStockScopeMaxIds("out_of_stock")), outOfStock, `out_of_stock ${value}`);
        for (const availability of ["supplied", undefined] as const) assert.equal(withMax(value, () => prefetchedStockScopeMaxIds(availability)), 0, `${availability} ${value}`);
      }
      // catalogFilter reads its prefetched scopes up to that limit, and only when it is above 0.
      const catalogSource = await readFile("src/modules/store/catalog.ts", "utf8");
      assert.match(catalogSource, /prefetchMax=prefetchedStockScopeMaxIds\(query\.availability\);\n if\(prefetchMax>0&&/);
      assert.match(catalogSource, /stockScope\(source,prefetchMax\)/);
    });

    // Brand and manufacturer listings bind no JS id array: a stock filter reads their listed ids first (the stock scope,
    // cached) and then those ids' stock only (#1455). The oracle is the whole stock set's clause (LISTING_STOCK_SCOPE_MAX_IDS=0),
    // each side read by a fresh process (its own caches), in both checkout modes.
    describe("stock scopes of brand and manufacturer listings (#1455)", () => {
      type Catalog = typeof import("../src/modules/store/catalog");
      let processes = 0;
      /** Another app process: a second copy of the catalog module, with its own process caches, on the same database. */
      const otherProcess = async () => await import(`../src/modules/store/catalog.ts?brand-stock-scope-${++processes}`) as Catalog;
      /** The text of every statement `run` sends, on any connection. */
      async function sentTexts(run: () => Promise<unknown>) {
        const texts: string[] = [];
        const original = pg.Client.prototype.query;
        pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
          const config = args[0];
          texts.push(typeof config === "string" ? config : (config as { text?: string } | undefined)?.text ?? "");
          return (original as (...rest: unknown[]) => unknown).apply(this, args);
        } as typeof original;
        try {
          await run();
        } finally {
          pg.Client.prototype.query = original;
        }
        return texts;
      }
      /** The listing read by a fresh process under LISTING_STOCK_SCOPE_MAX_IDS=`max` (undefined: unset), and the statements it sent. */
      async function listing(max: string | undefined, query: CatalogQuery) {
        const saved = process.env.LISTING_STOCK_SCOPE_MAX_IDS;
        if (max === undefined) delete process.env.LISTING_STOCK_SCOPE_MAX_IDS;
        else process.env.LISTING_STOCK_SCOPE_MAX_IDS = max;
        try {
          const fresh = await otherProcess();
          let listed: Awaited<ReturnType<Catalog["browseProducts"]>> | undefined;
          const texts = await sentTexts(async () => { listed = await fresh.browseProducts(query); });
          assert.ok(listed);
          return { listed: { ids: listed.items.map(row => row.id), total: listed.total, page: listed.page, pages: listed.pages }, texts };
        } finally {
          if (saved === undefined) delete process.env.LISTING_STOCK_SCOPE_MAX_IDS;
          else process.env.LISTING_STOCK_SCOPE_MAX_IDS = saved;
        }
      }
      const scopedMarker = "catalog.id=ANY(ARRAY(WITH scope AS MATERIALIZED";
      /** A statement over the priced view (storefront_catalog), not the lean entries or the availability view. */
      const priced = (text: string) => /FROM storefront_catalog WHERE/.test(text);
      const wholeClause = (availability: "in_stock" | "out_of_stock") =>
        availability === "in_stock" ? "catalog.id IN (SELECT COALESCE(o.primary_id,a.id)" : "commerce_out_of_stock_ids(";
      before(async () => {
        await groups();
        // AVTEST as a master brand of its own name, its rows keeping their shown brand: the manufacturer page /marka/avtest.
        // The matching refresh may have created the brand already (#470).
        await schema.pool.query("INSERT INTO brands(key,name) VALUES('AVTEST','AVTEST') ON CONFLICT (key) DO NOTHING");
        await schema.pool.query(`INSERT INTO supplier_brands(supplier,label,brand_id,items) SELECT supplier,'AVTEST',b.id,3
          FROM brands b CROSS JOIN unnest(ARRAY['basbug','dinamik']) supplier WHERE b.key='AVTEST' ON CONFLICT (supplier,label) DO NOTHING`);
        const { invalidateListings } = await import("../src/modules/store/listing-epoch");
        await invalidateListings();
      });

      test("lists the same cards, order, totals and pages scoped and over the whole stock set", async () => {
        const mode = (await schema.pool.query<{ mode: string }>("SELECT basbug_checkout_mode AS mode FROM commerce_settings")).rows[0].mode;
        const queries: Record<string, CatalogQuery> = {
          "brand AVTEST": { brand: "AVTEST" }, "brand GRUPTEST": { brand: "GRUPTEST" }, "brands AVTEST+GRUPTEST": { brands: '["AVTEST","GRUPTEST"]' },
          "manufacturer avtest": { manufacturer: "avtest" }, "manufacturer avtest + brand GRUPTEST": { manufacturer: "avtest", brand: "GRUPTEST" },
        };
        try {
          for (const checkout of ["live", "snapshot"]) {
            await schema.pool.query("UPDATE commerce_settings SET basbug_checkout_mode=$1", [checkout]);
            const totals: Record<string, number> = {};
            for (const [name, base] of Object.entries(queries)) {
              for (const availability of ["in_stock", "out_of_stock"] as const) {
                for (const sort of [undefined, "price-asc", "price-desc"] as const) {
                  const label = `${checkout} ${name} ${availability} ${sort ?? "newest"}`, query = { ...base, availability, sort };
                  const scoped = await listing(undefined, query), whole = await listing("0", query);
                  assert.deepEqual(scoped.listed, whole.listed, label);
                  totals[`${name} ${availability}`] = scoped.listed.total;
                  // The scope's listed ids are read first (one array literal), then the scoped clause; 0 reads neither.
                  assert.ok(scoped.texts.some(text => text.includes("array_agg(id)::text") && text.includes(") scope")), label);
                  assert.ok(scoped.texts.some(text => text.includes(scopedMarker)), label);
                  assert.ok(!scoped.texts.some(text => text.includes(wholeClause(availability))), label);
                  assert.ok(whole.texts.some(text => text.includes(wholeClause(availability))), label);
                  assert.ok(!whole.texts.some(text => text.includes("scope AS MATERIALIZED") || text.includes(") scope")), label);
                  // A statement pricing the view never reads the scoped clause: a price order reads the listing's ids first.
                  assert.ok(!scoped.texts.some(text => priced(text) && text.includes("scope AS MATERIALIZED")), label);
                  if (sort) assert.ok(scoped.texts.some(text => text.includes("array_agg(catalog.id)") && text.includes(scopedMarker)), label);
                }
              }
            }
            // Not vacuous: both stock filters list cards of both brands; the manufacturer page lists its brand's.
            for (const name of ["brand AVTEST", "brand GRUPTEST", "manufacturer avtest"])
              for (const availability of ["in_stock", "out_of_stock"]) assert.ok(totals[`${name} ${availability}`] > 0, `${checkout} ${name} ${availability}`);
            assert.equal(totals["brands AVTEST+GRUPTEST in_stock"], totals["brand AVTEST in_stock"] + totals["brand GRUPTEST in_stock"], checkout);
            assert.equal(totals["manufacturer avtest in_stock"], totals["brand AVTEST in_stock"], checkout);
            assert.equal(totals["manufacturer avtest + brand GRUPTEST in_stock"], 0, checkout);
          }
        } finally {
          await schema.pool.query("UPDATE commerce_settings SET basbug_checkout_mode=$1", [mode]);
        }
      });

      // A scope is never used older than its 10-minute TTL (maxServeMs): a request past it waits for the reload instead of
      // getting the old scope while a background refresh runs, so a row that joined the brand since (no counter moved) is
      // listed. Read through stockListingStatements: the scope cache alone, no listing cache. The mocked clock moves its age.
      test("a scope older than its TTL is read again before it is used", async t => {
        t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
        const fresh = await otherProcess(), query: CatalogQuery = { brand: "SCOPETEST", availability: "in_stock" };
        const counted = async () => {
          const statements = await fresh.stockListingStatements(query, 1);
          assert.ok(statements.count.text.includes(scopedMarker) && statements.scopes.length === 1);
          return Number((await schema.pool.query<{ count: string }>(statements.count.text, statements.count.values)).rows[0].count);
        };
        await item("scopeFirst", { supplier: "basbug", code: "SCP 0001", brand: "SCOPETEST", stock: 2 });
        try {
          assert.equal(await counted(), 1);
          await item("scopeJoined", { supplier: "basbug", code: "SCP 0002", brand: "SCOPETEST", stock: 2 });
          // Within the TTL the cached scope lacks the joined row (the documented bound): the whole set's clause lists it.
          t.mock.timers.tick(10 * 60 * 1000 - 1);
          assert.equal(await counted(), 1, "within the TTL");
          t.mock.timers.tick(2);
          assert.equal(await counted(), 2, "past the TTL the scope is read again before it is used");
        } finally {
          await schema.pool.query("DELETE FROM supplier_items WHERE id=ANY($1::uuid[])", [[ids.scopeFirst, ids.scopeJoined].filter(Boolean)]);
        }
      });

      test("a scope over LISTING_STOCK_SCOPE_MAX_IDS reads the whole stock set", async () => {
        for (const availability of ["in_stock", "out_of_stock"] as const) {
          // AVTEST lists more than one card: over a limit of 1 its scope read stops at two rows and binds nothing.
          const query = { brand: "AVTEST", availability }, over = await listing("1", query), whole = await listing("0", query);
          assert.deepEqual(over.listed, whole.listed, availability);
          assert.ok(over.texts.some(text => text.includes(") scope") && text.includes("LIMIT 2")), availability);
          assert.ok(!over.texts.some(text => text.includes("scope AS MATERIALIZED")), availability);
          assert.ok(over.texts.some(text => text.includes(wholeClause(availability))), availability);
        }
        // NGK lists one card, in stock: within a limit of 1 its scope is bound.
        const ngk = await listing("1", { brand: "NGK", availability: "in_stock" });
        assert.deepEqual(ngk.listed.ids, [ids.ngk]);
        assert.ok(ngk.texts.some(text => text.includes(scopedMarker)));
      });
    });
  });
});

// commerce_catalog is the store products UNION ALL commerce_supplier_catalog (#1424). The one view before held both a WITH
// and the UNION ALL: the planner could neither flatten it nor drop its unused columns, and built every column of every
// supplier row (pricing_snapshot's jsonb, stock labels, names) for a price order reading three. The body before the split,
// frozen in scripts/fixtures/commerce-catalog-pre-1424.sql, is the oracle: the same rows, and the same listings when the
// unchanged storefront_catalog reads it.
describe("split catalog views (#1424)", () => {
  const preSplitBody = () => readFile("scripts/fixtures/commerce-catalog-pre-1424.sql", "utf8");
  let invalidateListings: () => Promise<void>;
  let order = 0;
  type SplitRow = { supplier?: "basbug" | "dinamik"; stock?: Record<string, number> | null; cost?: number; currency?: string; category?: string;
    seenHoursAgo?: number; presence?: "present" | "inactive" };
  /** A SPLITTEST row; each later row is older (changed_at), so the newest order is fixed. */
  async function splitRow(key: string, { supplier = "basbug", stock = { stok: 2 }, cost = 100, currency = "TL", category = "", seenHoursAgo = 1,
    presence = "present" }: SplitRow = {}) {
    const product = { uk: "SPLITTEST", ac: `${key} PARCA`, dc: currency, ...(category ? { category } : {}),
      ...(supplier === "dinamik" ? { marka: "SPLITTEST", stokAdi: `${key} PARCA` } : {}) };
    const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
      product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
      VALUES($1,$2,'SPLIT',$3,$4,$5,$6,$7,1,1,1,false,$8,now()-interval '10 days',now()-make_interval(hours=>$9),now()-make_interval(mins=>$10))
      RETURNING id::text`, [supplier, supplier === "basbug" ? basbug : dinamik, supplier === "basbug" ? "MRK" : "ALL", `SPLITTEST ${key.toUpperCase()}`,
      product, { nf: cost }, stock, presence, seenHoursAgo, ++order]);
    ids[key] = rows[0].id;
  }
  const setMode = (mode: string) => schema.pool.query("UPDATE commerce_settings SET basbug_checkout_mode=$1", [mode]);
  /** `run` in both checkout modes, the stored mode restored afterwards. */
  async function inBothModes(run: (mode: string) => Promise<void>) {
    const saved = (await schema.pool.query<{ mode: string }>("SELECT basbug_checkout_mode AS mode FROM commerce_settings")).rows[0].mode;
    try {
      for (const mode of ["live", "snapshot"]) {
        await setMode(mode);
        await run(mode);
      }
    } finally {
      await setMode(saved);
    }
  }
  /** `run` while commerce_catalog has its pre-split body (storefront_catalog, unchanged, reads it), the split body restored afterwards. */
  async function withPreSplitCatalog<T>(run: () => Promise<T>) {
    const { rows: [{ def }] } = await schema.pool.query<{ def: string }>("SELECT pg_get_viewdef('commerce_catalog'::regclass) AS def");
    await schema.pool.query(`CREATE OR REPLACE VIEW commerce_catalog AS ${await preSplitBody()}`);
    try {
      await invalidateListings();
      return await run();
    } finally {
      await schema.pool.query(`CREATE OR REPLACE VIEW commerce_catalog AS ${def}`);
      await invalidateListings();
    }
  }
  const plan = async (sql: string, values: unknown[] = []) => (await schema.pool.query<{ "QUERY PLAN": string }>(`EXPLAIN (VERBOSE, COSTS OFF) ${sql}`, values))
    .rows.map(row => row["QUERY PLAN"]).join("\n");

  // After invalidateListings() the listing counts, page ids and facets serve their earlier value once a reload takes longer
  // than LISTING_EPOCH_WAIT_MS (listing-wait.ts; 250 ms by default). On a slow runner the pre-split reads below would then
  // repeat the split ones, and the stock change would not show: every reload here is awaited, whatever the environment sets.
  let savedWait: string | undefined;
  before(() => {
    savedWait = process.env.LISTING_EPOCH_WAIT_MS;
    process.env.LISTING_EPOCH_WAIT_MS = "600000";
  });
  after(() => {
    if (savedWait === undefined) delete process.env.LISTING_EPOCH_WAIT_MS;
    else process.env.LISTING_EPOCH_WAIT_MS = savedWait;
  });

  before(async () => {
    invalidateListings = (await import("../src/modules/store/listing-epoch")).invalidateListings;
    await schema.pool.query(`CREATE VIEW commerce_catalog_pre1424 AS ${await preSplitBody()}`);
    // Categories 3 Yedek parçalar > 252 Fren: the legacy "fren" category of store products and supplier rows.
    await schema.pool.query(`INSERT INTO source_categories(source,category_id,parent_id,name,slug,path_ids,source_url,raw) VALUES
      ('trodo',3,NULL,'Yedek parçalar','yedek-parca','{3}','','{}'),('trodo',252,3,'Fren','fren','{3,252}','','{}');
      INSERT INTO source_category_labels(source,category_id,locale,name,slug) VALUES
      ('trodo',3,'tr','Yedek parçalar','yedek-parca'),('trodo',252,'tr','Fren','fren')`);
    // A master brand with a manufacturer page (/marka/splittest).
    const brand = (await schema.pool.query<{ id: string }>("INSERT INTO brands(key,name) VALUES('SPLITTEST','SPLITTEST') RETURNING id::text")).rows[0].id;
    await schema.pool.query("INSERT INTO supplier_brands(supplier,label,brand_id,items) VALUES('basbug','SPLITTEST',$1,12),('dinamik','SPLITTEST',$1,1)", [brand]);
    // Rates: Başbuğ's newest succeeded import (EUR 50, fresh) and Dinamik's (USD 30, older than max_age_hours: a stale rate).
    await schema.pool.query(`INSERT INTO supplier_imports(supplier,company,list_group,warehouse,started_at,completed_at,observations,quality,groups_data,currencies_data,status)
      VALUES('basbug',$1,'SPLIT','MRK',now()-interval '50 minutes',now()-interval '50 minutes','{}','{}','{}','{"dovizListesi":[{"dovizCinsi":"EUR","satis":50}]}','succeeded'),
       ('dinamik',$2,'SPLIT','ALL',now()-interval '200 hours',now()-interval '200 hours','{}','{}','{}','{"dovizListesi":[{"dovizCinsi":"USD","satis":30}]}','succeeded')`,
    [basbug, dinamik]);
    await splitRow("spCheap", { cost: 10, category: "fren" });
    await splitRow("spTieA", { cost: 20 });
    await splitRow("spTieB", { cost: 20, category: "fren" });
    await splitRow("spFixed", { cost: 50 });
    await splitRow("spCampaign", { cost: 60, category: "fren" });
    await splitRow("spAnomaly", { cost: 40 });
    await splitRow("spEur", { cost: 2, currency: "EUR" });
    await splitRow("spStaleRate", { supplier: "dinamik", cost: 3, currency: "USD" });
    await splitRow("spSoldOut", { cost: 30, stock: { stok: 0 }, category: "fren" });
    await splitRow("spOtherDepot", { cost: 35, stock: { stok: 0, sFarkliDepo: 2 } });
    await splitRow("spStaleSeen", { cost: 45, seenHoursAgo: 100 });
    await splitRow("spHidden", { cost: 15 });
    await splitRow("spGone", { cost: 25, stock: { stok: 0 }, presence: "inactive", category: "fren" });
    // Matching first: its sync of product edits drops item overrides no product override backs (db/product-overrides.sql).
    await schema.pool.query("SELECT refresh_product_matches()");
    await schema.pool.query("INSERT INTO commerce_item_overrides(supplier_item_id,product_id,price_kurus) VALUES($1,$1,1234)", [ids.spFixed]);
    await schema.pool.query(`INSERT INTO commerce_item_overrides(supplier_item_id,product_id,sale_price_kurus,sale_from,sale_until)
      VALUES($1,$1,999,now()-interval '1 day',now()+interval '1 day')`, [ids.spCampaign]);
    await schema.pool.query("INSERT INTO commerce_item_overrides(supplier_item_id,product_id,hidden) VALUES($1,$1,true)", [ids.spHidden]);
    await schema.pool.query("INSERT INTO supplier_price_anomalies(supplier_item_id,supplier,evidence) VALUES($1,'basbug','{}')", [ids.spAnomaly]);
    const store = await schema.pool.query<{ id: string }>(`INSERT INTO store_products(supplier,code,name,brand,price_kurus,stock,category)
      VALUES('demo','SPLIT-STORE-1','Depo ürünü','SPLITTEST',5000,3,'fren'),('demo','SPLIT-STORE-0','Depo ürünü','SPLITTEST',4000,0,'') RETURNING id::text`);
    [ids.spStore, ids.spStoreEmpty] = store.rows.map(row => row.id);
    await invalidateListings();
  });

  test("the split views return the pre-split rows and columns in both checkout modes", async () => {
    const columns = async (view: string) => (await schema.pool.query(`SELECT attname AS name,format_type(atttypid,atttypmod) AS type,
      attcollation::regcollation::text AS collation FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum`, [view])).rows;
    const catalogColumns = await columns("commerce_catalog");
    assert.equal(catalogColumns.length, 21);
    assert.deepEqual(catalogColumns, await columns("commerce_catalog_pre1424"));
    // The inner view carries commerce_catalog's columns, names, order and types alike (db/commerce.sql).
    assert.deepEqual(await columns("commerce_supplier_catalog"), catalogColumns);
    const difference = async (from: string, minus: string) => (await schema.pool.query<{ id: string }>(
      `SELECT id::text FROM (SELECT * FROM ${from} EXCEPT ALL SELECT * FROM ${minus}) d`)).rows.map(row => row.id);
    const row = async (key: string) => (await schema.pool.query<{ price_kurus: number | null; pricing_snapshot: Record<string, unknown> }>(
      "SELECT price_kurus,pricing_snapshot FROM commerce_catalog WHERE id=$1", [ids[key]])).rows[0];
    await inBothModes(async mode => {
      assert.deepEqual(await difference("commerce_catalog", "commerce_catalog_pre1424"), [], mode);
      assert.deepEqual(await difference("commerce_catalog_pre1424", "commerce_catalog"), [], mode);
      // The fixture reaches each pricing case: fixed price, campaign, open anomaly, another currency, a stale rate, hidden, store.
      assert.equal((await row("spFixed")).price_kurus, 1234, mode);
      assert.equal((await row("spFixed")).pricing_snapshot.price_kind, "fixed", mode);
      assert.equal((await row("spCampaign")).price_kurus, 999, mode);
      assert.equal((await row("spCampaign")).pricing_snapshot.price_kind, "sale", mode);
      assert.equal((await row("spAnomaly")).price_kurus, null, mode);
      assert.equal(Number((await row("spEur")).pricing_snapshot.exchange_rate), 50, mode);
      assert.equal((await row("spStaleRate")).price_kurus === null, mode === "live", mode);
      assert.equal(await row("spHidden"), undefined, mode);
      assert.deepEqual((await row("spStore")).pricing_snapshot, { source: "store", base_price_kurus: 5000 }, mode);
    });
  });

  test("a price order's read builds only the columns it sorts by (#1424)", async () => {
    const priced = "SELECT id,unavailable,price_kurus FROM storefront_catalog";
    const pricedPlan = await plan(priced);
    // No pricing_snapshot (jsonb_build_object), no stock label, and the catalog is not one subquery scan over its UNION ALL.
    assert.doesNotMatch(pricedPlan, /jsonb_build_object/);
    assert.doesNotMatch(pricedPlan, /Stok bilgisi güncelleniyor/);
    assert.doesNotMatch(pricedPlan, /Subquery Scan on c\b/);
    // A row read still builds every column.
    const rowPlan = await plan("SELECT * FROM storefront_catalog WHERE id=$1", [ids.spCheap]);
    assert.match(rowPlan, /jsonb_build_object/);
    assert.match(rowPlan, /Stok bilgisi güncelleniyor/);
    // What the check guards against: the pre-split body built them for the price order too.
    await withPreSplitCatalog(async () => {
      const old = await plan(priced);
      assert.match(old, /Subquery Scan on c\b/);
      assert.match(old, /jsonb_build_object/);
      assert.match(old, /Stok bilgisi güncelleniyor/);
    });
  });

  test("listings show the pre-split ids, order, cards, counts and facets (#1424)", async () => {
    const scopes: Record<string, CatalogQuery> = { none: {}, category: { category: "fren" }, brand: { brand: "SPLITTEST" },
      manufacturer: { manufacturer: "splittest" }, "category+brand": { category: "fren", brand: "SPLITTEST" } };
    const availabilities = [undefined, "in_stock", "supplied", "out_of_stock"] as const;
    const sorts = [undefined, "price-asc", "price-desc"] as const;
    /** Every page's cards (up to five pages) and the total of each case, and each scope's facets. */
    const readAll = async () => {
      const read = new Map<string, unknown>();
      for (const [name, scope] of Object.entries(scopes)) {
        read.set(`${name} facets`, await inRequest(() => catalog.catalogFacets(scope)));
        for (const availability of availabilities) for (const sort of sorts) {
          const query: CatalogQuery = { ...scope, ...availability && { availability }, ...sort && { sort } };
          const first = await inRequest(() => catalog.browseProducts(query));
          const items = [...first.items];
          for (let page = 2; page <= Math.min(first.pages, 5); page++)
            items.push(...(await inRequest(() => catalog.browseProducts({ ...query, page: String(page) }))).items);
          read.set(JSON.stringify(query), { total: first.total, items });
        }
      }
      return read;
    };
    await invalidateListings();
    const split = await readAll();
    const preSplit = await withPreSplitCatalog(readAll);
    assert.equal(split.size, 65);
    for (const [key, value] of split) assert.deepEqual(value, preSplit.get(key), key);
    // Not two empty answers: the brand's price order, the manufacturer's facet and the category scope.
    const listed = (query: CatalogQuery) => split.get(JSON.stringify(query)) as { total: number; items: CatalogProduct[] };
    const ascending = listed({ brand: "SPLITTEST", sort: "price-asc" });
    assert.equal(ascending.total, 14);
    // The campaign (999) and the fixed price (1234) under the formula's cheapest (10 TL: 1560), the tie in id order.
    assert.deepEqual(ascending.items.slice(0, 5).map(row => row.id), [ids.spCampaign, ids.spFixed, ids.spCheap, ...[ids.spTieA, ids.spTieB].sort()]);
    assert.deepEqual(ascending.items.slice(0, 3).map(row => row.price_kurus), [999, 1234, 1560]);
    // Unpriced rows (open anomaly, stale observation, stale rate) after the priced ones, the unavailable card last.
    assert.deepEqual(ascending.items.slice(-4).map(row => row.id), [...[ids.spAnomaly, ids.spStaleSeen, ids.spStaleRate].sort(), ids.spGone]);
    assert.ok(!ascending.items.some(row => row.id === ids.spHidden));
    assert.deepEqual((split.get("manufacturer facets") as { brands: string[] }).brands, ["SPLITTEST"]);
    assert.equal(listed({ manufacturer: "splittest", sort: "price-desc" }).total, ascending.total);
    assert.deepEqual(new Set(listed({ category: "fren", brand: "SPLITTEST", availability: "in_stock", sort: "price-asc" }).items.map(row => row.id)),
      new Set([ids.spCheap, ids.spTieB, ids.spCampaign, ids.spStore]));
  });

  test("a stock change shows in the next price-sorted listing read after the caches are reset (#1424)", async () => {
    const listing = (availability: "in_stock" | "out_of_stock") => inRequest(() => catalog.browseProducts({ brand: "SPLITTEST", availability, sort: "price-asc" }));
    const listedIds = (rows: CatalogProduct[]) => rows.map(row => row.id);
    const [inBefore, outBefore] = [await listing("in_stock"), await listing("out_of_stock")];
    for (const key of ["spCheap", "spStore"]) {
      assert.ok(listedIds(inBefore.items).includes(ids[key]) && !listedIds(outBefore.items).includes(ids[key]), key);
    }
    try {
      await schema.pool.query(`UPDATE supplier_items SET stock_data='{"stok":0}' WHERE id=$1`, [ids.spCheap]);
      await schema.pool.query("UPDATE store_products SET stock=0 WHERE id=$1", [ids.spStore]);
      await invalidateListings();
      const [inAfter, outAfter] = [await listing("in_stock"), await listing("out_of_stock")];
      for (const key of ["spCheap", "spStore"]) {
        assert.ok(!listedIds(inAfter.items).includes(ids[key]), key);
        const card = outAfter.items.find(row => row.id === ids[key]);
        assert.equal(card?.stock_label, "Stokta yok", key);
        assert.equal(card?.available, false, key);
      }
      assert.equal(inAfter.total, inBefore.total - 2);
      assert.equal(outAfter.total, outBefore.total + 2);
    } finally {
      await schema.pool.query(`UPDATE supplier_items SET stock_data='{"stok":2}' WHERE id=$1`, [ids.spCheap]);
      await schema.pool.query("UPDATE store_products SET stock=3 WHERE id=$1", [ids.spStore]);
      await invalidateListings();
    }
  });
});
