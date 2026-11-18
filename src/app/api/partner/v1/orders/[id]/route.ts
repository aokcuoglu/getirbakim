import type { NextRequest } from "next/server";
import { partnerFailure, partnerGuard, partnerNoStore, partnerOrderLimiter } from "@/modules/partner/guard";
import { getPartnerOrder } from "@/modules/partner/orders";

/** `GET /api/partner/v1/orders/:id` (#426): one of the calling partner's orders; any other id is ORDER_NOT_FOUND. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = partnerGuard(request, partnerOrderLimiter);
  if ("response" in guard) return guard.response;
  const { partner } = guard;
  try {
    const { id } = await params;
    return Response.json({ order: await getPartnerOrder(partner.code, id) }, { headers: partnerNoStore });
  } catch (error) {
    return partnerFailure(error, "orders/:id", partner.code);
  }
}
