// Usage: node scripts/harness/measure-memory.mjs <base-url> (--pid <pid> | --container <name>) [--log <server-log>]
//   [--rounds 6] [--limit 300] [--concurrency 4] [--images 4] [--urls <file>] [--filters] [--searches <file>]
//   [--user-agent <ua>] [--probe]
// Dependency-free memory probe (#1262): crawls a production build round after round (sitemap, else make -> model ->
// model x category -> product links) plus a few /_next/image URLs per page, and after each round prints the request
// count, the process RSS (`ps` for --pid, `docker stats` for --container) and the latest `Memory:` line the server
// logged (src/lib/memory-log.ts; start the server with MEMORY_LOG_INTERVAL_MS=15000 and pass its log with --log).
// `--filters` adds listing variants (sorts, deep pages, in-stock and brand/attribute filters); `--searches <file>` adds
// /katalog?q= URLs from a file of terms, only with a crawler user agent (the default `getirbakim-memory-bot` is one):
// other agents record every search in the database, so search URLs are refused. `--probe` (needs --log) sends SIGUSR2 to --pid after
// the last round (start the server with MEMORY_PROBE=1 and node --expose-gc) and prints the `Cache probe:` lines.
// Point it at a build, not `next dev`.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defaultUserAgent, listingVariants, probeArmed, searchAllowed, searchPaths } from "./memory-urls.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv.splice(index, 2)[1] ?? fallback;
};
const pid = flag("--pid");
const container = flag("--container");
const logFile = flag("--log");
const urlsFile = flag("--urls");
const searchesFile = flag("--searches");
const userAgent = flag("--user-agent", defaultUserAgent);
const probe = argv.includes("--probe") && argv.splice(argv.indexOf("--probe"), 1).length > 0;
const filters = argv.includes("--filters") && argv.splice(argv.indexOf("--filters"), 1).length > 0;
const count = (name, fallback, min) => {
  const value = Number(flag(name, fallback));
  return Number.isFinite(value) ? Math.max(min, Math.floor(value)) : fallback;
};
const rounds = count("--rounds", 6, 1);
const limit = count("--limit", 300, 1);
const concurrency = count("--concurrency", 4, 1);
const images = count("--images", 4, 0);
const [base] = argv;
if (!base || (!pid && !container)) {
  console.error("Usage: node scripts/harness/measure-memory.mjs <base-url> (--pid <pid> | --container <name>) [--log <server-log>] [--rounds N] [--limit N] [--concurrency N] [--images N] [--urls <file>] [--filters] [--searches <file>] [--user-agent <ua>] [--probe]");
  process.exit(2);
}
if (searchesFile && !searchAllowed(userAgent)) {
  console.error(`--searches needs a crawler user agent (matching /bot|crawl|spider|slurp|preview|headless|lighthouse/i); "${userAgent}" would record every search`);
  process.exit(2);
}
if (probe && (!pid || !logFile)) {
  console.error("--probe needs --pid and --log");
  process.exit(2);
}
// SIGUSR2 kills a process that has no handler: only a server that logged `Memory probe: armed pid=<pid>` gets it.
const armed = () => {
  try {
    return probeArmed(readFileSync(logFile, "utf8"), pid);
  } catch {
    return false;
  }
};
if (probe && !armed()) {
  console.error(`--probe: no "Memory probe: armed pid=${pid}" line in ${logFile}; start the server with MEMORY_PROBE=1`);
  process.exit(2);
}

const get = (url) => fetch(url, { headers: { "user-agent": userAgent }, cache: "no-store", signal: AbortSignal.timeout(60_000) });
const text = async (path) => {
  try {
    const response = await get(new URL(path, base));
    return response.ok ? await response.text() : "";
  } catch {
    return "";
  }
};
const links = (html, pattern) => [...new Set([...html.matchAll(pattern)].map((match) => match[1].replaceAll("&amp;", "&")))];
const allowed = (path) => path.startsWith("/") && (searchAllowed(userAgent) || !/[?&]q=/.test(path)) && !path.startsWith("/api/");

async function fromSitemap() {
  const index = await text("/sitemap.xml");
  const children = links(index, /<loc>([^<]+)<\/loc>/g).map((loc) => new URL(loc).pathname);
  const pages = [];
  for (const child of children) {
    const body = child.endsWith(".xml") ? await text(child) : "";
    pages.push(...links(body, /<loc>([^<]+)<\/loc>/g).map((loc) => new URL(loc).pathname + new URL(loc).search));
    if (pages.length >= limit * 4) break;
  }
  return pages.filter(allowed);
}

