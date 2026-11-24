import type { NextRequest } from "next/server";
import { CONSENT_COOKIE } from "@/lib/cookie-consent";
import { SESSION_COOKIE } from "@/modules/auth/session-cookie";

// The cookie-less home page is cached at the CloudFront edge (#1349, part of #642). Without any of these cookies the
// (store) layout and the home page render the same HTML for everyone: no account (service discount #1212, admin tag
// opt-out), no garage vehicle, an empty cart badge and the cookie banner open (#736). A request that carries one of them,
// even with an empty value, is rendered for that visitor and stays `private, no-store`.
// The CloudFront cache policy for "/" (getirbakim-infra) must key on exactly this set of cookies, plus the `q` and `_rsc`
// query strings (`/?q=` redirects to the search; `_rsc` keeps RSC payloads apart from the HTML, see
// node_modules/next/dist/docs/01-app/02-guides/cdn-caching.md). A new per-visitor input on the home page goes into both.
// The origin cannot send Vary: Cookie (Next replaces Vary on app pages), so the edge should hand browsers its own
// Cache-Control (or add Vary: Cookie): otherwise a browser that honours stale-while-revalidate could reuse its anonymous
// copy for a few minutes after one of these cookies is set.
// gb_vehicle / gb_garage (src/modules/store/garage.ts) and gb_cart (src/modules/store/cart.ts) live in server-only
// modules; scripts/test-response-headers.ts ties these literals to them.
export const PERSONAL_COOKIES = [SESSION_COOKIE, "gb_vehicle", "gb_garage", "gb_cart", CONSENT_COOKIE] as const;

/** Edge-cached for a minute, then served stale for up to four more while one request renders it again; never fresh in a browser. */
export const HOME_CACHE_CONTROL = "public, max-age=0, s-maxage=60, stale-while-revalidate=240";

/** Whether this is the document request for the anonymous home page that the edge may cache. */
export function anonymousHome(request: NextRequest): boolean {
  return (request.method === "GET" || request.method === "HEAD")
    && request.nextUrl.pathname === "/"
    && !request.nextUrl.searchParams.has("q")
    && !request.headers.has("next-action")
    && !PERSONAL_COOKIES.some((name) => request.cookies.has(name));
}
