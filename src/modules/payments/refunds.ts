import "server-only";
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { appendNote } from "./checkout";
import { refundablePayments, refundKindLabel, reversalKinds, type ReversalKind } from "./refund-rules";
import {
  assertTamiConfigured, buildCorrelationId, queryPaymentByOrderId, refundTamiPayment, verifiedReversal, voidTamiPayment,
  type TamiReversalResult,
} from "./tami";

// TAMI void/refund from /yonetim (#619). Callers check the admin session. Every provider call has its own
// commerce_payment_refunds row, committed as 'requested' before the call, so a lost reply is never forgotten.

export type RefundOutcome = { outcome: "succeeded" | "failed" | "unknown" | "busy" | "not_allowed"; kind?: ReversalKind; message?: string };

// TODO(#619): the order query's transactionType for a reversal is not documented. The orchestrator confirms the real
// names from a sandbox void/refund and narrows this set; until then any of them counts as a reversal.
export const REVERSAL_TRANSACTION_TYPES = ["REFUND", "VOID", "CANCEL"] as const;
// The signed query is only trusted to say "no reversal happened" this long after the call.
const NO_REVERSAL_AFTER_MINUTES = 15;
// A query right after the call may not show it yet.
const CHECK_AFTER_MINUTES = 1;

type Payment = { id: string; provider_order_id: string; amount_kurus: string; status: string; paid_at: Date | null };
type Order = { id: string; number: string; payment_status: string };
type Settlement = {
  status: "succeeded" | "failed" | "unknown"; bankReference?: string | null; bankAuthCode?: string | null; transactionAt?: string | null;
  errorCode?: string | null; errorMessage?: string | null; providerResult?: Record<string, unknown> | null;
};

const lockOrder = async (client: PoolClient, orderId: string) => (await client.query<Order>(
  "SELECT id,number,payment_status FROM commerce_orders WHERE id=$1 FOR UPDATE", [orderId],
)).rows[0];

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

const insertRequested = (client: PoolClient, input: { paymentId: string; orderId: string; kind: ReversalKind; amountKurus: string; adminId: string }) =>
  client.query<{ id: string; correlation_id: string }>(
    `INSERT INTO commerce_payment_refunds(payment_id,order_id,kind,amount_kurus,correlation_id,requested_by) VALUES($1,$2,$3,$4,$5,$6)
     RETURNING id,correlation_id`,
    [input.paymentId, input.orderId, input.kind, input.amountKurus, buildCorrelationId("refund"), input.adminId],
  ).then(result => result.rows[0]);

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

const text = (value: unknown) => typeof value === "string" ? value : typeof value === "number" ? String(value) : null;

/** Turns a provider reply into the row's final state; anything not proven either way stays unknown. */
function settlementOf(result: TamiReversalResult, expected: { kind: ReversalKind; amountKurus: number; correlationId: string }): Settlement {
  if (result.kind === "ok") {
    const providerResult = { body: result.body, signedResponse: result.raw };
    if (!verifiedReversal(result.body, expected)) {
      return { status: "unknown", errorMessage: "TAMI başarılı dedi ama tutar, para birimi veya istek kimliği uyuşmuyor.", providerResult };
    }
    return {
      status: "succeeded", bankReference: text(result.body.bankReferenceNumber), bankAuthCode: text(result.body.bankAuthCode),
      transactionAt: text(result.body.transactionDate), providerResult,
    };
  }
  if (result.kind === "rejected") {
    return {
      status: "failed", errorCode: result.errorCode, errorMessage: result.errorMessage.slice(0, 500),
      providerResult: { httpStatus: result.httpStatus, errorGroup: result.errorGroup, body: result.body },
    };
  }
  return { status: "unknown", errorMessage: result.reason.slice(0, 500), providerResult: { httpStatus: result.httpStatus } };
}

/** Records the outcome on a row still in `from`; false when another request settled it first. */
async function settleRow(client: PoolClient, refundId: string, from: string[], settlement: Settlement) {
  const updated = await client.query(
    `UPDATE commerce_payment_refunds SET status=$3,bank_reference=COALESCE($4,bank_reference),bank_auth_code=COALESCE($5,bank_auth_code),
     provider_transaction_at=COALESCE($6,provider_transaction_at),error_code=$7,error_message=$8,provider_result=COALESCE($9::jsonb,provider_result),
     completed_at=CASE WHEN $3 IN ('succeeded','failed') THEN now() ELSE completed_at END,checked_at=now()
     WHERE id=$1 AND status=ANY($2::text[])`,
    [refundId, from, settlement.status, settlement.bankReference ?? null, settlement.bankAuthCode ?? null, settlement.transactionAt ?? null,
      settlement.errorCode ?? null, settlement.errorMessage ?? null, settlement.providerResult ? JSON.stringify(settlement.providerResult) : null],
  );
  return Boolean(updated.rowCount);
}

/**
 * After a successful reversal: a cancelled order whose every captured attempt is reversed becomes refunded with the
 * TAMI references; a reversed extra capture on a paid order is noted. The order is already locked by the caller.
 */
