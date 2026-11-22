// Content-Security-Policy-Report-Only violation reports (#1291): parsed and reduced to what the phase-3 decision needs.
// A report carries the visitor's page URL (reset and verification tokens, order ids), referrer, a script sample, the
// full policy and the user agent; only the directive, where the blocked resource came from, the page's first path
// segments and the source line survive. Nothing here is stored: survivors become one log line each.

export const CSP_REPORT_MAX_BYTES = 16 * 1024;
const MAX_REPORTS = 10;
const MAX_PATH = 200;

export type CspReport = {
  directive: string;
  blocked: string;
  page: string;
  source: string | null;
  line: number | null;
  /** "extension": a browser extension's injection, not ours to fix. */
  kind: "page" | "extension";
};

const extensionSchemes = new Set(["chrome-extension:", "moz-extension:", "safari-extension:", "safari-web-extension:", "webkit-masked-url:"]);
// The values browsers report instead of a URL (blocked inline code, eval, data:/blob: sources).
const keywords = new Set(["inline", "eval", "wasm-eval", "data", "blob", "self", "trusted-types-policy", "trusted-types-sink"]);

/** A path segment that may carry a token or an id: long, or with a run of 4+ digits / hex characters holding a digit. */
function maskSegment(segment: string): string {
  if (segment.length > 40) return "*";
  return /(?=[0-9a-f]*[0-9])[0-9a-f]{4,}/i.test(segment) ? "*" : segment;
}

function maskPath(pathname: string, maxSegments?: number): string {
  const segments = pathname.split("/").filter(Boolean);
  const kept = maxSegments === undefined ? segments : segments.slice(0, maxSegments);
  const path = `/${kept.map(maskSegment).join("/")}${maxSegments !== undefined && segments.length > maxSegments ? "/…" : ""}`;
  return path.slice(0, MAX_PATH);
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** A blocked or source location as origin + masked path; keywords stay; extensions and other schemes keep the scheme only. */
function location(value: unknown): { text: string; extension: boolean } | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim().slice(0, 2048);
  if (keywords.has(raw.toLowerCase())) return { text: raw.toLowerCase(), extension: false };
  const url = parseUrl(raw);
  if (!url) return { text: "unknown", extension: false };
  if (extensionSchemes.has(url.protocol)) return { text: url.protocol, extension: true };
  if (url.protocol === "data:" || url.protocol === "blob:") return { text: url.protocol.slice(0, -1), extension: false };
  if (url.protocol !== "http:" && url.protocol !== "https:") return { text: url.protocol, extension: false };
  return { text: `${url.origin}${maskPath(url.pathname)}`, extension: false };
}

function directiveOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const directive = value.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return /^[a-z-]{3,40}$/.test(directive) ? directive : null;
}

type Fields = { directive: unknown; blocked: unknown; page: unknown; source: unknown; line: unknown };

function reduce(fields: Fields): CspReport | null {
  const directive = directiveOf(fields.directive);
  if (!directive) return null;
  const blocked = location(fields.blocked);
  const source = location(fields.source);
  const pageUrl = typeof fields.page === "string" ? parseUrl(fields.page) : null;
  const line = typeof fields.line === "number" && Number.isInteger(fields.line) && fields.line >= 0 ? fields.line : null;
  return {
    directive,
    blocked: blocked?.text ?? "unknown",
    page: pageUrl && (pageUrl.protocol === "https:" || pageUrl.protocol === "http:") ? maskPath(pageUrl.pathname, 2) : "unknown",
    source: source?.text ?? null,
    line,
    kind: blocked?.extension || source?.extension ? "extension" : "page",
  };
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/**
 * The reports in one POST body: the report-uri shape (`application/csp-report`, one `csp-report` object) or the
 * Reporting API shape (`application/reports+json`, an array; only `csp-violation` entries). At most 10 per body;
 * anything else (other types, oversize, invalid JSON) yields none.
 */
export function parseCspReports(contentType: string | null, text: string): CspReport[] {
  const type = contentType?.split(";")[0]?.trim().toLowerCase();
  if (text.length > CSP_REPORT_MAX_BYTES) return [];
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return [];
  }
  if (type === "application/csp-report") {
    const report = record(record(body)?.["csp-report"]);
    if (!report) return [];
    const parsed = reduce({
      directive: report["effective-directive"] ?? report["violated-directive"],
      blocked: report["blocked-uri"],
      page: report["document-uri"],
      source: report["source-file"],
      line: report["line-number"],
    });
    return parsed ? [parsed] : [];
  }
  if (type === "application/reports+json") {
    if (!Array.isArray(body)) return [];
    const out: CspReport[] = [];
    for (const entry of body.slice(0, MAX_REPORTS)) {
      const report = record(entry);
      const inner = record(report?.body);
      if (report?.type !== "csp-violation" || !inner) continue;
      const parsed = reduce({
        directive: inner.effectiveDirective,
        blocked: inner.blockedURL,
        page: inner.documentURL ?? report.url,
        source: inner.sourceFile,
        line: inner.lineNumber,
      });
      if (parsed) out.push(parsed);
    }
    return out;
  }
  return [];
}

/** The log line for one report: a fixed prefix (the CloudWatch filter) and the compact JSON. */
export function cspReportLine(report: CspReport): string {
  return `csp-report ${JSON.stringify(report)}`;
}
