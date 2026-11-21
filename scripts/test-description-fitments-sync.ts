import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, describe, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { deriveDescriptionFitments, type DeriveOptions } from "../src/modules/store/description-fitment-derive";
import { diffDescriptionFitments, loadDescriptionFitmentsNext, writeDescriptionFitments, type DescriptionFitmentRow } from "../src/modules/store/description-fitment-sync";

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
    assert.deepEqual(await write(first()), { inserted: 7, updated: 0, deleted: 0, unchanged: 0 });
    await schema.pool.query("UPDATE product_model_fitments SET derived_at=$1", [EPOCH]);
    const before = await stored();

    assert.deepEqual(await diff(second()), { inserted: 1, updated: 4, deleted: 1, unchanged: 2 }, "the dry-run diff counts what the write then does");
    assert.deepEqual(await write(second()), { inserted: 1, updated: 4, deleted: 1, unchanged: 2 });
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

    assert.deepEqual(await write(second()), { inserted: 0, updated: 0, deleted: 0, unchanged: 7 });
    const again = await stored();
    for (const [key, value] of after) assert.equal(again.get(key)?.xmin, value.xmin, `${key} is not rewritten by an identical sync`);
  });

  test("dropping one of a product's models moves the derived_at of its remaining rows", async () => {
    await write([]);
    await write([row("F", 10, 2000, 2004), row("F", 11, 2000, 2004), row("G", 10, null, null)]);
    await schema.pool.query("UPDATE product_model_fitments SET derived_at=$1", [EPOCH]);
    const before = await stored();

    assert.deepEqual(await write([row("F", 10, 2000, 2004), row("G", 10, null, null)]), { inserted: 0, updated: 0, deleted: 1, unchanged: 2 });
    const after = await stored();
    assert.deepEqual(new Set(after.keys()), new Set(["F:10", "G:10"]));
    assert.ok(after.get("F:10")!.derived_at > EPOCH, "the product's lastmod still moves");
    assert.equal(after.get("G:10")?.derived_at, EPOCH);
    assert.equal(after.get("G:10")?.xmin, before.get("G:10")?.xmin, "an unrelated product is not rewritten");
  });

  test("two syncs in one transaction work and an empty derivation empties the table", async () => {
    await write([]);
    assert.deepEqual(await write(second()), { inserted: 7, updated: 0, deleted: 0, unchanged: 0 });
    const client = await schema.pool.connect();
    try {
      await client.query("BEGIN");
      assert.deepEqual(await writeDescriptionFitments(client, second()), { inserted: 0, updated: 0, deleted: 0, unchanged: 7 });
      assert.deepEqual(await writeDescriptionFitments(client, []), { inserted: 0, updated: 0, deleted: 7, unchanged: 0 });
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    assert.equal((await schema.pool.query("SELECT 1 FROM product_model_fitments")).rowCount, 0);
  });
});

// The derive (#562) runs as an AWS operations task: a dry run diffs without writing, a busy lock or a guard stops it
// before anything is written.
describe("description fitment derive", { skip: !process.env.DATABASE_URL }, () => {
  let schema: Awaited<ReturnType<typeof isolatedSchema>>;

  async function derive(options: Partial<DeriveOptions> = {}) {
    const client = await schema.pool.connect();
    try { return await deriveDescriptionFitments(client, { dryRun: false, allowShrink: false, ...options }); } finally { client.release(); }
  }
  const snapshot = async () => (await schema.pool.query<{ key: string }>(`SELECT string_agg(concat_ws(':',supplier_item_id,model_id,year_from,year_to,
    source_text,derived_at,xmin),',' ORDER BY supplier_item_id,model_id) AS key FROM product_model_fitments`)).rows[0].key;
  const count = async () => (await schema.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM product_model_fitments")).rows[0].n;
  async function dinamik(code: string, make: string, text: string) {
    return (await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
      product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
      VALUES('dinamik','DINAMIK','G','MRK',$1,jsonb_build_object('uk','TST','kull1s',$2::text,'ac',$3::text),'{"nf":100}','{"stok":2}',1,1,1,false,'present',now(),now(),now())
      RETURNING id::text`, [code, make, text])).rows[0].id;
  }

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
    assert.deepEqual(first.written, { inserted: 1, updated: 0, deleted: 0, unchanged: 0 });
    assert.deepEqual((await schema.pool.query("SELECT supplier_item_id::text,model_id,year_from,year_to FROM product_model_fitments")).rows,
      [{ supplier_item_id: golf, model_id: 10, year_from: 1998, year_to: 2004 }]);
    const stored = await snapshot();
    const second = await derive();
    assert.deepEqual(second.written, { inserted: 0, updated: 0, deleted: 0, unchanged: 1 });
    assert.equal(await snapshot(), stored, "an identical derive rewrites nothing");
  });

  test("a dry run leaves the table untouched and reports what the real run then writes", async () => {
    await dinamik("TST PASSAT", "VAG", "FAR SAG PASSAT 97>00");
    await schema.pool.query("UPDATE supplier_items SET product_data=product_data||'{\"ac\":\"SILECEK MOTORU GOLF IV 99>04\"}' WHERE code='TST GOLF'");
    const before = await snapshot();
    const dry = await derive({ dryRun: true });
    assert.equal(dry.status, "ok");
    assert.deepEqual(dry.written, { inserted: 1, updated: 1, deleted: 0, unchanged: 0 });
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
    assert.deepEqual(allowed.written, { inserted: 1, updated: 0, deleted: 1000, unchanged: 2 });
    assert.equal(await count(), 3);
  });

  test("a derivation deleting over 10% of 1000+ stored rows is refused even when inserts keep the count level", async () => {
    await schema.pool.query(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
      product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
      SELECT 'dinamik','DINAMIK','G','MRK','BULK '||g,'{"uk":"TST","kull1s":"VAG","ac":"SILECEK GOLF IV 98>04"}','{}','{}',1,1,1,false,'present',now(),now(),now()
      FROM generate_series(1,1000) g`);
    assert.deepEqual((await derive()).written, { inserted: 1000, updated: 0, deleted: 0, unchanged: 3 });
    await schema.pool.query(`UPDATE supplier_items SET product_data=product_data||'{"ac":"FAR PASSAT 97>00"}'
      WHERE code IN (SELECT 'BULK '||g FROM generate_series(1,150) g)`);
    const before = await snapshot();
    const expected = { inserted: 150, updated: 0, deleted: 150, unchanged: 853 };
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

test("the CLI rejects an unknown flag with its usage and exit code 64", () => {
  const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/description-fitments.ts", "derive", "--bogus"], { encoding: "utf8" });
  assert.equal(run.status, 64);
  assert.match(run.stderr, /^Usage: description-fitments\.ts derive/);
  assert.equal(run.stdout, "");
});
