import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { Client, Pool, type PoolClient } from "pg";
import { migrateSupplierSnapshots } from "../src/modules/suppliers/sync";
import { isolatedSchema, setupFiles } from "./isolated-schema";
import { createConcurrentIndexes } from "./setup-concurrent-indexes";

// db:setup changing nested views under live storefront reads (#1046). The v0.31.0 release replaced
// commerce_catalog_entries and later storefront_catalog_entries in one transaction; a storefront query that locked the
// outer view in between waited for the inner one while setup waited for the outer one: 40P01 on every retry.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
before(async () => { schema = await isolatedSchema("setup_view_locks"); });
after(async () => { await schema?.drop(); });

const connect = async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
};
const pidOf = async (client: Client | PoolClient) => (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
/** Waits until `pid` waits for a lock; the steps below depend on that order. */
const waitingForLock = async (monitor: Client, pid: number) => {
  for (let attempt = 0; attempt < 400; attempt++) {
    if ((await monitor.query("SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted", [pid])).rowCount) return;
    await sleep(25);
  }
  throw new Error(`backend ${pid} never waited for a lock`);
};
const accessExclusive = async (monitor: Client, pid: number) => (await monitor.query<{ entry: string }>(
  `SELECT c.relkind::text||' '||c.relname AS entry FROM pg_locks l JOIN pg_class c ON c.oid=l.relation
   WHERE l.pid=$1 AND l.granted AND l.mode='AccessExclusiveLock' AND c.relnamespace=$2::regnamespace ORDER BY 1`,
  [pid, schema.name])).rows.map((row) => row.entry);

/** scripts/setup.ts's files on `client`; `withoutLockOrder` strips the setup_lock_dependent_views calls (the v0.31.0 state). */
async function applySetup(client: PoolClient, withoutLockOrder = false) {
  for (const file of setupFiles) {
    if (file === "commerce") await migrateSupplierSnapshots(client);
    const sql = await readFile(`db/${file}.sql`, "utf8");
    await client.query(withoutLockOrder ? sql.replace(/IF cur IS NOT NULL THEN PERFORM setup_lock_dependent_views\(cur\); END IF;/g, "")
      .replace(/PERFORM setup_lock_dependent_views\('\w+'\);/g, "") : sql);
  }
}

/** Gives views an older body with the same columns, so the next setup run replaces them. */
async function makeStale(views: string[]) {
  for (const view of views) {
    const { rows: [{ def }] } = await schema.pool.query<{ def: string }>("SELECT pg_get_viewdef($1::regclass) AS def", [view]);
    await schema.pool.query(`CREATE OR REPLACE VIEW ${view} AS SELECT * FROM (${def.replace(/;\s*$/, "")}) stale`);
  }
}

test("dependent views are locked outermost first, and never their base tables", async () => {
  const monitor = await connect();
  const blocker = await connect();
  const setup = await schema.pool.connect();
  try {
    // A storefront read in progress holds storefront_catalog and everything under it.
    await blocker.query("BEGIN");
    await blocker.query("SELECT 1 FROM storefront_catalog LIMIT 0");
    await setup.query("BEGIN");
    const pid = await pidOf(setup);
    const locking = setup.query("SELECT setup_lock_dependent_views('commerce_supplier_items')");
    await waitingForLock(monitor, pid);
    // Waiting for an outermost view (storefront_catalog), setup holds no view the reader is about to need.
    const { rows: [waits] } = await monitor.query<{ relname: string }>(
      "SELECT c.relname FROM pg_locks l JOIN pg_class c ON c.oid=l.relation WHERE l.pid=$1 AND NOT l.granted", [pid]);
    assert.equal(waits.relname, "storefront_catalog");
    assert.deepEqual((await accessExclusive(monitor, pid)).filter((entry) => entry !== "v storefront_catalog_entries"), []);
    await blocker.query("COMMIT");
    await locking;
    assert.deepEqual(await accessExclusive(monitor, pid), ["v commerce_catalog", "v commerce_catalog_entries",
      "v commerce_dropped_items", "v commerce_item_availability", "v commerce_unavailable_items", "v storefront_catalog", "v storefront_catalog_entries"]);
    // A table's dependents, without the table itself.
    await setup.query("SELECT setup_lock_dependent_views('supplier_items')");
    assert.ok(!(await accessExclusive(monitor, pid)).some((entry) => entry.startsWith("r ")));
  } finally {
    // The blocker first: a failed assertion leaves setup's statement waiting for it.
    await blocker.query("ROLLBACK").catch(() => undefined);
    await setup.query("ROLLBACK").catch(() => undefined);
    setup.release();
    await Promise.all([monitor.end(), blocker.end()]);
  }
});

/**
 * Replaces commerce_catalog_entries, commerce_catalog and storefront_catalog_entries while a storefront read of
 * storefront_catalog_entries arrives between the inner and the outer replacement. A blocker reading commerce_catalog
 * holds setup between the two; the read starts once setup waits for it. Returns the error codes of setup and the read.
 */
async function replaceUnderRead(withoutLockOrder: boolean) {
  await makeStale(["commerce_catalog_entries", "commerce_catalog", "storefront_catalog_entries"]);
  const monitor = await connect();
  const blocker = await connect();
  const reader = await connect();
  const setup = await schema.pool.connect();
  const code = (error: unknown) => (error as { code?: string }).code ?? String(error);
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT 1 FROM commerce_catalog LIMIT 0");
    await setup.query("BEGIN");
    await setup.query("SET LOCAL lock_timeout='20s'");
    const setupPid = await pidOf(setup);
    const setupRun = applySetup(setup, withoutLockOrder).then(() => setup.query("COMMIT")).then(() => null, code);
    await waitingForLock(monitor, setupPid);
    await reader.query("BEGIN");
    const readerPid = await pidOf(reader);
    const read = reader.query("SELECT count(*) FROM storefront_catalog_entries").then(() => reader.query("COMMIT")).then(() => null, code);
    await waitingForLock(monitor, readerPid);
    await blocker.query("COMMIT");
    return { setup: await setupRun, read: await read };
  } finally {
    await Promise.all([blocker, reader].map((client) => client.query("ROLLBACK").catch(() => undefined)));
    await setup.query("ROLLBACK").catch(() => undefined);
    setup.release();
    await Promise.all([monitor.end(), blocker.end(), reader.end()]);
  }
}

