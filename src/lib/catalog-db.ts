import { Pool, PoolConfig } from "pg";

let pool: Pool | null = null;

function getPoolConfig(): PoolConfig {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not configured. Set it in environment variables.");
  }
  return {
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 8000,
  };
}

export function getCatalogPool(): Pool {
  if (!pool) {
    pool = new Pool(getPoolConfig());
    pool.on("error", (err) => {
      console.error("[catalog-db] Unexpected pool error:", err.message);
    });
  }
  return pool;
}

export function isCatalogDbEnabled(): boolean {
  return process.env.USE_EXISTING_CATALOG_DB === "true";
}

export function getCatalogSearchSource(): string {
  return process.env.CATALOG_SEARCH_SOURCE ?? "mock";
}

export function getCatalogTableName(): string {
  return process.env.SUPPLIER_CATALOG_TABLE ?? "supplier_products";
}

export function getCatalogSchema(): string {
  return process.env.SUPPLIER_DB_SCHEMA ?? "public";
}

export function isLiveFallbackEnabled(): boolean {
  return process.env.SEARCH_LIVE_FALLBACK_ENABLED === "true";
}

export async function queryCatalogDb<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const client = getCatalogPool();
  const tableName = getCatalogTableName();
  const schema = getCatalogSchema();
  const resolvedSql = sql.replace(/\{table\}/g, `${schema}.${tableName}`);
  const result = await client.query<T>(resolvedSql, params);
  return result.rows;
}

export async function checkCatalogConnection(): Promise<{
  connected: boolean;
  error?: string;
  tableExists?: boolean;
  rowCount?: number;
}> {
  try {
    const pool = getCatalogPool();
    const schema = getCatalogSchema();
    const table = getCatalogTableName();

    const tableCheck = await pool.query(
      `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2) as exists`,
      [schema, table]
    );

    if (!tableCheck.rows[0].exists) {
      return { connected: true, tableExists: false };
    }

    const countResult = await pool.query(
      `SELECT COUNT(*)::bigint as count FROM ${schema}.${table}`
    );

    return {
      connected: true,
      tableExists: true,
      rowCount: Number(countResult.rows[0].count),
    };
  } catch (err) {
    return {
      connected: false,
      error: (err as Error).message,
    };
  }
}