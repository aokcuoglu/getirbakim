import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { siteUrl } from "@/lib/site";
import { guestOrderExists, viewableOrder } from "@/modules/store/order-read";
import { ORDER_LINK_TOKEN_MAX, orderLinkGrant, orderLinkNoticeUrl, orderLinkSecret } from "@/modules/store/order-link";

/**
 * The confirmation email's signed guest link (#1034): a valid token for an existing guest order becomes a cookie scoped
 * to this order's pages, then the visitor lands on the clean address, so the token never stays in the address bar or a
 * Referer. Without a grant the visitor still reaches the order if this browser already owns it (viewableOrder);
 * otherwise an expired link, or any other unusable one, lands on /siparis/baglanti, which explains it (#1148). Every
 * redirect is built from the configured site URL and the validated id only. The order is looked up only to keep a cookie
 * from being set for an account order; viewableOrder re-verifies the cookie on every view.
 */
const query = z.object({
  t: z.string().max(ORDER_LINK_TOKEN_MAX).optional(),
  sayfa: z.enum(["sozlesme"]).optional().catch(undefined),
});

function see(location: string) {
  const response = NextResponse.redirect(location, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return see(orderLinkNoticeUrl("invalid", siteUrl));
  const parsed = query.safeParse({ t: request.nextUrl.searchParams.get("t") ?? undefined, sayfa: request.nextUrl.searchParams.get("sayfa") ?? undefined });
  const token = parsed.success ? parsed.data.t : undefined;
  const page = parsed.success ? parsed.data.sayfa : undefined;
  const grant = orderLinkGrant({ orderId: id, token, page, siteUrl, secret: orderLinkSecret(), production: process.env.NODE_ENV === "production" });
  if (grant.cookie && await guestOrderExists(id)) {
    const response = see(grant.target);
    response.cookies.set(grant.cookie.name, grant.cookie.value, grant.cookie.options);
    return response;
  }
  if (await viewableOrder(id)) return see(grant.target);
  return see(grant.status === "valid" ? orderLinkNoticeUrl("invalid", siteUrl) : grant.notice);
}
