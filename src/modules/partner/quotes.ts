import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Partner order quotes (#426): a binding price for a set of offer lines, signed with HMAC-SHA256 so the order request can
 * carry it back without the server storing quotes. Pure: no database, no environment reads (callers pass the secret and
 * the clock), so scripts/test-partner.ts covers it directly.
 */
export const partnerQuoteSecretEnv = "PARTNER_QUOTE_SIGNING_SECRET";
/** Shorter secrets are treated as missing: a guessable key would let anyone forge a price. */
export const minQuoteSecretLength = 32;
export const partnerQuoteTtlMs = 15 * 60_000;
export const maxPartnerOrderLines = 20;
export const maxPartnerLineQuantity = 99;

export type PartnerOrderErrorCode =
  | "VALIDATION_ERROR" | "QUOTE_CONFIGURATION_UNAVAILABLE" | "ORDER_LIMIT_UNAVAILABLE" | "OFFER_UNAVAILABLE" | "PRICE_CHANGED"
  | "QUOTE_EXPIRED" | "QUOTE_CHANGED" | "CREDIT_LIMIT_EXCEEDED" | "IDEMPOTENCY_CONFLICT" | "ORDER_NOT_FOUND" | "SUPPLIER_CHECK_UNAVAILABLE";

/** A refusal the partner API answers with `{ error: { code, message, details } }` and `status`. */
export class PartnerOrderError extends Error {
  constructor(readonly code: PartnerOrderErrorCode, message: string, readonly status: number, readonly details?: Record<string, unknown>) {
    super(message);
  }
}

const lineSchema = z.object({
  selectedOfferId: z.string().regex(/^offer_[0-9a-f]{32}$/),
  quantity: z.number().int().min(1).max(maxPartnerLineQuantity),
  unitNetKurus: z.number().int().positive(),
}).strict();
export type QuoteLine = z.infer<typeof lineSchema>;

const payloadSchema = z.object({
  version: z.literal(1),
  partner: z.string().min(1).max(64),
  lines: z.array(lineSchema).min(1).max(maxPartnerOrderLines),
  issuedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
}).strict();
export type QuotePayload = z.infer<typeof payloadSchema>;

/** The signing secret, or QUOTE_CONFIGURATION_UNAVAILABLE (503) when it is missing or too short: fail closed. */
export function quoteSecret(raw: string | null | undefined) {
  const secret = raw?.trim();
  if (!secret || secret.length < minQuoteSecretLength) {
    throw new PartnerOrderError("QUOTE_CONFIGURATION_UNAVAILABLE", "Partner quotes are unavailable.", 503);
  }
  return secret;
}

const changed = () => new PartnerOrderError("QUOTE_CHANGED", "The quote does not match this request; request a new quote.", 409);

/** `<base64url payload>.<base64url HMAC-SHA256>`; throws QUOTE_CONFIGURATION_UNAVAILABLE without a usable secret. */
export function signQuote(payload: QuotePayload, rawSecret: string | null | undefined) {
  const secret = quoteSecret(rawSecret);
  const body = Buffer.from(JSON.stringify(payloadSchema.parse(payload)), "utf8").toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body, "ascii").digest("base64url")}`;
}

/** The signed payload, or QUOTE_CHANGED for a token this server did not sign (or signed with another secret). */
export function verifyQuote(token: string, rawSecret: string | null | undefined): QuotePayload {
  const secret = quoteSecret(rawSecret);
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) throw changed();
  const expected = createHmac("sha256", secret).update(body, "ascii").digest();
  const supplied = Buffer.from(signature, "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw changed();
  try {
    return payloadSchema.parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
  } catch {
    throw changed();
  }
}

const lineKey = (line: QuoteLine) => `${line.selectedOfferId}:${line.quantity}:${line.unitNetKurus}`;

/**
 * The quote must belong to `partner`, list exactly the requested lines (any order) and still be valid at `now`.
 * Mismatch → QUOTE_CHANGED; expiry → QUOTE_EXPIRED (409, the partner requests a new quote).
 */
export function assertQuoteMatches(quote: QuotePayload, partner: string, lines: QuoteLine[], now: number) {
  const requested = lines.map(lineKey).sort(), quoted = quote.lines.map(lineKey).sort();
  if (quote.partner !== partner || requested.length !== quoted.length || requested.some((key, index) => key !== quoted[index])) throw changed();
  if (quote.expiresAt <= now) throw new PartnerOrderError("QUOTE_EXPIRED", "The quote expired; request a new quote.", 409, { expiredAt: new Date(quote.expiresAt).toISOString() });
}

/** Stable JSON: object keys sorted at every level, so the same body always hashes the same. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

/** SHA-256 of the validated order body: an Idempotency-Key replayed with a different body is a conflict. */
export function fingerprintOrderRequest(body: unknown) {
  return createHash("sha256").update(JSON.stringify(canonical(body))).digest("hex");
}
