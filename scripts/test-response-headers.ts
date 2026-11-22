import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { matchHas } from "next/dist/shared/lib/router/utils/prepare-destination";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { adminThemeScript } from "../src/lib/admin-theme-script";
import { ADMIN_THEME_SCRIPT_HASH, CSP_REPORT_PATH, REPORTING_ENDPOINTS, TAMI_FORM_HOSTS, cspReportOnly, newNonce } from "../src/lib/csp";
import { cspReportLine, parseCspReports } from "../src/lib/csp-report";
import { RETURN_TO_HEADER } from "../src/modules/auth/return-to";
import { config, proxy } from "../src/proxy";

// The response headers of next.config.ts (#1216): security headers everywhere, public asset caching, no-referrer.

const build = "abc123def456";
const short = "public, max-age=86400, s-maxage=3600, stale-while-revalidate=600";
const immutable = "public, max-age=31536000, immutable";
const id = "0b8f6a52-6c0e-4f7c-9d52-0a4d9b7e1c11";

type Rule = { source: string; has?: { type: "query"; key: string; value?: string }[]; headers: { key: string; value: string }[] };

async function load(buildVersion: string | undefined, siteUrl?: string): Promise<Rule[]> {
  if (buildVersion === undefined) delete process.env.BUILD_VERSION;
  else process.env.BUILD_VERSION = buildVersion;
  const previousSiteUrl = process.env.SITE_URL;
  if (siteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = siteUrl;
  try {
    const mod = (await import(`../next.config?v=${buildVersion ?? "none"}&site=${encodeURIComponent(siteUrl ?? "unset")}`)) as {
      default: { headers: () => Promise<Rule[]> };
    };
    return await mod.default.headers();
  } finally {
    if (previousSiteUrl === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = previousSiteUrl;
  }
}

function effective(rules: Rule[], path: string, query: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of rules) {
    if (!getPathMatch(rule.source)(path)) continue;
    if (rule.has && !matchHas({ headers: {} } as never, query, rule.has as never)) continue;
    for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
}

const securityKeys = ["Content-Security-Policy", "Referrer-Policy", "Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options"];

test("every route carries exactly the five security headers", async () => {
  const rules = await load(build);
  for (const path of ["/", "/katalog", "/yonetim/siparisler", "/api/health", "/media/site/images/x.jpg"]) {
    assert.deepEqual(Object.keys(effective(rules, path)).filter((k) => k !== "Cache-Control").sort(), securityKeys, path);
  }
});

const cspPaths = ["/", "/yonetim/siparisler", "/api/payments/tami/start", "/api/payments/tami/callback", "/media/site/images/x.jpg"];
const phase1 = "object-src 'none'; base-uri 'self'; frame-ancestors 'self'";

test("the CSP is the phase-1 policy", async () => {
  const rules = await load(build, "https://getirbakim.com");
  for (const path of cspPaths) {
    assert.equal(effective(rules, path)["Content-Security-Policy"], `${phase1}; upgrade-insecure-requests`, path);
  }
});

test("an http or unset SITE_URL does not upgrade requests", async () => {
  for (const siteUrl of ["http://localhost:3103", undefined]) {
    const rules = await load(build, siteUrl);
    for (const path of cspPaths) assert.equal(effective(rules, path)["Content-Security-Policy"], phase1, `${siteUrl} ${path}`);
  }
});

test("phase 1 restricts no fetch or form directive", async () => {
  const csp = effective(await load(build, "https://getirbakim.com"), "/")["Content-Security-Policy"];
  assert.doesNotMatch(csp, /(^|;\s)(default-src|script-src(-elem|-attr)?|style-src(-elem|-attr)?|img-src|connect-src|font-src|frame-src|form-action)\s/);
  assert.match(csp, /frame-ancestors/);
});

test("deploymentId is the build id the dpl match relies on", async () => {
  process.env.BUILD_VERSION = build;
  const mod = (await import(`../next.config?v=${build}-deployment`)) as { default: { deploymentId?: string } };
  assert.equal(mod.default.deploymentId, build);
});

test("this build's own dpl is immutable", async () => {
  const rules = await load(build);
  assert.equal(effective(rules, "/media/site/images/x.jpg", { dpl: build })["Cache-Control"], immutable);
  assert.equal(effective(rules, "/brand/logo-light.svg", { dpl: build })["Cache-Control"], immutable);
});

test("bare, other-build and ?v= URLs keep the short cache", async () => {
  const rules = await load(build);
  for (const query of [{} as Record<string, string>, { dpl: "otherbuild" }, { dpl: `${build}x` }, { dpl: `x${build}` }, { v: "0123456789ab" }]) {
    assert.equal(effective(rules, "/media/site/images/x.jpg", query)["Cache-Control"], short, JSON.stringify(query));
  }
  assert.equal(effective(rules, "/brand/logo-light.svg")["Cache-Control"], short);
});

test("payment and order-access routes send no referrer", async () => {
  const rules = await load(build);
  for (const path of ["/api/payments/tami/start", "/api/payments/tami/callback", `/siparis/${id}/erisim`]) {
    assert.equal(effective(rules, path)["Referrer-Policy"], "no-referrer", path);
  }
  assert.equal(effective(rules, `/siparis/${id}`)["Referrer-Policy"], "strict-origin-when-cross-origin");
});

test("without BUILD_VERSION nothing is immutable; a dotted id is matched literally", async () => {
  const none = await load(undefined);
  assert.equal(effective(await load("development"), "/media/x.jpg", { dpl: "development" })["Cache-Control"], short);
  assert.equal(effective(none, "/media/x.jpg", { dpl: build })["Cache-Control"], short);
  const dotted = await load("ab.cd");
  assert.equal(effective(dotted, "/media/x.jpg", { dpl: "ab.cd" })["Cache-Control"], immutable);
  assert.equal(effective(dotted, "/media/x.jpg", { dpl: "abXcd" })["Cache-Control"], short);
});

test("pages get no Cache-Control from the config", async () => {
  const rules = await load(build);
  assert.equal(effective(rules, "/")["Cache-Control"], undefined);
  assert.equal(effective(rules, "/katalog")["Cache-Control"], undefined);
});

test("the short cache stays within a day even after CloudFront forwards Age", () => {
  const directive = (name: string) => Number(new RegExp(`${name}=(\\d+)`).exec(short)?.[1]);
  assert.ok(directive("s-maxage") + directive("stale-while-revalidate") < directive("max-age"));
  assert.ok(directive("max-age") <= 86400);
});

test("a ?v= logo gets this build's dpl from next/image and is therefore immutable", async () => {
  process.env.NEXT_DEPLOYMENT_ID = build;
  const { getImageProps } = await import("next/image");
  const { props } = getImageProps({ src: "/media/logos/vehicles/bmw.webp?v=0123456789ab", width: 84, height: 84, alt: "", unoptimized: true });
  assert.ok(props.src.includes("v=0123456789ab"));
  assert.ok(props.src.includes(`dpl=${build}`), props.src);
  const query = Object.fromEntries(new URL(props.src, "http://x").searchParams);
  assert.equal(effective(await load(build), "/media/logos/vehicles/bmw.webp", query)["Cache-Control"], immutable);
});

// Files whose bare /media or /brand URLs must stay stable (manifest, social images and JSON-LD) or are not our assets.
const bareUrlAllowlist = new Set(["src/app/manifest.ts", "src/lib/site.ts", "src/app/api/bakim-seti/gorsel/route.tsx", "src/modules/enrichment/trodo-adapter.ts"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(css|tsx?)$/.test(entry.name) ? [path] : [];
  });
}

/** Offending lines: a CSS root-relative url(), or a /media or /brand string literal not handed to next/image (which adds dpl). */
function bareAssetUrls(file: string, code: string): string[] {
  const found: string[] = [];
  const lines = (file.endsWith(".css") ? code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")) : code).split("\n");
  lines.forEach((line, index) => {
    if (file.endsWith(".css")) {
      if (/url\(\s*["']?\/(?!\/)/.test(line)) found.push(`${file}:${index + 1}`);
      return;
    }
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    if (/["'`]\/(media|brand)\//.test(line) && !/<Image(\s|$)|getImageProps\(/.test(line)) found.push(`${file}:${index + 1}`);
  });
  return found;
}

test("storefront assets are hashed imports or next/image, not bare /media or /brand URLs", () => {
  const found: string[] = [];
  for (const file of sourceFiles(join(process.cwd(), "src"))) {
    const rel = relative(process.cwd(), file);
    if (!bareUrlAllowlist.has(rel)) found.push(...bareAssetUrls(rel, readFileSync(file, "utf8")));
  }
  assert.deepEqual(found, []);
});

test("the source guard catches the ways a bare asset URL can slip in", () => {
  for (const sample of ['<img src={"/media/a.png"} />', "<img src='/media/a.png' />", 'const s = "/brand/" + name;', '<img srcSet="/media/a.png 1x" />', '<link rel="preload" href="/media/a.png" />', '<video poster="/media/a.png" />', "const u = `/media/${x}`;"]) {
    assert.equal(bareAssetUrls("x.tsx", sample).length, 1, sample);
  }
  assert.equal(bareAssetUrls("x.css", ".a { background: url(/media/a.png); }").length, 1);
  assert.equal(bareAssetUrls("x.css", ".a { background: url('/brand/a.png'); }").length, 1);
  assert.equal(bareAssetUrls("x.css", "/* url(/media/a.png) */ .a { background: url(\"../x.png\"); }").length, 0);
  assert.equal(bareAssetUrls("x.tsx", '<Image src="/media/a.png" alt="" />').length, 0);
  assert.equal(bareAssetUrls("x.tsx", "// see /media/a.png: \"/media/a.png\"").length, 0);
});

// Phase 2 (#1291): the nonce-based Report-Only CSP, set per request by the proxy and the TAMI return page.

const nonce = "MDEyMzQ1Njc4OWFiY2RlZg==";
const themeHash = createHash("sha256").update(adminThemeScript, "utf8").digest("base64");
const tags = {
  script: "https://www.googletagmanager.com https://connect.facebook.net",
  connect: "https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://*.g.doubleclick.net https://*.google.com https://google.com https://www.google.com.tr https://pagead2.googlesyndication.com https://www.googleadservices.com https://www.facebook.com https://connect.facebook.net",
  img: "https://*.google-analytics.com https://*.googletagmanager.com https://*.g.doubleclick.net https://*.google.com https://google.com https://www.google.com.tr https://pagead2.googlesyndication.com https://www.googleadservices.com https://www.facebook.com",
  frame: "https://td.doubleclick.net https://bid.g.doubleclick.net https://www.googletagmanager.com https://www.facebook.com",
};
const tail = `img-src 'self' data: blob: ${tags.img}; frame-src 'self' ${tags.frame}; form-action 'self' https://portal.tami.com.tr https://sandbox-portal.tami.com.tr; report-uri /api/csp-report; report-to csp`;

test("the Report-Only policy is exact in production and development", () => {
  assert.equal(cspReportOnly({ nonce, dev: false }),
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'sha256-${themeHash}' ${tags.script}; connect-src 'self' ${tags.connect}; ${tail}`);
  assert.equal(cspReportOnly({ nonce, dev: true }),
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'sha256-${themeHash}' 'unsafe-eval' ${tags.script}; connect-src 'self' ws: ${tags.connect}; ${tail}`);
  assert.equal(REPORTING_ENDPOINTS, `csp="${CSP_REPORT_PATH}"`);
});

test("the policy restricts scripts only and reports both ways", () => {
  const policy = cspReportOnly({ nonce, dev: false });
  assert.doesNotMatch(policy, /(^|;\s)(style-src(-elem|-attr)?|default-src|frame-ancestors)\s/);
  assert.match(policy, /(^|;\s)report-uri \/api\/csp-report(;|$)/);
  assert.match(policy, /(^|;\s)report-to csp(;|$)/);
});

test("nonces are fresh base64", () => {
  const a = newNonce(), b = newNonce();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9+/]+=*$/);
});

test("the theme script hash matches the constant the root layout renders", () => {
  assert.equal(ADMIN_THEME_SCRIPT_HASH, themeHash);
  const layout = readFileSync("src/app/layout.tsx", "utf8");
  assert.match(layout, /import \{ adminThemeScript \} from "@\/lib\/admin-theme-script"/);
  assert.equal(layout.match(/<script\b/g)?.length, 1);
  assert.match(layout, /<script dangerouslySetInnerHTML=\{\{__html:adminThemeScript\}\}\/>/);
});

test("form-action allows every TAMI portal the payment module can send to", () => {
  const tami = readFileSync("src/modules/payments/tami.ts", "utf8");
  const portals = [...new Set([...tami.matchAll(/https:\/\/[a-z0-9.-]*portal[a-z0-9.-]*/g)].map((m) => m[0]))];
  assert.ok(portals.length >= 2, String(portals));
  for (const portal of portals) assert.ok((TAMI_FORM_HOSTS as readonly string[]).includes(portal), portal);
});

test("next.config never sets the Report-Only header (it would replace the per-request nonce)", async () => {
  for (const [buildVersion, siteUrl] of [[build, "https://getirbakim.com"], [undefined, undefined], ["development", "http://localhost:3103"]] as const) {
    for (const rule of await load(buildVersion, siteUrl)) {
      assert.ok(!rule.headers.some((h) => h.key.toLowerCase() === "content-security-policy-report-only"), rule.source);
    }
  }
});

const proxyRequest = (path: string, headers: Record<string, string> = {}, method = "GET") =>
  new NextRequest(new URL(path, "https://shop.example.invalid"), { method, headers });
const reportOnly = (response: Response) => response.headers.get("content-security-policy-report-only");

test("the proxy puts a fresh nonce on documents and hands it to the renderer", () => {
  for (const path of ["/", "/urun/x", "/yonetim"]) {
    const first = proxy(proxyRequest(path)), second = proxy(proxyRequest(path));
    const policy = reportOnly(first);
    assert.ok(policy, path);
    assert.match(policy, /'nonce-[A-Za-z0-9+/]+=*'/, path);
    assert.equal(first.headers.get("x-middleware-request-content-security-policy-report-only"), policy, path);
    assert.equal(first.headers.get("reporting-endpoints"), REPORTING_ENDPOINTS, path);
    assert.notEqual(reportOnly(second), policy, path);
  }
  // /yonetim keeps its return address alongside the nonce.
  assert.equal(proxy(proxyRequest("/yonetim/urunler?page=2")).headers.get(`x-middleware-request-${RETURN_TO_HEADER}`), "/yonetim/urunler?page=2");
});

test("API routes and server actions get no nonce", () => {
  for (const response of [
    proxy(proxyRequest("/api/vehicles")),
    proxy(proxyRequest("/urun/x", { "next-action": "00", "content-type": "text/plain;charset=UTF-8" }, "POST")),
  ]) {
    assert.equal(reportOnly(response), null);
    assert.equal(response.headers.get("x-middleware-request-content-security-policy-report-only"), null);
    assert.equal(response.headers.get("reporting-endpoints"), null);
  }
});

test("CSP_REPORT_ONLY=off turns the header off", () => {
  process.env.CSP_REPORT_ONLY = "off";
  try {
    const response = proxy(proxyRequest("/"));
    assert.equal(reportOnly(response), null);
    assert.equal(response.headers.get("x-middleware-request-content-security-policy-report-only"), null);
  } finally {
    delete process.env.CSP_REPORT_ONLY;
  }
});

// Next strips the rsc and prefetch headers before the proxy runs, so only the matcher can leave those requests out.
test("the proxy matcher runs on documents, not on API routes, assets, feeds, RSC requests or prefetches", () => {
  for (const url of ["/", "/urun/x", "/yonetim", "/kategori/fren"]) assert.equal(unstable_doesMiddlewareMatch({ config, url }), true, url);
  for (const url of ["/api/categories", "/api/csp-report", "/feeds/google.xml.gz", "/manifest.webmanifest", "/_next/static/x.js", "/_next/image", "/favicon.ico", "/robots.txt", "/media/a.webp"]) {
    assert.equal(unstable_doesMiddlewareMatch({ config, url }), false, url);
  }
  assert.equal(unstable_doesMiddlewareMatch({ config, url: "/", headers: { rsc: "1" } }), false);
  assert.equal(unstable_doesMiddlewareMatch({ config, url: "/", headers: { "next-router-prefetch": "1" } }), false);
  assert.equal(unstable_doesMiddlewareMatch({ config, url: "/", headers: { purpose: "prefetch" } }), false);
});

test("the TAMI return page carries the policy and its script the same nonce", () => {
  const script = `import { popupReturn } from "./src/modules/payments/popup-return.ts";
const r = popupReturn("0b8f6a52-6c0e-4f7c-9d52-0a4d9b7e1c11", "sonuc");
process.stdout.write(JSON.stringify({ policy: r.headers.get("content-security-policy-report-only"), endpoints: r.headers.get("reporting-endpoints"), html: await r.text() }));`;
  const run = (env: Record<string, string>) => {
    const out = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "--eval", script], { env: { ...process.env, ...env }, encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    return JSON.parse(out.stdout) as { policy: string | null; endpoints: string | null; html: string };
  };
  const on = run({});
  const policyNonce = /'nonce-([^']+)'/.exec(on.policy ?? "")?.[1];
  assert.ok(policyNonce);
  assert.equal(on.endpoints, REPORTING_ENDPOINTS);
  assert.ok(on.html.includes(`<script nonce="${policyNonce}">`));
  assert.equal(on.html.match(/<script\b/g)?.length, 1);
  assert.equal(run({ CSP_REPORT_ONLY: "off" }).policy, null);
});

const legacyReport = (report: Record<string, unknown>) => JSON.stringify({ "csp-report": report });

test("a report-uri report keeps the directive, origins, page prefix and line only", () => {
  const [report, ...rest] = parseCspReports("application/csp-report", legacyReport({
    "document-uri": "https://getirbakim.com/sifre-yenile/0123456789abcdefABCDEF_token-value-that-is-long?x=1#y",
    referrer: "https://mail.example.com/inbox?u=someone@example.com",
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    "original-policy": "script-src 'self'",
    "blocked-uri": "https://evil.example/a/b.js?token=secret",
    "source-file": "https://getirbakim.com/_next/static/chunks/0a1b2c3d4e.js?dpl=abc",
    "line-number": 12,
    "script-sample": "alert('secret')",
  }));
  assert.deepEqual(rest, []);
  assert.deepEqual(report, { directive: "script-src-elem", blocked: "https://evil.example/a/b.js", page: "/sifre-yenile/*", source: "https://getirbakim.com/_next/static/chunks/*", line: 12, kind: "page" });
  const line = cspReportLine(report);
  assert.ok(line.startsWith("csp-report {"));
  for (const secret of ["mail.example.com", "someone", "secret", "alert", "token", "original", "?", "#"]) assert.ok(!line.includes(secret), secret);
});

test("Reporting API bodies: csp-violation entries only, at most ten, tokens masked", () => {
  const entry = (n: number, overrides: Record<string, unknown> = {}) => ({
    type: "csp-violation", age: 1, url: "https://getirbakim.com/x", user_agent: "Mozilla/5.0 secret-agent",
    body: { documentURL: `https://getirbakim.com/siparis/0b8f6a52-6c0e-4f7c-9d52-0a4d9b7e1c11/erisim?t=${n}`, referrer: "https://ref.example/",
      blockedURL: "inline", effectiveDirective: "script-src-elem", sample: "var secret", lineNumber: n, sourceFile: "https://getirbakim.com/siparis/0b8f6a52-6c0e-4f7c-9d52-0a4d9b7e1c11/erisim", ...overrides },
  });
  const reports = parseCspReports("application/reports+json", JSON.stringify([{ type: "deprecation", body: {} }, ...Array.from({ length: 12 }, (_, i) => entry(i + 1))]));
  assert.equal(reports.length, 9);
  assert.deepEqual(reports[0], { directive: "script-src-elem", blocked: "inline", page: "/siparis/*/…", source: "https://getirbakim.com/siparis/*/erisim", line: 1, kind: "page" });
  for (const report of reports) for (const secret of ["secret", "ref.example", "Mozilla", "0b8f6a52"]) assert.ok(!cspReportLine(report).includes(secret), secret);
  assert.deepEqual(parseCspReports("application/reports+json; charset=utf-8", JSON.stringify([entry(1, { blockedURL: "eval" })]))[0]?.blocked, "eval");
});

test("extension injections are classified and keep the scheme only", () => {
  for (const blocked of ["chrome-extension://abcdefghijklmnop/inject.js", "moz-extension://1234-5678/x.js", "safari-web-extension://ID/x.js", "safari-extension://x/y.js", "webkit-masked-url://hidden/"]) {
    const [report] = parseCspReports("application/csp-report", legacyReport({ "document-uri": "https://getirbakim.com/", "effective-directive": "script-src-elem", "blocked-uri": blocked }));
    assert.equal(report?.kind, "extension", blocked);
    assert.equal(report?.blocked, `${new URL(blocked).protocol}`, blocked);
  }
  const [source] = parseCspReports("application/csp-report", legacyReport({ "document-uri": "https://getirbakim.com/", "effective-directive": "script-src-elem", "blocked-uri": "inline", "source-file": "chrome-extension://abc/content.js" }));
  assert.equal(source?.kind, "extension");
  const [data] = parseCspReports("application/csp-report", legacyReport({ "document-uri": "https://getirbakim.com/katalog", "effective-directive": "img-src", "blocked-uri": "data:image/png;base64,AAAA" }));
  assert.deepEqual([data?.blocked, data?.page, data?.kind], ["data", "/katalog", "page"]);
});

test("an oversize hostname or path cannot stretch the log line", () => {
  const host = `${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.${"e".repeat(60)}.example`;
  const path = Array.from({ length: 40 }, (_, i) => `seg${i}`).join("/");
  const [report] = parseCspReports("application/csp-report", legacyReport({ "document-uri": "https://getirbakim.com/", "effective-directive": "script-src-elem",
    "blocked-uri": `https://${host}/x.js`, "source-file": `https://getirbakim.com/${path}` }));
  assert.equal(report?.blocked, "unknown");
  assert.ok((report?.source ?? "").length <= 300);
  assert.ok(cspReportLine(report!).length < 500, String(cspReportLine(report!).length));
});

test("garbage, oversize and unknown bodies yield no report", () => {
  const valid = legacyReport({ "document-uri": "https://getirbakim.com/", "effective-directive": "script-src-elem", "blocked-uri": "inline" });
  assert.equal(parseCspReports("application/csp-report", valid).length, 1);
  assert.deepEqual(parseCspReports("application/json", valid), []);
  assert.deepEqual(parseCspReports(null, valid), []);
  assert.deepEqual(parseCspReports("application/csp-report", "{not json"), []);
  assert.deepEqual(parseCspReports("application/csp-report", "[]"), []);
  assert.deepEqual(parseCspReports("application/csp-report", legacyReport({ "effective-directive": "<script>", "blocked-uri": "inline" })), []);
  assert.deepEqual(parseCspReports("application/reports+json", JSON.stringify({ type: "csp-violation" })), []);
  assert.deepEqual(parseCspReports("application/csp-report", legacyReport({ "document-uri": "https://getirbakim.com/", "effective-directive": "script-src", "blocked-uri": "inline", pad: "x".repeat(17 * 1024) })), []);
});
