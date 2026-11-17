import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { Client, Pool } from "pg";
import { isolatedSchema } from "./isolated-schema";

// The matcher locks are per schema outside public (#792, #829): slot 5 (matcher / state sync), 6 (admin regrouping)
// and 7 (brand decisions). An isolated test schema must not queue behind the dev server's matcher, while the callers
// of one schema still share each key.
const original = process.env.DATABASE_URL;
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let store: typeof import("../src/modules/admin/product-override-store");
let closeDb: (() => Promise<void>) | undefined;
const marker = "00000000-0000-0000-0000-000000000000";

before(async () => {
  schema = await isolatedSchema("product_match_lock_test");
  const [{ db }, storeModule] = await Promise.all([import("../src/lib/db"), import("../src/modules/admin/product-override-store")]);
  store = storeModule;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

const key = async (sql: string) => (await schema.pool.query<{ key: number }>(`SELECT ${sql} AS key`)).rows[0].key;

test("public keeps the slot, other schemas get distinct negative keys", async () => {
  assert.equal(await key("schema_lock_key(5,'public')"), 5);
  assert.equal(await key("schema_lock_key(5,NULL)"), 5);
  assert.ok(await key("schema_lock_key(5)") < 0);
  assert.notEqual(await key("schema_lock_key(5,'a')"), await key("schema_lock_key(5,'b')"));
  assert.notEqual(await key("schema_lock_key(5)"), await key("schema_lock_key(6)"));
  assert.equal(await key("schema_lock_key(6,'public')"), 6);
  assert.equal(await key("schema_lock_key(7,'public')"), 7);
  const isolated = [await key("schema_lock_key(5)"), await key("schema_lock_key(6)"), await key("schema_lock_key(7)")];
  assert.ok(isolated[1] < 0 && isolated[2] < 0);
  assert.equal(new Set(isolated).size, 3);
});

test("the matcher in an isolated schema does not wait for the public locks", async () => {
  const outside = new Client({ connectionString: original });
  await outside.connect();
  const held: number[] = [];
  try {
    // Try-lock only: when someone else (a dev server) already holds a slot the precondition holds as well.
    for (const slot of [5, 6, 7]) {
      const { rows } = await outside.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(20261001,$1) AS locked", [slot]);
      if (rows[0].locked) held.push(slot);
    }
    const client = await schema.pool.connect();
    try {
      await client.query("SET lock_timeout='5s'");
      const { rows } = await client.query<{ result: unknown }>("SELECT refresh_product_matches() AS result");
      assert.ok(rows[0].result);
    } finally {
      await client.query("RESET lock_timeout");
      client.release();
    }
  } finally {
    for (const slot of held) await outside.query("SELECT pg_advisory_unlock(20261001,$1)", [slot]);
    await outside.end();
  }
});

// Runs `body` while another session of the isolated schema holds the slot's key.
async function whileHeld(slot: number, body: () => Promise<void>) {
  const holder = await schema.pool.connect();
  try {
    await holder.query("BEGIN");
    await holder.query("SELECT pg_advisory_xact_lock(20261001,schema_lock_key($1))", [slot]);
    await body();
  } finally {
    await holder.query("ROLLBACK");
    holder.release();
  }
}

async function rejectsTimedOut(sql: string) {
  const client = await schema.pool.connect();
  try {
    await client.query("SET lock_timeout='300ms'");
    await assert.rejects(client.query(sql), { code: "55P03" });
  } finally {
    await client.query("RESET lock_timeout");
    client.release();
  }
}

test("the matcher, admin regrouping and override saves of one schema share slot 6", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.searchParams.set("options", `${url.searchParams.get("options") ?? ""} -c lock_timeout=300ms`.trim());
  const timedPool = new Pool({ connectionString: url.toString(), max: 1 });
  try {
    await whileHeld(6, async () => {
      await rejectsTimedOut("SELECT refresh_product_matches()");
      await rejectsTimedOut("SELECT product_merge(gen_random_uuid(),gen_random_uuid(),NULL)");
      await assert.rejects(store.persistProductOverride(timedPool, randomUUID(), {}, randomUUID()), { code: "55P03" });
    });
  } finally {
    await timedPool.end();
  }
});

test("brand decisions of one schema share slot 7", async () => {
  await whileHeld(7, () => rejectsTimedOut("SELECT sync_supplier_brands()"));
});

test("no matcher lock is taken with a fixed key", async () => {
  const files = { sql: await readFile("db/product-matching.sql", "utf8"), store: await readFile("src/modules/admin/product-override-store.ts", "utf8"),
    actions: await readFile("src/app/yonetim/urun-eslestirme/actions.ts", "utf8") };
  for (const [name, source] of Object.entries(files)) assert.doesNotMatch(source, /advisory_xact_lock\(20261001,\s*[567]\)/, name);
  const count = (source: string, slot: number) => source.split(`schema_lock_key(${slot})`).length - 1;
  assert.equal(count(files.sql, 6), 5);
  assert.equal(count(files.sql, 7), 2);
  assert.equal(count(files.store, 6), 1);
  assert.equal(count(files.actions, 7), 1);
});

test("the matcher and the state sync of one schema share the lock", async () => {
  const sync = async () => (await schema.pool.query<{ changed: number }>("SELECT enrichment_product_states_sync() AS changed")).rows[0].changed;
  const queued = async () => Number((await schema.pool.query<{ count: string }>("SELECT count(*) FROM enrichment_product_state_queue")).rows[0].count);
  await sync();
  await schema.pool.query("INSERT INTO enrichment_product_state_queue(product_id) VALUES($1) ON CONFLICT DO NOTHING", [marker]);
  const queuedBefore = await queued();
  assert.ok(queuedBefore > 0);
  const holder = await schema.pool.connect();
  try {
    await holder.query("BEGIN");
    await holder.query("SELECT pg_advisory_xact_lock(20261001,schema_lock_key(5))");
    assert.equal(await sync(), 0);
    assert.equal(await queued(), queuedBefore);
    // The matcher takes the same key, so it queues behind the holder too.
    const matcher = await schema.pool.connect();
    try {
      await matcher.query("SET lock_timeout='300ms'");
      await assert.rejects(matcher.query("SELECT refresh_product_matches()"), { code: "55P03" });
    } finally {
      await matcher.query("RESET lock_timeout");
      matcher.release();
    }
  } finally {
    await holder.query("ROLLBACK");
    holder.release();
  }
  await sync();
  assert.equal(await queued(), 0);
});
