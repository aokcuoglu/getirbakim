import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { reconcilePendingPayments } from "@/modules/payments/checkout";

// Called every 5 minutes by the AWS EventBridge schedule getirbakim-production-payment-reconciliation (ECS task, Bearer
// PAYMENT_RECONCILIATION_SECRET; see docs/payments.md). Finds late payments and expires unpaid orders.
export async function POST(request: NextRequest) {
  const secret = process.env.PAYMENT_RECONCILIATION_SECRET ?? "";
  const expected = Buffer.from(`Bearer ${secret}`), received = Buffer.from(request.headers.get("authorization") ?? "");
  if (secret.length < 32 || expected.length !== received.length || !timingSafeEqual(expected, received)) return new NextResponse(null, { status: 401 });
  return NextResponse.json(await reconcilePendingPayments(), { headers: { "Cache-Control": "no-store" } });
}
