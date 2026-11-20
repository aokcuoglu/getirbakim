import { handledPaymentSql } from "@/modules/store/payment-states";

// Order list tabs and the dashboard's order figures. Free of the session (unlike data.ts), so
// scripts/test-partner-orders.ts can run the revenue query.

/** A partner's cancel request (#426) operations have not decided yet; the order may not ship meanwhile. */
export const openCancelRequestSql = "(o.cancel_requested_at IS NOT NULL AND o.cancel_request_rejected_at IS NULL)";

export const orderFilters = {
  all: { label: "Tümü", where: "true" },
  action: { label: "Teyit bekleyen", where: `o.status='pending' AND o.payment_status IN ${handledPaymentSql}` },
  // An order with an open partner cancel request cannot ship; it waits under cancel_request.
  shipping: { label: "Kargoya verilecek", where: `o.status='confirmed' AND NOT ${openCancelRequestSql}` },
  cancel_request: { label: "İptal talebi", where: `o.status='confirmed' AND ${openCancelRequestSql}` },
  refund: { label: "İade bekleyen", where: "o.payment_status='refund_required'" },
  awaiting_payment: { label: "Ödeme bekleyen", where: "o.status='awaiting_payment'" },
  shipped: { label: "Kargoda", where: "o.status='shipped'" },
  delivered: { label: "Teslim edildi", where: "o.status='delivered'" },
  cancelled: { label: "İptal", where: "o.status='cancelled'" },
} as const;
export type OrderFilter = keyof typeof orderFilters;

// Revenue (#426, product decision 2026-11-19): paid orders by payment time, plus partner on-account orders (invoiced
// later) by order time while not cancelled.
const paid30 = "payment_status='paid' AND paid_at>=now()-interval '30 days'";
const paidPrev30 = "payment_status='paid' AND paid_at>=now()-interval '60 days' AND paid_at<now()-interval '30 days'";
const onAccount30 = "payment_status='on_account' AND status<>'cancelled' AND created_at>=now()-interval '30 days'";
const onAccountPrev30 = "payment_status='on_account' AND status<>'cancelled' AND created_at>=now()-interval '60 days' AND created_at<now()-interval '30 days'";
export const dashboardOrdersSql = `SELECT
  count(*) FILTER (WHERE ${orderFilters.action.where})::int AS action,
  count(*) FILTER (WHERE ${orderFilters.shipping.where})::int AS shipping,
  count(*) FILTER (WHERE ${orderFilters.cancel_request.where})::int AS cancel_request,
  count(*) FILTER (WHERE ${orderFilters.refund.where})::int AS refund,
  count(*) FILTER (WHERE ${orderFilters.awaiting_payment.where})::int AS awaiting_payment,
  COALESCE(sum(total_kurus) FILTER (WHERE (${paid30}) OR (${onAccount30})),0) AS revenue_30d,
  count(*) FILTER (WHERE ${paid30})::int AS paid_30d,
  count(*) FILTER (WHERE ${onAccount30})::int AS on_account_30d,
  COALESCE(sum(total_kurus) FILTER (WHERE (${paidPrev30}) OR (${onAccountPrev30})),0) AS revenue_prev_30d
  FROM commerce_orders o`;
