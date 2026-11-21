import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { siteUrl } from "@/lib/site";
import { ORDER_LINK_COOKIE, ORDER_LINK_TOKEN_MAX, orderLinkSecret, verifyOrderLink } from "@/modules/store/order-link";

/**
 * The confirmation email's signed guest link (#1034): a valid token becomes a cookie scoped to this order's pages, then
 * the visitor lands on the clean address, so the token never stays in the address bar or a Referer. An invalid or
 * expired link redirects the same way without a cookie (the page then 404s unless this browser owns the order). No
 * database read: viewableOrder re-verifies the cookie and checks the order is a guest order on every view.
 */
const query = z.object({
  t: z.string().max(ORDER_LINK_TOKEN_MAX).optional(),
  sayfa: z.enum(["sozlesme"]).optional().catch(undefined),
});

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const parsed = query.safeParse({ t: request.nextUrl.searchParams.get("t") ?? undefined, sayfa: request.nextUrl.searchParams.get("sayfa") ?? undefined });
  const token = parsed.success ? parsed.data.t : undefined;
  const page = parsed.success ? parsed.data.sayfa : undefined;
  // Built from the configured site and the validated id only: never from the request URL or a query value.
  const path = `/siparis/${id}`;
  const response = NextResponse.redirect(new URL(page ? `${path}/${page}` : path, siteUrl), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  const secret = orderLinkSecret();
  if (secret && token && verifyOrderLink(id, token, secret)) {
    const maxAge = Number(token.split(".")[0]) - Math.floor(Date.now() / 1000);
    response.cookies.set(ORDER_LINK_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path, maxAge });
  }
  return response;
}
