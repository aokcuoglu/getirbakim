import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";

// Shared automatic images (#1097) in an isolated copy of the schema: the list threshold, store-row counts, host
// filter, sorting, paging and the per-image detail. The session check is left out by calling the database cores.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let shared: typeof import("../src/modules/admin/shared-images-query");
let closeDb: () => Promise<void>;
const ids: Record<string, string> = {};
const media: Record<string, string> = {};
const companies = storefrontCompanies();
const codeOf = (key: string) => `FEB 1${"abc".indexOf(key[0])}00${key[1]}0`;
const [basbug] = companies;

async function item(key: string, options: { presence?: string; company?: string } = {}) {
  const { presence = "present", company = basbug } = options;
  const product = { uk: "FEBI", ac: `FEBI URUN ${key.toUpperCase()}`, ac2: "", dc: "TL" };
  ids[key] = (await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
    VALUES('basbug',$1,'G','MRK',$2,$3,'{"nf":100}','{"stok":2}',1,1,1,false,$4,now(),now(),now()) RETURNING id::text`,
  [company, codeOf(key), product, presence])).rows[0].id;
}
async function image(key: string, url: string) {
  media[key] = (await schema.pool.query<{ id: string }>(`INSERT INTO product_media_objects(bucket,object_key,sha256,content_type,size_bytes,source_url)
    VALUES('product-media',$1,$2,'image/webp',1000,$3) RETURNING id::text`, [`products/${key}.webp`, createHash("sha256").update(key).digest("hex"), url])).rows[0].id;
}
const enrich = (key: string, imageKey: string, part: string) => schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,
  source_method,manufacturer,manufacturer_part_number,image_id,payload) VALUES($1,$2,'FEBI','https://www.trodo.com/x','test','MAN '||$3,$3,$4,'{}')`,
[ids[key], codeOf(key), part, media[imageKey]]);
const link = (key: string, donor: string, imageKey: string) => schema.pool.query(`INSERT INTO product_enrichment_shared_links(supplier_item_id,supplier_code,
  supplier_brand,donor_item_id,donor_oem,status,image_id,imported_at) VALUES($1,$2,'FEBI',$3,'X','ok',$4,now())`, [ids[key], codeOf(key), ids[donor], media[imageKey]]);
const productOf = async (key: string) => (await schema.pool.query<{ product_id: string }>("SELECT product_id::text FROM product_sources WHERE supplier_item_id=$1", [ids[key]])).rows[0]?.product_id;
const list = (params: Parameters<typeof shared.sharedImagesPage>[1] = {}) => shared.sharedImagesPage(schema.pool, params, companies);
const detail = (id: string, params: Parameters<typeof shared.sharedImageDetail>[2] = {}) => shared.sharedImageDetail(schema.pool, id, params, companies);

before(async () => {
  schema = await isolatedSchema("shared_images_test");
  await image("a", "https://www.trodo.com/a.webp");
  await image("b", "https://cdn.other.com/b.webp");
  await image("c", "https://www.trodo.com/c.webp");
  await image("d", "https://www.trodo.com/d.webp");
  await image("up", "https://www.trodo.com/up.webp");
  for (const key of ["a1", "a2", "a3", "a4", "a5", "b1", "b2", "c1", "c2"]) await item(key, key === "a4" || key.startsWith("b") ? { presence: "inactive" } : key === "a5" ? { company: "OTHER" } : {});
  await schema.pool.query("SELECT refresh_product_matches()");
  for (const [key, part] of [["a1", "P1"], ["a2", "P2"], ["a3", "P3"], ["a4", "P4"]]) await enrich(key, "a", part);
  for (const [key, part] of [["b1", "Q1"], ["b2", "Q2"]]) await enrich(key, "b", part);
  for (const key of ["c1", "c2"]) await enrich(key, "c", "R1");
  for (const key of ["a1", "a2", "a3", "a4", "a5"]) await link(key, "a1", "a");
  for (const key of ["b1", "b2"]) await link(key, "b1", "b");
  await schema.pool.query("DELETE FROM product_sources WHERE supplier_item_id=$1", [ids.a5]);
  const admin = (await schema.pool.query<{ id: string }>(`INSERT INTO accounts(name,email,password_hash,role,approved) VALUES('Yönetici',$1,'x','admin',true) RETURNING id::text`, [`${randomUUID()}@example.com`])).rows[0].id;
  await schema.pool.query(`INSERT INTO product_override_images(product_id,media_id,position,width,height,created_by) VALUES($1,$2,0,100,100,$3)`, [await productOf("a1"), media.up, admin]);
  await schema.pool.query(`INSERT INTO product_override_image_settings(product_id,hide_automatic) VALUES($1,true)`, [await productOf("a2")]);
  shared = await import("../src/modules/admin/shared-images-query");
  const { db } = await import("../src/lib/db");
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

test("the list needs the threshold of distinct part numbers, not of rows", async () => {
  const keys = (min?: string) => list({ min }).then(data => data.images.map(row => row.image_id));
  assert.deepEqual(await keys("2"), [media.a, media.b]);
  assert.deepEqual(await keys("5"), []);
  assert.deepEqual(await keys("4"), []);
  assert.deepEqual(await keys("nonsense"), []);
  const [first] = (await list({ min: "2" })).images;
  assert.deepEqual([first.parts, first.donors, first.host], [4, 4, "www.trodo.com"]);
  assert.equal(first.samples.length, 3);
});

test("store rows count only present rows of the storefront companies", async () => {
  const data = await list({ min: "2" });
  assert.equal(data.images.find(row => row.image_id === media.a)?.store_rows, 3);
  assert.equal(data.images.find(row => row.image_id === media.b)?.store_rows, 0);
});

test("the host filter narrows the list and its options ignore the filter", async () => {
  const data = await list({ min: "2", host: "cdn.other.com" });
  assert.deepEqual(data.images.map(row => row.image_id), [media.b]);
  assert.deepEqual(data.hostOptions.map(option => option.host).sort(), ["cdn.other.com", "www.trodo.com"]);
});

test("an unknown sort falls back to the default order; a known one sorts", async () => {
  const fallback = (await list({ min: "2" })).images.map(row => row.image_id);
  assert.deepEqual((await list({ min: "2", sort: "constructor; DROP TABLE x" })).images.map(row => row.image_id), fallback);
  assert.deepEqual((await list({ min: "2", sort: "parts", dir: "asc" })).images.map(row => row.image_id), [media.b, media.a]);
});

test("a page past the end shows the last page with the real total", async () => {
  const data = await list({ min: "2", page: "9" });
  assert.deepEqual([data.page, data.pages, data.total, data.images.length], [1, 1, 2, 2]);
});

test("the detail lists supplier rows with upload, hidden and unmatched state", async () => {
  const data = await detail(media.a);
  assert.ok(data);
  assert.deepEqual([data.header.parts, data.header.store_rows, data.total], [4, 3, 5]);
  const row = (key: string) => data.rows.find(item => item.supplier_item_id === ids[key])!;
  assert.deepEqual([row("a1").uploaded, row("a1").hidden], [true, false]);
  assert.deepEqual([row("a2").uploaded, row("a2").hidden], [false, true]);
  assert.deepEqual([row("a3").uploaded, row("a3").hidden, row("a3").in_store], [false, false, true]);
  assert.deepEqual([row("a4").in_store, row("a5").in_store, row("a5").product_id], [false, false, null]);
  assert.deepEqual((await detail(media.a, { sort: "code", dir: "desc" }))!.rows.map(item => item.supplier_code), ["a5", "a4", "a3", "a2", "a1"].map(codeOf));
  assert.equal((await detail(media.a, { page: "7" }))!.page, 1);
});

test("an unknown, malformed or unreferenced image has no detail", async () => {
  assert.equal(await detail(randomUUID()), null);
  assert.equal(await detail("not-a-uuid"), null);
  assert.equal(await detail(media.d), null);
});

const sha = (key: string) => createHash("sha256").update(key).digest("hex");

test("images on the placeholder denylist are flagged in the list and the detail header", async () => {
  const denylist = new Set([sha("a")]);
  const flagged = (await shared.sharedImagesPage(schema.pool, { min: "2" }, companies, denylist)).images;
  assert.deepEqual(flagged.map(row => [row.image_id, row.listed, row.sha256]), [[media.a, true, sha("a")], [media.b, false, sha("b")]]);
  assert.ok((await list({ min: "2" })).images.every(row => !row.listed));
  const header = (await shared.sharedImageDetail(schema.pool, media.a, {}, companies, denylist))!.header;
  assert.deepEqual([header.listed, header.sha256], [true, sha("a")]);
  assert.equal((await detail(media.a))!.header.listed, false);
});

test("the placeholder status tells in-use, cleaned and absent entries apart in list order", async () => {
  const absent = sha(randomUUID());
  const entries = [sha("d"), absent, sha("a")].map((hash, index) => ({ sha256: hash, source: `src${index}`, note: `note ${index}` }));
  const status = await shared.placeholderListStatus(schema.pool, companies, entries);
  assert.deepEqual(status.entries.map(entry => [entry.sha256, entry.state, entry.image_id, entry.donors, entry.store_rows]), [
    [sha("d"), "clean", media.d, 0, 0], [absent, "absent", null, 0, 0], [sha("a"), "in_use", media.a, 4, 3],
  ]);
  assert.deepEqual(status.entries.map(entry => entry.source), ["src0", "src1", "src2"]);
  assert.deepEqual(status.inUse, { images: 1, donors: 4, storeRows: 3 });
});
