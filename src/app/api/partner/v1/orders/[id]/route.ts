import type { NextRequest } from "next/server";
import { partnerFailure, partnerGuard, partnerNoStore, partnerOrderLimiters } from "@/modules/partner/guard";
import { cancelPartnerOrder } from "@/modules/partner/order-cancel";
import { getPartnerOrder } from "@/modules/partner/orders";

/** `GET /api/partner/v1/orders/:id` (#426): one of the calling partner's orders; any other id is ORDER_NOT_FOUND. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = partnerGuard(request, partnerOrderLimiters);
  if ("response" in guard) return guard.response;
  const { partner } = guard;
  try {
    const { id } = await params;
    return Response.json({ order: await getPartnerOrder(partner.code, id) }, { headers: partnerNoStore });
  } catch (error) {
    return partnerFailure(error, "orders/:id", partner.code);
  }
}

/**
 * `DELETE /api/partner/v1/orders/:id` (#426): cancels a not yet confirmed order (200, `cancellation: "CANCELLED"`) or asks
 * operations to cancel a confirmed one (202, `cancellation: "REQUESTED"`). Repeatable; see docs/partner-order-contract.md.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = partnerGuard(request, partnerOrderLimiters);
  if ("response" in guard) return guard.response;
  const { partner } = guard;
  try {
    const { id } = await params;
    const result = await cancelPartnerOrder(partner.code, id);
    return Response.json(result, { status: result.cancellation === "REQUESTED" ? 202 : 200, headers: partnerNoStore });
  } catch (error) {
    return partnerFailure(error, "orders/:id DELETE", partner.code);
  }
}