test("without the lock order, replacing the view chain deadlocks with a storefront read (v0.31.0)", async () => {
  const result = await replaceUnderRead(true);
  assert.ok(result.setup === "40P01" || result.read === "40P01", JSON.stringify(result));
});

test("replacing the view chain under a storefront read neither deadlocks nor fails", async () => {
  assert.deepEqual(await replaceUnderRead(false), { setup: null, read: null });
  // The chain has its current bodies again: a further run changes nothing.
  const views = async () => (await schema.pool.query<{ entry: string }>(
    "SELECT relname||' '||md5(pg_get_viewdef(oid)) AS entry FROM pg_class WHERE relnamespace=$1::regnamespace AND relkind='v' ORDER BY 1",
    [schema.name])).rows.map((row) => row.entry);
  const replaced = await views();
  const client = await schema.pool.connect();
  try { await applySetup(client); } finally { client.release(); }
  assert.deepEqual(await views(), replaced);
});

const brandLabelIndex = async () => (await schema.pool.query<{ oid: number; def: string; valid: boolean }>(
  `SELECT i.indexrelid::int AS oid,pg_get_indexdef(i.indexrelid) AS def,i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
   WHERE i.indrelid='supplier_items'::regclass AND c.relname='supplier_items_brand_label_idx'`)).rows[0];

test("setup's concurrent index matches the schema file's, and the schema file then leaves it alone", async () => {
  const created = await brandLabelIndex();
  assert.ok(created?.valid);
  await schema.pool.query("DROP INDEX supplier_items_brand_label_idx");
  await createConcurrentIndexes(schema.pool);
  const concurrent = await brandLabelIndex();
  assert.deepEqual({ def: concurrent.def, valid: concurrent.valid }, { def: created.def, valid: true });
  const client = await schema.pool.connect();
  try { await applySetup(client); } finally { client.release(); }
  assert.equal((await brandLabelIndex()).oid, concurrent.oid);
  // Present and valid: nothing to do.
  await createConcurrentIndexes(schema.pool);
  assert.equal((await brandLabelIndex()).oid, concurrent.oid);
});