async function settleOrderAfterRefund(client: PoolClient, order: Order, providerOrderId: string, kind: ReversalKind) {
  if (order.payment_status === "paid") {
    await appendNote(client, order.id, `Mükerrer ödeme ${providerOrderId} iade edildi.`);
    return;
  }
  if (order.payment_status !== "refund_required") {
    await appendNote(client, order.id, `TAMI ${refundKindLabel[kind].toLocaleLowerCase("tr")} kaydı ${providerOrderId} sonradan doğrulandı.`);
    return;
  }
  const open = (await client.query<{ open: number }>(
    `SELECT count(*)::int AS open FROM commerce_payments p WHERE p.order_id=$1 AND p.status='succeeded'
     AND NOT EXISTS(SELECT 1 FROM commerce_payment_refunds r WHERE r.payment_id=p.id AND r.status='succeeded')`, [order.id],
  )).rows[0].open;
  if (open) return;
  const references = (await client.query<{ kind: ReversalKind; provider_order_id: string; bank_reference: string | null }>(
    `SELECT r.kind,p.provider_order_id,r.bank_reference FROM commerce_payment_refunds r JOIN commerce_payments p ON p.id=r.payment_id
     WHERE r.order_id=$1 AND r.status='succeeded' ORDER BY r.completed_at,r.id`, [order.id],
  )).rows.map(r => `TAMI ${refundKindLabel[r.kind]} ${r.provider_order_id}${r.bank_reference ? ` · banka ref. ${r.bank_reference}` : ""}`);
  await client.query("UPDATE commerce_orders SET payment_status='refunded',refunded_at=now(),refund_reference=$2 WHERE id=$1 AND payment_status='refund_required'",
    [order.id, references.join("; ")]);
}

const outcomeMessage: Record<Settlement["status"], string> = {
  succeeded: "TAMI işlemi onayladı.",
  failed: "TAMI işlemi reddetti; yeniden denenebilir.",
  unknown: "TAMI yanıtı doğrulanamadı. TAMI'de kontrol edin.",
};

/**
 * Reverses one captured payment attempt in full through TAMI. Same-day payments are voided, and refunded if TAMI
 * rejects the void; older ones are refunded. A concurrent or unresolved call for the same attempt returns `busy`.
 */
