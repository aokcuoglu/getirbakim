import { timingSafeEqual } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { reconcilePendingPayments } from "@/modules/payments/checkout";
import { deliverPartnerWebhooksSafely, prunePartnerWebhookEventsSafely } from "@/modules/partner/webhooks";
import { deliverOrderEmailsSafely } from "@/modules/store/order-email";

// Called every 5 minutes by the AWS EventBridge schedule getirbakim-production-payment-reconciliation (ECS task, Bearer
// PAYMENT_RECONCILIATION_SECRET; see docs/payments.md). Finds late payments, expires unpaid orders and, after the
// response, sends order emails still pending (#951) and partner webhooks still pending (#1002), then deletes partner
// webhook events finished more than 90 days ago; each outbox claims its rows with a lease, so an overlapping sweep sends
// nothing twice.
export async function POST(request: NextRequest) {
  const secret = process.env.PAYMENT_RECONCILIATION_SECRET ?? "";
  const expected = Buffer.from(`Bearer ${secret}`), received = Buffer.from(request.headers.get("authorization") ?? "");
  if (secret.length < 32 || expected.length !== received.length || !timingSafeEqual(expected, received)) return new NextResponse(null, { status: 401 });
  after(() => deliverOrderEmailsSafely({ limit: 10 }));
  after(async () => {
    await deliverPartnerWebhooksSafely({ limit: 20 });
    await prunePartnerWebhookEventsSafely();
  });
  return NextResponse.json(await reconcilePendingPayments(), { headers: { "Cache-Control": "no-store" } });
}
