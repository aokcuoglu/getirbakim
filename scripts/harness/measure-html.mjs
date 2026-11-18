// Usage: node scripts/harness/measure-html.mjs <base-url> <path>... [--runs N] [--top N]
// Dependency-free HTML weight probe (#642): for each path, the document's size, the share of the inlined RSC payload
// (`self.__next_f.push` scripts), its gzip size, the median time to first byte and, read from the payload, the bytes of
// props each client component receives (summed over its instances, nested elements excluded). Not part of CI: point it
// at a production build (`npm run build && npx next start -p <port>`), not `next dev`.
// The first of the runs warms the route and is left out of the TTFB median. Avoid search URLs (/katalog?q=…): they
// record the search in the database.
import { gzipSync } from "node:zlib";

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(argv[index + 1]);
  argv.splice(index, 2);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const runs = Math.max(2, option("--runs", 5));
const top = option("--top", 6);
const [base, ...paths] = argv;
if (!base || !paths.length) {
  console.error("Usage: node scripts/harness/measure-html.mjs <base-url> <path>... [--runs N] [--top N]");
  process.exit(2);
}

const kb = (bytes) => (bytes / 1024).toFixed(1);

async function fetchPage(url) {
  const started = performance.now();
  const response = await fetch(url, { headers: { "accept-encoding": "identity", "user-agent": "Mozilla/5.0 measure-html" }, redirect: "follow" });
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

// The RSC payload as one string: the `[1, "…"]` pushes concatenated.
function flightOf(html) {
  const scripts = [...html.matchAll(/<script[^>]*>self\.__next_f\.push\(([\s\S]*?)\)<\/script>/g)];
  let flight = "";
  for (const match of scripts) {
    try {
      const chunk = JSON.parse(match[1]);
      if (chunk[0] === 1) flight += chunk[1];
    } catch {
      // A push that is not plain JSON (form state, binary chunks) carries no rows to read.
    }
  }
  return { bytes: scripts.reduce((sum, match) => sum + Buffer.byteLength(match[0]), 0), flight };
}

// Client component prop bytes: rows `id:I[…]` name the modules, elements `["$","$L<id>",key,props]` use them.
function clientProps(flight) {
  const modules = new Map(), parsed = [];
  for (const row of flight.split(/\n(?=[0-9a-f]+:)/)) {
    const colon = row.indexOf(":"), id = row.slice(0, colon), body = row.slice(colon + 1);
    if (body.startsWith("I[")) {
      try {
        const [, chunks, name] = JSON.parse(body.slice(1));
        const file = String(Array.isArray(chunks) ? chunks.at(-1) ?? "" : chunks).split("/").pop();
        modules.set(id, `${name || "default"} (${file.slice(0, 32)})`);
      } catch {
        // Not a module row.
      }
      continue;
    }
    if (/^[THE]/.test(body)) continue;
    try {
      parsed.push(JSON.parse(body));
    } catch {
      // Rows that continue a text chunk.
    }
  }
  const isElement = (value) => Array.isArray(value) && value[0] === "$" && typeof value[1] === "string";
  const stats = new Map();
  const own = (value) => {
    if (isElement(value)) {
      walk(value);
      return 4;
    }
    if (Array.isArray(value)) return 2 + value.reduce((sum, item) => sum + own(item) + 1, 0);
    if (value && typeof value === "object") return 2 + Object.entries(value).reduce((sum, [key, item]) => sum + key.length + 4 + own(item), 0);
    return JSON.stringify(value ?? null).length;
  };
  function walk(value) {
    if (isElement(value)) {
      const type = value[1], props = value[3] ?? {}, name = type.startsWith("$L") ? modules.get(type.slice(2)) : undefined;
      if (!name) {
        for (const item of Object.values(props)) own(item);
        return;
      }
      const entry = stats.get(name) ?? { count: 0, bytes: 0, props: {} };
      entry.count++;
      for (const [key, item] of Object.entries(props)) {
        const bytes = own(item);
        entry.bytes += bytes;
        entry.props[key] = (entry.props[key] ?? 0) + bytes;
      }
      stats.set(name, entry);
      return;
    }
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  }
  parsed.forEach(walk);
  return [...stats].sort((a, b) => b[1].bytes - a[1].bytes);
}

const rows = [], details = [];
for (const path of paths) {
  const times = [];
  let page;
  for (let run = 0; run < runs; run++) {
    page = await fetchPage(new URL(path, base));
    if (run > 0) times.push(page.ttfb);
  }
  times.sort((a, b) => a - b);
  const bytes = Buffer.byteLength(page.html), { bytes: rsc, flight } = flightOf(page.html);
  rows.push({ path: path.length > 48 ? `${path.slice(0, 45)}…` : path, status: page.status, htmlKB: +kb(bytes), rscKB: +kb(rsc),
    rscPct: Math.round((rsc / bytes) * 100), gzipKB: +kb(gzipSync(page.html).length), ttfbMs: Math.round(times[Math.floor((times.length - 1) / 2)]) });
  details.push([path, clientProps(flight)]);
}
console.table(rows);
for (const [path, stats] of details) {
  const total = stats.reduce((sum, [, entry]) => sum + entry.bytes, 0);
  console.log(`\n${path}\n  client component props: ${kb(total)} KB`);
  for (const [name, entry] of stats.slice(0, top)) {
    const props = Object.entries(entry.props).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([key, bytes]) => `${key}=${kb(bytes)}`).join(" ");
    console.log(`  ${kb(entry.bytes).padStart(7)} KB  x${String(entry.count).padEnd(4)} ${name.padEnd(48)} ${props}`);
  }
}
