// Model-level fitment from Dinamik's product descriptions (#392).
//   derive [--dry-run] [--allow-shrink]  syncs product_model_fitments for products without an engine-level enrichment:
//                       only changed rows are written, and derived_at moves only when a row's model or years change (#798).
//                       --dry-run computes the same diff in a rolled-back transaction. Prints one JSON line.
//   report              counts what is stored, per brand
// The derivation lives in src/modules/store/description-fitment-derive.ts; neither imports a server-only module, so the
// AWS operations task runs without --conditions=react-server (#562), from getirbakim-infra:
//   ./scripts/run-task.sh production -- node --import tsx scripts/description-fitments.ts derive [--dry-run]
// Exit codes: 0 ok, 1 error, 2 refused by a guard (empty vehicle catalog, no Dinamik items, or with 1000+ stored rows a
// derivation under 70% of them or deleting over 10% of them; --allow-shrink accepts it), 3 another derive holds the lock, 64 usage.
import { Pool } from "pg";
import { deriveDescriptionFitments } from "../src/modules/store/description-fitment-derive";

const usage = "Usage: description-fitments.ts derive [--dry-run] [--allow-shrink] | report";
const [command, ...flags] = process.argv.slice(2);
const exitCodes = { ok: 0, refused: 2, busy: 3 } as const;

async function derive(pool: Pool) {
  const started = Date.now();
  const dryRun = flags.includes("--dry-run");
  const client = await pool.connect();
  try {
    const result = await deriveDescriptionFitments(client, { dryRun, allowShrink: flags.includes("--allow-shrink") });
    const { status, reason, items, statuses, rows, existing, diff, written, top } = result;
    console.log(JSON.stringify({ job: "description-fitments", status, ...(reason ? { reason } : {}), dryRun,
      seconds: Math.round((Date.now() - started) / 100) / 10, items, statuses, rows, existing, diff, written, top }));
    process.exitCode = exitCodes[status];
  } finally { client.release(); }
}

async function report(pool: Pool) {
  console.log(JSON.stringify((await pool.query(`SELECT COALESCE(s.product_data->>'uk','') AS brand,count(DISTINCT f.supplier_item_id)::int AS products,
    count(*)::int AS models FROM product_model_fitments f JOIN supplier_items s ON s.id=f.supplier_item_id GROUP BY 1 ORDER BY 2 DESC LIMIT 40`)).rows, null, 1));
}

const valid = (command === "derive" && flags.every(flag => flag === "--dry-run" || flag === "--allow-shrink"))
  || (command === "report" && flags.length === 0);
if (!valid) {
  console.error(usage);
  process.exitCode = 64;
} else {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    if (command === "derive") await derive(pool);
    else await report(pool);
  } catch (error) {
    console.log(JSON.stringify({ job: "description-fitments", status: "error", error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  } finally { await pool.end(); }
}
