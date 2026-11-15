import { db } from "../src/lib/db";
import { runIndexNow } from "../src/modules/seo/indexnow.server";

// npm run seo:indexnow [--dry-run] [--seed] [--limit=N] (#645, docs/indexnow.md). Reports the product pages whose
// indexable content changed since the last run. Outside production or without INDEXNOW_KEY it only prints "disabled";
// --dry-run works everywhere and neither sends nor writes.
const args = process.argv.slice(2);
const unknown = args.filter(arg => arg !== "--dry-run" && arg !== "--seed" && !/^--limit=\d+$/.test(arg));
if (unknown.length > 0) throw new Error(`Unknown arguments: ${unknown.join(" ")} (expected --dry-run, --seed, --limit=N)`);
const limitArg = args.find(arg => arg.startsWith("--limit="))?.slice("--limit=".length) ?? process.env.INDEXNOW_MAX_URLS;
const limit = limitArg ? Number(limitArg) : 50_000;
if (!Number.isInteger(limit) || limit < 0) throw new Error("--limit / INDEXNOW_MAX_URLS must be a whole number (0 = no limit)");

try {
  const result = await runIndexNow({ mode: args.includes("--seed") ? "seed" : "send", limit, dryRun: args.includes("--dry-run") });
  const { status, ...counters } = result;
  console.log(JSON.stringify(status === "disabled" ? { indexnow: status, reason: result.reason } : { indexnow: status, ...counters }));
  if (status === "failed") process.exitCode = 1;
} finally {
  await db.end();
}
