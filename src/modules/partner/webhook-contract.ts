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
/** A claimed row is not claimed again within this window; the shortest retry backoff equals it. */
export const PARTNER_WEBHOOK_LEASE_MINUTES = 5;
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

/** The endpoint URL when it is usable: https (http only outside production), no credentials. */
function endpointUrl(raw: string, production: boolean) {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" && (production || url.protocol !== "http:")) return null;
  if (url.username || url.password) return null;
  return url.toString();
}

/**
 * `PARTNER_WEBHOOKS_JSON` as partner code → endpoint. Tolerant like parsePartnerKeys: broken JSON is no endpoint at all,
 * a broken or disabled entry is skipped and the others still deliver. A partner without an entry gets no webhooks.
 */
export function parsePartnerWebhooks(raw: string | undefined | null, production = process.env.NODE_ENV === "production") {
  const endpoints = new Map<string, PartnerWebhookEndpoint>();
  let parsed: unknown;
  try { parsed = JSON.parse(raw?.trim() || "{}"); } catch { return endpoints; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return endpoints;
  for (const [key, value] of Object.entries(parsed)) {
    const code = key.trim();
    const entry = entrySchema.safeParse(value);
    if (!code || code.length > 64 || !entry.success || entry.data.enabled === false) continue;
    const url = endpointUrl(entry.data.url, production);
    if (url) endpoints.set(code, { url, secret: entry.data.secret });
  }
  return endpoints;
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
