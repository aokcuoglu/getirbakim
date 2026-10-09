import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { siteUrl } from "@/lib/site";
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
export function callbackUrl(orderId: string) {
  const url = new URL("/api/payments/tami/callback", siteUrl);
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

async function queryAttempt(attempt: Attempt): Promise<Outcome> {
  try {
    const query = await queryPaymentByOrderId({ orderId: attempt.provider_order_id, locale: "tr" });
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

function providerResult(query: TamiQueryResponse) {
  const { securityHash: _hash, ...raw } = query.raw;
  void _hash;
  return { ...raw, securityHashValid: query.securityHashValid };
}

/**
 * Asks TAMI about every open attempt of an order, records verified payments and expires unpaid orders.
 * Callback parameters are never trusted; the signed provider query is the only evidence of payment.
 */
export async function reconcileOrderPayments(orderId: string, { minIntervalSeconds = 0 } = {}) {
  // Page views pass an interval so refreshes do not flood the provider.
  const attempts = (await db.query<Attempt>(
    `SELECT id,provider_order_id,amount_kurus,status,hosted_url,created_at,provider_result FROM commerce_payments WHERE order_id=$1 AND status IN ('initiated','pending')
     AND (checked_at IS NULL OR checked_at<now()-make_interval(secs=>$2)) ORDER BY created_at`,
    [orderId, minIntervalSeconds],
  )).rows;
  let uncertain = false;
  for (const attempt of attempts) {
    let outcome: Outcome;
    try { outcome = await queryAttempt(attempt); }
    catch (error) {
      uncertain = true;
      console.error("TAMI payment query failed", { orderId, attempt: attempt.provider_order_id, error: error instanceof Error ? error.message : error });
      await db.query("UPDATE commerce_payments SET checked_at=now() WHERE id=$1", [attempt.id]);
      continue;
    }
    if (outcome.kind === "paid") { await recordPaid(orderId, attempt, outcome.query); continue; }
    const old = Date.now() - attempt.created_at.getTime() > ATTEMPT_WATCH_HOURS * 3_600_000;
    await db.query(
      `UPDATE commerce_payments SET checked_at=now(),provider_result=COALESCE($2::jsonb,provider_result),
       status=CASE WHEN $3 THEN 'abandoned' ELSE status END WHERE id=$1 AND status IN ('initiated','pending')`,
      [attempt.id, outcome.kind === "unpaid" ? JSON.stringify(providerResult(outcome.query)) : null, old],
    );
  }
  // An unanswered query may hide a payment; expiry waits for a definite answer.
  if (!uncertain) await expireIfDue(orderId);
}

async function recordPaid(orderId: string, attempt: Attempt, query: TamiQueryResponse) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const order = (await client.query<{ status: string; payment_status: string; number: string }>(
      "SELECT status,payment_status,number FROM commerce_orders WHERE id=$1 FOR UPDATE", [orderId],
    )).rows[0];
    const updated = await client.query(
      `UPDATE commerce_payments SET status='succeeded',paid_at=now(),checked_at=now(),provider_result=$2,
       bank_reference=$3,bank_auth_code=$4,installment_count=$5 WHERE id=$1 AND status IN ('initiated','pending')`,
      [attempt.id, JSON.stringify(providerResult(query)), query.bankReferenceNumber, query.bankAuthCode, query.installmentCount],
    );
    if (!order || !updated.rowCount) { await client.query("COMMIT"); return; }
    if (order.payment_status === "paid" || order.payment_status === "refund_required" || order.payment_status === "refunded") {
      await appendNote(client, orderId, `Mükerrer ödeme alındı (${attempt.provider_order_id}); fazla tahsilatı TAMI portalından iade edin.`);
    } else if (order.status === "awaiting_payment") {
      await client.query("UPDATE commerce_orders SET status='pending',payment_status='paid',paid_at=now() WHERE id=$1", [orderId]);
      await clearPurchasedCart(client, orderId);
    } else if (order.status === "cancelled" && order.payment_status === "expired") {
      // Paid after the window closed: take the order back if in-house stock still allows it.
      const short = await reserveStoreStock(client, orderId);
      await client.query("UPDATE commerce_orders SET status='pending',payment_status='paid',paid_at=now() WHERE id=$1", [orderId]);
      await appendNote(client, orderId, short
        ? "Ödeme süre dolduktan sonra alındı ve mağaza stoku yetersiz; stok/iade kararı verin."
        : "Ödeme süre dolduktan sonra alındı; fiyat ve stok teyidini yapın.");
      await clearPurchasedCart(client, orderId);
    } else {
      await appendNote(client, orderId, `Beklenmeyen durumda ödeme alındı (${attempt.provider_order_id}); siparişi inceleyin.`);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function appendNote(client: PoolClient, orderId: string, note: string) {
  await client.query("UPDATE commerce_orders SET payment_note=concat_ws(' ',NULLIF(payment_note,''),$2::text) WHERE id=$1", [orderId, note]);
}

async function clearPurchasedCart(client: PoolClient, orderId: string) {
  // The cart is kept until payment so a failed card can be retried; only purchased lines are removed.
  await client.query(`DELETE FROM commerce_cart_items c USING commerce_orders o, commerce_order_items i
    WHERE o.id=$1 AND i.order_id=o.id AND c.owner_kind=o.owner_kind AND c.owner_id=o.owner_id AND c.product_id=i.product_id`, [orderId]);
}

async function reserveStoreStock(client: PoolClient, orderId: string) {
  const lines = (await client.query<{ product_id: string; quantity: number }>(
    "SELECT i.product_id,i.quantity FROM commerce_order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=$1 ORDER BY i.product_id FOR UPDATE OF p", [orderId],
  )).rows;
  let short = false;
  for (const line of lines) {
    const taken = await client.query("UPDATE products SET stock=stock-$2,updated_at=now() WHERE id=$1 AND stock>=$2", [line.product_id, line.quantity]);
    if (!taken.rowCount) short = true;
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
    if (order) {
      await client.query(`UPDATE products p SET stock=p.stock+i.quantity,updated_at=now() FROM commerce_order_items i WHERE i.order_id=$1 AND i.product_id=p.id`, [orderId]);
      await client.query("UPDATE commerce_orders SET status='cancelled',payment_status='expired' WHERE id=$1", [orderId]);
    }
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
