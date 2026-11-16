import assert from "node:assert/strict";
import { after, before, test } from "node:test";
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
