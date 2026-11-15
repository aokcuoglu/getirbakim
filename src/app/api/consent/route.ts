import { cookies, headers } from "next/headers";
import { CONSENT_COOKIE, CONSENT_MAX_AGE, serializeConsent } from "@/lib/cookie-consent";
import { siteUrl } from "@/lib/site";
import { consentRequest } from "@/modules/analytics/consent-request";

/** Writes the cookie preference from the server so Safari keeps it for 180 days; touches no database. */
export async function POST(request: Request) {
  const requestHeaders = await headers();
  const result = consentRequest({
    origin: request.headers.get("origin"),
    hosts: [requestHeaders.get("x-forwarded-host"), requestHeaders.get("host")].filter((host): host is string => Boolean(host)),
    siteOrigin: new URL(siteUrl).origin,
    body: await request.json().catch(() => null),
    now: Date.now(),
  });
  if (result.status !== 204) return new Response(null, { status: result.status });
  (await cookies()).set(CONSENT_COOKIE, serializeConsent(result), {
    path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: CONSENT_MAX_AGE / 1000,
  });
  return new Response(null, { status: 204 });
}
