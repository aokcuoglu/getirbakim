import { NextResponse, type NextRequest } from "next/server";
import { CSP_REPORT_ONLY_HEADER, REPORTING_ENDPOINTS, cspReportOnly, cspReportOnlyEnabled, newNonce } from "@/lib/csp";
import { RETURN_TO_HEADER } from "@/modules/auth/return-to";
import { SESSION_COOKIE, SESSION_SEEN_COOKIE, sessionCookieDue, sessionCookieOptions } from "@/modules/auth/session-cookie";
import { legacyRedirect } from "@/modules/seo/legacy-redirects";

// /yonetim: lets requireService() send an expired session back to the page it was on after login.
// Signed in: the session cookie slides with requests (server actions are POSTs to the page and pass here too), but at most
// every SESSION_REFRESH_SECONDS: a Set-Cookie on an action response marks the page revalidated and re-renders it (#716).
// The cookie outlives the database expiry that currentAccount() extends; a dead token kept alive here stays rejected there.
// Old listing addresses (/automakers, /car-parts/<make>, /katalog?category=) move with one 301 (#638). Next needs an
// absolute URL here and sends it on relative (same host), so a CDN or load balancer in front keeps its own host.
// Publicly cached GETs (category tree, category and product images, a product's fitment list #966, the product feed)
// never carry a session cookie: a shared cache would keep the Set-Cookie with the body and hand one visitor's session to
// the next (#642). The matcher skips them; the check here keeps it that way if the matcher changes.
const publicCachedPath = /^\/(?:api\/(?:categories|category-media|product-media|product-fitments)|feeds)(?:\/|$)/;
// The Report-Only CSP (#1291, src/lib/csp.ts) goes on document requests only: server actions and API routes render no
// HTML, so they need no nonce. RSC requests are left out by the matcher: Next strips the rsc header (and _rsc) before
// the proxy sees the request. A signed-in RSC request still runs the proxy for the cookie and gets the (ignored)
// header. CSP_REPORT_ONLY=off turns it off with a restart, no new build.
function cspNonceWanted(request: NextRequest) {
 return cspReportOnlyEnabled() && !request.nextUrl.pathname.startsWith("/api/") && !request.headers.has("next-action");
}
export function proxy(request: NextRequest) {
 if (publicCachedPath.test(request.nextUrl.pathname)) return NextResponse.next();
 const target = legacyRedirect(request.nextUrl.pathname, request.nextUrl.searchParams);
 if (target) return NextResponse.redirect(new URL(target, request.url), 301);
 const path = request.nextUrl.pathname;
 const workspace = path === "/yonetim" || path.startsWith("/yonetim/");
 const nonce = cspNonceWanted(request) ? newNonce() : null;
 const policy = nonce ? cspReportOnly({ nonce, dev: process.env.NODE_ENV === "development" }) : null;
 let response: NextResponse;
 if (workspace || policy) {
  const headers = new Headers(request.headers);
  if (workspace) {
   const url = request.nextUrl.clone();
   url.searchParams.delete("_rsc");
   headers.set(RETURN_TO_HEADER, url.pathname + url.search);
  }
  // Next reads the nonce for its own scripts from this request header (app-render getScriptNonceFromHeader).
  if (policy) headers.set(CSP_REPORT_ONLY_HEADER, policy);
  response = NextResponse.next({ request: { headers } });
  if (policy) {
   response.headers.set(CSP_REPORT_ONLY_HEADER, policy);
   response.headers.set("Reporting-Endpoints", REPORTING_ENDPOINTS);
  }
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
  // Every document without a session gets the Report-Only CSP nonce (#1291); RSC requests, prefetches and assets skip the proxy.
  {
   source: "/((?!api/|_next/static|_next/image|feeds/|sitemaps/|favicon\\.ico|.*\\.(?:png|jpe?g|webp|avif|svg|ico|css|js|txt|xml|webmanifest|woff2?)$).*)",
   missing: [{ type: "header", key: "rsc" }, { type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }],
  },
  { source: "/((?!_next/static|_next/image|api/(?:categories|category-media|product-media|product-fitments)(?:/|$)|feeds/|favicon\\.ico|.*\\.(?:png|jpe?g|webp|avif|svg|ico|css|js|txt|xml|woff2?)$).*)", has: [{ type: "cookie", key: "gb_session" }] },
 ],
};