// make -> model -> model x category -> product; interleaved so every kind of page is in the list.
async function fromLinks() {
  const kinds = [[], [], [], []];
  const makes = links(await text("/arac-markalari"), /href="(\/yedek-parca\/[^"?#]+)"/g).filter(allowed);
  kinds[0].push(...makes);
  for (const make of makes.slice(0, 12)) {
    const models = links(await text(make), /href="(\/yedek-parca\/[^"?#]+)"/g).filter((path) => allowed(path) && path !== make);
    kinds[1].push(...models);
    for (const model of models.slice(0, 3)) {
      const listings = links(await text(model), /href="(\/(?:yedek-parca|katalog|kategori)\/[^"?#]+)"/g).filter((path) => allowed(path) && path !== model);
      kinds[2].push(...listings);
      for (const listing of listings.slice(0, 2)) kinds[3].push(...links(await text(listing), /href="(\/urun\/[^"?#]+)"/g).filter(allowed));
    }
  }
  const catalog = await text("/katalog");
  kinds[2].push(...links(catalog, /href="(\/(?:katalog|kategori)\/[^"?#]+)"/g).filter(allowed));
  const merged = [];
  for (let index = 0; merged.length < limit * 4 && kinds.some((kind) => index < kind.length); index++) {
    for (const kind of kinds) if (index < kind.length) merged.push(kind[index]);
  }
  return merged;
}

let urls;
if (urlsFile) urls = readFileSync(urlsFile, "utf8").split("\n").map((line) => line.trim()).filter(allowed);
else {
  urls = await fromSitemap();
  if (urls.length < 20) urls = [...new Set([...urls, ...(await fromLinks())])];
}
urls = [...new Set(["/", "/katalog", "/arac-markalari", ...urls])];
const isListing = (path) => !path.includes("?") && /^\/(katalog|kategori|yedek-parca|marka)(\/|$)/.test(path);
if (filters) {
  // Listing variants, interleaved after the plain URLs so --limit keeps both kinds.
  const variants = [];
  for (const path of urls.filter(isListing).slice(0, Math.ceil(limit / 6))) variants.push(listingVariants(path, await text(path)));
  const merged = [];
  for (let index = 0; variants.some((list) => index < list.length); index++) for (const list of variants) if (index < list.length) merged.push(list[index]);
  urls = [...urls.slice(0, Math.ceil(limit / 2)), ...merged];
}
if (searchesFile) {
  const terms = readFileSync(searchesFile, "utf8").split("\n");
  urls = [...urls.slice(0, Math.ceil(limit / 2)), ...searchPaths(terms, userAgent), ...urls.slice(Math.ceil(limit / 2))];
}
urls = [...new Set(urls)].slice(0, limit);
if (urls.length < 3) {
  console.error("No URLs to crawl");
  process.exit(1);
}
console.log(`Crawling ${urls.length} URLs x ${rounds} rounds, concurrency ${concurrency}, ${images} images per page, user agent ${userAgent}`);

function rssMb() {
  try {
    if (pid) return Number(execFileSync("ps", ["-o", "rss=", "-p", pid], { encoding: "utf8" }).trim()) / 1024;
    const usage = execFileSync("docker", ["stats", "--no-stream", "--format", "{{.MemUsage}}", container], { encoding: "utf8" }).split("/")[0].trim();
    const value = parseFloat(usage);
    return /GiB/i.test(usage) ? value * 1024 : /KiB/i.test(usage) ? value / 1024 : value;
  } catch {
    return Number.NaN;
  }
}
const lastMemoryLine = () => {
  if (!logFile) return "";
  try {
    return readFileSync(logFile, "utf8").split("\n").filter((line) => line.startsWith("Memory:")).at(-1) ?? "";
  } catch {
    return "";
  }
};

console.log(`start rss=${rssMb().toFixed(0)}MB`);
for (let round = 1; round <= rounds; round++) {
  let next = 0, requests = 0, failed = 0;
  const timings = { plain: [], variant: [], search: [] };
  const worker = async () => {
    while (next < urls.length) {
      const path = urls[next++];
      try {
        const started = performance.now();
        const response = await get(new URL(path, base));
        const html = await response.text();
        timings[/[?&]q=/.test(path) ? "search" : path.includes("?") ? "variant" : "plain"].push(performance.now() - started);
        requests++;
        if (!response.ok) failed++;
        const sources = links(html, /src="(\/_next\/image\?[^"]+)"/g).slice(0, images);
        for (const source of sources) {
          try {
            const image = await get(new URL(source, base));
            await image.arrayBuffer();
            requests++;
            if (!image.ok) failed++;
          } catch {
            failed++;
          }
        }
      } catch {
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  // The server logs every few seconds; let the next line appear.
  await new Promise((resolve) => setTimeout(resolve, logFile ? 16_000 : 1_000));
  const timing = Object.entries(timings).filter(([, list]) => list.length).map(([kind, list]) => `${kind}=${list.length}x${(list.reduce((sum, ms) => sum + ms, 0) / list.length).toFixed(0)}ms`).join(" ");
  console.log(`round ${round}: requests=${requests} failed=${failed} rss=${rssMb().toFixed(0)}MB avg(${timing}) ${lastMemoryLine()}`);
}
if (probe && !armed()) console.error("--probe: the armed line is gone from the log; SIGUSR2 not sent");
else if (probe) {
  const before = logFile ? readFileSync(logFile, "utf8").split("\n").length : 0;
  process.kill(Number(pid), "SIGUSR2");
  // The probe collects garbage after every cache; wait for its closing line.
  for (let waited = 0; waited < 300_000; waited += 2_000) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const lines = logFile ? readFileSync(logFile, "utf8").split("\n").slice(before) : [];
    if (lines.some((line) => line.startsWith("Cache probe: done"))) {
      for (const line of lines.filter((entry) => entry.startsWith("Cache probe:") || entry.startsWith("Heap snapshot:"))) console.log(line);
      break;
    }
  }
}
