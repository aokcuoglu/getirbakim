import { timingSafeEqual } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { reconcilePendingPayments } from "@/modules/payments/checkout";
import { deliverOrderEmailsSafely } from "@/modules/store/order-email";

// Called every 5 minutes by the AWS EventBridge schedule getirbakim-production-payment-reconciliation (ECS task, Bearer
// PAYMENT_RECONCILIATION_SECRET; see docs/payments.md). Finds late payments, expires unpaid orders and, after the
// response, sends order emails still pending (#951).
export async function POST(request: NextRequest) {
  const secret = process.env.PAYMENT_RECONCILIATION_SECRET ?? "";
  const expected = Buffer.from(`Bearer ${secret}`), received = Buffer.from(request.headers.get("authorization") ?? "");
  if (secret.length < 32 || expected.length !== received.length || !timingSafeEqual(expected, received)) return new NextResponse(null, { status: 401 });
  after(() => deliverOrderEmailsSafely({ limit: 10 }));
  return NextResponse.json(await reconcilePendingPayments(), { headers: { "Cache-Control": "no-store" } });
}
