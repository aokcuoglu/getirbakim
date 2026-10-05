import "server-only";
import { Pool } from "pg";
const globalDb = globalThis as unknown as { getirbakimPool?: Pool };
export const db = globalDb.getirbakimPool ?? new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 3000 });
if (process.env.NODE_ENV !== "production") globalDb.getirbakimPool = db;
