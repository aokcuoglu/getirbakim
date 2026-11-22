// Pure helpers of the HTML weight probe (#642), kept apart from the network code so they can be tested.

// The RSC payload as one string: the `[1, "…"]` pushes concatenated.
export function flightOf(html) {
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
export function clientProps(flight) {
  const modules = new Map(), parsed = [];
  for (const row of flight.split(/\n(?=[0-9a-f]+:)/)) {
    const colon = row.indexOf(":"), id = row.slice(0, colon), body = row.slice(colon + 1);
    if (body.startsWith("I[")) {
      try {
        const [moduleId, chunks, name] = JSON.parse(body.slice(1));
        const file = String(Array.isArray(chunks) ? chunks.at(-1) ?? "" : chunks).split("?")[0].split("/").pop();
        // Export name + chunk file + module id: modules that share an empty (default) export name stay apart.
        modules.set(id, `${name || "default"} (${file.slice(0, 32)}#${moduleId})`);
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

// What the markup itself weighs: bytes inside class attributes, module rows (`id:I[…]`) of the payload and JSON-LD
// scripts. The class bytes are counted in the HTML only; the payload repeats them, so the real cost is about double.
export function markupStats(html, flight = flightOf(html).flight) {
  const bytes = (text) => Buffer.byteLength(text);
  let classBytes = 0;
  for (const match of html.matchAll(/\sclass="([^"]*)"/g)) classBytes += bytes(match[1]);
  let moduleBytes = 0;
  for (const row of flight.split(/\n(?=[0-9a-f]+:)/)) {
    if (/^[0-9a-f]+:I\[/.test(row)) moduleBytes += bytes(row);
  }
  let jsonLdBytes = 0;
  for (const match of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) jsonLdBytes += bytes(match[1]);
  return { classBytes, moduleBytes, jsonLdBytes };
}

// `--budget "/urun/=160,/=410"` -> [[prefix, KB]]; the longest matching prefix decides a path's limit. Throws on an
// entry that is not `/prefix=<positive KB>`, so a typo cannot switch the gate off.
export function parseBudget(spec) {
  if (typeof spec !== "string" || !spec.trim()) throw new Error("--budget needs a value like \"/urun/=160,/=410\"");
  return spec.split(",").map((part) => {
    const entry = part.trim(), index = entry.lastIndexOf("="), prefix = entry.slice(0, index), limit = entry.slice(index + 1).trim();
    if (index === -1 || !prefix.startsWith("/") || !/^\d+(\.\d+)?$/.test(limit) || Number(limit) <= 0) throw new Error(`Invalid --budget entry "${entry}": expected /prefix=<KB>`);
    return [prefix, Number(limit)];
  });
}

// "/" is the home page only; any other prefix matches itself and what lies below it on a segment boundary.
export function budgetFor(budget, path) {
  const pathname = path.split("?")[0];
  let best;
  for (const entry of budget) {
    const [prefix] = entry;
    const matches = pathname === prefix || (prefix !== "/" && pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`));
    if (matches && (!best || prefix.length > best[0].length)) best = entry;
  }
  return best?.[1];
}

// First product link and first fitment-product card link (`…#uyumlu-araclar`) of a list page, fragment stripped.
export function samplePaths(html) {
  const product = html.match(/href="(\/urun\/[^"#?]+)/)?.[1];
  const fitmentProduct = html.match(/href="(\/urun\/[^"#?]+)#uyumlu-araclar"/)?.[1];
  return { product, fitmentProduct };
}

// Lighthouse report -> the three lab vitals; null when an audit is missing or the run failed.
export function lighthouseMetrics(lhr) {
  if (!lhr || lhr.runtimeError) return null;
  const read = (id) => lhr.audits?.[id]?.numericValue;
  const lcpMs = read("largest-contentful-paint"), cls = read("cumulative-layout-shift"), tbtMs = read("total-blocking-time");
  if (![lcpMs, cls, tbtMs].every((value) => typeof value === "number")) return null;
  // network-requests is a hidden performance audit; if a Lighthouse version drops it the vitals still count.
  const items = lhr.audits?.["network-requests"]?.details?.items;
  return Array.isArray(items) ? { lcpMs, cls, tbtMs, requests: items.length } : { lcpMs, cls, tbtMs };
}

export function median(numbers) {
  if (!numbers.length) return undefined;
  const sorted = [...numbers].sort((a, b) => a - b), mid = Math.floor((sorted.length - 1) / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid] + sorted[mid + 1]) / 2;
}

// Rows: measure-html `--json` rows, optionally with `lcpMs`/`cls`/`tbtMs`/`requests`; missing vitals print as an em dash.
export function markdownTable(rows, budget = []) {
  const lines = ["| Route | HTML KB | RSC KB (%) | gzip KB | TTFB ms | LCP s | CLS | TBT ms | Req | Target KB | Status |", "|---|---|---|---|---|---|---|---|---|---|---|"];
  for (const row of rows) {
    const limit = budgetFor(budget, row.path), over = limit === undefined ? undefined : Math.round(row.htmlKB - limit);
    const status = limit === undefined ? "—" : over > 0 ? `+${over}` : "ok";
    const vital = (value, format) => (typeof value === "number" ? format(value) : "—");
    lines.push(`| ${row.path} | ${row.htmlKB.toFixed(1)} | ${row.rscKB.toFixed(1)} (${row.rscPct}) | ${row.gzipKB.toFixed(1)} | ${row.ttfbMs} | ${vital(row.lcpMs, (v) => (v / 1000).toFixed(2))} | ${vital(row.cls, (v) => v.toFixed(3))} | ${vital(row.tbtMs, (v) => String(Math.round(v)))} | ${vital(row.requests, (v) => String(Math.round(v)))} | ${limit === undefined ? "—" : `≤${limit}`} | ${status} |`);
  }
  return lines.join("\n");
}
