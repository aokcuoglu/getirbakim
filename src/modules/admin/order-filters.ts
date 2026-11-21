import { handledPaymentSql } from "@/modules/store/payment-states";

// Order list tabs and the dashboard's order figures. Free of the session (unlike data.ts), so
// scripts/test-partner-orders.ts can run the revenue query.

/** A partner's cancel request (#426) operations have not decided yet; the order may not ship meanwhile. */
export const openCancelRequestSql = "(o.cancel_requested_at IS NOT NULL AND o.cancel_request_rejected_at IS NULL)";

/** A partner's return request (#1007) operations have not decided yet; it holds its quantity until then. */
export const openReturnRequestSql = "EXISTS (SELECT 1 FROM partner_return_requests rr WHERE rr.order_id=o.id AND rr.status='requested')";

export const orderFilters = {
  all: { label: "Tümü", where: "true" },
  action: { label: "Teyit bekleyen", where: `o.status='pending' AND o.payment_status IN ${handledPaymentSql}` },
  // An order with an open partner cancel request cannot ship; it waits under cancel_request.
  shipping: { label: "Kargoya verilecek", where: `o.status='confirmed' AND NOT ${openCancelRequestSql}` },
  cancel_request: { label: "İptal talebi", where: `o.status='confirmed' AND ${openCancelRequestSql}` },
  return_request: { label: "İade talebi", where: openReturnRequestSql },
  refund: { label: "İade bekleyen", where: "o.payment_status='refund_required'" },
  awaiting_payment: { label: "Ödeme bekleyen", where: "o.status='awaiting_payment'" },
  shipped: { label: "Kargoda", where: "o.status='shipped'" },
  delivered: { label: "Teslim edildi", where: "o.status='delivered'" },
  cancelled: { label: "İptal", where: "o.status='cancelled'" },
} as const;
export type OrderFilter = keyof typeof orderFilters;

/** One count per tab of the order list. */
export const orderTabCountsSql = `SELECT ${Object.entries(orderFilters).map(([key, f]) => `count(*) FILTER (WHERE ${f.where})::int AS ${key}`).join(",")} FROM commerce_orders o`;
/** The navigation badge: orders operations must act on (confirm, refund, a partner's cancel or return request). */
export const navOrderCountSql = `SELECT count(*)::int FROM commerce_orders o WHERE ${orderFilters.action.where} OR ${orderFilters.refund.where}
  OR ${orderFilters.cancel_request.where} OR ${orderFilters.return_request.where}`;
/** An order's partner return requests (#1007) for the list (correlated on `o`), oldest first, with their lines. */
export const orderReturnRequestsSql = `COALESCE((SELECT jsonb_agg(jsonb_build_object('id',rr.id,'status',rr.status,'note',rr.note,'requested_at',rr.requested_at,
  'decided_at',rr.decided_at,'lines',(SELECT jsonb_agg(jsonb_build_object('product_id',rl.product_id,'quantity',rl.quantity,'reason',rl.reason) ORDER BY rl.product_id)
   FROM partner_return_request_lines rl WHERE rl.request_id=rr.id)) ORDER BY rr.requested_at,rr.id)
  FROM partner_return_requests rr WHERE rr.order_id=o.id),'[]')`;

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
