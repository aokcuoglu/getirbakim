import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, describe, mock, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { syncSharedLinks } from "./test-helpers/shared-links";
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
  await image("e", "https://www.trodo.com/e.webp");
  await link("c1", "a1", "e");
  const entries = [sha("d"), absent, sha("a"), sha("e")].map((hash, index) => ({ sha256: hash, source: `src${index}`, note: `note ${index}` }));
  const status = await shared.placeholderListStatus(schema.pool, companies, entries);
  assert.deepEqual(status.entries.map(entry => [entry.sha256, entry.state, entry.image_id, entry.donors, entry.store_rows]), [
    [sha("d"), "clean", media.d, 0, 0], [absent, "absent", null, 0, 0], [sha("a"), "cleanup_pending", media.a, 4, 3],
    [sha("e"), "sync_pending", media.e, 0, 1],
  ]);
  assert.deepEqual(status.entries.map(entry => entry.source), ["src0", "src1", "src2", "src3"]);
  assert.deepEqual(status.inUse, { images: 2, donors: 4, storeRows: 4 });
});

// Blocking a shared image (#1136). Real, valid enrichments on matched products, so the links come from the sync.
// The sync rewrites the hand-made links above, so these tests run last.
describe("blocking a shared image", () => {
  let blocks: typeof import("../src/modules/admin/shared-image-blocks");
  let images: typeof import("../src/modules/store/product-images");
  let adminRoute: typeof import("../src/app/api/admin/product-media/[id]/route");
  let publicRoute: typeof import("../src/app/api/product-media/[id]/route");
  let admin: string;
  // The admin preview route (#1176) reads the session and the object storage, both mocked; the database is the schema.
  let account: { id: string } | null = null;
  let storageFails = false;
  const get = (route: { GET: typeof adminRoute.GET }, id: string) => route.GET(new Request(`http://localhost/${id}`), { params: Promise.resolve({ id }) });
  const blockKeys = ["x1", "x2", "x3"];
  const linkImages = async () => (await schema.pool.query<{ supplier_item_id: string; image_id: string | null }>(
    `SELECT supplier_item_id::text, image_id::text FROM product_enrichment_shared_links
     WHERE donor_item_id IN (SELECT supplier_item_id FROM product_enrichments WHERE image_id=$1) ORDER BY supplier_item_id`, [media.x])).rows;
  const sync = () => syncSharedLinks(schema.pool);

  before(async () => {
    await image("x", "https://www.trodo.com/x.webp");
    for (const [index, key] of blockKeys.entries()) {
      const code = `FEB 9100${index}0`;
      ids[key] = (await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
        product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
        VALUES('basbug',$1,'G','MRK',$2,$3,'{"nf":100}','{"stok":2}',1,1,1,false,'present',now(),now(),now()) RETURNING id::text`,
      [basbug, code, { uk: "FEBI", ac: `FEBI ENGEL ${index}`, ac2: "", dc: "TL" }])).rows[0].id;
    }
    await schema.pool.query("SELECT refresh_product_matches()");
    for (const [index, key] of blockKeys.entries()) {
      const code = `FEB 9100${index}0`;
      await schema.pool.query(`INSERT INTO product_enrichment_jobs(supplier_item_id,supplier_code,supplier_brand,status) VALUES($1,$2,'FEBI','complete')`, [ids[key], code]);
      await schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,
        manufacturer_part_number,image_id,payload) VALUES($1,$2,'FEBI','https://www.trodo.com/x','test','FEBI BILSTEIN',$3,$4,$5)`,
      [ids[key], code, `910${index}`, media.x, { specifications: [], oemNumbers: {}, crossReferences: {}, vehicles: [], imageWidth: 600, imageHeight: 400 }]);
    }
    await sync();
    admin = (await schema.pool.query<{ id: string }>("SELECT id::text FROM accounts WHERE role='admin' LIMIT 1")).rows[0].id;
    mock.module("../src/modules/auth/session.ts", { namedExports: { adminApiAccount: async () => account } });
    mock.module("../src/lib/object-storage.ts", { namedExports: {
      objectStorage: () => ({ send: async () => {
        if (storageFails) throw Object.assign(new Error("down"), { name: "TestStorageDown" });
        return { Body: { transformToWebStream: () => new Blob(["x"]).stream() } };
      } }),
    } });
    [blocks, images, adminRoute, publicRoute] = await Promise.all([import("../src/modules/admin/shared-image-blocks"), import("../src/modules/store/product-images"),
      import("../src/app/api/admin/product-media/[id]/route"), import("../src/app/api/product-media/[id]/route")]);
  });

  test("a block empties the image on every link of its donors after a sync; unblocking restores it", async () => {
    assert.deepEqual((await linkImages()).map(row => row.image_id), [media.x, media.x, media.x]);
    assert.deepEqual(await blocks.blockSharedImage(schema.pool, media.x, "Filigranlı", admin), { ok: true });
    await sync();
    assert.deepEqual((await linkImages()).map(row => row.image_id), [null, null, null]);
    assert.equal((await schema.pool.query("SELECT count(*)::int AS n FROM product_enrichments WHERE image_id=$1", [media.x])).rows[0].n, 3);
    assert.deepEqual(await blocks.unblockSharedImage(schema.pool, media.x), { ok: true });
    await sync();
    assert.deepEqual((await linkImages()).map(row => row.image_id), [media.x, media.x, media.x]);
  });

  test("a re-imported enrichment and a full rebuild keep a blocked image off the links", async () => {
    assert.deepEqual(await blocks.blockSharedImage(schema.pool, media.x, "", admin), { ok: true });
    await sync();
    await schema.pool.query("UPDATE product_enrichments SET imported_at=now() WHERE image_id=$1", [media.x]);
    await schema.pool.query("SELECT product_enrichment_shared_refresh(NULL,NULL)");
    assert.deepEqual((await linkImages()).map(row => row.image_id), [null, null, null]);
  });

  test("the blocked flag shows in the list, the detail and the block list; detail rows stay listed", async () => {
    const row = (await list({ min: "2" })).images.find(item => item.image_id === media.x);
    assert.deepEqual([row?.blocked, row?.store_rows, row?.samples.length], [true, 0, 3]);
    assert.ok((await list({ min: "2" })).images.filter(item => item.image_id !== media.x).every(item => !item.blocked));
    const data = (await detail(media.x))!;
    assert.deepEqual([data.header.blocked, data.total], [true, 3]);
    assert.deepEqual(data.rows.map(item => item.supplier_item_id).sort(), blockKeys.map(key => ids[key]).sort());
    const [entry] = await blocks.listImageBlocks(schema.pool);
    assert.deepEqual([entry.sha256, entry.image_id, entry.donors, entry.created_by, entry.source_url], [sha("x"), media.x, 3, "Yönetici", "https://www.trodo.com/x.webp"]);
    assert.equal(row?.block_note, "");
    assert.equal((await list({ min: "2" })).images.find(item => item.image_id === media.a)?.block_note, null);
  });

  test("listed, unknown and unreferenced images are refused; a second block keeps the first", async () => {
    assert.deepEqual(await blocks.blockSharedImage(schema.pool, media.a, "", admin, new Set([sha("a")])), { ok: false, reason: "listed" });
    assert.deepEqual(await blocks.blockSharedImage(schema.pool, randomUUID(), "", admin), { ok: false, reason: "not-found" });
    assert.deepEqual(await blocks.blockSharedImage(schema.pool, media.d, "", admin), { ok: false, reason: "not-found" });
    assert.deepEqual(await blocks.blockSharedImage(schema.pool, media.x, "ikinci", admin), { ok: true });
    const rows = (await schema.pool.query<{ note: string }>("SELECT note FROM product_image_blocks WHERE sha256=$1", [sha("x")])).rows;
    assert.deepEqual(rows.map(row => row.note), [""]);
    assert.equal((await schema.pool.query("SELECT count(*)::int AS n FROM product_image_blocks WHERE sha256=$1", [sha("a")])).rows[0].n, 0);
  });

  test("the admin preview finds only blocked media; the public route still refuses it", async () => {
    assert.equal((await blocks.blockedProductMedia(schema.pool, media.x))?.object_key, "products/x.webp");
    assert.equal(await images.servableProductMedia(media.x, companies), undefined);
    assert.equal(await blocks.blockedProductMedia(schema.pool, media.a), undefined);
    assert.equal(await blocks.blockedProductMedia(schema.pool, randomUUID()), undefined);
    assert.equal((await get(publicRoute, media.x)).status, 404);
  });

  test("the admin preview route answers only an admin, only for blocked media, and is never cached", async () => {
    account = null;
    const refused = await get(adminRoute, media.x);
    assert.deepEqual([refused.status, refused.headers.get("Cache-Control"), refused.headers.get("X-Content-Type-Options")], [403, "private, no-store", "nosniff"]);
    account = { id: admin };
    try {
      const missing = await get(adminRoute, media.a);
      assert.deepEqual([missing.status, missing.headers.get("Cache-Control")], [404, "private, no-store"]);
      assert.equal((await get(adminRoute, "not-a-uuid")).status, 404);
      const shown = await get(adminRoute, media.x);
      assert.deepEqual([shown.status, shown.headers.get("Cache-Control"), shown.headers.get("Content-Type"), shown.headers.get("ETag")],
        [200, "private, no-store", "image/webp", null]);
      assert.equal(await shown.text(), "x");
      storageFails = true;
      const failed = await get(adminRoute, media.x);
      assert.deepEqual([failed.status, failed.headers.get("Retry-After"), failed.headers.get("Cache-Control")], [503, "30", "private, no-store"]);
    } finally { account = null; storageFails = false; }
  });

  test("the media route stops serving a blocked image unless an admin also uploaded it", async () => {
    assert.equal(await images.servableProductMedia(media.x, companies), undefined);
    const product = await productOf("x1");
    await schema.pool.query(`INSERT INTO product_override_images(product_id,media_id,position,width,height,created_by) VALUES($1,$2,0,600,400,$3)`, [product, media.x, admin]);
    assert.ok(await images.servableProductMedia(media.x, companies));
    await schema.pool.query("DELETE FROM product_override_images WHERE media_id=$1", [media.x]);
    assert.deepEqual(await blocks.unblockSharedImage(schema.pool, media.x), { ok: true });
    await sync();
    assert.ok(await images.servableProductMedia(media.x, companies));
  });

  test("an unblocked image leaves the admin preview and returns to the public route", async () => {
    assert.equal(await blocks.blockedProductMedia(schema.pool, media.x), undefined);
    assert.ok(await images.servableProductMedia(media.x, companies));
    account = { id: admin };
    try { assert.equal((await get(adminRoute, media.x)).status, 404); } finally { account = null; }
  });

  test("a stale block is lifted even when no enrichment uses the image any more", async () => {
    await schema.pool.query("INSERT INTO product_image_blocks(sha256,note) VALUES($1,'eski')", [sha("d")]);
    assert.deepEqual(await blocks.blockSharedImage(schema.pool, media.d, "", admin), { ok: false, reason: "not-found" });
    assert.deepEqual(await blocks.unblockSharedImage(schema.pool, media.d), { ok: true });
    assert.equal((await schema.pool.query("SELECT count(*)::int AS n FROM product_image_blocks WHERE sha256=$1", [sha("d")])).rows[0].n, 0);
    assert.deepEqual(await blocks.unblockSharedImage(schema.pool, randomUUID()), { ok: false, reason: "not-found" });
  });

  test("the link queue is drained inline only when it is small and holds no rebuild marker", async () => {
    await sync();
    assert.equal(await blocks.linkQueueDrainable(schema.pool), true);
    await schema.pool.query("INSERT INTO product_enrichment_shared_queue(kind,id) SELECT 'i',gen_random_uuid() FROM generate_series(1,3)");
    assert.equal(await blocks.linkQueueDrainable(schema.pool, 3), true);
    assert.equal(await blocks.linkQueueDrainable(schema.pool, 2), false);
    await schema.pool.query("DELETE FROM product_enrichment_shared_queue");
    await schema.pool.query("INSERT INTO product_enrichment_shared_queue(kind,id) VALUES ('p','00000000-0000-0000-0000-000000000000')");
    assert.equal(await blocks.linkQueueDrainable(schema.pool), false);
    await schema.pool.query("DELETE FROM product_enrichment_shared_queue");
  });
});
