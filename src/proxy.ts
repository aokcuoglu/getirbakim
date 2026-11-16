import { NextResponse, type NextRequest } from "next/server";
import { RETURN_TO_HEADER } from "@/modules/auth/return-to";
import { SESSION_COOKIE, SESSION_SEEN_COOKIE, sessionCookieDue, sessionCookieOptions } from "@/modules/auth/session-cookie";
import { legacyRedirect } from "@/modules/seo/legacy-redirects";

// /yonetim: lets requireService() send an expired session back to the page it was on after login.
// Signed in: the session cookie slides with requests (server actions are POSTs to the page and pass here too), but at most
// every SESSION_REFRESH_SECONDS: a Set-Cookie on an action response marks the page revalidated and re-renders it (#716).
// The cookie outlives the database expiry that currentAccount() extends; a dead token kept alive here stays rejected there.
// Old listing addresses (/automakers, /car-parts/<make>, /katalog?category=) move with one 301 (#638). Next needs an
// absolute URL here and sends it on relative (same host), so a CDN or load balancer in front keeps its own host.
// Publicly cached GETs (category tree, category and product images) never carry a session cookie: a shared cache
// would keep the Set-Cookie with the body and hand one visitor's session to the next (#642). The matcher skips them;
// the check here keeps it that way if the matcher changes.
const publicCachedPath = /^\/api\/(?:categories|category-media|product-media)(?:\/|$)/;
export function proxy(request: NextRequest) {
 if (publicCachedPath.test(request.nextUrl.pathname)) return NextResponse.next();
 const target = legacyRedirect(request.nextUrl.pathname, request.nextUrl.searchParams);
 if (target) return NextResponse.redirect(new URL(target, request.url), 301);
 let response: NextResponse;
 if (request.nextUrl.pathname === "/yonetim" || request.nextUrl.pathname.startsWith("/yonetim/")) {
  const url = request.nextUrl.clone();
  url.searchParams.delete("_rsc");
  const headers = new Headers(request.headers);
  headers.set(RETURN_TO_HEADER, url.pathname + url.search);
  response = NextResponse.next({ request: { headers } });
 } else response = NextResponse.next();
 const token = request.cookies.get(SESSION_COOKIE)?.value;
 const now = Math.floor(Date.now() / 1000);
 if (token && sessionCookieDue(request.cookies.get(SESSION_SEEN_COOKIE)?.value, now)) {
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  response.cookies.set(SESSION_SEEN_COOKIE, String(now), sessionCookieOptions());
 }
 return response;
}

export const config = {
 matcher: [
  "/yonetim", "/yonetim/:path*",
  // Constants only (Next reads them at build time); scripts/test-listing-paths.ts ties them to legacyListingPaths.
  { source: "/katalog", has: [{ type: "query", key: "category" }] }, "/automakers", "/car-parts/:path*",
  // /katalog?brand=<label> moves to its manufacturer page /marka/<slug> (#660).
  { source: "/katalog", has: [{ type: "query", key: "brand" }] },
  { source: "/((?!_next/static|_next/image|api/(?:categories|category-media|product-media)(?:/|$)|favicon\\.ico|.*\\.(?:png|jpe?g|webp|avif|svg|ico|css|js|txt|xml|woff2?)$).*)", has: [{ type: "cookie", key: "gb_session" }] },
 ],
};
