// Usage: node scripts/harness/measure-cls.mjs <url> [mobile|desktop] [slow]
// Dependency-free CLS probe: headless system Chrome + CDP. Env: CHROME_PATH, W (mobile width, default 412).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, mode = "mobile", slow] = process.argv.slice(2);
if (!url) {
  console.error("Usage: node scripts/harness/measure-cls.mjs <url> [mobile|desktop] [slow]");
  process.exit(2);
}
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9300 + Math.floor(Math.random() * 500);
const dir = mkdtempSync(join(tmpdir(), "cls-"));
const chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--no-first-run", "--disable-extensions", "about:blank"], { stdio: "ignore" });
const finish = async (code) => {
  const closed = new Promise((r) => chrome.once("exit", r));
  chrome.kill();
  await Promise.race([closed, new Promise((r) => setTimeout(r, 3000))]);
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  process.exit(code);
};
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => finish(130));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    target = list.find((t) => t.type === "page");
  } catch {
    /* Chrome not ready yet */
  }
  if (!target) await sleep(200);
}
if (!target) {
  console.error("Chrome did not start");
  await finish(1);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
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
    ? { width: Number(process.env.W || 412), height: 823, deviceScaleFactor: 1.75, mobile: true }
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
await send("Page.navigate", { url });
await sleep(slow ? 20000 : 9000);
const r = await send("Runtime.evaluate", {
  expression: "JSON.stringify({cls:window.__cls,fontsAt:window.__fontsAt,total:window.__cls.reduce((a,b)=>a+b.v,0)})",
  returnByValue: true,
});
const out = JSON.parse(r.result.value);
console.log(url, mode, slow || "", "CLS total", out.total.toFixed(4), "fonts ready at", out.fontsAt);
for (const e of out.cls) {
  console.log(` t=${e.t} v=${e.v}`);
  for (const s of e.src) console.log(`   ${s.n}  [${s.from}] -> [${s.to}]`);
}
ws.close();
await finish(0);
