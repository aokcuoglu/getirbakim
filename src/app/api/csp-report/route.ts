import { clientEvidence } from "@/lib/client-address";
import { CSP_REPORT_MAX_BYTES, cspReportLine, parseCspReports } from "@/lib/csp-report";
import { createRateLimiter } from "@/lib/rate-limit";

// Report-Only CSP violation reports (#1291, src/lib/csp.ts). Anyone can post here, so the answer is always 204 and the
// only output is a bounded number of sanitised log lines (CloudWatch: filter /^csp-report /). No database, cookies or
// session. The address only keys the per-client budget in memory; it is never logged.
const limiters = {
  address: createRateLimiter(30, 60_000),
  global: createRateLimiter(120, 60_000),
  // The same violation from the same page is logged once per 10 minutes per task.
  duplicate: createRateLimiter(1, 600_000),
};
const acceptedTypes = new Set(["application/csp-report", "application/reports+json"]);
const noContent = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

/** The body as text, or null once it passes the byte cap (a missing or false content-length is not trusted). */
async function cappedText(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > CSP_REPORT_MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type");
  if (!acceptedTypes.has(contentType?.split(";")[0]?.trim().toLowerCase() ?? "")) return noContent();
  if (Number(request.headers.get("content-length") ?? 0) > CSP_REPORT_MAX_BYTES) return noContent();
  if (!limiters.address(clientEvidence(request.headers).ip ?? "unknown").allowed) return noContent();
  let text: string | null;
  try {
    text = await cappedText(request);
  } catch {
    return noContent();
  }
  if (text === null) return noContent();
  for (const report of parseCspReports(contentType, text)) {
    if (!limiters.global.peek("all").allowed) break;
    if (!limiters.duplicate([report.directive, report.blocked, report.page, report.source ?? ""].join("|")).allowed) continue;
    limiters.global("all");
    console.info(cspReportLine(report));
  }
  return noContent();
}
