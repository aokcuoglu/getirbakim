import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { siteUrl } from "@/lib/site";
import { cancelLockedOrder } from "@/modules/store/order-cancel";
import { money } from "@/modules/store/money";
import { queueOrderConfirmation } from "@/modules/store/order-email";
import { installmentTotal } from "./installment-plan";
import { installmentSettings } from "./installment-settings";
import {
  createHostedToken, buildHostedPaymentUrl, queryPaymentByOrderId, verifiedPaymentSuccess, verifySecurityHash,
  TamiRequestError, type TamiQueryResponse,
} from "./tami";

// The hosted page must be finished well inside this window; unpaid orders then release reserved stock.
export const PAYMENT_WINDOW_MINUTES = 45;
// A pending attempt is reused while its token is still valid (TAMI page times out after 6 min in production).
const REUSE_ATTEMPT_MINUTES = 5;
// Attempts stay under reconciliation this long, so late provider outcomes are never lost.
const ATTEMPT_WATCH_HOURS = 2;
const MAX_ATTEMPTS = 6;
// TAMI: "Bu sipariş üye işyerine ait değildir." — no transaction exists for this orderId (yet).
const TAMI_ORDER_NOT_FOUND = 2013;

export function paymentsEnabled() { return process.env.TAMI_CHECKOUT_ENABLED === "true"; }

function callbackSignature(orderId: string) {
  const secret = process.env.TAMI_SECRET_KEY?.trim();
  if (!secret) throw new Error("TAMI_SECRET_KEY is missing.");
  return createHmac("sha256", secret).update(`tami-callback:${orderId}`).digest("base64url");
}
/**
 * TAMI's hosted page only follows a callback whose hostname contains a dot, so a local `localhost` site is sent as
 * 127.0.0.1; the callback route then hands the customer back to the `localhost` origin (#743).
 */
export function providerReturnBase(base = siteUrl) {
  const url = new URL(base);
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.origin;
}
/** The site origin a provider-facing callback must continue on, or null when the request is already there. */
export function siteReturnUrl(requestUrl: URL, base = siteUrl) {
  const site = new URL(base);
  if (site.hostname !== "localhost" || requestUrl.hostname === "localhost") return null;
  return new URL(`${requestUrl.pathname}${requestUrl.search}`, site.origin);
}
export function callbackUrl(orderId: string) {
  const url = new URL("/api/payments/tami/callback", providerReturnBase());
  url.searchParams.set("order", orderId);
  url.searchParams.set("sig", callbackSignature(orderId));
  return url.toString();
}
export function validCallback(orderId: string, signature: string) {
  const expected = Buffer.from(callbackSignature(orderId)), received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

type PaymentOrder = { id: string; number: string; status: string; payment_status: string; total_kurus: string; phone: string; payment_due_at: Date | null };
type Attempt = { id: string; provider_order_id: string; amount_kurus: string; status: string; hosted_url: string | null; created_at: Date; provider_result: unknown };

/** TAMI expects a mobile number; Turkish numbers are sent as 90XXXXXXXXXX. */
export function tamiPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (/^90\d{10}$/.test(digits)) return digits;
  if (/^0\d{10}$/.test(digits)) return `9${digits}`;
  if (/^\d{10}$/.test(digits)) return `90${digits}`;
  return digits;
}

export type StartPaymentResult = { url: string } | { error: "closed" | "paid" | "expired" | "limit" | "provider" | "disabled" };

