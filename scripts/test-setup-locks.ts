import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "pg";
import { applySetupFiles, isolatedSchema } from "./isolated-schema";

// db:setup re-runs every setup file on each deploy while the previous release serves traffic (#925). On an already
// set-up database it must not take ACCESS EXCLUSIVE on the tables the storefront and /yonetim read: such a lock is held
// until the single setup transaction commits and queues every reader behind it. The first run (isolatedSchema) creates
// the schema; the tests measure the second one.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
const hot = ["accounts", "guest_carts", "supplier_items", "products", "product_sources", "product_offers", "product_enrichments",
  "product_enrichment_jobs", "product_vehicle_fitments", "enrichment_product_states", "enrichment_runs", "enrichment_run_items", "vehicle_types",
  "vehicle_models"];

before(async () => { schema = await isolatedSchema("setup_locks"); });
after(async () => { await schema?.drop(); });

const connect = async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
};

test("a second setup run takes no ACCESS EXCLUSIVE lock on the hot tables", async (t) => {
  const client = await schema.pool.connect();
  try {
    await client.query("BEGIN");
    await applySetupFiles(client);
    const { rows } = await client.query<{ relname: string; relkind: string }>(
      `SELECT c.relname,c.relkind FROM pg_locks l JOIN pg_class c ON c.oid=l.relation JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE l.pid=pg_backend_pid() AND l.locktype='relation' AND l.mode='AccessExclusiveLock' AND n.nspname=$1
       ORDER BY c.relkind,c.relname`, [schema.name]);
    // The rest (views, other tables) is the inventory for follow-up work.
    for (const row of rows) t.diagnostic(`ACCESS EXCLUSIVE: ${row.relkind} ${row.relname}`);
    assert.deepEqual(rows.filter((row) => row.relkind === "r" && hot.includes(row.relname)).map((row) => row.relname), []);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
});

// Triggers on these tables are created only when missing: CREATE [OR REPLACE] TRIGGER takes SHARE ROW EXCLUSIVE, which
// queues every insert, update and delete behind setup until it commits.
const writeHot = ["accounts", "guest_carts", "supplier_items", "products", "product_sources", "product_enrichments", "product_enrichment_jobs",
  "product_vehicle_fitments", "vehicle_types", "vehicle_models"];

test("a second setup run takes no writer-blocking lock on the write-hot tables", async (t) => {
  const client = await schema.pool.connect();
  try {
    await client.query("BEGIN");
    await applySetupFiles(client);
    const { rows } = await client.query<{ relname: string; mode: string }>(
      `SELECT c.relname,l.mode FROM pg_locks l JOIN pg_class c ON c.oid=l.relation
       WHERE l.pid=pg_backend_pid() AND l.locktype='relation' AND c.relname=ANY($1) AND c.relnamespace=$2::regnamespace
        AND l.mode IN ('ShareLock','ShareRowExclusiveLock','ExclusiveLock','AccessExclusiveLock') ORDER BY 1,2`, [writeHot, schema.name]);
    for (const row of rows) t.diagnostic(`${row.mode}: ${row.relname}`);
    // CREATE INDEX IF NOT EXISTS still takes SHARE on its table before it finds the index: reported, not asserted.
    assert.deepEqual(rows.filter((row) => row.mode !== "ShareLock").map((row) => `${row.mode}: ${row.relname}`), []);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
});

test("a second setup run keeps constraints, indexes and triggers", async () => {
  const snapshot = async () => {
    const { rows } = await schema.pool.query<{ entry: string }>(
      `SELECT 'constraint '||conrelid::regclass||'.'||conname||' '||oid AS entry FROM pg_constraint WHERE connamespace=$1::regnamespace
       UNION ALL SELECT 'index '||c.relname||' '||i.indexrelid FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
       WHERE c.relnamespace=$1::regnamespace
       UNION ALL SELECT 'trigger '||tgrelid::regclass||'.'||tgname||' '||t.oid FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
       WHERE c.relnamespace=$1::regnamespace AND NOT t.tgisinternal`, [schema.name]);
    return new Set(rows.map((row) => row.entry));
  };
  const before = await snapshot();
  const client = await schema.pool.connect();
  try {
    await applySetupFiles(client);
  } finally {
    client.release();
  }
  const afterRun = await snapshot();
  // Only the differences, so a failure names the recreated objects instead of printing the whole catalog.
  assert.deepEqual({ dropped: [...before].filter((entry) => !afterRun.has(entry)).sort(), added: [...afterRun].filter((entry) => !before.has(entry)).sort() },
    { dropped: [], added: [] });
});

test("a second setup run does not wait for, or block, readers of the hot tables", async () => {
  const reader = await connect();
  const setup = await schema.pool.connect();
  const probe = await connect();
  try {
    await reader.query("BEGIN");
    await reader.query(`LOCK TABLE ${hot.join(",")} IN ACCESS SHARE MODE`);
    await setup.query("BEGIN");
    await setup.query("SET LOCAL lock_timeout='2s'");
    await applySetupFiles(setup);
    await probe.query("SET statement_timeout='2s'");
    for (const table of hot) await probe.query(`SELECT 1 FROM ${table} LIMIT 1`);
    await setup.query("COMMIT");
  } finally {
    await setup.query("ROLLBACK").catch(() => undefined);
    setup.release();
    await reader.query("ROLLBACK").catch(() => undefined);
    await Promise.all([reader.end(), probe.end()]);
  }
});

const rerun = async () => {
  const client = await schema.pool.connect();
  try {
    await applySetupFiles(client);
  } finally {
    client.release();
  }
};

test("a value list that differs in any way is still replaced", async () => {
  const definition = async () => (await schema.pool.query<{ def: string }>(
    "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='supplier_items'::regclass AND conname='supplier_items_supplier_check'")).rows[0].def;
  const current = await definition();
  // An older list (missing the newest value) and one with a value dropped but the newest kept.
  for (const list of ["'basbug','dinamik','seta'", "'basbug','dinamik','manual'"]) {
    await schema.pool.query(`ALTER TABLE supplier_items DROP CONSTRAINT supplier_items_supplier_check,
      ADD CONSTRAINT supplier_items_supplier_check CHECK (supplier IN (${list}))`);
    assert.notEqual(await definition(), current);
    await rerun();
    assert.equal(await definition(), current);
  }
});

test("columns in an older shape are still altered", async () => {
  const column = async () => (await schema.pool.query<{ notnull: boolean; hasdef: boolean }>(
    "SELECT attnotnull AS notnull,atthasdef AS hasdef FROM pg_attribute WHERE attrelid='supplier_imports'::regclass AND attname='completed_at'")).rows[0];
  assert.deepEqual(await column(), { notnull: false, hasdef: false });
  await schema.pool.query("ALTER TABLE supplier_imports ALTER COLUMN completed_at SET DEFAULT now(), ALTER COLUMN completed_at SET NOT NULL");
  await rerun();
  assert.deepEqual(await column(), { notnull: false, hasdef: false });
});
