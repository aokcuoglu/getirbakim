import { createHash } from "node:crypto";
import { adminThemeScript } from "@/lib/admin-theme-script";

// Phase 2 of the CSP rollout (#1287, #1291): a nonce-based script-src measured with Content-Security-Policy-Report-Only.
// The enforced phase-1 header stays in next.config.ts. This policy is set per request by src/proxy.ts (pages) and
// popupReturn (the TAMI return page); never in next.config.ts headers(), whose value would replace the per-request nonce.
// A new third-party tag (script, beacon, pixel, iframe) needs its hosts here, or it shows up as a violation report.
// No style-src/default-src: inline styles are everywhere and stay unrestricted.
// The edge-cached anonymous home (#1349, src/lib/edge-cache.ts) gets the policy without script-src: a nonce must be new
// for every response (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md), so a page shared from the
// CDN cannot carry one, and a hash list cannot cover Next's inline flight scripts, which differ per render.

export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";
export const CSP_REPORT_PATH = "/api/csp-report";
/** The Reporting API endpoint the report-to directive names (browsers without it use report-uri). */
export const REPORTING_ENDPOINTS = `csp="${CSP_REPORT_PATH}"`;

/** TAMI's hosted payment pages: /api/payments/tami/start answers 303 there, and form-action is enforced across redirects. */
export const TAMI_FORM_HOSTS = ["https://portal.tami.com.tr", "https://sandbox-portal.tami.com.tr"] as const;

/** The base64 sha256 of the inline admin theme script in the root layout. */
export const ADMIN_THEME_SCRIPT_HASH = createHash("sha256").update(adminThemeScript, "utf8").digest("base64");

const tagScripts = ["https://www.googletagmanager.com", "https://connect.facebook.net"];
const googleBeacons = [
  "https://*.google-analytics.com", "https://*.analytics.google.com", "https://*.googletagmanager.com", "https://*.g.doubleclick.net",
  "https://*.google.com", "https://google.com", "https://www.google.com.tr", "https://pagead2.googlesyndication.com", "https://www.googleadservices.com",
];
const tagConnect = [...googleBeacons, "https://www.facebook.com", "https://connect.facebook.net"];
const tagImages = [...googleBeacons.filter((host) => host !== "https://*.analytics.google.com"), "https://www.facebook.com"];
const tagFrames = ["https://td.doubleclick.net", "https://bid.g.doubleclick.net", "https://www.googletagmanager.com", "https://www.facebook.com"];

/** The kill switch: CSP_REPORT_ONLY=off drops the header everywhere (read per request, so a restart applies it). */
export function cspReportOnlyEnabled(): boolean {
  return process.env.CSP_REPORT_ONLY !== "off";
}

/** A fresh per-request nonce. */
export function newNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

/**
 * The Report-Only policy for one response. Development adds what React's dev build and HMR need. Without a nonce (the
 * edge-cached home) script-src is left out and the other directives are still measured.
 */
export function cspReportOnly({ nonce, dev }: { nonce: string | null; dev: boolean }): string {
  return [
    ...(nonce ? [["script-src", "'self'", `'nonce-${nonce}'`, "'strict-dynamic'", `'sha256-${ADMIN_THEME_SCRIPT_HASH}'`, ...(dev ? ["'unsafe-eval'"] : []), ...tagScripts]] : []),
    ["connect-src", "'self'", ...(dev ? ["ws:"] : []), ...tagConnect],
    ["img-src", "'self'", "data:", "blob:", ...tagImages],
    ["frame-src", "'self'", ...tagFrames],
    ["form-action", "'self'", ...TAMI_FORM_HOSTS],
    ["report-uri", CSP_REPORT_PATH],
    ["report-to", "csp"],
  ].map((directive) => directive.join(" ")).join("; ");
}