test("an INVALID index left by a failed concurrent build is dropped and built again", async () => {
  const expected = (await brandLabelIndex()).def;
  await schema.pool.query(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,product_count,price_count,stock_count,
    first_seen_at,last_seen_at,changed_at) VALUES('basbug','C','L','MRK','not-a-number','{}',1,0,0,now(),now(),now())`);
  await schema.pool.query("DROP INDEX supplier_items_brand_label_idx");
  await assert.rejects(schema.pool.query("CREATE INDEX CONCURRENTLY supplier_items_brand_label_idx ON supplier_items((code::integer))"));
  assert.equal((await brandLabelIndex()).valid, false);
  await createConcurrentIndexes(schema.pool);
  const rebuilt = await brandLabelIndex();
  assert.deepEqual({ def: rebuilt.def, valid: rebuilt.valid }, { def: expected, valid: true });
});

test("a concurrent build that hits a lock timeout is retried", async () => {
  await schema.pool.query("DROP INDEX supplier_items_brand_label_idx");
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("options", `${url.searchParams.get("options")} -c lock_timeout=200ms`);
  const impatient = new Pool({ connectionString: url.toString() });
  const blocker = await connect();
  const warn = console.warn;
  const warnings: string[] = [];
  console.warn = (message: string) => { warnings.push(message); };
  try {
    await blocker.query("BEGIN");
    await blocker.query("LOCK TABLE supplier_items IN SHARE UPDATE EXCLUSIVE MODE");
    // The first build times out; the blocker is gone before the retry.
    const release = sleep(600).then(() => blocker.query("COMMIT"));
    await createConcurrentIndexes(impatient, 1500);
    await release;
  } finally {
    console.warn = warn;
    await blocker.query("ROLLBACK").catch(() => undefined);
    await Promise.all([blocker.end(), impatient.end()]);
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /attempt 1 hit a lock conflict \(55P03\)/);
  assert.equal((await brandLabelIndex()).valid, true);
});

// Production view ownership is not known beforehand: a dependent view setup's role cannot alter is skipped with a
// NOTICE instead of failing setup with 42501. Needs roles of its own, so only where the test role is a superuser (CI).
test("a dependent view owned by a role setup is not a member of is skipped with a notice", async (t) => {
  const { rows: [{ superuser }] } = await schema.pool.query<{ superuser: boolean }>(
    "SELECT rolsuper AS superuser FROM pg_roles WHERE rolname=current_user");
  if (!superuser) { t.skip("creating roles needs a superuser (CI); the local role cannot"); return; }
  const suffix = schema.name.slice(-12);
  const [runner, other] = [`setup_runner_${suffix}`, `setup_other_${suffix}`];
  const client = await connect();
  const notices: string[] = [];
  client.on("notice", (notice) => notices.push(notice.message ?? ""));
  try {
    await client.query(`CREATE ROLE ${runner} NOLOGIN; CREATE ROLE ${other} NOLOGIN;
      GRANT USAGE ON SCHEMA ${schema.name} TO ${runner}, ${other};
      CREATE TABLE owner_probe_base(id int); CREATE VIEW owner_probe_inner AS SELECT id FROM owner_probe_base;
      CREATE VIEW owner_probe_outer AS SELECT id FROM owner_probe_inner;
      ALTER TABLE owner_probe_base OWNER TO ${runner}; ALTER VIEW owner_probe_inner OWNER TO ${runner};
      ALTER VIEW owner_probe_outer OWNER TO ${other}`);
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${runner}`);
    await client.query("SELECT setup_lock_dependent_views('owner_probe_base')");
    const { rows } = await client.query<{ relname: string }>(
      `SELECT c.relname FROM pg_locks l JOIN pg_class c ON c.oid=l.relation
       WHERE l.pid=pg_backend_pid() AND l.mode='AccessExclusiveLock' AND c.relname LIKE 'owner_probe%' ORDER BY 1`);
    assert.deepEqual(rows.map((row) => row.relname), ["owner_probe_inner"]);
    assert.deepEqual(notices.filter((notice) => notice.includes("setup_lock_dependent_views")),
      [`setup_lock_dependent_views: ${schema.name}.owner_probe_outer is owned by ${other}, not locked before changing owner_probe_base`]);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.query(`DROP VIEW IF EXISTS owner_probe_outer, owner_probe_inner; DROP TABLE IF EXISTS owner_probe_base;
      DROP OWNED BY ${runner}, ${other}; DROP ROLE IF EXISTS ${runner}; DROP ROLE IF EXISTS ${other}`).catch(() => undefined);
    await client.end();
  }
});
