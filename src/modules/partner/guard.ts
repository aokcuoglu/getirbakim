import type { NextRequest } from "next/server";
import { clientEvidence } from "@/lib/client-address";
import { partnerKeysEnv, resolvePartner, type PartnerIdentity } from "./auth";
import { PartnerOrderError } from "./quotes";
import { createRateLimiter } from "./rate-limit";

export const partnerNoStore = { "Cache-Control": "no-store" };

export type PartnerErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };

export function partnerError(status: number, code: string, message: string, details?: Record<string, unknown>, headers: Record<string, string> = {}) {
  const body: PartnerErrorBody = { error: details ? { code, message, details } : { code, message } };
  return Response.json(body, { status, headers: { ...partnerNoStore, ...headers } });
}

type Limiter = ReturnType<typeof createRateLimiter>;
export type PartnerLimiters = { address: Limiter; partner: Limiter };

/**
 * Rate limit + API key check shared by every `/api/partner/v1` route (#424, #426). The client address is limited before
 * authentication, so a client guessing keys is limited too; the address is the one our edge reports (clientEvidence:
 * CloudFront's viewer address, else the last X-Forwarded-For hop), never a header the client can set. After a key
 * matches, the partner is limited again by its code, whatever addresses it calls from. One answer for a missing and a
 * wrong key. Counters live in process memory: with several app tasks each task counts on its own, so the effective
 * limit is the per-task limit times the number of tasks.
 */
export function partnerGuard(request: NextRequest, limiters: PartnerLimiters): { partner: PartnerIdentity } | { response: Response } {
  const limited = (limit: ReturnType<Limiter>) => limit.allowed ? null
    : { response: partnerError(429, "RATE_LIMITED", "Too many requests.", undefined, { "Retry-After": String(limit.retryAfterSeconds) }) };
  const byAddress = limited(limiters.address(clientEvidence(request.headers).ip ?? "unknown"));
  if (byAddress) return byAddress;
  const partner = resolvePartner(request.headers.get("authorization"), process.env[partnerKeysEnv]);
  if (!partner) return { response: partnerError(401, "UNAUTHORIZED", "Valid partner API key required.") };
  return limited(limiters.partner(partner.code)) ?? { partner };
}

/** The order routes (quotes, orders, order reads) share one budget: 60 a minute per address, 300 per partner. */
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
