import { db } from "../src/lib/db";
import { SYNC_DEFAULT_LIMIT, syncGeliverShipments } from "../src/modules/shipping/geliver-sync";

// Periodic Geliver tracking sync (#974); see docs/commerce.md "Geliver ile kargo etiketi".
//   npm run geliver:sync [-- --limit=50] [-- --dry-run]
// Exits 1 only on a configuration or database error; a failed Geliver call is reported and the run goes on.

const args = process.argv.slice(2);
const limitArg = args.find(arg => arg.startsWith("--limit="))?.slice("--limit=".length);
const limit = limitArg === undefined ? SYNC_DEFAULT_LIMIT : Number(limitArg);
const dryRun = args.includes("--dry-run");
const unknownArgs = args.filter(arg => arg !== "--dry-run" && !arg.startsWith("--limit="));

async function main() {
  if (unknownArgs.length || !Number.isInteger(limit) || limit < 1 || limit > 500) {
    console.error("Usage: geliver:sync [--limit=1..500] [--dry-run]");
    return 1;
  }
  const summary = await syncGeliverShipments({ limit, dryRun });
  if (summary.status === "not_live") { console.log("GELIVER_MODE is not live: test labels are never synced (a GET advances them). Nothing to do."); return 0; }
  if (summary.status === "unavailable") { console.error("GELIVER_API_TOKEN is not set."); return 1; }
  if (summary.dryRun) {
    console.log(`Dry run: ${summary.candidates.length} live label(s) would be checked.`);
    for (const c of summary.candidates) {
      console.log(`  row ${c.rowId}  order ${c.orderId}  status ${c.trackingStatusCode ?? "-"}  last checked ${c.checkedAt?.toISOString() ?? "never"}`);
    }
    return 0;
  }
  const count = (outcome: string) => summary.results.filter(r => r.outcome === outcome).length;
  for (const r of summary.results) {
    const detail = r.outcome === "applied" ? r.statusCode : r.outcome === "ignored" || r.outcome === "error" ? r.reason : "";
    console.log(`  row ${r.rowId}  order ${r.orderId}  ${r.outcome}${detail ? ` ${detail}` : ""}`);
  }
  console.log(`Checked ${summary.results.length}: applied ${count("applied")}, unchanged ${count("ignored")}, no status ${count("no_status")}, failed ${count("error")}.`);
  return 0;
}

let code = 1;
try { code = await main(); }
catch (error) { console.error("Geliver sync stopped:", error instanceof Error ? error.message : error); }
finally { await db.end(); }
process.exit(code);