export async function refundPayment({ orderId, paymentId, adminId }: { orderId: string; paymentId: string; adminId: string }): Promise<RefundOutcome> {
  assertTamiConfigured();
  type Claim = { order: Order; payment: Payment; kinds: ReversalKind[]; refund: { id: string; correlation_id: string } };
  let claim: Claim | RefundOutcome;
  try {
    claim = await inTransaction(async (client): Promise<Claim | RefundOutcome> => {
      const order = await lockOrder(client, orderId);
      if (!order) return { outcome: "not_allowed" };
      const payments = (await client.query<Payment>(
        "SELECT id,provider_order_id,amount_kurus,status,paid_at FROM commerce_payments WHERE order_id=$1 ORDER BY created_at", [orderId],
      )).rows;
      const payment = payments.find(p => p.id === paymentId);
      if (!payment || payment.status !== "succeeded") return { outcome: "not_allowed" };
      const refunds = (await client.query<{ payment_id: string; status: string }>(
        "SELECT payment_id,status FROM commerce_payment_refunds WHERE order_id=$1", [orderId],
      )).rows;
      const own = refunds.filter(r => r.payment_id === paymentId);
      if (own.some(r => r.status === "requested" || r.status === "unknown")) {
        return { outcome: "busy", message: "Bu ödeme için sonucu bilinmeyen bir TAMI isteği var. Önce TAMI'de kontrol edin." };
      }
      if (!refundablePayments(order, payments, refunds).some(p => p.id === paymentId)) return { outcome: "not_allowed" };
      const kinds = reversalKinds(payment.paid_at);
      const refund = await insertRequested(client, { paymentId, orderId, kind: kinds[0], amountKurus: payment.amount_kurus, adminId });
      return { order, payment, kinds, refund };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { outcome: "busy", message: "Bu ödeme için başka bir TAMI isteği sürüyor." };
    throw error;
  }
  if (!("refund" in claim)) return claim;

  const { order, payment, kinds } = claim;
  let refund = claim.refund;
  const amountKurus = Number(payment.amount_kurus);
  const reason = order.payment_status === "paid" ? `Sipariş #${order.number} mükerrer ödeme` : `Sipariş #${order.number} iptal`;
  for (const [index, kind] of kinds.entries()) {
    let result: TamiReversalResult;
    try {
      result = kind === "void"
        ? await voidTamiPayment({ orderId: payment.provider_order_id, reason, correlationId: refund.correlation_id })
        : await refundTamiPayment({ orderId: payment.provider_order_id, amountKurus, reason, correlationId: refund.correlation_id });
    } catch (error) {
      result = { kind: "unknown", reason: error instanceof Error ? error.message : "TAMI çağrısı tamamlanamadı.", httpStatus: null };
    }
    const settlement = settlementOf(result, { kind, amountKurus, correlationId: refund.correlation_id });
    const next = settlement.status === "failed" && index < kinds.length - 1 ? kinds[index + 1] : null;
    type Step = { done: RefundOutcome } | { retry: { id: string; correlation_id: string } };
    const step = await inTransaction(async (client): Promise<Step> => {
      const locked = await lockOrder(client, orderId);
      if (!await settleRow(client, refund.id, ["requested"], settlement)) {
        // Settled meanwhile (TAMI'de kontrol et); report what is recorded, change nothing.
        const current = (await client.query<{ status: Settlement["status"] | "requested" }>(
          "SELECT status FROM commerce_payment_refunds WHERE id=$1", [refund.id],
        )).rows[0]?.status;
        return { done: { outcome: current === "requested" || !current ? "unknown" : current, kind } };
      }
      if (settlement.status === "succeeded") await settleOrderAfterRefund(client, locked, payment.provider_order_id, kind);
      if (next) return { retry: await insertRequested(client, { paymentId: payment.id, orderId, kind: next, amountKurus: payment.amount_kurus, adminId }) };
      return { done: { outcome: settlement.status, kind, message: settlement.errorMessage ?? outcomeMessage[settlement.status] } };
    });
    if ("done" in step) return step.done;
    refund = step.retry;
  }
  return { outcome: "unknown" };
}

type OpenRefund = { id: string; order_id: string; payment_id: string; kind: ReversalKind; amount_kurus: string; status: string; requested_at: Date; provider_order_id: string };

/**
 * Settles a requested/unknown call from the signed order query: a successful reversal transaction makes it succeeded;
 * a query that shows only the captured AUTH long after the call makes it failed (retry allowed); anything else keeps it unknown.
 */
export async function checkRefund({ refundId, orderId }: { refundId: string; orderId: string }): Promise<RefundOutcome> {
  const refund = (await db.query<OpenRefund>(
    `SELECT r.id,r.order_id,r.payment_id,r.kind,r.amount_kurus,r.status,r.requested_at,p.provider_order_id FROM commerce_payment_refunds r
     JOIN commerce_payments p ON p.id=r.payment_id WHERE r.id=$1 AND r.order_id=$2`, [refundId, orderId],
  )).rows[0];
  if (!refund || !["requested", "unknown"].includes(refund.status)) return { outcome: "not_allowed" };
  const age = Date.now() - refund.requested_at.getTime();
  if (age < CHECK_AFTER_MINUTES * 60_000) {
    return { outcome: "unknown", kind: refund.kind, message: "İstek çok yeni; bir dakika sonra yeniden kontrol edin." };
  }
  let settlement: Settlement;
  try {
    const query = await queryPaymentByOrderId({ orderId: refund.provider_order_id, locale: "tr" });
    const types = query.transactions.map(t => String(t.transactionType ?? "").toUpperCase());
    const reversal = query.transactions.find(t => (REVERSAL_TRANSACTION_TYPES as readonly string[]).includes(String(t.transactionType ?? "").toUpperCase())
      && String(t.transactionStatus ?? "").toUpperCase() === "SUCCESS");
    const trusted = query.securityHashValid && query.orderId === refund.provider_order_id;
    const reversedAmount = reversal?.amount == null ? null : Math.round(Number(reversal.amount) * 100);
    if (trusted && reversal && (reversedAmount === null || reversedAmount === Number(refund.amount_kurus))) {
      settlement = {
        status: "succeeded", bankReference: text(reversal.bankReferenceNumber), bankAuthCode: text(reversal.bankAuthCode),
        transactionAt: text(reversal.transactionDate), providerResult: { query: query.raw },
      };
    } else if (trusted && !reversal && query.success && query.orderStatus === "AUTH" && query.transactionStatus === "SUCCESS"
      && types.every(type => type === "AUTH") && age > NO_REVERSAL_AFTER_MINUTES * 60_000) {
      settlement = { status: "failed", errorMessage: "TAMI'de iade kaydı yok; yeniden deneyin.", providerResult: { query: query.raw } };
    } else {
      settlement = { status: "unknown", errorMessage: trusted ? "TAMI sorgusu sonucu henüz göstermiyor." : "TAMI sorgu yanıtı doğrulanamadı." };
    }
  } catch (error) {
    settlement = { status: "unknown", errorMessage: `TAMI sorgusu yanıt vermedi: ${error instanceof Error ? error.message : "bilinmeyen hata"}`.slice(0, 500) };
  }
  return inTransaction(async (client) => {
    const order = await lockOrder(client, orderId);
    if (!await settleRow(client, refund.id, ["requested", "unknown"], settlement)) return { outcome: "busy", kind: refund.kind };
    if (settlement.status === "succeeded") await settleOrderAfterRefund(client, order, refund.provider_order_id, refund.kind);
    return { outcome: settlement.status, kind: refund.kind, message: settlement.errorMessage ?? outcomeMessage[settlement.status] };
  });
}
