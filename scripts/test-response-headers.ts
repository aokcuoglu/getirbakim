import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { matchHas } from "next/dist/shared/lib/router/utils/prepare-destination";

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
