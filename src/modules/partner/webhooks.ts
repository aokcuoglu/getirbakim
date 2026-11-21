import "server-only";
// Kept free of the session and next/* so the outbox can be driven from tests and after() alike (like order-email.ts).
import { db } from "@/lib/db";
import { readOrder } from "./orders";
import { readPartnerReturn } from "./returns";
import {
  buildPartnerOrderEvent, buildPartnerReturnEvent, parsePartnerWebhooks, partnerWebhooksEnv, PARTNER_WEBHOOK_FIRST_RETRY_MINUTES, PARTNER_WEBHOOK_GIVE_UP_HOURS,
  PARTNER_RETURN_EVENT_TYPE, PARTNER_WEBHOOK_LEASE_MINUTES, PARTNER_WEBHOOK_TIMEOUT_MS, signPartnerWebhook, webhookHeaders, type PartnerWebhookConfig,
} from "./webhook-contract";

/**
 * Partner webhook delivery (#1002). db/partner.sql's triggers write one pending row per partner-visible order change
 * (partner.order.updated) and per decision on a partner return request (partner.return.updated); deliverPartnerWebhooks
 * claims pending rows atomically (SKIP LOCKED plus the retry backoff; a sweep's batch is capped so its sends end before
 * the shortest backoff, so concurrent calls send a row once per claim) and POSTs the order (readOrder) or the return
 * request (readPartnerReturn) as it is now, signed with the partner's secret. The 5-minute sweep sends every pending row;
 * an operations step on an order (revalidateOrder) and a carrier update (the Geliver webhook) also send that order's
 * rows right after their answer, via after(). A non-2xx answer, a redirect, a timeout or a network error keeps the row pending for the next try;
 * after 72 hours it is given up as dead. A partner with no entry in PARTNER_WEBHOOKS_JSON gets its rows skipped; a broken
 * or disabled entry, or broken JSON, keeps them pending (logged every sweep) so a configuration mistake loses nothing
 * within the 72 hours.
 */
// Minutes after the last claim before the next try: 4 (the next 5-minute sweep), 15, 45, 135, then every 6 hours
// (about 15 tries in 72 hours).
const RETRY_SQL = `(CASE WHEN attempts<=1 THEN ${PARTNER_WEBHOOK_FIRST_RETRY_MINUTES} ELSE LEAST(5*power(3,attempts-1),360)::int END)`;
// A sweep must finish its sends before any of its rows can be claimed again (the shortest backoff): at most one timeout
// per row, two rows' worth of margin for the database work. 4 min / 10 s - 2 = 22 rows.
const MAX_LIMIT = Math.floor(Math.min(PARTNER_WEBHOOK_LEASE_MINUTES, PARTNER_WEBHOOK_FIRST_RETRY_MINUTES) * 60_000 / PARTNER_WEBHOOK_TIMEOUT_MS) - 2;
const ERROR_LENGTH = 500;

export type WebhookRequest = { url: string; headers: Record<string, string>; body: string };
/** Sends one request and returns the HTTP status; throws on a network error or timeout. Injected by tests. */
export type WebhookSend = (request: WebhookRequest) => Promise<{ status: number }>;
export type DeliverWebhooksOptions = {
  limit?: number; orderId?: string; send?: WebhookSend;
  /** Parsed endpoints; defaults to PARTNER_WEBHOOKS_JSON. */
  config?: PartnerWebhookConfig;
};
/** `retried`: attempts that failed and stay pending; `dead`: rows given up in this call. */
export type DeliverWebhooksResult = { delivered: number; skipped: number; dead: number; retried: number };

/** Redirects are not followed (a moved endpoint must be reconfigured) and nothing is cached; the attempt times out. */
const fetchSend: WebhookSend = async ({ url, headers, body }) => {
  const response = await fetch(url, {
    method: "POST", headers, body, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(PARTNER_WEBHOOK_TIMEOUT_MS),
  });
  // The answer's body is never read or stored; cancelling it frees the connection.
  await response.body?.cancel().catch(() => undefined);
  return { status: response.status };
};

type ClaimedEvent = { id: string; partner_code: string; event_type: string; order_id: string; return_request_id: string | null; attempts: number; created_at: Date };

