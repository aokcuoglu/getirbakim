import { Pool } from "pg";
import { syncEnrichmentStates } from "./enrichment-derived-sync";

// Rebuilds enrichment_product_states, the dashboard's materialized catalog (db/enrichment-states.sql).
// `sync` only drains the change queue; the default asks for a full rebuild and waits for it.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const mode = process.argv[2] === "sync" ? "sync" : "rebuild";
  const started = Date.now();
  if (mode === "rebuild") await pool.query("INSERT INTO enrichment_product_state_queue(product_id) VALUES ('00000000-0000-0000-0000-000000000000') ON CONFLICT DO NOTHING");
  const written = await syncEnrichmentStates(pool);
  const rows = (await pool.query<{ status: string; count: number }>("SELECT status,count(*)::int AS count FROM enrichment_product_states GROUP BY status ORDER BY count DESC")).rows;
  console.log(JSON.stringify({ mode, written, seconds: Math.round((Date.now() - started) / 1000), counts: Object.fromEntries(rows.map(row => [row.status, row.count])) }));
} finally { await pool.end(); }
