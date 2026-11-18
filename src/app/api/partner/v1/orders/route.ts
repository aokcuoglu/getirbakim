import type { NextRequest } from "next/server";
import { partnerError, partnerFailure, partnerGuard, partnerNoStore, partnerOrderLimiters, readJson } from "@/modules/partner/guard";
import { orderRequestSchema } from "@/modules/partner/order-schema";
import { createPartnerOrder, partnerOrderConfig } from "@/modules/partner/orders";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `POST /api/partner/v1/orders` (#426, docs/partner-order-contract.md): places an order on account from a quote.
 * `Idempotency-Key` (UUID) is required: the same key and body return the original order (200), the same key with
 * another body is IDEMPOTENCY_CONFLICT (409); a new order is 201.
 */
export async function POST(request: NextRequest) {
  const guard = partnerGuard(request, partnerOrderLimiters);
  if ("response" in guard) return guard.response;
  const { partner } = guard;
  const idempotencyKey = request.headers.get("idempotency-key")?.trim().toLowerCase() ?? "";
  if (!uuidPattern.test(idempotencyKey)) return partnerError(400, "VALIDATION_ERROR", "A UUID Idempotency-Key header is required.");
  const parsed = orderRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) return partnerError(400, "VALIDATION_ERROR", "Invalid order request.", { issues: parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })) });
  try {
    const result = await createPartnerOrder(partner.code, idempotencyKey, parsed.data, partnerOrderConfig());
    return Response.json({ order: result.order, replayed: result.replayed }, { status: result.replayed ? 200 : 201, headers: partnerNoStore });
  } catch (error) {
    return partnerFailure(error, "orders", partner.code);
  }
}
