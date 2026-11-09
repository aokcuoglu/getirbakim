import { NextResponse, type NextRequest } from "next/server";
import { RETURN_TO_HEADER } from "@/modules/auth/return-to";

// Lets requireService() send an expired session back to the page it was on after login.
export function proxy(request: NextRequest) {
 const url = request.nextUrl.clone();
 url.searchParams.delete("_rsc");
 const headers = new Headers(request.headers);
 headers.set(RETURN_TO_HEADER, url.pathname + url.search);
 return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/yonetim", "/yonetim/:path*"] };
