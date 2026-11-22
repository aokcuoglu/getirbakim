import { NextResponse } from "next/server";
import { plausibleConfig } from "@/modules/analytics/config";
import { scriptCache } from "@/modules/analytics/plausible";

export const dynamic = "force-dynamic";

// First-party copy of the self-hosted Plausible tracker (#1290): ad-block lists match the vendor path, not this one.
// Never a 5xx: a down upstream must not show up as a failing script request on the storefront.
export async function GET() {
  const config = plausibleConfig();
  if (!config) return new NextResponse(null, { status: 404 });
  const body = await scriptCache(async () => {
    const response = await fetch(`${config.url}/js/script.js`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`Plausible script ${response.status}`);
    return response.text();
  });
  const type = "application/javascript; charset=utf-8";
  if (body === null) return new NextResponse("/* stats unavailable */", { status: 200, headers: { "Content-Type": type, "Cache-Control": "no-store" } });
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400, s-maxage=3600, stale-while-revalidate=600" },
  });
}