/** The signed body of one event as the partner's data is now, or null (with the reason) when its subject is gone. */
async function eventBody(row: ClaimedEvent): Promise<{ body: string } | { missing: string }> {
  const meta = { eventId: row.id, occurredAt: new Date(row.created_at), partnerId: row.partner_code };
  if (row.event_type === PARTNER_RETURN_EVENT_TYPE) {
    const request = row.return_request_id ? await readPartnerReturn(row.partner_code, row.return_request_id) : null;
    return request ? { body: buildPartnerReturnEvent({ ...meta, return: request }) } : { missing: "return request not found" };
  }
  const found = await readOrder(row.partner_code, "id", row.order_id);
  return found ? { body: buildPartnerOrderEvent({ ...meta, order: found.dto }) } : { missing: "order not found" };
}

/**
 * Sends pending partner webhooks: all of them (oldest first, up to `limit`) or only `orderId`'s. Events older than
 * 72 hours (counted from a requeue, if any) that no attempt holds are given up as dead first.
 */
export async function deliverPartnerWebhooks({
  limit = 20, orderId, send = fetchSend, config = parsePartnerWebhooks(process.env[partnerWebhooksEnv]),
}: DeliverWebhooksOptions = {}): Promise<DeliverWebhooksResult> {
  const only = orderId ?? null;
  const { endpoints, invalid, parseError } = config;
  const batch = Math.max(1, Math.min(Math.floor(limit), MAX_LIMIT));
  const result: DeliverWebhooksResult = { delivered: 0, skipped: 0, dead: 0, retried: 0 };
  const given = (await db.query<{ id: string; partner_code: string; attempts: number }>(
    `UPDATE partner_webhook_events SET status='dead',
      last_error=left('gave up after '||attempts||' attempts'||coalesce(': '||last_error,''),${ERROR_LENGTH})
     WHERE status='pending' AND COALESCE(requeued_at,created_at) < now()-make_interval(hours=>$2) AND ($1::uuid IS NULL OR order_id=$1)
      AND (claimed_at IS NULL OR claimed_at < now()-make_interval(mins=>$3))
     RETURNING id::text,partner_code,attempts`, [only, PARTNER_WEBHOOK_GIVE_UP_HOURS, PARTNER_WEBHOOK_LEASE_MINUTES],
  )).rows;
  for (const row of given) {
    result.dead++;
    console.error("Partner webhook given up", { event: row.id, partner: row.partner_code, attempts: row.attempts });
  }
  if (parseError) {
    // Nothing is claimed: an attempt would count against the events while no partner can be reached.
    console.error("Partner webhooks waiting: PARTNER_WEBHOOKS_JSON is not a JSON object");
    return result;
  }
  const held = [...invalid.keys()];
  if (held.length) {
    const waiting = (await db.query<{ partner_code: string; count: number }>(
      "SELECT partner_code,count(*)::int AS count FROM partner_webhook_events WHERE status='pending' AND partner_code=ANY($1::text[]) GROUP BY partner_code", [held])).rows;
    for (const row of waiting) console.error("Partner webhooks waiting: invalid PARTNER_WEBHOOKS_JSON entry", { partner: row.partner_code, reason: invalid.get(row.partner_code), events: row.count });
  }
  // Sent in queue order; a partner still cannot rely on it (a retried event arrives after later ones).
  const claimed = (await db.query<ClaimedEvent>(
    `WITH claimed AS (UPDATE partner_webhook_events SET claimed_at=now(),attempts=attempts+1 WHERE id IN (
       SELECT id FROM partner_webhook_events WHERE status='pending' AND ($1::uuid IS NULL OR order_id=$1) AND NOT partner_code=ANY($3::text[])
        AND (claimed_at IS NULL OR claimed_at < now()-make_interval(mins=>${RETRY_SQL}))
       ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED)
     RETURNING id::text,partner_code,event_type,order_id::text,return_request_id::text,attempts,created_at)
     SELECT * FROM claimed ORDER BY created_at,id`, [only, batch, held],
  )).rows;
  for (const row of claimed) {
    const endpoint = endpoints.get(row.partner_code);
    if (!endpoint) {
      await db.query("UPDATE partner_webhook_events SET status='skipped',last_error='no endpoint configured' WHERE id=$1", [row.id]);
      result.skipped++;
      continue;
    }
    let httpStatus: number | null = null;
    try {
      const built = await eventBody(row);
      if ("missing" in built) {
        await db.query("UPDATE partner_webhook_events SET status='skipped',last_error=$2 WHERE id=$1", [row.id, built.missing]);
        result.skipped++;
        continue;
      }
      const { body } = built;
      // Signed per attempt with the current time, so a retry is not refused by the partner's age check.
      const timestamp = String(Math.floor(Date.now() / 1000));
      const headers = webhookHeaders({ eventId: row.id, eventType: row.event_type, timestamp, signature: signPartnerWebhook(endpoint.secret, timestamp, body) });
      httpStatus = (await send({ url: endpoint.url, headers, body })).status;
      if (httpStatus >= 200 && httpStatus < 300) {
        await db.query("UPDATE partner_webhook_events SET status='delivered',delivered_at=now(),last_http_status=$2,last_error=NULL WHERE id=$1", [row.id, httpStatus]);
        result.delivered++;
        continue;
      }
      throw new Error(httpStatus >= 300 && httpStatus < 400 ? `HTTP ${httpStatus} (redirect not followed)` : `HTTP ${httpStatus}`);
    } catch (error) {
      // Stays pending: the next claim waits for the backoff, and a 72-hour-old row is given up above. Only the status and
      // the error's message are kept, never the answer's body, the endpoint or the secret.
      // fetch's TypeError ("fetch failed") hides the reason in its cause: only the cause's code is added.
      const cause = error instanceof Error && error.cause && typeof error.cause === "object" && "code" in error.cause ? String(error.cause.code) : null;
      const message = (error instanceof Error ? error.message : String(error)) + (cause ? ` (${cause})` : "");
      await db.query("UPDATE partner_webhook_events SET last_http_status=$2,last_error=$3 WHERE id=$1", [row.id, httpStatus, message.slice(0, ERROR_LENGTH)]);
      result.retried++;
      console.error("Partner webhook failed", { event: row.id, partner: row.partner_code, attempt: row.attempts, status: httpStatus });
    }
  }
  return result;
}

