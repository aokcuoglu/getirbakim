import { NextResponse, type NextRequest } from "next/server";
import { RETURN_TO_HEADER } from "@/modules/auth/return-to";
import { SESSION_COOKIE, sessionCookieOptions } from "@/modules/auth/session-cookie";
import { legacyRedirect } from "@/modules/seo/legacy-redirects";

// /yonetim: lets requireService() send an expired session back to the page it was on after login.
// Signed in: the session cookie slides with each request (server actions are POSTs to the page and pass here too),
// matching the database expiry that currentAccount() extends. A dead token kept alive here stays rejected by the database.
// Old listing addresses (/automakers, /car-parts/<make>, /katalog?category=) move with one 301 (#638). The Location
// stays relative so a CDN or load balancer in front never turns it into the origin's host.
export function proxy(request: NextRequest) {
 const target = legacyRedirect(request.nextUrl.pathname, request.nextUrl.searchParams);
 if (target) return new NextResponse(null, { status: 301, headers: { Location: target } });
 let response: NextResponse;
 if (request.nextUrl.pathname === "/yonetim" || request.nextUrl.pathname.startsWith("/yonetim/")) {
  const url = request.nextUrl.clone();
  url.searchParams.delete("_rsc");
  const headers = new Headers(request.headers);
  headers.set(RETURN_TO_HEADER, url.pathname + url.search);
  response = NextResponse.next({ request: { headers } });
 } else response = NextResponse.next();
 const token = request.cookies.get(SESSION_COOKIE)?.value;
 if (token) response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
 return response;
}

export const config = {
 matcher: [
  "/yonetim", "/yonetim/:path*",
  // Constants only (Next reads them at build time); scripts/test-listing-paths.ts ties them to legacyListingPaths.
  { source: "/katalog", has: [{ type: "query", key: "category" }] }, "/automakers", "/car-parts/:path*",
  { source: "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpe?g|webp|avif|svg|ico|css|js|txt|xml|woff2?)$).*)", has: [{ type: "cookie", key: "gb_session" }] },
 ],
};
