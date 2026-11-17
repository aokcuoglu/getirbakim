import { db } from "../src/lib/db";
import { runMerchantFeed } from "../src/modules/seo/merchant-feed.server";

// npm run seo:feed [--dry-run] [--force] (#643, docs/merchant-feed.md). Builds the Google Merchant Center / Meta product
// feed and uploads it to S3_BUCKET (feeds/google.xml.gz with feeds/google.json). On staging, without an explicit SITE_URL
// or without S3_BUCKET it only prints "disabled"; --dry-run works everywhere, builds the file in a temporary directory
// and reports the counters without reading or writing storage. --force publishes past the drop guard.
const args = process.argv.slice(2);
const unknown = args.filter(arg => arg !== "--dry-run" && arg !== "--force");
if (unknown.length > 0) throw new Error(`Unknown arguments: ${unknown.join(" ")} (expected --dry-run, --force)`);

try {
  const result = await runMerchantFeed({ dryRun: args.includes("--dry-run"), force: args.includes("--force") });
  const { status, ...counters } = result;
  console.log(JSON.stringify(status === "disabled" ? { feed: status, reason: result.reason } : { feed: status, ...counters }));
  if (status === "failed") process.exitCode = 1;
} finally {
  await db.end();
}
