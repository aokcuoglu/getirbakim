import type { NextRequest } from "next/server";
import { partnerError, partnerFailure, partnerGuard, partnerNoStore, partnerOrderLimiters, readJson } from "@/modules/partner/guard";
import { quoteRequestSchema } from "@/modules/partner/order-schema";
import { partnerOrderConfig, quotePartnerOrder } from "@/modules/partner/orders";

/**
 * `POST /api/partner/v1/order-quotes` (#426, docs/partner-order-contract.md): binding prices for offer lines, valid
 * 15 minutes, with the signed `confirmationToken` the order request carries back. Nothing is reserved.
 */
export async function POST(request: NextRequest) {
  const guard = partnerGuard(request, partnerOrderLimiters);
  if ("response" in guard) return guard.response;
  const { partner } = guard;
  const parsed = quoteRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) return partnerError(400, "VALIDATION_ERROR", "Invalid quote request.", { issues: parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })) });
  try {
    return Response.json({ quote: await quotePartnerOrder(partner.code, parsed.data, partnerOrderConfig()) }, { headers: partnerNoStore });
  } catch (error) {
    return partnerFailure(error, "order-quotes", partner.code);
  }
}
