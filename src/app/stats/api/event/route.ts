import { after, NextResponse, type NextRequest } from "next/server";
import { siteUrl } from "@/lib/site";
import { plausibleConfig } from "@/modules/analytics/config";
import { forwardedEvent, MAX_EVENT_BYTES, readCapped, warnOncePerMinute } from "@/modules/analytics/plausible";

export const dynamic = "force-dynamic";

// Tracker events for the self-hosted Plausible (#1290). Public: answers 202 whatever happens so the page never sees an error.
export async function POST(request: NextRequest) {
  const reply = () => new NextResponse(null, { status: 202, headers: { "Cache-Control": "no-store" } });
  const config = plausibleConfig();
  if (!config) return reply();
  if (Number(request.headers.get("content-length") ?? 0) > MAX_EVENT_BYTES) return reply();
  const body = await readCapped(request.body, MAX_EVENT_BYTES);
  if (body === null) return reply();
  const event = forwardedEvent(body, request.headers, config.domain, new URL(siteUrl).host);
  if (!event) return reply();
  after(async () => {
    try {
      const response = await fetch(`${config.url}/api/event`, { method: "POST", headers: event.headers, body: event.body, cache: "no-store", signal: AbortSignal.timeout(3000) });
      if (!response.ok) warnOncePerMinute(`Plausible event rejected: ${response.status}`);
    } catch (error) {
      warnOncePerMinute(`Plausible event failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  });
  return reply();
}
