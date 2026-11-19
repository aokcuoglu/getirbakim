import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { authenticateGeliverWebhook, handleAuthenticatedWebhook } from "@/modules/shipping/geliver-labels";

// Geliver TRACK_UPDATED webhook (#960); registered with `npm run geliver:webhook -- register` (docs/commerce.md).
// Geliver calls it without our cookies; the shared secret is checked before the body is read.
const MAX_BODY_BYTES = 256 * 1024;
const noStore = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const via = authenticateGeliverWebhook({ header: request.headers.get("x-geliver-secret"), token: request.nextUrl.searchParams.get("token") });
  if (!via) return new NextResponse(null, { status: 401, headers: noStore });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return new NextResponse(null, { status: 413, headers: noStore });
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) return new NextResponse(null, { status: 413, headers: noStore });
  try {
    const result = await handleAuthenticatedWebhook(via, rawBody);
    if (result.outcome === "applied") {
      revalidatePath("/yonetim", "layout"); revalidatePath(`/siparis/${result.orderId}`); revalidatePath("/siparisler");
    }
    return NextResponse.json(result.outcome === "ignored" ? { ok: true, outcome: result.outcome, reason: result.reason } : { ok: true, outcome: result.outcome }, { headers: noStore });
  } catch (error) {
    // Not acknowledged, so a redelivery (if Geliver retries) or the next status can still update the order.
    console.error("Geliver webhook failed", { error: error instanceof Error ? error.message : error });
    return new NextResponse(null, { status: 500, headers: noStore });
  }
}
