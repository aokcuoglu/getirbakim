import type { Pool } from "pg";

/**
 * Indexes a release adds to a large write-hot table (#1046). Inside setup's transaction CREATE INDEX holds SHARE on the
 * table (queueing every writer) and keeps the view locks taken before it for as long as the build runs. scripts/setup.ts
 * builds these CONCURRENTLY before that transaction, so the guarded CREATE INDEX in the schema file (looked up by name
 * on the table) finds them and does nothing. Each `definition` must match that file's CREATE INDEX; tables or functions
 * missing on a new database are left to the transaction (nothing reads them yet).
 */
export const concurrentIndexes = [
  // db/commerce.sql, #771.
  { name: "supplier_items_brand_label_idx", table: "supplier_items", functions: ["supplier_item_brand"],
    definition: "ON supplier_items(supplier_item_brand(supplier,product_data))" },
] as const;

/** Builds the missing `concurrentIndexes` in the current schema; an INVALID one left by a failed build is dropped and rebuilt. */
export async function createConcurrentIndexes(pool: Pool) {
  for (const index of concurrentIndexes) {
    const { rows: [state] } = await pool.query<{ ready: boolean; valid: boolean | null }>(
      `SELECT EXISTS (SELECT 1 FROM pg_class WHERE relname=$1 AND relnamespace=current_schema()::regnamespace AND relkind IN ('r','p'))
        AND (SELECT count(DISTINCT proname) FROM pg_proc WHERE proname=ANY($2::text[]) AND pronamespace=current_schema()::regnamespace)=cardinality($2::text[]) AS ready,
       (SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid
        WHERE c.relname=$3 AND t.relname=$1 AND t.relnamespace=current_schema()::regnamespace) AS valid`,
      [index.table, index.functions, index.name]);
    if (!state.ready || state.valid) continue;
    // Identifiers are the constants above; the schema-qualified name keeps an isolated test schema off public's index.
    const { rows: [{ schema }] } = await pool.query<{ schema: string }>("SELECT quote_ident(current_schema()) AS schema");
    if (state.valid === false) await pool.query(`DROP INDEX CONCURRENTLY IF EXISTS ${schema}.${index.name}`);
    await pool.query(`CREATE INDEX CONCURRENTLY ${index.name} ${index.definition}`);
  }
}
