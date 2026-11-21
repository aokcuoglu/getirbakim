import assert from "node:assert/strict";
import { test } from "node:test";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { matchHas } from "next/dist/shared/lib/router/utils/prepare-destination";

// The response headers of next.config.ts (#1216): security headers everywhere, public asset caching, no-referrer.

const build = "abc123def456";
const short = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800";
const immutable = "public, max-age=31536000, immutable";
const id = "0b8f6a52-6c0e-4f7c-9d52-0a4d9b7e1c11";

type Rule = { source: string; has?: { type: "query"; key: string; value?: string }[]; headers: { key: string; value: string }[] };

async function load(buildVersion: string | undefined): Promise<Rule[]> {
  if (buildVersion === undefined) delete process.env.BUILD_VERSION;
  else process.env.BUILD_VERSION = buildVersion;
  const mod = (await import(`../next.config?v=${buildVersion ?? "none"}`)) as { default: { headers: () => Promise<Rule[]> } };
  return mod.default.headers();
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

const securityKeys = ["Referrer-Policy", "Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options"];

test("every route carries exactly the four security headers", async () => {
  const rules = await load(build);
  for (const path of ["/", "/katalog", "/yonetim/siparisler", "/api/health", "/media/site/images/x.jpg"]) {
    assert.deepEqual(Object.keys(effective(rules, path)).filter((k) => k !== "Cache-Control").sort(), securityKeys, path);
  }
});

test("deploymentId is the build id the dpl match relies on", async () => {
  process.env.BUILD_VERSION = build;
  const mod = (await import(`../next.config?v=deployment`)) as { default: { deploymentId?: string } };
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
