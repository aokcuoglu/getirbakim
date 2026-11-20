import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";

// Products no supplier sells now (#475) in an isolated copy of the schema: db/storefront-catalog.sql and the store
// catalog reading it. Nothing is written to the shared database's tables.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let catalog: typeof import("../src/modules/store/catalog");
let closeDb: () => Promise<void>;
const ids: Record<string, string> = {};
const [basbug, , dinamik] = storefrontCompanies();

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
    assert.equal(await refresh(), 1);
    assert.equal((await schema.pool.query("SELECT 1 FROM storefront_price_only_items WHERE supplier_item_id=$1", [ids.qualifying])).rowCount, 0);
  });
});
