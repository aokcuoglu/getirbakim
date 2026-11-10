import type { NextRequest } from "next/server";
import { partnerKeysEnv, resolvePartner } from "@/modules/partner/auth";
import { clampPartnerLimit, partnerMinQueryLength, searchPartnerProducts } from "@/modules/partner/catalog";
import { partnerDiscountEnv, resolvePartnerDiscountBps } from "@/modules/partner/pricing";
import { createRateLimiter } from "@/modules/partner/rate-limit";

const maxVehicleTypeId = 2_147_483_647;
const limiter = createRateLimiter(120, 60_000);
const noStore = { "Cache-Control": "no-store" };

function parseVehicleTypeId(raw: string | null): number | null | undefined {
  if (raw == null) return null;
  if (!/^[1-9]\d*$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= maxVehicleTypeId ? value : undefined;
}

/**
 * Partner catalog search, `GET /api/partner/v1/products` (#424; contract 1.2, consumed by BakımX).
 *
 * `?partNo=` exact manufacturer part number, `?oem=` exact OEM number, otherwise `?q=` free text.
 * `?vehicleTypeId=` only reports `exactFitment`, it does not filter. Prices are kuruş, VAT excluded, and
 * `lastSyncedAt` is part of the contract: this endpoint does not promise live stock.
 */
export async function GET(request: NextRequest) {
  // Limited before authentication: a client guessing keys is limited too.
  // The address our own proxy saw: the first X-Forwarded-For entry is whatever the client chose to send.
  const address = request.headers.get("x-real-ip")?.trim() || request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown";
  const limit = limiter(address);
  if (!limit.allowed) {
    return Response.json({ error: { code: "RATE_LIMITED", message: "Too many requests." } },
      { status: 429, headers: { ...noStore, "Retry-After": String(limit.retryAfterSeconds) } });
  }
  // One answer for a missing and a wrong key: telling them apart helps whoever is guessing.
  const partner = resolvePartner(request.headers.get("authorization"), process.env[partnerKeysEnv]);
  if (!partner) return Response.json({ error: { code: "UNAUTHORIZED", message: "Valid partner API key required." } }, { status: 401, headers: noStore });

  const params = request.nextUrl.searchParams;
  const vehicleTypeId = parseVehicleTypeId(params.get("vehicleTypeId"));
  if (vehicleTypeId === undefined) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Invalid vehicleTypeId." } }, { status: 400, headers: noStore });
  }
  try {
    const { products, source } = await searchPartnerProducts({
      q: params.get("q"), oem: params.get("oem"), partNo: params.get("partNo"),
      limit: clampPartnerLimit(params.get("limit")), vehicleTypeId,
      discountBps: resolvePartnerDiscountBps(process.env[partnerDiscountEnv]),
    });
    return Response.json({ products, source, minQueryLength: partnerMinQueryLength }, { headers: noStore });
  } catch (error) {
    console.error(`[partner/v1/products] ${partner.code}:`, error instanceof Error ? error.message : error);
    return Response.json({ error: { code: "INTERNAL_ERROR", message: "Partner search failed." } }, { status: 500, headers: noStore });
  }
}
