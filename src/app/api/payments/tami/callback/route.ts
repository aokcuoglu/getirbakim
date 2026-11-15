import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { reconcileOrderPayments, siteReturnUrl, validCallback } from "@/modules/payments/checkout";
import { popupReturn } from "@/modules/payments/popup-return";

// TAMI returns the customer here (GET or form POST, without our cookies). The callback body and
// success/fail route are not evidence of payment; the order is reconciled with a signed provider query.
async function handle(request: NextRequest) {
  const order = request.nextUrl.searchParams.get("order") ?? "";
  const sig = request.nextUrl.searchParams.get("sig") ?? "";
  if (!z.uuid().safeParse(order).success || !sig || !validCallback(order, sig)) return new NextResponse(null, { status: 404 });
  // Local dev only: TAMI returned to 127.0.0.1; continue on the opener's origin so the popup can notify it (#743).
  const siteReturn = siteReturnUrl(request.nextUrl);
  if (siteReturn) return NextResponse.redirect(siteReturn, 303);
  try { await reconcileOrderPayments(order); }
  catch (error) { console.error("TAMI callback reconciliation failed", { order, error: error instanceof Error ? error.message : error }); }
  return popupReturn(order, "sonuc");
}
export const GET = handle;
export const POST = handle;
