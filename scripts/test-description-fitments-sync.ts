import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, describe, test } from "node:test";
import type { Pool } from "pg";
import { isolatedSchema } from "./isolated-schema";
import { deriveDescriptionFitments, SHRINK_GUARD_RATIO, type DeriveOptions } from "../src/modules/store/description-fitment-derive";
import { diffDescriptionFitments, loadDescriptionFitmentsKeep, loadDescriptionFitmentsNext, writeDescriptionFitments,
  type DescriptionFitmentRow } from "../src/modules/store/description-fitment-sync";

// The description fitment derivation syncs product_model_fitments (#798): unchanged rows are not rewritten and keep
// derived_at (the sitemap's lastmod), a model or year change moves it, a source_text change alone updates the text only.

describe("description fitment sync", { skip: !process.env.DATABASE_URL }, () => {
  let schema: Awaited<ReturnType<typeof isolatedSchema>>;
  const ids: Record<string, string> = {};
  const EPOCH = "2026-01-01T00:00:00.000Z";

  async function item(key: string) {
    ids[key] = (await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
      product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
      VALUES('dinamik','DINAMIK','G','MRK',$1,'{"uk":"TST","ac":"TEST","ac2":"","dc":"TL"}','{"nf":100}','{"stok":2}',1,1,1,false,'present',now(),now(),now())
      RETURNING id::text`, [`TST ${key}`])).rows[0].id;
  }
  async function write(rows: DescriptionFitmentRow[]) {
    const client = await schema.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await writeDescriptionFitments(client, rows);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async function diff(rows: DescriptionFitmentRow[]) {
    const client = await schema.pool.connect();
    try {
      await client.query("BEGIN");
      await loadDescriptionFitmentsKeep(client);
      await loadDescriptionFitmentsNext(client, rows);
      return await diffDescriptionFitments(client);
    } finally { await client.query("ROLLBACK"); client.release(); }
  }
  type Stored = { key: string; year_from: number | null; year_to: number | null; source_text: string; derived_at: string; xmin: string };
  async function stored() {
    const rows = (await schema.pool.query<Omit<Stored, "key"> & { supplier_item_id: string; model_id: number }>(`SELECT supplier_item_id::text,model_id,
      year_from,year_to,source_text,to_char(derived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS derived_at,xmin::text AS xmin
      FROM product_model_fitments`)).rows;
    const keys = Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, key]));
    return new Map(rows.map(row => [`${keys[row.supplier_item_id]}:${row.model_id}`, row]));
  }
  const row = (key: string, model: number, year_from: number | null, year_to: number | null, source_text = `TEXT ${key}`): DescriptionFitmentRow =>
    ({ supplier_item_id: ids[key], model_id: model, year_from, year_to, source_text });

  before(async () => {
    schema = await isolatedSchema("descfit");
    await schema.pool.query("INSERT INTO vehicle_brands(id,name,display_name) VALUES(1,'VW','VOLKSWAGEN')");
    await schema.pool.query("INSERT INTO vehicle_models(id,brand_id,name) VALUES(10,1,'GOLF IV'),(11,1,'PASSAT')");
    for (const key of ["A", "A2", "B", "B2", "B3", "C", "D", "E", "F", "G"]) await item(key);
  });
  after(async () => { await schema?.drop(); });

  const first = () => [row("A", 10, null, null), row("A2", 10, 2000, 2004), row("B", 10, 2000, 2004), row("B2", 10, null, null),
    row("B3", 10, 1998, 2003), row("C", 10, 2001, null), row("E", 11, 1997, 2005)];
  const second = () => [row("A", 10, null, null), row("A2", 10, 2000, 2004), row("B", 10, 2001, 2004), row("B2", 10, 1999, null),
    row("B3", 10, 1998, null), row("D", 11, null, 2010), row("E", 11, 1997, 2005, "TEXT E CHANGED")];

  // Each test starts from an empty table, so any of them runs alone under --test-name-pattern.
  test("only changed rows are written and derived_at moves only with the model or years", async () => {
    await write([]);
    assert.deepEqual(await write(first()), { inserted: 7, updated: 0, deleted: 0, unchanged: 0, kept: 0 });
    await schema.pool.query("UPDATE product_model_fitments SET derived_at=$1", [EPOCH]);
    const before = await stored();

    assert.deepEqual(await diff(second()), { inserted: 1, updated: 4, deleted: 1, unchanged: 2, kept: 0 }, "the dry-run diff counts what the write then does");
    assert.deepEqual(await write(second()), { inserted: 1, updated: 4, deleted: 1, unchanged: 2, kept: 0 });
    const after = await stored();
    assert.deepEqual(new Set(after.keys()), new Set(["A:10", "A2:10", "B:10", "B2:10", "B3:10", "D:11", "E:11"]));
    for (const key of ["A:10", "A2:10"]) {
      assert.equal(after.get(key)?.derived_at, EPOCH, key);
      assert.equal(after.get(key)?.xmin, before.get(key)?.xmin, `${key} is not rewritten`);
    }
    for (const key of ["B:10", "B2:10", "B3:10"]) assert.ok(after.get(key)!.derived_at > EPOCH, `${key} moved`);
    assert.deepEqual([after.get("B:10")?.year_from, after.get("B2:10")?.year_from, after.get("B3:10")?.year_to], [2001, 1999, null]);
    assert.equal(after.get("E:11")?.source_text, "TEXT E CHANGED");
    assert.equal(after.get("E:11")?.derived_at, EPOCH, "a text change alone keeps derived_at");
    assert.ok(after.get("D:11")!.derived_at > EPOCH);
    assert.deepEqual([after.get("D:11")?.year_from, after.get("D:11")?.year_to], [null, 2010]);

    assert.deepEqual(await write(second()), { inserted: 0, updated: 0, deleted: 0, unchanged: 7, kept: 0 });
    const again = await stored();
    for (const [key, value] of after) assert.equal(again.get(key)?.xmin, value.xmin, `${key} is not rewritten by an identical sync`);
  });

  test("dropping one of a product's models moves the derived_at of its remaining rows", async () => {
    await write([]);
    await write([row("F", 10, 2000, 2004), row("F", 11, 2000, 2004), row("G", 10, null, null)]);
    await schema.pool.query("UPDATE product_model_fitments SET derived_at=$1", [EPOCH]);
    const before = await stored();

    assert.deepEqual(await write([row("F", 10, 2000, 2004), row("G", 10, null, null)]), { inserted: 0, updated: 0, deleted: 1, unchanged: 2, kept: 0 });
    const after = await stored();
    assert.deepEqual(new Set(after.keys()), new Set(["F:10", "G:10"]));
    assert.ok(after.get("F:10")!.derived_at > EPOCH, "the product's lastmod still moves");
    assert.equal(after.get("G:10")?.derived_at, EPOCH);
    assert.equal(after.get("G:10")?.xmin, before.get("G:10")?.xmin, "an unrelated product is not rewritten");
  });

  test("two syncs in one transaction work and an empty derivation empties the table", async () => {
    await write([]);
    assert.deepEqual(await write(second()), { inserted: 7, updated: 0, deleted: 0, unchanged: 0, kept: 0 });
    const client = await schema.pool.connect();
    try {
      await client.query("BEGIN");
      assert.deepEqual(await writeDescriptionFitments(client, second()), { inserted: 0, updated: 0, deleted: 0, unchanged: 7, kept: 0 });
      assert.deepEqual(await writeDescriptionFitments(client, []), { inserted: 0, updated: 0, deleted: 7, unchanged: 0, kept: 0 });
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    assert.equal((await schema.pool.query("SELECT 1 FROM product_model_fitments")).rowCount, 0);
  });
});

async function deriveIn(pool: Pool, options: Partial<DeriveOptions> = {}) {
  const client = await pool.connect();
  try { return await deriveDescriptionFitments(client, { dryRun: false, allowShrink: false, ...options }); } finally { client.release(); }
}
/** Every stored row with its derived_at and xmin: an equal snapshot means nothing was written. */
const snapshotOf = async (pool: Pool) => (await pool.query<{ key: string }>(`SELECT string_agg(concat_ws(':',supplier_item_id,model_id,year_from,year_to,
  source_text,derived_at,xmin),',' ORDER BY supplier_item_id,model_id) AS key FROM product_model_fitments`)).rows[0].key;
const countOf = async (pool: Pool) => (await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM product_model_fitments")).rows[0].n;
/** A supplier item described by `text` (`ac`) for the vehicle make `make` (`kull1s`); a present Dinamik one by default. */
async function insertItem(pool: Pool, code: string, text: string, { make = "VAG", supplier = "dinamik", presence = "present" } = {}) {
  return (await pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
    VALUES($1::text,upper($1::text),'G','MRK',$2,jsonb_build_object('uk','TST','kull1s',$3::text,'ac',$4::text),'{"nf":100}','{"stok":2}',1,1,1,false,$5,now(),now(),now())
    RETURNING id::text`, [supplier, code, make, text, presence])).rows[0].id;
}

// The derive (#562) runs as an AWS operations task: a dry run diffs without writing, a busy lock or a guard stops it
// before anything is written.
describe("description fitment derive", { skip: !process.env.DATABASE_URL }, () => {
  let schema: Awaited<ReturnType<typeof isolatedSchema>>;

  const derive = (options: Partial<DeriveOptions> = {}) => deriveIn(schema.pool, options);
  const snapshot = () => snapshotOf(schema.pool);
  const count = () => countOf(schema.pool);
  const dinamik = (code: string, make: string, text: string) => insertItem(schema.pool, code, text, { make });

  before(async () => {
    schema = await isolatedSchema("descderive");
    await schema.pool.query("INSERT INTO vehicle_brands(id,name,display_name) VALUES(1,'VW','VOLKSWAGEN')");
    await schema.pool.query(`INSERT INTO vehicle_models(id,brand_id,name,date_from,date_to) VALUES(10,1,'GOLF IV (1J1)','1997-08-01','2005-06-01'),
      (11,1,'PASSAT (3B2)','1996-08-01','2001-11-01')`);
  });
  after(async () => { await schema?.drop(); });

  // The tests share one schema and run in order: the empty catalog one goes last.
  test("derives the model a Dinamik description names; a second run changes nothing", async () => {
    const golf = await dinamik("TST GOLF", "VAG", "SILECEK MOTORU GOLF IV 98>04");
    await dinamik("TST NONE", "VAG", "EVRENSEL PASPAS");
    const first = await derive();
    assert.equal(first.status, "ok");
    assert.equal(first.items, 2);
    assert.deepEqual(first.written, { inserted: 1, updated: 0, deleted: 0, unchanged: 0, kept: 0 });
    assert.deepEqual((await schema.pool.query("SELECT supplier_item_id::text,model_id,year_from,year_to FROM product_model_fitments")).rows,
      [{ supplier_item_id: golf, model_id: 10, year_from: 1998, year_to: 2004 }]);
    const stored = await snapshot();
    const second = await derive();
    assert.deepEqual(second.written, { inserted: 0, updated: 0, deleted: 0, unchanged: 1, kept: 0 });
    assert.equal(await snapshot(), stored, "an identical derive rewrites nothing");
  });

  test("a dry run leaves the table untouched and reports what the real run then writes", async () => {
    await dinamik("TST PASSAT", "VAG", "FAR SAG PASSAT 97>00");
    await schema.pool.query("UPDATE supplier_items SET product_data=product_data||'{\"ac\":\"SILECEK MOTORU GOLF IV 99>04\"}' WHERE code='TST GOLF'");
    const before = await snapshot();
    const dry = await derive({ dryRun: true });
    assert.equal(dry.status, "ok");
    assert.deepEqual(dry.written, { inserted: 1, updated: 1, deleted: 0, unchanged: 0, kept: 0 });
    assert.equal(await snapshot(), before, "a dry run writes nothing");
    assert.deepEqual((await derive()).written, dry.written);
    assert.equal(await count(), 2);
  });

  test("another derive holding the lock makes it busy without writing", async () => {
    await dinamik("TST GOLF 2", "VAG", "AYNA CAMI GOLF IV 98>04");
    const before = await snapshot();
    const holder = await schema.pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(20261106,1)");
      const busy = await derive();
      assert.equal(busy.status, "busy");
      assert.equal(busy.written, null);
    } finally { await holder.query("ROLLBACK"); holder.release(); }
    assert.equal(await snapshot(), before);
  });

  test("a derivation under 70% of 1000+ stored rows is refused unless shrinking is allowed", async () => {
    await schema.pool.query(`WITH s AS (INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
      product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
      SELECT 'basbug','BASBUG','G','MRK','OLD '||g,'{}','{}','{}',1,1,1,false,'present',now(),now(),now() FROM generate_series(1,1000) g RETURNING id)
      INSERT INTO product_model_fitments(supplier_item_id,model_id,source_text) SELECT id,10,'OLD' FROM s`);
    const before = await snapshot();
    const refused = await derive();
    assert.equal(refused.status, "refused");
    assert.match(refused.reason ?? "", /--allow-shrink/);
    assert.deepEqual([refused.rows, refused.existing, refused.written], [3, 1002, null]);
    assert.equal(await snapshot(), before, "a refused derive writes nothing");
    assert.equal((await derive({ dryRun: true })).status, "refused", "a dry run reports the refusal too");

    const allowed = await derive({ allowShrink: true });
    assert.equal(allowed.status, "ok");
    assert.deepEqual(allowed.written, { inserted: 1, updated: 0, deleted: 1000, unchanged: 2, kept: 0 });
    assert.equal(await count(), 3);
  });

  test("a derivation deleting over 10% of 1000+ stored rows is refused even when inserts keep the count level", async () => {
    await schema.pool.query(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
      product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
      SELECT 'dinamik','DINAMIK','G','MRK','BULK '||g,'{"uk":"TST","kull1s":"VAG","ac":"SILECEK GOLF IV 98>04"}','{}','{}',1,1,1,false,'present',now(),now(),now()
      FROM generate_series(1,1000) g`);
    assert.deepEqual((await derive()).written, { inserted: 1000, updated: 0, deleted: 0, unchanged: 3, kept: 0 });
    await schema.pool.query(`UPDATE supplier_items SET product_data=product_data||'{"ac":"FAR PASSAT 97>00"}'
      WHERE code IN (SELECT 'BULK '||g FROM generate_series(1,150) g)`);
    const before = await snapshot();
    const expected = { inserted: 150, updated: 0, deleted: 150, unchanged: 853, kept: 0 };
    const refused = await derive();
    assert.equal(refused.status, "refused");
    assert.match(refused.reason ?? "", /deletes 150 of the 1003/);
    assert.deepEqual([refused.rows, refused.diff, refused.written], [1003, expected, null]);
    assert.equal(await snapshot(), before, "a refused derive writes nothing");
    const dry = await derive({ dryRun: true });
    assert.deepEqual([dry.status, dry.diff], ["refused", expected], "a dry run shows the refused diff for review");

    assert.deepEqual((await derive({ allowShrink: true })).written, expected);
    assert.equal(await count(), 1003);
  });

  test("no present Dinamik item is refused before the matching pass", async () => {
    await schema.pool.query("UPDATE supplier_items SET presence='inactive' WHERE supplier='dinamik'");
    const before = await snapshot();
    const refused = await derive({ allowShrink: true });
    assert.equal(refused.status, "refused");
    assert.match(refused.reason ?? "", /no present Dinamik item/);
    assert.deepEqual([refused.items, refused.rows, refused.diff, refused.written], [0, 0, null, null]);
    assert.equal(await snapshot(), before);
  });

  test("an empty vehicle catalog is refused", async () => {
    await schema.pool.query("DELETE FROM vehicle_models");
    const refused = await derive();
    assert.equal(refused.status, "refused");
    assert.match(refused.reason ?? "", /catalog is empty/);
    assert.equal(refused.written, null);
  });
});

// The derive keeps the stored rows of present Dinamik items with a usable enrichment (#1370): its matching pass skips
// them, yet storefront_description_fits still lists them on make and model pages next to their engine fits.
describe("description fitment derive keeps the rows of enriched items", { skip: !process.env.DATABASE_URL }, () => {
  let schema: Awaited<ReturnType<typeof isolatedSchema>>;
  const ids: Record<string, string> = {};
  const EPOCH = "2026-01-01T00:00:00.000Z";
  const GOLF = "SILECEK MOTORU GOLF IV 98>04", PASSAT = "FAR SAG PASSAT 97>00";

  const derive = (options: Partial<DeriveOptions> = {}) => deriveIn(schema.pool, options);
  const snapshot = () => snapshotOf(schema.pool);
  async function item(key: string, text: string, options: { supplier?: string; presence?: string } = {}) {
    ids[key] = await insertItem(schema.pool, `TST ${key}`, text, options);
  }
  /** A shared enrichment: the job in `status`, a payload listing one vehicle or none. */
  async function enrich(items: string[], status: "complete" | "partial", vehicles: boolean) {
    await schema.pool.query(`INSERT INTO product_enrichment_jobs(supplier_item_id,supplier_code,supplier_brand,status)
      SELECT id,code,product_data->>'uk',$2 FROM supplier_items WHERE id=ANY($1::uuid[])`, [items, status]);
    await schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,payload)
      SELECT id,code,product_data->>'uk','https://example.test/p','test','TST',code,$2::jsonb FROM supplier_items WHERE id=ANY($1::uuid[])`,
    [items, JSON.stringify({ vehicles: vehicles ? [{ model: "GOLF IV" }] : [], specifications: [], oemNumbers: {} })]);
  }
  async function store(key: string, ...models: number[]) {
    await schema.pool.query(`INSERT INTO product_model_fitments(supplier_item_id,model_id,source_text,derived_at)
      SELECT $1,m,'OLD',$3 FROM unnest($2::int[]) m`, [ids[key], models, EPOCH]);
  }
  /** The named items' rows by `key:model`, each with its years, text, derived_at and xmin. */
  async function stored() {
    const keys = new Map(Object.entries(ids).map(([key, id]) => [id, key]));
    const rows = (await schema.pool.query<{ id: string; model_id: number; row: string }>(`SELECT supplier_item_id::text AS id,model_id,
      format('%s:%s:%s:%s:%s',year_from,year_to,source_text,derived_at,xmin) AS row FROM product_model_fitments
      WHERE supplier_item_id=ANY($1::uuid[])`, [Object.values(ids)])).rows;
    return new Map(rows.map(row => [`${keys.get(row.id)}:${row.model_id}`, row.row]));
  }

  before(async () => {
    schema = await isolatedSchema("desckeep");
    await schema.pool.query("INSERT INTO vehicle_brands(id,name,display_name) VALUES(1,'VW','VOLKSWAGEN')");
    await schema.pool.query(`INSERT INTO vehicle_models(id,brand_id,name,date_from,date_to) VALUES(10,1,'GOLF IV (1J1)','1997-08-01','2005-06-01'),
      (11,1,'PASSAT (3B2)','1996-08-01','2001-11-01')`);
  });
  after(async () => { await schema?.drop(); });

  // The tests share one schema and run in order.
  test("enriched present Dinamik items keep their rows; every other item the derive does not read loses them", async () => {
    await item("plain", GOLF);
    // Usable enrichments, complete or listing vehicles; each description names a model its stored rows lack.
    await item("enriched", PASSAT); await enrich([ids.enriched], "complete", true); await store("enriched", 10, 11);
    await item("partial", PASSAT); await enrich([ids.partial], "partial", true); await store("partial", 10);
    await item("bare", GOLF); await enrich([ids.bare], "complete", false); await store("bare", 11);
    // A partial enrichment without vehicles is not usable: the item is read like a plain one.
    await item("thin", GOLF); await enrich([ids.thin], "partial", false); await store("thin", 11);
    // Enriched but gone from Dinamik, or not a Dinamik item; and a present Dinamik item without a description.
    await item("inactive", GOLF, { presence: "inactive" }); await enrich([ids.inactive], "complete", true); await store("inactive", 10);
    await item("missing", GOLF, { presence: "pending_missing" }); await enrich([ids.missing], "complete", true); await store("missing", 10);
    await item("basbug", GOLF, { supplier: "basbug" }); await enrich([ids.basbug], "complete", true); await store("basbug", 10);
    await item("empty", ""); await store("empty", 10);
    const before = await stored();

    const expected = { inserted: 2, updated: 0, deleted: 5, unchanged: 0, kept: 4 };
    const dry = await derive({ dryRun: true });
    assert.deepEqual([dry.status, dry.items, dry.rows, dry.existing, dry.written], ["ok", 2, 2, 9, expected]);
    assert.deepEqual(await stored(), before, "a dry run writes nothing");
    const real = await derive();
    assert.deepEqual([real.status, real.diff, real.written], ["ok", expected, expected], "the write matches the dry-run diff, kept included");

    const after = await stored();
    assert.deepEqual([...after.keys()].sort(), ["bare:11", "enriched:10", "enriched:11", "partial:10", "plain:10", "thin:10"]);
    for (const key of ["bare:11", "enriched:10", "enriched:11", "partial:10"]) assert.equal(after.get(key), before.get(key), `${key} is kept untouched`);
  });

  test("an item moves from derived to kept when it gets an enrichment, and back when it loses it", async () => {
    // plain gets an enrichment and a description naming another model; bare loses its enrichment.
    await schema.pool.query(`UPDATE supplier_items SET product_data=product_data||jsonb_build_object('ac',$2::text) WHERE id=$1`, [ids.plain, PASSAT]);
    await enrich([ids.plain], "complete", true);
    await schema.pool.query("DELETE FROM product_enrichments WHERE supplier_item_id=$1", [ids.bare]);
    const before = await stored();

    const result = await derive();
    assert.deepEqual([result.status, result.items, result.written], ["ok", 2, { inserted: 1, updated: 0, deleted: 1, unchanged: 1, kept: 4 }]);
    const after = await stored();
    assert.equal(after.get("plain:10"), before.get("plain:10"), "the newly enriched item keeps its derived row untouched");
    assert.equal(after.has("plain:11"), false, "and gets no row from its new description");
    assert.deepEqual([after.has("bare:11"), after.has("bare:10")], [false, true], "an item that lost its enrichment is derived again");
  });

  test("the shrink guard counts the kept rows as remaining", async () => {
    await schema.pool.query(`WITH s AS (INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
      product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
      SELECT 'dinamik','DINAMIK','G','MRK','KEPT '||g,jsonb_build_object('uk','TST','kull1s','VAG','ac',$1::text),'{}','{}',1,1,1,false,'present',now(),now(),now()
      FROM generate_series(1,1000) g RETURNING id)
      INSERT INTO product_model_fitments(supplier_item_id,model_id,source_text) SELECT id,10,'OLD' FROM s`, [PASSAT]);
    await enrich((await schema.pool.query<{ ids: string[] }>("SELECT array_agg(id::text) AS ids FROM supplier_items WHERE code LIKE 'KEPT %'")).rows[0].ids,
      "complete", true);
    const ok = await derive();
    assert.equal(ok.status, "ok", ok.reason);
    assert.ok(ok.rows < ok.existing * SHRINK_GUARD_RATIO, "the derivation alone is under the guard");
    assert.deepEqual([ok.rows, ok.existing, ok.written], [2, 1006, { inserted: 0, updated: 0, deleted: 0, unchanged: 2, kept: 1004 }]);

    // 400 enriched items leave Dinamik: 606 of the 1006 rows would remain.
    await schema.pool.query("UPDATE supplier_items SET presence='inactive' WHERE code IN (SELECT 'KEPT '||g FROM generate_series(1,400) g)");
    const before = await snapshot();
    const refused = await derive();
    assert.equal(refused.status, "refused");
    assert.match(refused.reason ?? "", /leaves 606 rows \(2 derived, 604 kept\), under 70% of the 1006 stored/);
    assert.deepEqual([refused.diff, refused.written], [{ inserted: 0, updated: 0, deleted: 400, unchanged: 2, kept: 604 }, null]);
    assert.equal(await snapshot(), before, "a refused derive writes nothing");
    await schema.pool.query("UPDATE supplier_items SET presence='present' WHERE code LIKE 'KEPT %'");
  });

  test("the delete guard counts only the rows it deletes, not the kept ones", async () => {
    // The 1004 kept rows passed above; 150 enriched items leaving Dinamik are deletions.
    await schema.pool.query("UPDATE supplier_items SET presence='inactive' WHERE code IN (SELECT 'KEPT '||g FROM generate_series(1,150) g)");
    const before = await snapshot();
    const expected = { inserted: 0, updated: 0, deleted: 150, unchanged: 2, kept: 854 };
    const refused = await derive();
    assert.equal(refused.status, "refused");
    assert.match(refused.reason ?? "", /deletes 150 of the 1006/);
    assert.deepEqual([refused.diff, refused.written], [expected, null]);
    assert.equal(await snapshot(), before, "a refused derive writes nothing");
    assert.deepEqual((await derive({ allowShrink: true })).written, expected);
    assert.equal(await countOf(schema.pool), 856);
  });
});

test("the CLI rejects an unknown flag with its usage and exit code 64", () => {
  const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/description-fitments.ts", "derive", "--bogus"], { encoding: "utf8" });
  assert.equal(run.status, 64);
  assert.match(run.stderr, /^Usage: description-fitments\.ts derive/);
  assert.equal(run.stdout, "");
});
