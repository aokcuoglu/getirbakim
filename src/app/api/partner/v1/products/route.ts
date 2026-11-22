import type { NextRequest } from "next/server";
import { clampPartnerLimit, partnerMinQueryLength, searchPartnerProducts } from "@/modules/partner/catalog";
import { cachedPartnerDiscount } from "@/modules/partner/discounts";
import { partnerError, partnerGuard, partnerNoStore } from "@/modules/partner/guard";
import { partnerDiscountEnv, resolvePartnerDiscountBps } from "@/modules/partner/pricing";
import { createRateLimiter } from "@/lib/rate-limit";

const maxVehicleTypeId = 2_147_483_647;
// 600 a minute per partner; 120 failed key checks a minute per address (see partnerGuard).
const limiters = { address: createRateLimiter(120, 60_000), partner: createRateLimiter(600, 60_000) };

function parseVehicleTypeId(raw: string | null): number | null | undefined {
  if (raw == null) return null;
  if (!/^[1-9]\d*$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= maxVehicleTypeId ? value : undefined;
}

/**
 * Partner catalog search, `GET /api/partner/v1/products` (#424; contract 1.3, consumed by BakımX;
 * docs/partner-products-contract.md).
 *
 * `?partNo=` exact manufacturer part number, `?oem=` exact OEM number, otherwise `?q=` free text; `?limit=` 1-30.
 * `?vehicleTypeId=` never filters: it puts the parts fitting that vehicle first and reports `exactFitment` and
 * `fitmentLevel` (#1093). Prices are kuruş, VAT excluded, and `lastSyncedAt` is part of the contract: this endpoint
 * does not promise live stock.
 */
export async function GET(request: NextRequest) {
  const guard = partnerGuard(request, limiters);
  if ("response" in guard) return guard.response;
  const { partner } = guard;

  const params = request.nextUrl.searchParams;
  const vehicleTypeId = parseVehicleTypeId(params.get("vehicleTypeId"));
  if (vehicleTypeId === undefined) return partnerError(400, "VALIDATION_ERROR", "Invalid vehicleTypeId.");
  try {
    const { products, source } = await searchPartnerProducts({
      q: params.get("q"), oem: params.get("oem"), partNo: params.get("partNo"),
      limit: clampPartnerLimit(params.get("limit")), vehicleTypeId,
      // The partner's /yonetim discount (#1130), else PARTNER_B2B_DISCOUNT_BPS; the answer cache is keyed by it.
      discountBps: (await cachedPartnerDiscount(partner.code, resolvePartnerDiscountBps(process.env[partnerDiscountEnv]))).discountBps,
    });
    return Response.json({ products, source, minQueryLength: partnerMinQueryLength }, { headers: partnerNoStore });
  } catch (error) {
    console.error(`[partner/v1/products] ${partner.code}:`, error instanceof Error ? error.message : error);
    return partnerError(500, "INTERNAL_ERROR", "Partner search failed.");
  }
}
