import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";
import { collectMedia, parseMediaGcArgs, type MediaGcOptions } from "../src/modules/enrichment/media-gc";

// npm run media:gc (#597) in an isolated copy of the schema: which media rows count as unreferenced, and how a run
// keeps rows whose objects stayed or that gained a reference meanwhile. Objects live in an in-memory store.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
const bucket = "product-media";
const [basbug] = storefrontCompanies();
let itemId: string;
let productId: string;
let serial = 0;

/** S3 as the collection uses it: Put, Head and DeleteObjects; `fail` makes DeleteObjects throw or report key errors. */
function fakeStorage() {
  const objects = new Set<string>();
  const state = { fail: null as null | "throw" | Set<string>, deleted: [] as string[] };
  type Command = { constructor: { name: string }; input: { Key?: string; Delete?: { Objects: { Key: string }[] } } };
  return { objects, state, send: async (command: Command) => {
    if (command.constructor.name !== "DeleteObjectsCommand") throw new Error(`Unexpected ${command.constructor.name}`);
    if (state.fail === "throw") throw new Error("storage unavailable");
    const keys = command.input.Delete!.Objects.map(object => object.Key);
    const failed = state.fail;
    const errors = failed ? keys.filter(key => failed.has(key)).map(Key => ({ Key, Code: "AccessDenied" })) : [];
    for (const key of keys) if (!failed?.has(key)) { objects.delete(key); state.deleted.push(key); }
    return errors.length ? { Errors: errors } : {};
  } };
}
let storage = fakeStorage();

/** A media row (and its object) created `ageDays` ago. */
async function media(ageDays: number, { folder = "products", rowBucket = bucket, storedDaysAgo = null as number | null } = {}) {
  const hash = createHash("sha256").update(`media-${serial++}`).digest("hex");
  const key = `${folder}/${hash.slice(0, 2)}/${hash}.webp`;
  const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO product_media_objects(bucket,object_key,sha256,content_type,size_bytes,source_url,created_at,stored_at)
    VALUES($1,$2,$3,'image/webp',1000,'https://example.com/a.webp',now()-make_interval(days=>$4),
      CASE WHEN $5::int IS NULL THEN NULL ELSE now()-make_interval(days=>$5::int) END) RETURNING id::text`, [rowBucket, key, hash, ageDays, storedDaysAgo]);
  if (rowBucket === bucket) storage.objects.add(key);
  return { id: rows[0].id, key };
}
const exists = async (id: string) => (await schema.pool.query("SELECT 1 FROM product_media_objects WHERE id=$1", [id])).rowCount === 1;
const run = (options: Partial<MediaGcOptions> = {}) => collectMedia(schema.pool, storage, { minAgeDays: 7, bucket, maxShare: 1, ...options });

const enrichment = (imageId: string | null) => schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,
  manufacturer,manufacturer_part_number,image_id,payload) VALUES($1,'FEB 10010','FEBI','https://example.com/p','test','FEBI','10010',$2,'{}')`, [itemId, imageId]);
/** Each way a media row can be referenced. */
const references: Record<string, (id: string) => Promise<unknown>> = {
  "product_enrichments.image_id": id => enrichment(id),
  "product_enrichment_shared_links.image_id": async id => {
    await enrichment(null);
    await schema.pool.query(`INSERT INTO product_enrichment_shared_links(supplier_item_id,supplier_code,supplier_brand,donor_item_id,donor_oem,status,image_id,imported_at)
      VALUES($1,'FEB 10010','FEBI',$1,'','complete',$2,now())`, [itemId, id]);
  },
  "enrichment_product_states.image_id": id => schema.pool.query(`INSERT INTO enrichment_product_states(product_id,status,updated_at,sorted_at,image_id)
    VALUES($1,'complete',now(),now(),$2)`, [productId, id]),
  "source_category_images.media_id": id => schema.pool.query("INSERT INTO source_category_images(source,category_id,media_id,width,height) VALUES('trodo',1,$1,100,100)", [id]),
  "vehicle_type_images.media_id": id => schema.pool.query("INSERT INTO vehicle_type_images(vehicle_type_id,media_id,width,height) VALUES(1,$1,100,100)", [id]),
  "vehicle_type_images.original_media_id": async id => {
    const cutout = await media(0);
    await schema.pool.query("INSERT INTO vehicle_type_images(vehicle_type_id,media_id,original_media_id,width,height) VALUES(1,$1,$2,100,100)", [cutout.id, id]);
  },
  "product_override_images.media_id": id => schema.pool.query("INSERT INTO product_override_images(product_id,media_id,position,width,height) VALUES($1,$2,0,100,100)", [productId, id]),
};

