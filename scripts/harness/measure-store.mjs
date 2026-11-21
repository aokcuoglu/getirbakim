// Usage: npm run harness:measure -- [--build] [--port N] [--base <url>] [--lighthouse] [--lh-runs N] [--runs N]
//   [--product </urun/…>] [--out <file.md>] [<path>...]
// One-command production-build store measurement (#642): optionally builds, starts `next start` on its own port, runs
// measure-html.mjs --json (HTML KB, RSC share, gzip, TTFB, client props) and, with --lighthouse, mobile lab vitals,
// then prints a Markdown table (and writes it to --out). Report only: exit 1 only when a page is not HTTP 200.
// Exit 2: bad usage, port 3000 (the dev server) or a busy port, missing build. Foreign processes are never killed.
// Next 16 facts: `next dev` writes to .next/dev and `next build` to .next (docs/01-app/02-guides/upgrading/version-16.md,
// "Concurrent dev and build"), so a build does not disturb a dev server; with `output: "standalone"`
// (docs/01-app/03-api-reference/05-config/01-next-config-js/output.md) `next start` still serves from .next.
// A symlinked node_modules (worktrees) cannot be built by Turbopack (docs/harness/README.md): --webpack is used then.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, lstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lighthouseMetrics, markdownTable, median, parseBudget, samplePaths } from "./html-weight.mjs";

const LIGHTHOUSE = "lighthouse@13.6.0", BUDGET = "/urun/=150,/katalog=350,/arac-markalari=350,/kategori/=350,/marka/=350,/yedek-parca/=350";
const argv = process.argv.slice(2);
const flag = (name) => (argv.includes(name) ? (argv.splice(argv.indexOf(name), 1), true) : false);
const value = (name) => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv.splice(index, 2)[1];
};
const fail = (message) => (console.error(message), process.exit(2));
const build = flag("--build"), lighthouse = flag("--lighthouse");
const port = Number(value("--port") ?? 3642), base = value("--base"), out = value("--out"), product = value("--product");
const runs = Number(value("--runs") ?? 5), lhRuns = Number(value("--lh-runs") ?? 3);
if (!Number.isInteger(port) || port < 1 || !(runs >= 2) || !(lhRuns >= 1)) fail("Invalid --port / --runs / --lh-runs");
if (product && !/^\/urun\/[^?#\s]+$/.test(product)) fail("--product must look like /urun/<slug>");
const badArg = (arg) => arg.startsWith("--") || !arg.startsWith("/") || new URL(arg, "http://x").searchParams.has("q");
if (argv.some(badArg)) fail(`Unknown option, non-path argument or search URL: ${argv.find(badArg)}`);
let basePort = port;
if (base) {
  try {
    const url = new URL(base);
    basePort = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  } catch {
    fail(`Malformed --base: ${base}`);
  }
}
if (port === 3000 || basePort === 3000) fail("Port 3000 is the dev server: pick another port.");

const sha = (() => { try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } })();
const env = { ...process.env, BUILD_VERSION: `measure-${sha}`, PORT: String(port), STOREFRONT_WARMUP: "0", ENRICHMENT_LINK_SYNC_INTERVAL_MS: "0" };
const next = ["node_modules/next/dist/bin/next"];
const webpack = lstatSync("node_modules").isSymbolicLink();
let server;
const stop = () => { if (server?.pid) try { process.kill(-server.pid); } catch { /* already gone */ } server = undefined; };
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => (stop(), process.exit(130)));

const listening = () => new Promise((resolve) => {
  const socket = net.connect({ port, host: "127.0.0.1" });
  socket.once("connect", () => (socket.destroy(), resolve(true)));
  socket.once("error", () => resolve(false));
});

