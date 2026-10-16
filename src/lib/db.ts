import "server-only";
import { Pool } from "pg";
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
