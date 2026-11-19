import type { NextRequest } from "next/server";
import { partnerFailure, partnerGuard, partnerNoStore, partnerOrderLimiters } from "@/modules/partner/guard";
import { getPartnerOrderByKey } from "@/modules/partner/orders";

/**
 * `GET /api/partner/v1/orders/by-key/:key` (#426): the calling partner's order created with this Idempotency-Key, so a
 * client whose create request timed out can find out whether the order exists without placing it again.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const guard = partnerGuard(request, partnerOrderLimiters);
  if ("response" in guard) return guard.response;
  const { partner } = guard;
  try {
    const { key } = await params;
    return Response.json({ order: await getPartnerOrderByKey(partner.code, key.toLowerCase()) }, { headers: partnerNoStore });
  } catch (error) {
    return partnerFailure(error, "orders/by-key", partner.code);
  }
}
