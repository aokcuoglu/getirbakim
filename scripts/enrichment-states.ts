import { Pool } from "pg";

// Rebuilds enrichment_product_states, the dashboard's materialized catalog (db/enrichment-states.sql).
// `sync` only drains the change queue; the default asks for a full rebuild and waits for it.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const mode = process.argv[2] === "sync" ? "sync" : "rebuild";
  const started = Date.now();
  if (mode === "rebuild") await pool.query("INSERT INTO enrichment_product_state_queue(product_id) VALUES ('00000000-0000-0000-0000-000000000000') ON CONFLICT DO NOTHING");
  let written = 0;
  // Another reader may hold the sync lock; its pass drains the queue, so wait for an empty queue either way.
  for (let attempt = 0; ; attempt++) {
    written += (await pool.query<{ n: number }>("SELECT enrichment_product_states_sync() AS n")).rows[0].n;
    if (!(await pool.query("SELECT 1 FROM enrichment_product_state_queue LIMIT 1")).rowCount) break;
    if (attempt >= 60) throw new Error("The state queue is still busy after 60 attempts.");
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const rows = (await pool.query<{ status: string; count: number }>("SELECT status,count(*)::int AS count FROM enrichment_product_states GROUP BY status ORDER BY count DESC")).rows;
  console.log(JSON.stringify({ mode, written, seconds: Math.round((Date.now() - started) / 1000), counts: Object.fromEntries(rows.map(row => [row.status, row.count])) }));
} finally { await pool.end(); }
