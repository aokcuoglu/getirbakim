import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "pg";
import { isolatedSchema } from "./isolated-schema";

// The matcher / state sync lock (20261001,5) is per schema outside public (#792): an isolated test schema must not
// queue behind the dev server's matcher, while the matcher and the state sync of one schema still share the key.
const original = process.env.DATABASE_URL;
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
const marker = "00000000-0000-0000-0000-000000000000";

before(async () => { schema = await isolatedSchema("product_match_lock_test"); });
after(async () => { await schema?.drop(); });

const key = async (sql: string) => (await schema.pool.query<{ key: number }>(`SELECT ${sql} AS key`)).rows[0].key;

test("public keeps the slot, other schemas get distinct negative keys", async () => {
  assert.equal(await key("schema_lock_key(5,'public')"), 5);
  assert.equal(await key("schema_lock_key(5,NULL)"), 5);
  assert.ok(await key("schema_lock_key(5)") < 0);
  assert.notEqual(await key("schema_lock_key(5,'a')"), await key("schema_lock_key(5,'b')"));
  assert.notEqual(await key("schema_lock_key(5)"), await key("schema_lock_key(6)"));
});

test("the matcher in an isolated schema does not wait for the public lock", async () => {
  const outside = new Client({ connectionString: original });
  await outside.connect();
  let held = false;
  try {
    // Try-lock only: when someone else (a dev server) already holds it the precondition holds as well.
    held = (await outside.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(20261001,5) AS locked")).rows[0].locked;
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
    if (held) await outside.query("SELECT pg_advisory_unlock(20261001,5)");
    await outside.end();
  }
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
