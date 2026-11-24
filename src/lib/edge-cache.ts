import type { NextRequest } from "next/server";
import { CONSENT_COOKIE } from "@/lib/cookie-consent";
import { SESSION_COOKIE } from "@/modules/auth/session-cookie";

// The cookie-less home page is cached at the CloudFront edge (#1349, part of #642). Without any of these cookies the
// (store) layout and the home page render the same HTML for everyone: no account (service discount #1212, admin tag
// opt-out), no garage vehicle, an empty cart badge and the cookie banner open (#736). A request that carries one of them,
// even with an empty value, is rendered for that visitor and stays `private, no-store`. Other cookies never reach the
// render (src/proxy.ts forwards the request without its cookie header).
// Only the bare "/" is public: the flight payload embeds the whole query string (`?gclid=…`), and `/?q=` redirects to
// the search, so any query (campaign landings too) takes the private path.
// The CloudFront cache policy for "/" (getirbakim-infra) must key on exactly this set of cookies, all query strings
// (defence in depth; `_rsc` keeps RSC payloads apart from the HTML, see
// node_modules/next/dist/docs/01-app/02-guides/cdn-caching.md) and the rsc header. A new per-visitor input on the home
// page goes into both lists.
// The origin cannot send Vary: Cookie (Next replaces Vary on app pages), so HOME_CACHE_CONTROL has no
// stale-while-revalidate: a browser that honours it could otherwise reuse its anonymous copy after one of these cookies
// is set. It can come back once the edge hands browsers its own Cache-Control (getirbakim-infra response headers policy).
// gb_vehicle / gb_garage (src/modules/store/garage.ts) and gb_cart (src/modules/store/cart.ts) live in server-only
// modules; scripts/test-response-headers.ts ties these literals to them.
export const PERSONAL_COOKIES = [SESSION_COOKIE, "gb_vehicle", "gb_garage", "gb_cart", CONSENT_COOKIE] as const;

/** Edge-cached for a minute; never fresh in a browser, so a browser always asks again. */
export const HOME_CACHE_CONTROL = "public, max-age=0, s-maxage=60";

/** Whether this is the document request for the anonymous home page (bare "/", no query) that the edge may cache. */
export function anonymousHome(request: NextRequest): boolean {
  return (request.method === "GET" || request.method === "HEAD")
    && request.nextUrl.pathname === "/"
    && request.nextUrl.search === ""
    && !request.headers.has("next-action")
    && !PERSONAL_COOKIES.some((name) => request.cookies.has(name));
}
