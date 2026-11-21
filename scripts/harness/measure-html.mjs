// Usage: node scripts/harness/measure-html.mjs <base-url> <path>... [--runs N] [--top N] [--json] [--budget "<prefix>=<KB>,…"]
// Dependency-free HTML weight probe (#642): for each path, the document's size, the share of the inlined RSC payload
// (`self.__next_f.push` scripts), its gzip size, the median time to first byte and, read from the payload, the bytes of
// props each client component receives (summed over its instances, nested elements excluded). Not part of CI: point it
// at a production build (`npm run build && npx next start -p <port>`), not `next dev`.
// Columns classKB (class attributes) and modKB (module rows of the payload) show what the markup, not the props, weighs.
// --budget "/urun/=160,/=410": the longest matching path prefix gives the HTML limit in KB ("/" matches only the home
// page); the exit code is 1 when a page exceeds it or is not 200 (2 for an invalid budget).
// --json prints one `{ rows, details }` document (numeric KB, jsonLdKB; details = client props per path) instead of the
// tables; the budget exit codes are unchanged.
// The first of the runs warms the route and is left out of the TTFB median. Avoid search URLs (/katalog?q=…): they
// record the search in the database.
import { gzipSync } from "node:zlib";
import { budgetFor, clientProps, flightOf, markupStats, parseBudget } from "./html-weight.mjs";

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(argv[index + 1]);
  argv.splice(index, 2);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const budgetIndex = argv.indexOf("--budget");
let budget = [];
if (budgetIndex !== -1) {
  try {
    budget = parseBudget(argv.splice(budgetIndex, 2)[1]);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
const json = argv.includes("--json");
if (json) argv.splice(argv.indexOf("--json"), 1);
const runs = Math.max(2, option("--runs", 5));
const top = option("--top", 6);
const [base, ...paths] = argv;
if (!base || !paths.length) {
  console.error("Usage: node scripts/harness/measure-html.mjs <base-url> <path>... [--runs N] [--top N] [--budget \"<prefix>=<KB>,…\"]");
  process.exit(2);
}

const kb = (bytes) => (bytes / 1024).toFixed(1);

async function fetchPage(url) {
  const started = performance.now();
  const response = await fetch(url, { headers: { "accept-encoding": "identity", "user-agent": "Mozilla/5.0 measure-html" }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
  const reader = response.body.getReader();
  const chunks = [];
  let ttfb = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (!ttfb) ttfb = performance.now() - started;
    if (done) break;
    chunks.push(value);
  }
  return { status: response.status, html: Buffer.concat(chunks).toString("utf8"), ttfb };
}

const rows = [], details = [], exceeded = [];
for (const path of paths) {
  const times = [];
  let page;
  for (let run = 0; run < runs; run++) {
    page = await fetchPage(new URL(path, base));
    if (run > 0) times.push(page.ttfb);
  }
  times.sort((a, b) => a - b);
  const bytes = Buffer.byteLength(page.html), { bytes: rsc, flight } = flightOf(page.html), markup = markupStats(page.html, flight);
  const limit = budgetFor(budget, path);
  if (budget.length && page.status !== 200) exceeded.push(`${path}: HTTP ${page.status}`);
  else if (limit !== undefined && bytes / 1024 > limit) exceeded.push(`${path}: ${kb(bytes)} KB > ${limit} KB`);
  rows.push({ path: json || path.length <= 48 ? path : `${path.slice(0, 45)}…`, status: page.status, htmlKB: +kb(bytes), rscKB: +kb(rsc),
    rscPct: Math.round((rsc / bytes) * 100), classKB: +kb(markup.classBytes), modKB: +kb(markup.moduleBytes), gzipKB: +kb(gzipSync(page.html).length), ttfbMs: Math.round(times[Math.floor((times.length - 1) / 2)]),
    ...(json && { jsonLdKB: +kb(markup.jsonLdBytes) }) });
  details.push([path, clientProps(flight)]);
}
if (json) {
  console.log(JSON.stringify({ rows, details: details.map(([path, stats]) => ({ path, props: stats.map(([name, entry]) => ({ name, count: entry.count, bytes: entry.bytes })) })) }));
} else console.table(rows);
for (const [path, stats] of json ? [] : details) {
  const total = stats.reduce((sum, [, entry]) => sum + entry.bytes, 0);
  console.log(`\n${path}\n  client component props: ${kb(total)} KB`);
  for (const [name, entry] of stats.slice(0, top)) {
    const props = Object.entries(entry.props).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([key, bytes]) => `${key}=${kb(bytes)}`).join(" ");
    console.log(`  ${kb(entry.bytes).padStart(7)} KB  x${String(entry.count).padEnd(4)} ${name.padEnd(48)} ${props}`);
  }
}
if (exceeded.length) {
  console.error(`\nBudget check failed:\n  ${exceeded.join("\n  ")}`);
  process.exit(1);
}
