import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { siteUrl } from "@/lib/site";
import { currentOrder } from "@/modules/store/order-read";
import { startPayment } from "@/modules/payments/checkout";
import { popupReturn } from "@/modules/payments/popup-return";

// Submitted into the payment popup (or a new tab without JS): TAMI's page cannot be framed
// (frame-ancestors is TAMI-only), so the site stays open behind it with the payment dialog.
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(siteUrl).origin && origin !== request.nextUrl.origin) return new NextResponse(null, { status: 403 });
  const id = String((await request.formData()).get("orderId") ?? "");
  if (!z.uuid().safeParse(id).success || !await currentOrder(id)) return new NextResponse(null, { status: 404 });
  const payment = await startPayment(id);
  // Errors end the popup and surface in the dialog instead of loading the order page inside it.
  if (!("url" in payment)) return popupReturn(id, payment.error);
  const response = NextResponse.redirect(payment.url, 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