before(async () => {
  schema = await isolatedSchema("media_gc_test");
  itemId = (await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
    VALUES('basbug',$1,'G','MRK','FEB 10010','{"uk":"FEBI","ac":"FEBI FREN BALATASI","ac2":"","dc":"TL"}','{"nf":100}','{"stok":2}',1,1,1,false,'present',now(),now(),now())
    RETURNING id::text`, [basbug])).rows[0].id;
  await schema.pool.query("SELECT refresh_product_matches()");
  productId = (await schema.pool.query<{ id: string }>("SELECT product_id::text AS id FROM product_sources WHERE supplier_item_id=$1", [itemId])).rows[0].id;
  await schema.pool.query(`INSERT INTO source_categories(source,category_id,name,slug,path_ids,source_url,raw) VALUES('trodo',1,'Fren','fren','{1}','https://example.com/c','{}')`);
  await schema.pool.query("INSERT INTO vehicle_brands(id,name,display_name) VALUES(1,'TEST','Test')");
  await schema.pool.query("INSERT INTO vehicle_models(id,brand_id,name) VALUES(1,1,'MODEL')");
  await schema.pool.query(`INSERT INTO vehicle_types(id,model_id,name,fuel_type,fuel_name,hp,kwt,year_of_constr_from,search_text)
    VALUES(1,1,'1.6','petrol','Benzin',100,74,'2010-01-01','test model 1.6')`);
});
after(async () => { await schema?.drop(); });
beforeEach(async () => {
  await schema.pool.query(`DELETE FROM product_override_images; DELETE FROM vehicle_type_images; DELETE FROM source_category_images;
    DELETE FROM enrichment_product_states; DELETE FROM product_enrichment_shared_links; DELETE FROM product_enrichments; DELETE FROM product_media_objects`);
  storage = fakeStorage();
});

test("an old unreferenced row and its object are collected; a dry run changes nothing", async () => {
  const old = await media(30);
  const report = await run();
  assert.equal(report.apply, false);
  assert.deepEqual([report.total, report.candidates, report.bytes, report.deleted], [1, 1, 1000, 0]);
  assert.deepEqual(report.byFolder, { products: { count: 1, bytes: 1000 } });
  assert.deepEqual(report.sample, [old.key]);
  assert.equal(await exists(old.id), true);
  assert.equal(storage.objects.has(old.key), true);
  assert.deepEqual(storage.state.deleted, []);

  const applied = await run({ apply: true });
  assert.deepEqual([applied.deleted, applied.deletedBytes, applied.becameReferenced], [1, 1000, 0]);
  assert.equal(await exists(old.id), false);
  assert.deepEqual(storage.state.deleted, [old.key]);
});

for (const [name, reference] of Object.entries(references)) {
  test(`a row referenced only by ${name} stays`, async () => {
    const kept = await media(30);
    await reference(kept.id);
    const loose = await media(30, { folder: "admin" });
    const report = await run({ apply: true });
    assert.equal(report.deleted, 1);
    assert.equal(await exists(kept.id), true);
    assert.equal(storage.objects.has(kept.key), true);
    assert.equal(await exists(loose.id), false);
    assert.deepEqual(storage.state.deleted, [loose.key]);
  });
}

test("rows younger than the threshold stay, also an old row an import stored again recently", async () => {
  const young = await media(2);
  const restored = await media(30, { storedDaysAgo: 1 });
  const stale = await media(30, { storedDaysAgo: 20 });
  const report = await run({ apply: true });
  assert.equal(report.candidates, 1);
  assert.deepEqual([await exists(young.id), await exists(restored.id), await exists(stale.id)], [true, true, false]);
});

test("a foreign key from a table db/*.sql does not create counts as a reference", async () => {
  await schema.pool.query("CREATE TABLE legacy_images(media_id uuid REFERENCES product_media_objects(id))");
  try {
    const kept = await media(30);
    await schema.pool.query("INSERT INTO legacy_images VALUES($1)", [kept.id]);
    assert.equal((await run({ apply: true })).deleted, 0);
    assert.equal(await exists(kept.id), true);
  } finally { await schema.pool.query("DROP TABLE legacy_images"); }
});

test("an unrecognised uuid media column without a foreign key stops the run before anything is deleted", async () => {
  await schema.pool.query("CREATE TABLE unknown_gallery(id serial PRIMARY KEY, cover_media_id uuid)");
  try {
    const loose = await media(30);
    await assert.rejects(run({ apply: true }), /Unrecognised media id column\(s\): unknown_gallery\.cover_media_id/);
    await assert.rejects(run(), /Unrecognised media id column/);
    assert.equal(await exists(loose.id), true);
    assert.deepEqual(storage.state.deleted, []);
  } finally { await schema.pool.query("DROP TABLE unknown_gallery"); }
});

test("an object store failure keeps the rows of the objects that stayed", async () => {
  const first = await media(30);
  const second = await media(29);
  storage.state.fail = "throw";
  await assert.rejects(run({ apply: true }), /storage unavailable/);
  assert.deepEqual([await exists(first.id), await exists(second.id)], [true, true]);

  storage.state.fail = new Set([first.key]);
  await assert.rejects(run({ apply: true }), /did not delete 1 object/);
  assert.deepEqual([await exists(first.id), await exists(second.id)], [true, false]);
  assert.equal(storage.objects.has(first.key), true);
});

test("a row referenced after it was listed (23503) stays and the rest of its batch is collected", async () => {
  const rows = [await media(30), await media(29), await media(28)];
  const writer = await schema.pool.connect();
  try {
    await writer.query("BEGIN");
    // Uncommitted: the collection's NOT EXISTS cannot see it, but the foreign key check will once it commits.
    await writer.query("INSERT INTO product_override_images(product_id,media_id,position,width,height) VALUES($1,$2,0,100,100)", [productId, rows[1].id]);
    const writerPid = (await writer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const collecting = run({ apply: true });
    for (let attempt = 0; ; attempt++) {
      const blocked = await schema.pool.query("SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))", [writerPid]);
      if (blocked.rowCount) break;
      if (attempt > 200) throw new Error("The collection never waited for the writer");
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await writer.query("COMMIT");
    const report = await collecting;
    assert.deepEqual([report.deleted, report.becameReferenced], [2, 1]);
  } finally { writer.release(); }
  assert.deepEqual([await exists(rows[0].id), await exists(rows[1].id), await exists(rows[2].id)], [false, true, false]);
  assert.equal(storage.objects.has(rows[1].key), true);
});

test("a row another transaction holds past the lock timeout (55P03) stays and the rest of its batch is collected", async () => {
  const rows = [await media(30), await media(29), await media(28)];
  const writer = await schema.pool.connect();
  try {
    await writer.query("BEGIN");
    // Never committed while the collection runs: the deletion of this row gives up after lockTimeoutMs.
    await writer.query("INSERT INTO product_override_images(product_id,media_id,position,width,height) VALUES($1,$2,0,100,100)", [productId, rows[1].id]);
    const report = await run({ apply: true, lockTimeoutMs: 100 });
    assert.deepEqual([report.deleted, report.locked, report.becameReferenced], [2, 1, 0]);
    await writer.query("ROLLBACK");
  } finally { writer.release(); }
  assert.deepEqual([await exists(rows[0].id), await exists(rows[1].id), await exists(rows[2].id)], [false, true, false]);
  assert.equal(storage.objects.has(rows[1].key), true);
});

test("rows in another bucket are skipped and counted; a run above the share limit deletes nothing", async () => {
  const foreign = await media(30, { rowBucket: "other-bucket" });
  const loose = await media(30);
  const referenced = await media(30);
  await references["product_override_images.media_id"](referenced.id);
  const report = await run();
  assert.deepEqual([report.total, report.candidates, report.foreignBucket], [3, 1, 1]);
  await assert.rejects(run({ apply: true, maxShare: 0.2 }), /Refusing to delete 1 of 3 media objects/);
  assert.equal(await exists(loose.id), true);
  const applied = await run({ apply: true, maxShare: 0.5 });
  assert.equal(applied.deleted, 1);
  assert.deepEqual([await exists(foreign.id), await exists(loose.id)], [true, false]);
});

test("the indexes serve the foreign key checks a deletion runs", async () => {
  const client = await schema.pool.connect();
  try {
    await client.query("SET enable_seqscan=off; SET plan_cache_mode=force_generic_plan");
    for (const [table, column, index] of [["product_enrichments", "image_id", "product_enrichments_image_idx"],
      ["vehicle_type_images", "original_media_id", "vehicle_type_images_original_media_idx"]]) {
      await client.query(`PREPARE check_${table}(uuid) AS SELECT 1 FROM ONLY ${table} x WHERE ${column}=$1 FOR KEY SHARE OF x`);
      const plan = (await client.query(`EXPLAIN EXECUTE check_${table}('00000000-0000-0000-0000-000000000000')`)).rows.map(row => row["QUERY PLAN"]).join("\n");
      assert.match(plan, new RegExp(index), plan);
    }
  } finally { await client.query("DEALLOCATE ALL; RESET ALL"); client.release(); }
});

test("the command line accepts only its flags", () => {
  assert.deepEqual(parseMediaGcArgs([]), { apply: false, minAgeDays: 7, limit: null, batchSize: 200, maxShare: 0.2 });
  assert.deepEqual(parseMediaGcArgs(["--apply", "--min-age-days=14", "--limit=50", "--batch=100", "--max-share=0.5"]),
    { apply: true, minAgeDays: 14, limit: 50, batchSize: 100, maxShare: 0.5 });
  for (const bad of [["--aply"], ["--apply=yes"], ["--min-age-days=0"], ["--min-age-days=1.5"], ["--batch=1001"], ["--max-share=1.5"], ["--limit"], ["--apply", "--apply"], ["apply"]])
    assert.throws(() => parseMediaGcArgs(bad), /argument|must be/, bad.join(" "));
});