async function main() {
  let origin = base;
  if (!base) {
    if (await listening()) fail(`Port ${port} is already in use: pick another with --port.`);
    if (build) {
      if (webpack) console.error("node_modules is a symlink: building with --webpack (Turbopack cannot).");
      const result = spawnSync("node", [...next, "build", ...(webpack ? ["--webpack"] : [])], { env, stdio: ["ignore", "inherit", "inherit"] });
      if (result.status !== 0) { console.error("next build failed"); return 1; }
    } else if (!existsSync(".next/BUILD_ID")) fail("No production build: run `npm run harness:measure -- --build` first.");
    const logDir = mkdtempSync(join(tmpdir(), "measure-start-")), logFile = join(logDir, "start.log"), log = openSync(logFile, "w");
    server = spawn("node", [...next, "start", "-p", String(port)], { env, detached: true, stdio: ["ignore", log, log] });
    closeSync(log);
    let exited = false;
    server.once("exit", () => { exited = true; });
    origin = `http://127.0.0.1:${port}`;
    let healthy = false;
    for (let i = 0; i < 60 && !healthy && !exited; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      healthy = await fetch(`${origin}/api/health`).then((response) => response.ok, () => false);
    }
    if (!healthy) {
      console.error(`${exited ? "next start exited early" : "Server did not become healthy within 60 s"}:\n${readFileSync(logFile, "utf8").slice(-1500)}`);
      return 1;
    }
    rmSync(logDir, { recursive: true, force: true });
  }

  let paths = argv;
  if (!paths.length) {
    const html = await fetch(new URL("/kategori/filtre", origin)).then((response) => response.text());
    const sample = samplePaths(html);
    paths = ["/", "/katalog", "/kategori/filtre", "/marka/bosch", "/yedek-parca/volkswagen", ...(product ? [product] : [sample.product, sample.fitmentProduct].filter(Boolean))];
  }
  paths = [...new Set(paths)];

  const child = spawnSync("node", ["scripts/harness/measure-html.mjs", origin, ...paths, "--json", "--runs", String(runs), "--budget", BUDGET], { encoding: "utf8", maxBuffer: 1 << 28, timeout: 300_000 });
  if (child.error) { console.error(`measure-html failed: ${child.error.message}`); return 1; }
  if (child.status === 2 || !child.stdout) { console.error(child.stderr); return 1; }
  const { rows, details } = JSON.parse(child.stdout);
  const notOk = rows.filter((row) => row.status !== 200).map((row) => `${row.path}: HTTP ${row.status}`);

  let lhVersion = "off", lhWarned = false;
  if (lighthouse) {
    lhVersion = LIGHTHOUSE.split("@")[1];
    const dir = mkdtempSync(join(tmpdir(), "measure-lh-"));
    for (const row of rows) {
      const samples = [];
      for (let i = 0; i < lhRuns; i++) {
        const file = join(dir, `run-${i}.json`);
        const args = ["--yes", LIGHTHOUSE, new URL(row.path, origin).href, "--only-categories=performance", "--form-factor=mobile", "--output=json", `--output-path=${file}`, "--quiet", "--chrome-flags=--headless=new"];
        const result = spawnSync("npx", args, { env: process.env, encoding: "utf8", timeout: 120_000 });
        if (result.signal) { console.error(`Lighthouse stopped (${result.signal}) for ${row.path}; vitals stay —.`); break; }
        const metrics = result.status === 0 && existsSync(file) ? lighthouseMetrics(JSON.parse(readFileSync(file, "utf8"))) : null;
        if (metrics) samples.push(metrics);
        else if (!lhWarned) { lhWarned = true; console.error(`Lighthouse failed for ${row.path} (set CHROME_PATH if Chrome is not found); vitals stay —.\n${(result.stderr ?? "").slice(-300)}`); }
      }
      if (samples.length) Object.assign(row, { lcpMs: median(samples.map((s) => s.lcpMs)), cls: median(samples.map((s) => s.cls)), tbtMs: median(samples.map((s) => s.tbtMs)) });
    }
    rmSync(dir, { recursive: true, force: true });
  }

  const kb = (bytes) => (bytes / 1024).toFixed(1);
  const lines = [`commit ${sha} | bundler ${build ? (webpack ? "webpack" : "turbopack") : "existing build"} | runs ${runs} | Lighthouse ${lhVersion}${lighthouse ? ` x${lhRuns} (mobile, median)` : ""} | ${new Date().toISOString().slice(0, 10)}`, "", markdownTable(rows, parseBudget(BUDGET)), ""];
  for (const { path, props } of details) {
    const total = props.reduce((sum, entry) => sum + entry.bytes, 0);
    lines.push(`${path} client props: ${kb(total)} KB — ${props.slice(0, 6).map((entry) => `${entry.name} ${kb(entry.bytes)} (x${entry.count})`).join(", ")}`);
  }
  const text = lines.join("\n");
  console.log(text);
  if (out) writeFileSync(out, `${text}\n`);
  if (notOk.length) { console.error(`Not HTTP 200:\n  ${notOk.join("\n  ")}`); return 1; }
  return 0;
}

try {
  process.exitCode = await main();
} finally {
  stop();
}
