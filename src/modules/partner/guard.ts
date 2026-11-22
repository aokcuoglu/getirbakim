import type { NextRequest } from "next/server";
import { clientEvidence } from "@/lib/client-address";
import { partnerKeysEnv, resolvePartner, type PartnerIdentity } from "./auth";
import { PartnerOrderError } from "./quotes";
import { createRateLimiter } from "@/lib/rate-limit";

export const partnerNoStore = { "Cache-Control": "no-store" };

export type PartnerErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };

export function partnerError(status: number, code: string, message: string, details?: Record<string, unknown>, headers: Record<string, string> = {}) {
  const body: PartnerErrorBody = { error: details ? { code, message, details } : { code, message } };
  return Response.json(body, { status, headers: { ...partnerNoStore, ...headers } });
}

type Limiter = ReturnType<typeof createRateLimiter>;
export type PartnerLimiters = { address: Limiter; partner: Limiter };

/**
 * Rate limit + API key check shared by every `/api/partner/v1` route (#424, #426). A request with a valid key is
 * limited by its partner code only, whatever address it comes from: a partner calls from its own servers, so all of its
 * workshops share one address (#1093). Failed key checks (missing or wrong key, one answer for both) are counted per
 * client address, and an address over that budget is refused before its key is checked, so guessing keys stays
 * limited. The address is the one our edge reports (clientEvidence: CloudFront's viewer address, else the last
 * X-Forwarded-For hop), never a header the client can set. Counters live in process memory: with several app tasks
 * each task counts on its own, so the effective limit is the per-task limit times the number of tasks.
 */
export function partnerGuard(request: NextRequest, limiters: PartnerLimiters): { partner: PartnerIdentity } | { response: Response } {
  const limited = (limit: ReturnType<Limiter>) => limit.allowed ? null
    : { response: partnerError(429, "RATE_LIMITED", "Too many requests.", undefined, { "Retry-After": String(limit.retryAfterSeconds) }) };
  const address = clientEvidence(request.headers).ip ?? "unknown";
  const blocked = limited(limiters.address.peek(address));
  if (blocked) return blocked;
  const partner = resolvePartner(request.headers.get("authorization"), process.env[partnerKeysEnv]);
  if (!partner) {
    limiters.address(address);
    return { response: partnerError(401, "UNAUTHORIZED", "Valid partner API key required.") };
  }
  return limited(limiters.partner(partner.code)) ?? { partner };
}

/** The order routes (quotes, orders, order reads) share one budget: 300 a minute per partner, 60 failed key checks per address. */
export const partnerOrderLimiters: PartnerLimiters = { address: createRateLimiter(60, 60_000), partner: createRateLimiter(300, 60_000) };

/** JSON request body, or null when it is not JSON. */
export async function readJson(request: NextRequest): Promise<unknown> {
  try { return await request.json(); }
  catch { return null; }
}

/** A refusal from the order flow as its contract error; anything else is logged without details and answered 500. */
export function partnerFailure(error: unknown, label: string, partner: string) {
  if (error instanceof PartnerOrderError) return partnerError(error.status, error.code, error.message, error.details);
  console.error(`[partner/v1/${label}] ${partner}:`, error instanceof Error ? error.message : error);
  return partnerError(500, "INTERNAL_ERROR", "Partner request failed.");
}
