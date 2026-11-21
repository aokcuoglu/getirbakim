import "server-only";
import { Pool, type QueryResultRow } from "pg";
const globalDb = globalThis as unknown as { getirbakimPool?: Pool };
// One catalog render runs 9+ queries in parallel and every product image takes a client,
// so a 5-client pool with a 3 s acquire timeout failed pages with 500 under light load.
const createPool = () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX) || 15,
    connectionTimeoutMillis: Number(process.env.DATABASE_POOL_ACQUIRE_TIMEOUT_MS) || 10_000,
  });
  // Without a listener, an error on an idle client is an unhandled 'error' event and kills the process.
  pool.on("error", error => console.error("Idle database client error", error.message));
  return pool;
};
export const db = globalDb.getirbakimPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalDb.getirbakimPool = db;
/**
 * One read with a server-side time limit. node-postgres stops waiting on its own, but the query would keep running:
 * a request the CDN abandoned (504) must not leave it on the database. Meant for the expensive, cached catalog reads.
 * `workMem` ("64MB", "512kB") raises work_mem for this read only, for a sort that would otherwise spill to disk.
 */
export async function boundedQuery<T extends QueryResultRow>(sql: string, values: unknown[], timeoutMs = 30_000, { workMem }: { workMem?: string } = {}) {
  if (workMem !== undefined && !/^\d+(kB|MB)$/.test(workMem)) throw new Error(`Invalid work_mem: ${workMem}`);
  const client = await db.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${Math.max(1, Math.floor(timeoutMs))}`);
    if (workMem) await client.query(`SET LOCAL work_mem = '${workMem}'`);
    const result = await client.query<T>(sql, values);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}
