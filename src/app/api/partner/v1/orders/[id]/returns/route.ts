import type { NextRequest } from "next/server";
import { partnerError, partnerFailure, partnerGuard, partnerNoStore, partnerOrderLimiters, readJson } from "@/modules/partner/guard";
import { uuidPattern } from "@/modules/partner/orders";
import { returnRequestSchema } from "@/modules/partner/return-dto";
import { listPartnerReturns, requestPartnerReturn } from "@/modules/partner/returns";

/**
 * `POST /api/partner/v1/orders/:id/returns` (#1007, docs/partner-order-contract.md): asks operations to take back lines
 * of a shipped or delivered order. `Idempotency-Key` (UUID) is required: the same key and body return the original
 * request (200), the same key with another body or order is IDEMPOTENCY_CONFLICT (409); a new request is 201.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = partnerGuard(request, partnerOrderLimiters);
  if ("response" in guard) return guard.response;
  const { partner } = guard;
  const idempotencyKey = request.headers.get("idempotency-key")?.trim().toLowerCase() ?? "";
  if (!uuidPattern.test(idempotencyKey)) return partnerError(400, "VALIDATION_ERROR", "A UUID Idempotency-Key header is required.");
  const parsed = returnRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) return partnerError(400, "VALIDATION_ERROR", "Invalid return request.", { issues: parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })) });
  try {
    const { id } = await params;
    const result = await requestPartnerReturn(partner.code, id, idempotencyKey, parsed.data);
    return Response.json({ return: result.return, replayed: result.replayed }, { status: result.replayed ? 200 : 201, headers: partnerNoStore });
  } catch (error) {
    return partnerFailure(error, "orders/:id/returns", partner.code);
  }
}

/** `GET /api/partner/v1/orders/:id/returns` (#1007): the return requests on one of the calling partner's orders, oldest first. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = partnerGuard(request, partnerOrderLimiters);
  if ("response" in guard) return guard.response;
  const { partner } = guard;
  try {
    const { id } = await params;
    return Response.json({ returns: await listPartnerReturns(partner.code, id) }, { headers: partnerNoStore });
  } catch (error) {
    return partnerFailure(error, "orders/:id/returns", partner.code);
  }
}
