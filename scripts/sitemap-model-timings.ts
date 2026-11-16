import { db } from "../src/lib/db";
import { loadModelCategoryPaths, loadModelPaths, modelCategoryPathsQuery, modelPathsQuery } from "../src/modules/seo/sitemap-models.server";

// npm run seo:sitemap-timings [--explain] (#778). Read-only. Without arguments: wall time and row counts of the two
// slow sitemap loaders (models.xml, model-categories.xml) as one JSON line. --explain: EXPLAIN (ANALYZE, BUFFERS) of
// both queries, each in a read-only transaction, for the RDS numbers.
const args = process.argv.slice(2);
const unknown = args.filter(arg => arg !== "--explain");
if (unknown.length > 0) throw new Error(`Unknown arguments: ${unknown.join(" ")} (expected --explain)`);

async function timed(load: () => Promise<string[]>) {
  const started = Date.now();
  const paths = await load();
  return { rows: paths.length, ms: Date.now() - started };
}

async function explain(name: string, query: { text: string; values: unknown[] }) {
  const client = await db.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = 300000");
    const { rows } = await client.query<Record<string, string>>(`EXPLAIN (ANALYZE, BUFFERS) ${query.text}`, query.values);
    console.log(`-- ${name}\n${rows.map(row => row["QUERY PLAN"]).join("\n")}`);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

try {
  if (args.includes("--explain")) {
    await explain("models.xml", await modelPathsQuery());
    await explain("model-categories.xml", await modelCategoryPathsQuery());
  } else {
    console.log(JSON.stringify({ models: await timed(loadModelPaths), modelCategories: await timed(loadModelCategoryPaths) }));
  }
} finally {
  await db.end();
}
