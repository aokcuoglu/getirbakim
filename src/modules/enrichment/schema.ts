import { readFile } from "node:fs/promises";
import type { Pool, PoolClient } from "pg";

/**
 * Checks that the enrichment relations exist without touching them: to_regclass reads the catalog only, so a worker
 * starting next to a long read never queues behind it (#921). The schema itself comes from `npm run db:setup`.
 */
export async function requireEnrichmentSchema(pool: Pool | PoolClient, relations: string[]) {
  const { rows } = await pool.query<{ name: string }>(
    "SELECT r.name FROM unnest($1::text[]) AS r(name) WHERE to_regclass(r.name) IS NULL ORDER BY r.name",
    [relations],
  );
  if (rows.length) throw new Error(`Enrichment schema is missing ${rows.map((row) => row.name).join(", ")}: run npm run db:setup`);
}

/**
 * Applies schema files inside the caller's open transaction for hand-run `prepare` commands. The files alter tables the
 * admin pages and workers read; a lock wait behind a long read would queue every later reader behind this one, so the
 * transaction gives up after 5 s instead (#921).
 */
export async function applySchemaFiles(client: PoolClient, files: string[]) {
  await client.query("SET LOCAL lock_timeout = '5s'");
  try {
    for (const file of files) await client.query(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as { code?: string }).code === "55P03") {
      throw new Error("Enrichment schema is busy (a long query holds its tables); retry later", { cause: error });
    }
    throw error;
  }
}
