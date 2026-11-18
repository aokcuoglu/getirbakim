import type { NextRequest } from "next/server";
import { partnerKeysEnv, resolvePartner, type PartnerIdentity } from "./auth";
import { PartnerOrderError } from "./quotes";
import { createRateLimiter } from "./rate-limit";

export const partnerNoStore = { "Cache-Control": "no-store" };

export type PartnerErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };

export function partnerError(status: number, code: string, message: string, details?: Record<string, unknown>, headers: Record<string, string> = {}) {
  const body: PartnerErrorBody = { error: details ? { code, message, details } : { code, message } };
  return Response.json(body, { status, headers: { ...partnerNoStore, ...headers } });
}

/**
 * Rate limit + API key check shared by every `/api/partner/v1` route (#424, #426). Limited before authentication, so a
 * client guessing keys is limited too; one answer for a missing and a wrong key. Each route group passes its own
 * limiter (`createRateLimiter`), kept in process memory.
 */
export function partnerGuard(request: NextRequest, limiter: ReturnType<typeof createRateLimiter>): { partner: PartnerIdentity } | { response: Response } {
  // The address our own proxy saw: the first X-Forwarded-For entry is whatever the client chose to send.
  const address = request.headers.get("x-real-ip")?.trim() || request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown";
  const limit = limiter(address);
  if (!limit.allowed) return { response: partnerError(429, "RATE_LIMITED", "Too many requests.", undefined, { "Retry-After": String(limit.retryAfterSeconds) }) };
  const partner = resolvePartner(request.headers.get("authorization"), process.env[partnerKeysEnv]);
  if (!partner) return { response: partnerError(401, "UNAUTHORIZED", "Valid partner API key required.") };
  return { partner };
}

/** The order routes (quotes, orders, order reads) share one budget per client address. */
export const partnerOrderLimiter = createRateLimiter(60, 60_000);

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
