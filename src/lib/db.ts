import "server-only";
import { createHash } from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
const globalDb = globalThis as unknown as { getirbakimPool?: Pool };
// One catalog render runs 9+ queries in parallel and every product image takes a client,
// so a 5-client pool with a 3 s acquire timeout failed pages with 500 under light load.
const createPool = () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX) || 15,
    connectionTimeoutMillis: Number(process.env.DATABASE_POOL_ACQUIRE_TIMEOUT_MS) || 10_000,
    // Names this pool's sessions in pg_stat_activity (#1377), so their client backends (and their parallel workers, through
    // leader_pid) can be counted apart from psql and other clients. Every process using this module carries it: the web
    // tasks, and the scripts and in-process imports that import it too; PGAPPNAME or an application_name URL parameter
    // wins, so a script can name its own.
    fallback_application_name: "getirbakim-web",
  });
  // Without a listener, an error on an idle client is an unhandled 'error' event and kills the process.
  pool.on("error", error => console.error("Idle database client error", error.message));
  return pool;
};
// One pool per process, in production too. `next start` loads this module twice: in the instrumentation bundle (the
// warm-up and the enrichment sync) and in the server bundle all routes share; a module-level pool would open `max`
// connections per copy (#771 measured 16 open against a max of 15). Dev reload also reuses it. DATABASE_POOL_MAX is the real
// per-process ceiling only because the pool lives on globalThis; its error listener is registered once, in createPool.
export const db = (globalDb.getirbakimPool ??= createPool());
const defaultSlowMs = 20_000;
/** BOUNDED_QUERY_SLOW_MS, read per call: blank or invalid 20 s, 0 no slow-read line (boundedQuery). */
function boundedQuerySlowMs() {
  const setting = process.env.BOUNDED_QUERY_SLOW_MS?.trim();
  const value = setting ? Number(setting) : defaultSlowMs;
  return Number.isFinite(value) && value >= 0 ? value : defaultSlowMs;
}
/**
 * One read with a server-side time limit. node-postgres stops waiting on its own, but the query would keep running:
 * a request the CDN abandoned (504) must not leave it on the database. Meant for the expensive, cached catalog reads.
 * `workMem` ("64MB", "512kB") raises work_mem for this read only, for a sort that would otherwise spill to disk.
 * `label` is `<module>.<query>` plus optional listing detail, built only when the query runs (a cache miss); a statement
 * timeout (57014) is logged with it, cut to 200 chars, so a slow listing can be traced to its query. The logged time
 * includes the pool wait, and 57014 also covers a pg_cancel_backend.
 * `timeoutMs` limits the statement alone, as the server counts it: its lock waits are inside it, the wait for a pool
 * connection (up to DATABASE_POOL_ACQUIRE_TIMEOUT_MS) and the BEGIN/SET round trips are not.
 * A statement that succeeds after more than BOUNDED_QUERY_SLOW_MS (20 s) logs one line, `boundedQuery slow: <label> (<ms>
 * ms, limit <timeoutMs> ms)` with the statement's own time (no pool wait), so production shows how close the reads come
 * to their limits before they time out (#1377).
 * The transaction is READ ONLY unless `write`: a statement that stores what it reads (a listing's whole price order,
 * src/modules/store/listing-price-order.ts, #1369) runs under the same limits.
 */
export async function boundedQuery<T extends QueryResultRow>(label: string, sql: string, values: unknown[], timeoutMs = 30_000, { workMem, write = false }: { workMem?: string; write?: boolean } = {}) {
  if (workMem !== undefined && !/^\d+(kB|MB)$/.test(workMem)) throw new Error(`Invalid work_mem: ${workMem}`);
  const started = Date.now();
  const client = await db.connect();
  try {
    await client.query(write ? "BEGIN" : "BEGIN READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${Math.max(1, Math.floor(timeoutMs))}`);
    if (workMem) await client.query(`SET LOCAL work_mem = '${workMem}'`);
    const run = Date.now();
    const result = await client.query<T>(sql, values);
    const ms = Date.now() - run;
    await client.query("COMMIT");
    const slowMs = boundedQuerySlowMs();
    if (slowMs > 0 && ms > slowMs) console.warn(`boundedQuery slow: ${label.slice(0, 200)} (${ms} ms, limit ${timeoutMs} ms)`);
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if ((error as { code?: string }).code === "57014") console.error(`boundedQuery timeout: ${label.slice(0, 200)} (limit ${timeoutMs} ms, ${Date.now() - started} ms)`);
    throw error;
  } finally { client.release(); }
}
const statementNames = new Map<string, string>();
/**
 * A read sent as a named prepared statement: each connection parses it once and, after five executions, Postgres keeps
 * its generic plan (plan_cache_mode=auto). The hot by-id reads of the commerce views spend 73-86% of their 2.2-4.7 ms
 * planning (#1170); named, a round trip takes 0.7-1.2 ms instead of 3.0-6.1 ms. Keep the list short: every connection
 * holds each plan (measured 1.1-4.0 MB each; ~10.6 MB for six of them on one backend).
 * A cached plan must not change its result type: when `db:setup` adds a column to a view (a rolling deploy) a statement
 * returning `*` from it fails with 0A000 on every connection that prepared it. On a pool that client is dropped and
 * the read retried unnamed; inside a transaction the error would abort it, so there only statements listing their
 * output columns may be named.
 */
export async function preparedQuery<T extends QueryResultRow>(connection: Pick<PoolClient, "query">, text: string, values: unknown[]) {
  let name = statementNames.get(text);
  if (!name) { name = `p_${createHash("sha1").update(text).digest("hex").slice(0, 24)}`; statementNames.set(text, name); }
  if (!(connection instanceof Pool)) return connection.query<T>({ name, text, values });
  const client = await connection.connect();
  // As Pool.query does: a socket failure mid-query must reject this read, not also raise an uncaught 'error' event.
  const onError = () => {};
  client.on("error", onError);
  try {
    const result = await client.query<T>({ name, text, values });
    client.removeListener("error", onError);
    client.release();
    return result;
  } catch (error) {
    // Dropped as Pool.query drops a client after an error; for 0A000 this also discards the stale plan, which would
    // otherwise fail on this connection for good.
    client.removeListener("error", onError);
    client.release(true);
    if ((error as { code?: string }).code !== "0A000") throw error;
    return connection.query<T>(text, values);
  }
}
