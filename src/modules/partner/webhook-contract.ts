import { createHmac } from "node:crypto";
import { z } from "zod";

/**
 * The partner webhook contract (#1002, docs/partner-order-contract.md "Webhooks"). Pure: configuration, body and
 * signature, so scripts/test-partner.ts checks them without a database or network.
 *
 * Format: `PARTNER_WEBHOOKS_JSON='{"bakimx":{"url":"https://…","secret":"<at least 32 characters>","enabled":true}}'`.
 */
export const partnerWebhooksEnv = "PARTNER_WEBHOOKS_JSON";
export const PARTNER_WEBHOOK_SPEC_VERSION = "1.0";
export const PARTNER_ORDER_EVENT_TYPE = "partner.order.updated";
export const minPartnerWebhookSecretLength = 32;
/** An event claimed this recently is never given up: its attempt may still be running. */
export const PARTNER_WEBHOOK_LEASE_MINUTES = 5;
/** The first retry waits this long, so it lands on the next 5-minute sweep; later ones wait 15, 45, 135 minutes, then 6 hours. */
export const PARTNER_WEBHOOK_FIRST_RETRY_MINUTES = 4;
/** One delivery attempt waits this long for the partner's answer. */
export const PARTNER_WEBHOOK_TIMEOUT_MS = 10_000;
/** An event still undelivered this long after it was written (or requeued) is given up as dead. */
export const PARTNER_WEBHOOK_GIVE_UP_HOURS = 72;

export type PartnerWebhookEndpoint = { url: string; secret: string };

const entrySchema = z.object({
  url: z.string().trim().min(1),
  secret: z.string().min(minPartnerWebhookSecretLength),
  enabled: z.boolean().optional(),
});

/** Why an endpoint URL is unusable, or null: https only (http allowed outside production), no credentials. */
function urlProblem(raw: string, production: boolean) {
  let url: URL;
  try { url = new URL(raw); } catch { return "URL is not valid"; }
  if (url.protocol !== "https:" && (production || url.protocol !== "http:")) return production ? "URL is not https" : "URL is not http(s)";
  if (url.username || url.password) return "URL carries credentials";
  return null;
}

export type PartnerWebhookConfig = {
  endpoints: Map<string, PartnerWebhookEndpoint>;
  /** Partners with an entry that is broken or disabled → the reason (never the secret). Their events wait. */
  invalid: Map<string, string>;
  /** The variable is set but is not a JSON object: every partner's events wait. */
  parseError: boolean;
};

/**
 * `PARTNER_WEBHOOKS_JSON` as partner code → endpoint. Tolerant like parsePartnerKeys: a broken or disabled entry only
 * affects its partner. Only a partner with no entry at all (or an unset variable) has no webhooks; a broken entry or
 * broken JSON is reported in `invalid` / `parseError`, so delivery keeps those events instead of dropping them.
 */
export function parsePartnerWebhooks(raw: string | undefined | null, production = process.env.NODE_ENV === "production"): PartnerWebhookConfig {
  const config: PartnerWebhookConfig = { endpoints: new Map(), invalid: new Map(), parseError: false };
  const text = raw?.trim() ?? "";
  if (!text) return config;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { ...config, parseError: true }; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ...config, parseError: true };
  for (const [key, value] of Object.entries(parsed)) {
    const code = key.trim();
    if (!code || code.length > 64) continue;
    const entry = entrySchema.safeParse(value);
    if (!entry.success) {
      const secret = value && typeof value === "object" && "secret" in value ? (value as { secret: unknown }).secret : undefined;
      config.invalid.set(code, typeof secret === "string" && secret.length < minPartnerWebhookSecretLength
        ? `secret shorter than ${minPartnerWebhookSecretLength} characters` : "entry needs url and secret strings");
      continue;
    }
    if (entry.data.enabled === false) { config.invalid.set(code, "disabled"); continue; }
    const problem = urlProblem(entry.data.url, production);
    if (problem) { config.invalid.set(code, problem); continue; }
    config.endpoints.set(code, { url: new URL(entry.data.url).toString(), secret: entry.data.secret });
  }
  return config;
}

/** The request body, serialized once: the signature is computed over exactly these bytes. */
export function buildPartnerOrderEvent({ eventId, occurredAt, partnerId, order }: { eventId: string; occurredAt: Date; partnerId: string; order: unknown }) {
  return JSON.stringify({
    specVersion: PARTNER_WEBHOOK_SPEC_VERSION,
    eventId,
    eventType: PARTNER_ORDER_EVENT_TYPE,
    occurredAt: occurredAt.toISOString(),
    partnerId,
    order,
  });
}

/** `v1=` + hex HMAC-SHA256 of `${timestamp}.${rawBody}` with the partner's secret; timestamp in unix seconds. */
export function signPartnerWebhook(secret: string, timestamp: string, rawBody: string) {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex")}`;
}

/** The headers of one delivery attempt; the signature is fresh per attempt, the event id stays the same. */
export function webhookHeaders({ eventId, eventType, timestamp, signature }: { eventId: string; eventType: string; timestamp: string; signature: string }) {
  return {
    "Content-Type": "application/json",
    "User-Agent": "GetirBakim-Webhooks/1",
    "X-GetirBakim-Event-Id": eventId,
    "X-GetirBakim-Event-Type": eventType,
    "X-GetirBakim-Timestamp": timestamp,
    "X-GetirBakim-Signature": signature,
  };
}
