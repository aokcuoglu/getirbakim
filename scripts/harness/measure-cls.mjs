// Usage: node scripts/harness/measure-cls.mjs <url> [mobile|desktop] [slow] [--quiet]
// Dependency-free CLS probe: headless system Chrome + CDP. The summary line (total CLS) is printed last, so `tail -1` gives
// the total; consecutive shifts without a source node are collapsed into one line. --quiet (or CLS_QUIET=1) prints only the summary.
// Env: CHROME_PATH, CLS_WIDTH (mobile width, default 412), CHROME_ARGS (space-separated extra Chrome flags, e.g. --no-sandbox in a container).
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const quiet = argv.includes("--quiet") || process.env.CLS_QUIET === "1";
const [url, mode = "mobile", slow] = argv.filter((a) => a !== "--quiet");
if (!url) {
  console.error("Usage: node scripts/harness/measure-cls.mjs <url> [mobile|desktop] [slow] [--quiet]");
  process.exit(2);
}
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const dir = mkdtempSync(join(tmpdir(), "cls-"));
const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--no-first-run", "--disable-extensions", ...(process.env.CHROME_ARGS?.split(/\s+/).filter(Boolean) ?? []), "about:blank"], { stdio: "ignore" });
let chromeError;
chrome.once("error", (e) => {
  chromeError = e;
});
let finishing = false;
const finish = async (code) => {
  if (finishing) return;
  finishing = true;
  if (chrome.exitCode === null && !chromeError) {
    const closed = new Promise((r) => chrome.once("exit", r));
    chrome.kill();
    await Promise.race([closed, new Promise((r) => setTimeout(r, 3000))]);
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  process.exit(code);
};
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => finish(130));
for (const ev of ["uncaughtException", "unhandledRejection"]) {
  process.on(ev, (e) => {
    console.error(e);
    finish(1);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let code = 0;
try {
  let wsUrl;
  for (let i = 0; i < 50 && !wsUrl; i++) {
    if (chromeError) throw chromeError;
    const portFile = join(dir, "DevToolsActivePort");
    if (existsSync(portFile)) {
      const port = readFileSync(portFile, "utf8").split("\n")[0].trim();
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl;
      } catch {
        /* Chrome not ready yet */
      }
    }
    if (!wsUrl) await sleep(200);
  }
  if (!wsUrl) throw new Error("Chrome did not start");
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("DevTools socket failed to open"));
  });
  ws.onerror = () => finish(1);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result ?? m.error);
      pending.delete(m.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  await send("Page.enable");
  await send("Network.enable");
  await send(
    "Emulation.setDeviceMetricsOverride",
    mode === "mobile"
      ? { width: Number(process.env.CLS_WIDTH || 412), height: 823, deviceScaleFactor: 1.75, mobile: true }
      : { width: 1350, height: 940, deviceScaleFactor: 1, mobile: false },
  );
  if (slow) {
    await send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
  window.__cls=[];
  const sel=n=>{if(!n||n.nodeType!==1)return String(n&&n.nodeName);let s=n.tagName.toLowerCase();if(n.id)s+="#"+n.id;const c=(n.getAttribute("class")||"").split(/\\s+/).slice(0,4).join(".");if(c)s+="."+c;return s+" «"+(n.textContent||"").trim().slice(0,40)+"»";};
  const rect=r=>[r.x,r.y,r.width,r.height].map(Math.round).join(",");
  new PerformanceObserver(l=>{for(const e of l.getEntries()){if(e.hadRecentInput)continue;window.__cls.push({t:Math.round(e.startTime),v:+e.value.toFixed(4),src:e.sources.map(s=>({n:sel(s.node),from:rect(s.previousRect),to:rect(s.currentRect)}))});}}).observe({type:"layout-shift",buffered:true});
  document.fonts&&document.fonts.ready.then(()=>window.__fontsAt=Math.round(performance.now()));
  `,
  });
  const nav = await send("Page.navigate", { url });
  if (nav.errorText) throw new Error(`Navigation failed: ${nav.errorText}`);
  await sleep(slow ? 20000 : 9000);
  const r = await send("Runtime.evaluate", {
    expression: "JSON.stringify({cls:window.__cls,fontsAt:window.__fontsAt,total:window.__cls.reduce((a,b)=>a+b.v,0)})",
    returnByValue: true,
  });
  const out = JSON.parse(r.result.value);
  if (!quiet) {
    for (let i = 0; i < out.cls.length; i++) {
      const e = out.cls[i];
      if (e.src.length === 0) {
        let j = i;
        while (j + 1 < out.cls.length && out.cls[j + 1].src.length === 0) j++;
        const run = out.cls.slice(i, j + 1);
        console.log(` t=${run[0].t} v=${run.reduce((a, b) => a + b.v, 0).toFixed(4)} (${run.length} shift${run.length > 1 ? "s" : ""}, no source node)`);
        i = j;
        continue;
      }
      console.log(` t=${e.t} v=${e.v}`);
      for (const s of e.src) console.log(`   ${s.n}  [${s.from}] -> [${s.to}]`);
    }
  }
  console.log(url, mode, slow || "", "CLS total", out.total.toFixed(4), "fonts ready at", out.fontsAt);
  ws.close();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  code = 1;
} finally {
  await finish(code);
}
