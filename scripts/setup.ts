import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { hash } from "bcryptjs";
import { migrateSupplierSnapshots } from "../src/modules/suppliers/sync";
import { newPasswordSchema } from "../src/modules/auth/schemas";
import { createConcurrentIndexes } from "./setup-concurrent-indexes";
import { postSetupMaintenance } from "./setup-maintenance";
// --dry-run applies the schema in a transaction that is rolled back and only reports its timings (#1054): no concurrent
// index builds, nothing after the transaction. Reader-blocking locks are still held while it runs.
const dryRun = process.argv.includes("--dry-run");
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
// Locks that queue every reader of a table or view until the transaction ends (temporary probe views excluded).
const readerBlockingLocks = `SELECT c.relname FROM pg_locks l JOIN pg_class c ON c.oid=l.relation
 WHERE l.pid=pg_backend_pid() AND l.locktype='relation' AND l.mode='AccessExclusiveLock' AND c.relkind IN ('r','v','m')
  AND c.relpersistence<>'t' ORDER BY c.relname`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
 const { rows } = await pool.query("select current_database() as name, current_user as owner");
 if (rows[0].name !== "getirbakim" || rows[0].owner !== "getirbakim_app") throw new Error("Independent database check failed");
 // New indexes on large write-hot tables, built without blocking writers before the schema transaction (#1046): inside it
 // the build would hold SHARE on the table and every view lock taken before it until commit.
 if (!dryRun) await createConcurrentIndexes(pool);
 // The schema runs while the previous release still serves traffic. Its catalog queries read views and
 // tables this transaction replaces, so a lock wait can deadlock with them (40P01) or, with lock_timeout,
 // give up (55P03) instead of stalling every reader queued behind it. Both roll back cleanly: retry.
 for (let attempt = 1; ; attempt++) {
  const client = await pool.connect();
  // Each step's duration and the step that took the first reader-blocking lock (#1054): that lock is held to the end of
  // the transaction, so everything after it is time readers of that relation wait.
  const timings: { name: string; ms: number }[] = [];
  let firstLock: { name: string; at: number; relations: string[] } | undefined;
  const step = async (name: string, run: () => Promise<unknown>) => {
   const started = Date.now();
   await run();
   timings.push({ name, ms: Date.now() - started });
   if (firstLock) return;
   const { rows } = await client.query<{ relname: string }>(readerBlockingLocks);
   if (rows.length) firstLock = { name, at: started, relations: rows.map(row => row.relname) };
  };
  const apply = (file: string) => step(`db/${file}.sql`, async () => client.query(await readFile(`db/${file}.sql`, "utf8")));
  try {
   const began = Date.now();
   await client.query("BEGIN");
   await client.query("SET LOCAL lock_timeout = '15s'");
   await client.query("SELECT pg_advisory_xact_lock(20261001,1)");
   // SETA imports hold their own lock (seta-import.ts); schema changes wait for both.
   await client.query("SELECT pg_advisory_xact_lock(20261001,4)");
   // Dinamik imports (dinamik-import.ts) too: search.sql backfills supplier_items rows.
   await client.query("SELECT pg_advisory_xact_lock(20261001,3)");
   // Manual list imports (manual-import.ts) write the same tables.
   await client.query("SELECT pg_advisory_xact_lock(20261001,8)");
   await apply("schema");
   await apply("brand-launch");
   await apply("vehicle-schema");
   await apply("vehicle-oil-specs");
   await step("migrateSupplierSnapshots", () => migrateSupplierSnapshots(client));
   await apply("commerce");
   await apply("search");
   // Search statistics and admin synonyms (#822): reads accounts.
   await apply("search-analytics");
   await apply("garage");
   // Saved address book of approved accounts (#950).
   await apply("account-addresses");
   await apply("product-enrichment");
   await apply("manual-supplier");
   await apply("manufacturer-logos");
   await apply("vehicle-type-specs");
   await apply("enrichment-worker");
   await apply("product-fitments");
   await apply("source-categories");
   await apply("product-matching");
   // Admin edits of the store card (#575): reads products/product_sources, writes the copy commerce views read.
   await apply("product-overrides");
   // Admin-uploaded product images (#581): reads products, product_media_objects and product_override_changes.
   await apply("product-override-images");
   // Admin-entered OEM / cross-reference / barcode numbers (#582): reads products, accounts, product_override_changes
   // and part_number_key (db/commerce.sql).
   await apply("product-override-references");
   // Admin-entered technical specifications (#603): reads products, accounts and product_override_changes.
   await apply("product-override-specs");
   // Admin-added and removed vehicle fitments (#583): reads products, vehicle_types, accounts and product_override_changes.
   await apply("product-override-fitments");
   // Reads product_sources: the storefront catalog with unavailable products (#475), then their restock requests.
   await apply("storefront-catalog");
   await apply("restock-requests");
   await apply("enrichment-products");
   await apply("enrichment-states");
   // After enrichment-states: besides the enrichment OEM index (#609) it indexes enrichment_product_states (#617).
   await apply("enrichment-search");
   await apply("enrichment-shared-links");
   // Logs deleted and invalidated enrichments for the storefront sync (#564); needs supplier_items and the enrichment tables.
   await apply("enrichment-tombstones");
   await apply("storefront-make-fits");
   await apply("newsletter");
   await apply("indexnow");
   // The matcher / state sync lock is (20261001,5) in public; other schemas derive their own key (#792). Both functions
   // still agree off public, so a surprise is reported rather than failing the deploy.
   const lockKey = (await client.query<{ key: number }>("SELECT schema_lock_key(5) AS key")).rows[0].key;
   if (lockKey !== 5) console.warn(`Matcher lock key is ${lockKey}, not 5: the schema is not public (#792)`);
   const end = dryRun ? "ROLLBACK" : "COMMIT";
   await client.query(end);
   const ended = Date.now();
   const slowest = [...timings].sort((a, b) => b.ms - a.ms).slice(0, 3).map(({ name, ms }) => `${name} ${seconds(ms)}`).join(", ");
   const relations = firstLock && (firstLock.relations.length > 5
    ? `${firstLock.relations.slice(0, 5).join(", ")} and ${firstLock.relations.length - 5} more` : firstLock.relations.join(", "));
   console.log(`Schema transaction ${seconds(ended - began)} (${end}); slowest: ${slowest}; ${firstLock
    ? `ACCESS EXCLUSIVE on ${relations} from ${firstLock.name} to ${end}: ${seconds(ended - firstLock.at)}` : "no reader-blocking lock"}.`);
   if (dryRun) for (const { name, ms } of timings) console.log(`  ${name} ${seconds(ms)}`);
   break;
  } catch (error) {
   await client.query("ROLLBACK");
   const code = (error as { code?: string }).code;
   if (attempt >= 6 || (code !== "40P01" && code !== "55P03")) throw error;
   console.warn(`Schema attempt ${attempt} hit a lock conflict with live queries (${code}); retrying.`);
   await new Promise(resolve => setTimeout(resolve, attempt * 5000));
  } finally { client.release(); }
 }
 if (dryRun) console.log("Dry run: schema rolled back; maintenance, syncs and the administrator skipped.");
 else {
  // ANALYZE and the search vocabulary rebuild, outside the schema locks (#1054).
  await postSetupMaintenance(pool);
  // The dashboard's materialized catalog: a first deployment queues a full rebuild, which must not run under the schema locks.
  await pool.query("SELECT enrichment_product_states_sync()");
  // The storefront's enrichment links (#446): the schema queues a rebuild, done here before the release serves traffic.
  await pool.query("SELECT product_enrichment_shared_sync()");
  // Dinamik price-list-only codes with content (#1068), from the links just synced. NULL: another task holds the rebuild
  // lock, so the new search fields (#1081) are written by that run or the app's next one (within 10 minutes).
  const priceOnly = (await pool.query<{ written: number | null }>("SELECT storefront_price_only_refresh() AS written")).rows[0].written;
  if (priceOnly === null) console.warn("storefront_price_only_refresh skipped: another task is rebuilding the price-only cards; the app's next run catches up.");
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) throw new Error("Admin credentials required");
  const password = newPasswordSchema.parse(process.env.ADMIN_PASSWORD);
  await pool.query("INSERT INTO accounts (name,email,password_hash,role,approved) VALUES ($1,$2,$3,'admin',true) ON CONFLICT (email) DO NOTHING", ["Getirbakim Yönetim", process.env.ADMIN_EMAIL, await hash(password,12)]);
  console.log("Database getirbakim / getirbakim_app verified. Schema and administrator ready.");
 }
} finally { await pool.end(); }
