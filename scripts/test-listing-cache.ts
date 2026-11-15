import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { staleCache } from "../src/lib/stale-cache";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";

// Storefront listing caches and the listing epoch (#585) in an isolated copy of the schema: an admin edit bumps the
// epoch and the cached counts, category ids and plain searches reload; without a bump they keep serving the old value.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let catalog: typeof import("../src/modules/store/catalog");
let overrides: typeof import("../src/modules/admin/product-override-store");
let references: typeof import("../src/modules/admin/product-reference-store");
let epoch: typeof import("../src/modules/store/listing-epoch");
let closeDb: () => Promise<void>;
const ids: Record<string, string> = {};
const [basbug] = storefrontCompanies();
let admin: string;

async function item(key: string, code: string, brand: string, name: string) {
  const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
    VALUES('basbug',$1,'G','MRK',$2,$3,'{"nf":100}','{"stok":2}',1,1,1,false,'present',now()-interval '10 days',now()-interval '1 hour',now()-interval '1 hour') RETURNING id::text`,
  [basbug, code, { uk: brand, ac: name, ac2: "", dc: "TL" }]);
  ids[key] = rows[0].id;
}
const productOf = async (key: string) => (await schema.pool.query<{ product_id: string }>(
  "SELECT product_id::text FROM product_sources WHERE supplier_item_id=$1", [ids[key]])).rows[0].product_id;
const newestTotal = async () => (await catalog.browseProducts({ sort: "newest" })).total;

before(async () => {
  schema = await isolatedSchema("listing_cache_test");
  await item("mahle", "MAH 20020", "MAHLE", "MAHLE YAG FILTRESI");
  await item("ngk", "NGK 30030", "NGK", "NGK BUJI");
  await item("skf", "SKF 40040", "SKF", "SKF RULMAN");
  await item("sachs", "SACHS 50050", "SACHS", "SACHS AMORTISOR");
  await schema.pool.query("SELECT refresh_product_matches()");
  admin = (await schema.pool.query<{ id: string }>(`INSERT INTO accounts(name,email,password_hash,role,approved)
    VALUES('Test Yönetici',$1,'x','admin',true) RETURNING id::text`, [`${randomUUID()}@example.com`])).rows[0].id;
  await schema.pool.query(`INSERT INTO source_categories(source,category_id,parent_id,name,slug,path_ids,source_url,raw)
    VALUES('trodo',200,NULL,'Rulmanlar','rulmanlar','{200}','','{}')`);
  const [{ db }, catalogModule, overridesModule, referencesModule, epochModule] = await Promise.all([import("../src/lib/db"),
    import("../src/modules/store/catalog"), import("../src/modules/admin/product-override-store"),
    import("../src/modules/admin/product-reference-store"), import("../src/modules/store/listing-epoch")]);
  catalog = catalogModule;
  overrides = overridesModule;
  references = referencesModule;
  epoch = epochModule;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

test("without an epoch the cache serves stale values and refreshes in the background", async () => {
  const cache = staleCache<number>(20);
  let loads = 0;
  const load = async () => ++loads;
  assert.equal(await cache("k", load), 1);
  assert.equal(await cache("k", load), 1);
  await sleep(30);
  // Past the TTL the old value is served while one refresh runs.
  assert.equal(await cache("k", load), 1);
  await sleep(5);
  assert.equal(await cache("k", load), 2);
  assert.equal(loads, 2);
});

test("an epoch change makes callers wait for one shared reload; a failed reload serves the old value", async () => {
  let current = 0, loads = 0;
  const cache = staleCache<string>(60_000, 500, { epoch: async () => current });
  const load = async () => `v${++loads}`;
  assert.equal(await cache("k", load), "v1");
  assert.equal(await cache("k", load), "v1", "same epoch is a hit");
  current = 1;
  const [a, b] = await Promise.all([cache("k", load), cache("k", load)]);
  assert.deepEqual([a, b], ["v2", "v2"], "concurrent callers share the reload");
  assert.equal(loads, 2);
  current = 2;
  const failing = async (): Promise<string> => { throw new Error("database down"); };
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(await cache("k", failing), "v2", "a failed reload serves the previous value");
  } finally { console.error = originalError; }
  assert.equal(await cache("k", load), "v3", "the next request tries again");
  assert.equal(await cache("k", load), "v3");
});

test("hiding a product leaves the cached listing until the epoch is bumped", async () => {
  const total = await newestTotal();
  assert.ok(total >= 4);
  const saved = await overrides.persistProductOverride(schema.pool, await productOf("ngk"), { hidden: true }, admin);
  assert.ok(saved.ok && saved.changed.includes("hidden"));
  assert.equal(await newestTotal(), total, "no bump: the cached count is served");
  await epoch.invalidateListings();
  assert.equal(await newestTotal(), total - 1);
});

test("a category edit and an added reference reach the cached category ids and code search after a bump", async () => {
  assert.deepEqual(await catalog.categoryProductIds([], [200]), []);
  const saved = await overrides.persistProductOverride(schema.pool, await productOf("skf"), { category_id: 200 }, admin);
  assert.ok(saved.ok && saved.changed.includes("category_id"));
  assert.deepEqual(await catalog.categoryProductIds([], [200]), [], "no bump: the cached ids are served");
  await epoch.invalidateListings();
  assert.deepEqual(await catalog.categoryProductIds([], [200]), [ids.skf]);

  const search = async () => (await catalog.browseProducts({ q: "5Q0615301", searchBy: "code" })).items.map(row => row.id);
  assert.deepEqual(await search(), []);
  const added = await references.addProductReference(schema.pool, await productOf("mahle"), { kind: "oem", brand: "VW", number: "5Q0 615 301" }, admin);
  assert.ok(added.ok);
  assert.deepEqual(await search(), [], "no bump: the cached search is served");
  await epoch.invalidateListings();
  assert.deepEqual(await search(), [ids.mahle]);
});

test("a bump from another app process is seen within about a second", async () => {
  const total = await newestTotal();
  await overrides.persistProductOverride(schema.pool, await productOf("sachs"), { hidden: true }, admin);
  // Another container's invalidateListings(): only the shared counter moves.
  await schema.pool.query("UPDATE storefront_listing_epoch SET epoch=epoch+1,bumped_at=now()");
  await sleep(1100);
  assert.equal(await newestTotal(), total - 1);
});

test("the admin actions that change listings bump the epoch", async () => {
  const calls = async (file: string) => ((await readFile(file, "utf8")).match(/invalidateListings\(/g) ?? []).length;
  // splitSource, undoSplitSource, mergeProducts and saveProductOverride.
  assert.equal(await calls("src/app/yonetim/urunler/actions.ts"), 4);
  // run(), shared by add, hide and remove; setSupplierOemHidden (#615).
  assert.equal(await calls("src/app/yonetim/urunler/reference-actions.ts"), 2);
  // splitOffer, undoSplit, decideCandidate ("Aynı ürün") and acceptCandidates.
  assert.equal(await calls("src/app/yonetim/urun-eslestirme/actions.ts"), 4);
  // run() for remove and the automatic-image switch, finishProductImageUpload (#596).
  assert.equal(await calls("src/app/yonetim/urunler/image-actions.ts"), 2);
});

test("the home rails pick skips admin-hidden products and reloads on an epoch bump (#650)", async () => {
  const home = await readFile("src/modules/store/home.ts", "utf8");
  assert.match(home, /staleCache<string\[\]>\([^)]*\{epoch:listingEpoch\}\)/);
  assert.match(home, /NOT EXISTS \(SELECT 1 FROM commerce_item_overrides h WHERE h\.supplier_item_id=s\.id AND h\.hidden\)/);
  // Both arms (#596): the automatic one skips hidden automatic images, the upload one reads the uploads.
  assert.equal(home.match(/NOT EXISTS \(SELECT 1 FROM commerce_item_overrides h WHERE h\.supplier_item_id=s\.id AND h\.hidden\)/g)?.length, 2);
  assert.match(home, /product_override_images/);
  assert.match(home, /hiddenAutomaticItemsSql/);
});
