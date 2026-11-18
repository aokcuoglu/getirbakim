import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "pg";
import { applySetupFiles, isolatedSchema } from "./isolated-schema";

// db:setup re-runs every setup file on each deploy while the previous release serves traffic (#925, #954). On an already
// set-up database it must not take ACCESS EXCLUSIVE on any table or view: such a lock is held until the single setup
// transaction commits and queues every reader behind it. The first run (isolatedSchema) creates the schema; the tests
// measure the second one.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
before(async () => { schema = await isolatedSchema("setup_locks"); });
after(async () => { await schema?.drop(); });

const connect = async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
};

test("a second setup run takes no ACCESS EXCLUSIVE lock on any table or view", async () => {
  const client = await schema.pool.connect();
  try {
    await client.query("BEGIN");
    await applySetupFiles(client);
    const { rows } = await client.query<{ relname: string; relkind: string }>(
      `SELECT c.relname,c.relkind FROM pg_locks l JOIN pg_class c ON c.oid=l.relation JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE l.pid=pg_backend_pid() AND l.locktype='relation' AND l.mode='AccessExclusiveLock' AND n.nspname=$1
       ORDER BY c.relkind,c.relname`, [schema.name]);
    assert.deepEqual(rows.map((row) => `${row.relkind} ${row.relname}`), []);
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

test("a second setup run keeps constraints, indexes, triggers and views", async () => {
  const snapshot = async () => {
    const { rows } = await schema.pool.query<{ entry: string }>(
      `SELECT 'constraint '||conrelid::regclass||'.'||conname||' '||oid AS entry FROM pg_constraint WHERE connamespace=$1::regnamespace
       UNION ALL SELECT 'index '||c.relname||' '||i.indexrelid FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
       WHERE c.relnamespace=$1::regnamespace
       UNION ALL SELECT 'trigger '||tgrelid::regclass||'.'||tgname||' '||t.oid FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
       WHERE c.relnamespace=$1::regnamespace AND NOT t.tgisinternal
       UNION ALL SELECT 'view '||relname||' '||md5(pg_get_viewdef(oid)) FROM pg_class WHERE relnamespace=$1::regnamespace AND relkind='v'`,
      [schema.name]);
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

test("a second setup run does not wait for, or block, readers of any table or view", async () => {
  const reader = await connect();
  const setup = await schema.pool.connect();
  const probe = await connect();
  try {
    const relations = (await schema.pool.query<{ name: string }>(
      "SELECT quote_ident(relname) AS name FROM pg_class WHERE relnamespace=$1::regnamespace AND relkind IN ('r','v') ORDER BY relname",
      [schema.name])).rows.map((row) => `${schema.name}.${row.name}`);
    await reader.query("BEGIN");
    await reader.query(`LOCK TABLE ${relations.join(",")} IN ACCESS SHARE MODE`);
    await setup.query("BEGIN");
    await setup.query("SET LOCAL lock_timeout='2s'");
    await applySetupFiles(setup);
    await probe.query("SET statement_timeout='2s'");
    for (const relation of relations) await probe.query(`SELECT 1 FROM ${relation} LIMIT 1`);
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

test("a changed or missing view is still replaced", async () => {
  const definition = async (view: string) => (await schema.pool.query<{ def: string | null }>(
    `SELECT (SELECT pg_get_viewdef(oid) FROM pg_class WHERE relname=$1 AND relnamespace=$2::regnamespace AND relkind='v') AS def`,
    [view, schema.name])).rows[0].def;
  // An older body with the same columns.
  const current = await definition("brand_key_aliases");
  assert.ok(current);
  await schema.pool.query(`CREATE OR REPLACE VIEW brand_key_aliases AS SELECT * FROM (${current.replace(/;\s*$/, "")}) s WHERE false`);
  assert.notEqual(await definition("brand_key_aliases"), current);
  await rerun();
  assert.equal(await definition("brand_key_aliases"), current);
  // A dropped view (nothing depends on storefront_catalog) is created again.
  const catalog = await definition("storefront_catalog");
  await schema.pool.query("DROP VIEW storefront_catalog");
  await rerun();
  assert.equal(await definition("storefront_catalog"), catalog);
  // A column added behind a `*` changes the expanded definition, so the view picks it up.
  const columns = async () => (await schema.pool.query<{ attname: string }>(
    "SELECT attname FROM pg_attribute WHERE attrelid='commerce_supplier_items'::regclass AND attnum>0 AND NOT attisdropped")).rows.map((row) => row.attname);
  assert.ok(!(await columns()).includes("setup_probe"));
  await schema.pool.query("ALTER TABLE supplier_items ADD COLUMN setup_probe text");
  await rerun();
  assert.ok((await columns()).includes("setup_probe"));
});

test("vehicle catalog revision triggers exist per table", async () => {
  const triggers = async () => (await schema.pool.query<{ entry: string }>(
    `SELECT tgrelid::regclass||'.'||tgname||' '||t.oid AS entry FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
     WHERE c.relnamespace=$1::regnamespace AND tgname IN ('vehicle_brands_revision','vehicle_models_revision','vehicle_types_revision')
     ORDER BY tgname`, [schema.name])).rows.map((row) => row.entry);
  const created = await triggers();
  assert.deepEqual(created.map((entry) => entry.split(" ")[0]),
    ["vehicle_brands.vehicle_brands_revision", "vehicle_models.vehicle_models_revision", "vehicle_types.vehicle_types_revision"]);
  await schema.pool.query("DROP TRIGGER vehicle_models_revision ON vehicle_models");
  await rerun();
  const recreated = await triggers();
  assert.equal(recreated.length, 3);
  // Only the dropped one is new; the others keep their oid.
  assert.deepEqual(recreated.filter((entry) => !created.includes(entry)).map((entry) => entry.split(" ")[0]), ["vehicle_models.vehicle_models_revision"]);
});