/** Returns the TAMI hosted page for an order awaiting payment. Card data never reaches this application. */
export async function startPayment(orderId: string): Promise<StartPaymentResult> {
  if (!paymentsEnabled()) return { error: "disabled" };
  // Earlier attempts may have been paid in another tab; never open a new one before checking them.
  await reconcileOrderPayments(orderId);
  const client = await db.connect();
  let claim: { order: PaymentOrder; attempt: Attempt } | StartPaymentResult;
  try {
    await client.query("BEGIN");
    claim = await claimAttempt(client, orderId);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  if (!("attempt" in claim)) return claim;
  const { order, attempt } = claim;
  if (attempt.hosted_url) return { url: attempt.hosted_url };
  try {
    const token = await createHostedToken({
      amount: Number(attempt.amount_kurus) / 100, orderId: attempt.provider_order_id,
      successCallbackUrl: callbackUrl(order.id), failCallbackUrl: callbackUrl(order.id),
      mobilePhoneNumber: tamiPhone(order.phone), data: { currency: "TRY" }, locale: "tr",
    });
    const url = buildHostedPaymentUrl(token.oneTimeToken);
    await db.query("UPDATE commerce_payments SET hosted_url=$2,status='pending' WHERE id=$1 AND status='initiated'", [attempt.id, url]);
    return { url };
  } catch (error) {
    // The token may exist even though the response was lost; keep the attempt under reconciliation.
    const reason = error instanceof TamiRequestError ? error.message : "Ödeme sayfası yanıtı alınamadı.";
    await db.query("UPDATE commerce_payments SET status='pending',failure_reason=$2 WHERE id=$1 AND status='initiated'", [attempt.id, reason.slice(0, 500)]);
    console.error("TAMI hosted token failed", { orderId, attempt: attempt.provider_order_id, reason });
    return { error: "provider" };
  }
}

async function claimAttempt(client: PoolClient, orderId: string): Promise<{ order: PaymentOrder; attempt: Attempt } | StartPaymentResult> {
  const order = (await client.query<PaymentOrder>(
    "SELECT id,number,status,payment_status,total_kurus,phone,payment_due_at FROM commerce_orders WHERE id=$1 FOR UPDATE", [orderId],
  )).rows[0];
  if (!order) return { error: "closed" };
  if (order.payment_status === "paid") return { error: "paid" };
  if (order.payment_status === "expired") return { error: "expired" };
  if (order.status !== "awaiting_payment" || order.payment_status !== "awaiting") return { error: "closed" };
  if (!order.payment_due_at || order.payment_due_at.getTime() <= Date.now()) return { error: "expired" };
  const attempts = (await client.query<Attempt>(
    "SELECT id,provider_order_id,amount_kurus,status,hosted_url,created_at,provider_result FROM commerce_payments WHERE order_id=$1 ORDER BY created_at DESC", [orderId],
  )).rows;
  const latest = attempts[0];
  // A token is single-use: once TAMI has a transaction for it (even a failed one), a retry needs a new attempt.
  if (latest?.status === "pending" && latest.hosted_url && !latest.provider_result && Number(latest.amount_kurus) === Number(order.total_kurus)
    && Date.now() - latest.created_at.getTime() < REUSE_ATTEMPT_MINUTES * 60_000) return { order, attempt: latest };
  if (attempts.length >= MAX_ATTEMPTS) return { error: "limit" };
  // Prefixed per system so orderIds never collide with the previous storefront on the same merchant.
  const attempt = (await client.query<Attempt>(
    `INSERT INTO commerce_payments(order_id,provider_order_id,amount_kurus) VALUES($1,$2,$3)
     RETURNING id,provider_order_id,amount_kurus,status,hosted_url,created_at,provider_result`,
    [orderId, `GB2-${order.number}-${attempts.length + 1}`, order.total_kurus],
  )).rows[0];
  return { order, attempt };
}

type Outcome = { kind: "paid"; query: TamiQueryResponse } | { kind: "missing" } | { kind: "unpaid"; query: TamiQueryResponse };
type Answer = { outcome: Outcome } | { error: unknown };

async function queryAttempt(attempt: Attempt, timeoutMs?: number): Promise<Outcome> {
  try {
    const query = await queryPaymentByOrderId({ orderId: attempt.provider_order_id, locale: "tr", timeoutMs });
    if (verifiedPaymentSuccess(query, attempt.provider_order_id, Number(attempt.amount_kurus))) return { kind: "paid", query };
    return { kind: "unpaid", query };
  } catch (error) {
    const payload = error instanceof TamiRequestError ? error.payload : null;
    // Only a signed "order not found" answer counts as evidence that nothing was charged.
    if (payload && Number(payload.errorCode) === TAMI_ORDER_NOT_FOUND && typeof payload.securityHash === "string"
      && verifySecurityHash(payload, payload.securityHash)) return { kind: "missing" };
    throw error;
  }
}

const answer = (attempt: Attempt, timeoutMs?: number): Promise<Answer> =>
  queryAttempt(attempt, timeoutMs).then(outcome => ({ outcome }), (error: unknown) => ({ error }));

function providerResult(query: TamiQueryResponse) {
  const { securityHash: _hash, ...raw } = query.raw;
  void _hash;
  return { ...raw, securityHashValid: query.securityHashValid };
}

/** Budget for paths a customer waits on (order page after TAMI, polling); a slower TAMI answer counts as uncertain (#711). */
export const INTERACTIVE_RECONCILE_MS = 4500;

/**
 * Asks TAMI about every open attempt of an order, records verified payments and expires unpaid orders.
 * Callback parameters are never trusted; the signed provider query is the only evidence of payment.
 * `uncertain` is true when an attempt got no definite answer (network error, unsigned reply, budget hit): it may hide a payment.
 * `minIntervalSeconds` throttles page views and polling; 0 (callback, sweep, startPayment, cancel) always asks TAMI.
 * `deadlineMs` asks about all attempts at once with that timeout instead of one by one with TAMI's 15 s default.
 */
export async function reconcileOrderPayments(orderId: string, { minIntervalSeconds = 0, deadlineMs }: { minIntervalSeconds?: number; deadlineMs?: number } = {}): Promise<{ uncertain: boolean }> {
  // Claiming marks the attempts checked before TAMI is asked, so concurrent throttled callers ask once per attempt.
  // The open count comes from the same statement snapshot: an attempt left to another caller (or checked moments
  // ago) has no answer here, and its last answer may have been uncertain.
  const claim = (await db.query<{ open: string } & { [K in keyof Attempt]: Attempt[K] | null }>(
    `WITH claimed AS (
       UPDATE commerce_payments SET checked_at=now() WHERE order_id=$1 AND status IN ('initiated','pending')
         AND ($2::float8=0 OR checked_at IS NULL OR checked_at<now()-make_interval(secs=>$2::float8))
       RETURNING id,provider_order_id,amount_kurus,status,hosted_url,created_at,provider_result),
     open AS (SELECT count(*) AS open FROM commerce_payments WHERE order_id=$1 AND status IN ('initiated','pending'))
     SELECT open.open,claimed.* FROM open LEFT JOIN claimed ON true ORDER BY claimed.created_at`,
    [orderId, minIntervalSeconds],
  )).rows;
  const attempts = claim.filter((row): row is typeof row & Attempt => row.id !== null);
  const skipped = minIntervalSeconds > 0 && Number(claim[0]?.open ?? 0) > attempts.length;
  // With a budget the queries run together; results are still applied one by one in attempt order.
  const answers = deadlineMs === undefined ? null : await Promise.all(attempts.map(attempt => answer(attempt, deadlineMs)));
  let uncertain = false;
  for (const [index, attempt] of attempts.entries()) {
    const result = answers ? answers[index] : await answer(attempt);
    if ("error" in result) {
      uncertain = true;
      const { error } = result;
      console.error("TAMI payment query failed", { orderId, attempt: attempt.provider_order_id, error: error instanceof Error ? error.message : error });
      await db.query("UPDATE commerce_payments SET checked_at=now() WHERE id=$1", [attempt.id]);
      continue;
    }
    const { outcome } = result;
    if (outcome.kind === "paid") { await recordPaid(orderId, attempt, outcome.query); continue; }
    const old = Date.now() - attempt.created_at.getTime() > ATTEMPT_WATCH_HOURS * 3_600_000;
    await db.query(
      `UPDATE commerce_payments SET checked_at=now(),provider_result=COALESCE($2::jsonb,provider_result),
       status=CASE WHEN $3 THEN 'abandoned' ELSE status END WHERE id=$1 AND status IN ('initiated','pending')`,
      [attempt.id, outcome.kind === "unpaid" ? JSON.stringify(providerResult(outcome.query)) : null, old],
    );
  }
  // An unanswered or skipped query may hide a payment; expiry waits for a definite answer on every open attempt.
  if (!uncertain && !skipped) await expireIfDue(orderId);
  return { uncertain };
}

async function recordPaid(orderId: string, attempt: Attempt, query: TamiQueryResponse) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const order = (await client.query<{ status: string; payment_status: string; number: string; cancelled_by: string | null; total_kurus: string; installment_count: number; installment_fee_kurus: string }>(
      "SELECT status,payment_status,number,cancelled_by,total_kurus,installment_count,installment_fee_kurus FROM commerce_orders WHERE id=$1 FOR UPDATE", [orderId],
    )).rows[0];
    const updated = await client.query(
      `UPDATE commerce_payments SET status='succeeded',paid_at=now(),checked_at=now(),provider_result=$2,
       bank_reference=$3,bank_auth_code=$4,installment_count=$5 WHERE id=$1 AND status IN ('initiated','pending')`,
      [attempt.id, JSON.stringify(providerResult(query)), query.bankReferenceNumber, query.bankAuthCode, query.installmentCount],
    );
    if (!order || !updated.rowCount) { await client.query("COMMIT"); return; }
    // Whether this capture settles the order; other branches already ask for the whole payment back.
    let settled = false;
    if (order.payment_status === "refunded") {
      // The order's money was already returned; this capture must be refunded too, so the refund step reopens.
      await client.query("UPDATE commerce_orders SET payment_status='refund_required' WHERE id=$1", [orderId]);
      await appendNote(client, orderId, `İade edilmiş siparişe yeni ödeme alındı (${attempt.provider_order_id}); Siparişler'den TAMI ile iade edin.`);
    } else if (order.payment_status === "paid" || order.payment_status === "refund_required") {
      await appendNote(client, orderId, `Mükerrer ödeme alındı (${attempt.provider_order_id}); fazla tahsilatı Siparişler'den TAMI ile iade edin.`);
    } else if (order.status === "awaiting_payment") {
      await client.query("UPDATE commerce_orders SET status='pending',payment_status='paid',paid_at=now() WHERE id=$1", [orderId]);
      await clearPurchasedCart(client, orderId);
      settled = true;
    } else if (order.status === "cancelled" && order.payment_status === "cancelled") {
      // Cancelled unpaid (by the customer, #607) before this capture landed: the order stays cancelled and the money goes back.
      await client.query("UPDATE commerce_orders SET payment_status='refund_required',paid_at=now() WHERE id=$1", [orderId]);
      await appendNote(client, orderId, `${order.cancelled_by === "customer" ? "Müşteri iptal ettikten sonra ödeme alındı" : "İptal edilen siparişe ödeme alındı"} (${attempt.provider_order_id}); Siparişler'den TAMI ile iade edin.`);
    } else if (order.status === "cancelled" && order.payment_status === "expired") {
      // Paid after the window closed: take the order back if in-house stock still allows it.
      const short = await reserveStoreStock(client, orderId);
      await client.query("UPDATE commerce_orders SET status='pending',payment_status='paid',paid_at=now(),cancelled_by=NULL,cancelled_at=NULL WHERE id=$1", [orderId]);
      await appendNote(client, orderId, short
        ? "Ödeme süre dolduktan sonra alındı ve mağaza stoku yetersiz; stok/iade kararı verin."
        : "Ödeme süre dolduktan sonra alındı; fiyat ve stok teyidini yapın.");
      await clearPurchasedCart(client, orderId);
      settled = true;
    } else {
      await appendNote(client, orderId, `Beklenmeyen durumda ödeme alındı (${attempt.provider_order_id}); siparişi inceleyin.`);
    }
    const note = await installmentNote(client, order, query.installmentCount, attempt.provider_order_id, settled);
    if (note) await appendNote(client, orderId, note);
    // Queued with the payment (#951): a settled order gets one confirmation email, sent after the response.
    if (settled) await queueOrderConfirmation(client, orderId);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/**
 * The hosted page lets the buyer pick installments on its own (#873), so the count actually paid may differ from the
 * option chosen at checkout (#886). More installments: the merchant carries the extra commission. Fewer on a settled
 * order: the buyer paid the fee for installments they did not use, so the difference is refunded by hand.
 */
async function installmentNote(client: PoolClient, order: { total_kurus: string; installment_count: number; installment_fee_kurus: string },
  actual: number | null, providerOrderId: string, settled: boolean) {
  const chosen = order.installment_count;
  // An absent or malformed count (null, 0, NaN, fractional) says nothing about the installments: no note.
  // A no-fee installment order (#1462) is paid the same whatever count the buyer picks on the hosted page.
  if (chosen > 1 && Number(order.installment_fee_kurus) === 0) return null;
  if (actual === null || !Number.isInteger(actual) || actual < 1 || actual === chosen) return null;
  if (actual > chosen) {
    return `TAMI'de ${actual} taksitle ödendi (${providerOrderId}); ${chosen > 1 ? `siparişte ${chosen} taksit seçilmişti, ` : ""}taksit komisyon farkı işyerine yansır.`;
  }
  if (!settled) return null;
  const total = Number(order.total_kurus), fee = Number(order.installment_fee_kurus);
  let refund: number | null = fee;
  if (actual > 1) {
    const settings = await installmentSettings(client);
    const rate = settings.ratesBp[actual];
    refund = rate === undefined ? null : Math.max(0, total - installmentTotal(total - fee, settings.singleRateBp, rate));
  }
  return `Siparişte ${chosen} taksit seçildi, TAMI'de ${actual === 1 ? "tek çekim" : `${actual} taksitle`} ödendi (${providerOrderId}); vade farkı iadesi gerekir${refund === null ? "" : ` (≈ ${money(refund)})`}.`;
}

export async function appendNote(client: PoolClient, orderId: string, note: string) {
  await client.query("UPDATE commerce_orders SET payment_note=concat_ws(' ',NULLIF(payment_note,''),$2::text) WHERE id=$1", [orderId, note]);
}

async function clearPurchasedCart(client: PoolClient, orderId: string) {
  // The cart is kept until payment so a failed card can be retried; only purchased lines are removed.
  await client.query(`DELETE FROM commerce_cart_items c USING commerce_orders o, commerce_order_items i
    WHERE o.id=$1 AND i.order_id=o.id AND c.owner_kind=o.owner_kind AND c.owner_id=o.owner_id AND c.product_id=i.product_id`, [orderId]);
}

/** Takes store stock again for an expired order paid late; a line that cannot be covered keeps 0 reserved. */
async function reserveStoreStock(client: PoolClient, orderId: string) {
  const lines = (await client.query<{ product_id: string; quantity: number }>(
    "SELECT i.product_id,i.quantity FROM commerce_order_items i JOIN store_products p ON p.id=i.product_id WHERE i.order_id=$1 ORDER BY i.product_id FOR UPDATE OF p", [orderId],
  )).rows;
  let short = false;
  for (const line of lines) {
    const taken = await client.query("UPDATE store_products SET stock=stock-$2,updated_at=now() WHERE id=$1 AND stock>=$2", [line.product_id, line.quantity]);
    if (!taken.rowCount) short = true;
    await client.query("UPDATE commerce_order_items SET reserved_quantity=$3 WHERE order_id=$1 AND product_id=$2", [orderId, line.product_id, taken.rowCount ? line.quantity : 0]);
  }
  return short;
}

async function expireIfDue(orderId: string) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const order = (await client.query<{ id: string }>(
      `SELECT id FROM commerce_orders WHERE id=$1 AND status='awaiting_payment' AND payment_status='awaiting' AND payment_due_at<=now()
       AND NOT EXISTS(SELECT 1 FROM commerce_payments WHERE order_id=$1 AND status='succeeded') FOR UPDATE`, [orderId],
    )).rows[0];
    if (order) await cancelLockedOrder(client, orderId, "expiry");
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Scheduled sweep: open attempts first by oldest check, then unpaid orders past their window. */
export async function reconcilePendingPayments(limit = 50) {
  const { rows } = await db.query<{ order_id: string }>(
    `SELECT order_id FROM (
       SELECT order_id,min(checked_at) AS checked FROM commerce_payments WHERE status IN ('initiated','pending') GROUP BY order_id
       UNION ALL
       SELECT id,NULL FROM commerce_orders o WHERE status='awaiting_payment' AND payment_due_at<=now()
        AND NOT EXISTS(SELECT 1 FROM commerce_payments p WHERE p.order_id=o.id AND p.status IN ('initiated','pending'))
     ) due GROUP BY order_id ORDER BY min(checked) NULLS FIRST LIMIT $1`, [limit],
  );
  let failed = 0;
  for (const { order_id } of rows) {
    try { await reconcileOrderPayments(order_id); }
    catch (error) { failed++; console.error("Payment reconciliation failed", { order_id, error: error instanceof Error ? error.message : error }); }
  }
  return { checked: rows.length, failed };
}