/** deliverPartnerWebhooks for after(): logs instead of throwing, so a partner's endpoint never reaches the payment sweep. */
export async function deliverPartnerWebhooksSafely(options: DeliverWebhooksOptions = {}) {
  try { return await deliverPartnerWebhooks(options); }
  catch (error) {
    console.error("Partner webhook delivery failed", { error: error instanceof Error ? error.message : error });
    return null;
  }
}

export type PartnerWebhookSummary = { pending: number; dead: number; skipped: number; lastDeliveredAt: Date | null };

/** Per partner: events waiting, given up and skipped (no endpoint), and the last successful delivery. */
export async function partnerWebhookSummary(partners: string[]) {
  const { rows } = await db.query<{ partner: string; pending: number; dead: number; skipped: number; last_delivered_at: Date | null }>(
    `SELECT partner_code AS partner,count(*) FILTER (WHERE status='pending')::int AS pending,count(*) FILTER (WHERE status='dead')::int AS dead,
      count(*) FILTER (WHERE status='skipped')::int AS skipped,max(delivered_at) AS last_delivered_at
     FROM partner_webhook_events WHERE partner_code=ANY($1::text[]) GROUP BY partner_code`, [partners]);
  return new Map<string, PartnerWebhookSummary>(rows.map(row => [row.partner, { pending: row.pending, dead: row.dead, skipped: row.skipped, lastDeliveredAt: row.last_delivered_at }]));
}

export type PartnerWebhookProblem = {
  id: string; partner: string; orderId: string; orderNumber: string; status: "pending" | "dead"; attempts: number;
  lastHttpStatus: number | null; lastError: string | null; createdAt: Date;
};

/** The latest events that failed at least once and are still retried, or were given up; newest first. */
export async function recentPartnerWebhookProblems(partners: string[], limit = 50): Promise<PartnerWebhookProblem[]> {
  const { rows } = await db.query<PartnerWebhookProblem>(
    `SELECT e.id::text,e.partner_code AS partner,e.order_id::text AS "orderId",o.number::text AS "orderNumber",e.status,e.attempts,
      e.last_http_status AS "lastHttpStatus",e.last_error AS "lastError",e.created_at AS "createdAt"
     FROM partner_webhook_events e JOIN commerce_orders o ON o.id=e.order_id
     WHERE e.partner_code=ANY($1::text[]) AND (e.status='dead' OR (e.status='pending' AND e.last_error IS NOT NULL))
     ORDER BY e.created_at DESC,e.id LIMIT $2`, [partners, limit]);
  return rows;
}
