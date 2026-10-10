import "server-only";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import type { CommerceOrder } from "@/modules/store/orders";

type ServiceAccount = {
  id: string; name: string; email: string; approved: boolean; discount_percent: number;
  contact_name: string | null; phone: string | null; city: string | null;
};
type PricingSettings = { markup_percent: string; vat_percent: string; max_age_hours: number; shipping_fee_kurus: number; free_shipping_threshold_kurus: number };
type CurrencySnapshot = {
  currencies_data: { dovizListesi?: { dovizCinsi: string; alis: string; satis: string }[] };
  completed_at: Date;
};

const serviceColumns = "id,name,email,approved,discount_percent,contact_name,phone,city";

export async function adminOverview() {
  await requireAdmin();
  const [counts, accounts] = await Promise.all([
    db.query<{ database: string; products: string }>("SELECT current_database() as database,(SELECT count(*) FROM products) as products"),
    db.query<ServiceAccount>(`SELECT ${serviceColumns} FROM accounts WHERE role='service' ORDER BY approved,name`),
  ]);
  return { counts: counts.rows[0], accounts: accounts.rows };
}

export async function adminServiceAccounts() {
  await requireAdmin();
  return (await db.query<ServiceAccount>(`SELECT ${serviceColumns} FROM accounts WHERE role='service' ORDER BY name`)).rows;
}

export async function adminPricing() {
  await requireAdmin();
  const [settings, latest] = await Promise.all([
    db.query<PricingSettings>("SELECT markup_percent,vat_percent,max_age_hours,shipping_fee_kurus,free_shipping_threshold_kurus FROM commerce_settings WHERE id=true"),
    db.query<CurrencySnapshot>("SELECT currencies_data,completed_at FROM supplier_imports WHERE supplier='basbug' AND company=$1 AND status='succeeded' ORDER BY completed_at DESC,id DESC LIMIT 1", [process.env.BASBUG_FIRMA_ADI || "BASBUG"]),
  ]);
  if (!settings.rows[0]) throw new Error("Satış ayarları bulunamadı.");
  return { settings: settings.rows[0], latest: latest.rows[0], rates: latest.rows[0]?.currencies_data.dovizListesi ?? [] };
}

export type AdminPayment = { provider_order_id: string; status: string; amount_kurus: number; bank_reference: string | null; paid_at: string | null };

export const orderFilters = {
  all: { label: "Tümü", where: "true" },
  action: { label: "Teyit bekleyen", where: "o.status='pending' AND o.payment_status IN ('paid','none')" },
  shipping: { label: "Sevk bekleyen", where: "o.status='confirmed'" },
  refund: { label: "İade bekleyen", where: "o.payment_status='refund_required'" },
  awaiting_payment: { label: "Ödeme bekleyen", where: "o.status='awaiting_payment'" },
  shipped: { label: "Sevk edildi", where: "o.status='shipped'" },
  cancelled: { label: "İptal", where: "o.status='cancelled'" },
} as const;
export type OrderFilter = keyof typeof orderFilters;

export async function adminOrders(rawPage?: string, rawFilter?: string) {
  await requireAdmin();
  const requested = Number(rawPage);
  const page = Number.isSafeInteger(requested) ? Math.max(1, Math.min(10000, requested)) : 1;
  const filter: OrderFilter = rawFilter && rawFilter in orderFilters ? rawFilter as OrderFilter : "all";
  const [orders, counts] = await Promise.all([db.query<CommerceOrder & { payments: AdminPayment[] }>(
    `SELECT o.id,o.number,o.owner_kind,o.owner_id,o.customer_name,o.email,o.phone,o.address,o.note,o.total_kurus,o.subtotal_kurus,o.shipping_kurus,
     o.discount_percent,o.status,o.created_at,o.payment_status,o.payment_due_at,o.paid_at,o.payment_note,o.refund_reference,
     COALESCE((SELECT jsonb_agg(jsonb_build_object('provider_order_id',p.provider_order_id,'status',p.status,'amount_kurus',p.amount_kurus,
      'bank_reference',p.bank_reference,'paid_at',p.paid_at) ORDER BY p.created_at) FROM commerce_payments p WHERE p.order_id=o.id),'[]') AS payments
     FROM commerce_orders o WHERE ${orderFilters[filter].where} ORDER BY o.created_at DESC,o.id DESC LIMIT 51 OFFSET $1`,
    [(page - 1) * 50],
  ), db.query<Record<OrderFilter, number>>(`SELECT ${Object.entries(orderFilters).map(([key, f]) => `count(*) FILTER (WHERE ${f.where})::int AS ${key}`).join(",")} FROM commerce_orders o`)]);
  return { orders: orders.rows, page, filter, counts: counts.rows[0] };
}

/** Badge counts for the workspace navigation; kept to cheap aggregate queries. */
export async function adminNavCounts() {
  await requireAdmin();
  const { rows } = await db.query<{ orders: number; services: number; enrichment: number }>(`SELECT
    (SELECT count(*)::int FROM commerce_orders o WHERE ${orderFilters.action.where} OR ${orderFilters.refund.where}) AS orders,
    (SELECT count(*)::int FROM accounts WHERE role='service' AND NOT approved) AS services,
    (SELECT count(*)::int FROM product_enrichment_jobs WHERE status IN ('review','blocked','failed')) AS enrichment`);
  return rows[0];
}

export type DashboardDay = { day: string; orders: number; revenue_kurus: number };
export async function adminDashboard() {
  await requireAdmin();
  const [orders, days, recent, catalog, enrichment, imports, succeeded] = await Promise.all([
    db.query<{ action: number; shipping: number; refund: number; awaiting_payment: number; revenue_30d: string; paid_30d: number; revenue_prev_30d: string }>(`SELECT
      count(*) FILTER (WHERE ${orderFilters.action.where})::int AS action,
      count(*) FILTER (WHERE ${orderFilters.shipping.where})::int AS shipping,
      count(*) FILTER (WHERE ${orderFilters.refund.where})::int AS refund,
      count(*) FILTER (WHERE ${orderFilters.awaiting_payment.where})::int AS awaiting_payment,
      COALESCE(sum(total_kurus) FILTER (WHERE paid_at>=now()-interval '30 days' AND payment_status='paid'),0) AS revenue_30d,
      count(*) FILTER (WHERE paid_at>=now()-interval '30 days' AND payment_status='paid')::int AS paid_30d,
      COALESCE(sum(total_kurus) FILTER (WHERE paid_at>=now()-interval '60 days' AND paid_at<now()-interval '30 days' AND payment_status='paid'),0) AS revenue_prev_30d
      FROM commerce_orders o`),
    db.query<DashboardDay>(`SELECT to_char(d,'YYYY-MM-DD') AS day,count(o.id)::int AS orders,
      COALESCE(sum(o.total_kurus) FILTER (WHERE o.payment_status='paid'),0)::bigint::float8 AS revenue_kurus
      FROM generate_series((now() AT TIME ZONE 'Europe/Istanbul')::date-13,(now() AT TIME ZONE 'Europe/Istanbul')::date,interval '1 day') d
      LEFT JOIN commerce_orders o ON (o.created_at AT TIME ZONE 'Europe/Istanbul')::date=d::date GROUP BY d ORDER BY d`),
    db.query<Pick<CommerceOrder, "id" | "number" | "customer_name" | "total_kurus" | "status" | "payment_status" | "created_at">>(
      "SELECT id,number,customer_name,total_kurus,status,payment_status,created_at FROM commerce_orders ORDER BY created_at DESC,id DESC LIMIT 6"),
    db.query<{ items: number }>("SELECT count(*)::int AS items FROM supplier_items WHERE presence='present'"),
    db.query<{ status: string; count: number }>("SELECT status,count(*)::int AS count FROM product_enrichment_jobs GROUP BY status"),
    db.query<{ status: string; started_at: Date; completed_at: Date | null; list_group: string; run_kind: string }>(
      "SELECT status,started_at,completed_at,list_group,run_kind FROM supplier_imports WHERE supplier='basbug' ORDER BY started_at DESC LIMIT 1"),
    db.query<{ completed_at: Date }>("SELECT completed_at FROM supplier_imports WHERE supplier='basbug' AND status='succeeded' ORDER BY completed_at DESC LIMIT 1"),
  ]);
  return { orders: orders.rows[0], days: days.rows, recent: recent.rows, catalog: catalog.rows[0], enrichment: enrichment.rows, lastImport: imports.rows[0] ?? null, lastSuccess: succeeded.rows[0] ?? null };
}

export type FitmentReturnRow = { level: string; lines: number; returned: number; not_fit: number };
/** Compatibility level at checkout against returns, for orders that were not cancelled. */
export async function fitmentReturnReport() {
  await requireAdmin();
  return (await db.query<FitmentReturnRow>(
    `SELECT COALESCE(i.fitment_level,'unrecorded') AS level,count(*)::integer AS lines,
     count(*) FILTER (WHERE r.quantity>0)::integer AS returned,count(*) FILTER (WHERE r.not_fit>0)::integer AS not_fit
     FROM commerce_order_items i JOIN commerce_orders o ON o.id=i.order_id
     LEFT JOIN LATERAL (SELECT sum(quantity) AS quantity,sum(quantity) FILTER (WHERE reason='not_fit') AS not_fit
      FROM commerce_returns WHERE order_id=i.order_id AND product_id=i.product_id) r ON true
     WHERE o.status IN ('pending','confirmed','shipped') GROUP BY 1 ORDER BY 2 DESC`,
  )).rows;
}

export type OrderReturn = { id: string; product_id: string; quantity: number; reason: string; note: string; created_at: Date };
export async function orderReturns(orderId: string) {
  await requireAdmin();
  return (await db.query<OrderReturn>("SELECT id,product_id,quantity,reason,note,created_at FROM commerce_returns WHERE order_id=$1 ORDER BY created_at", [orderId])).rows;
}

/** Light-weight Başbuğ figures for the integrations overview; the full browser lives in modules/admin/basbug.ts. */
export async function adminSupplierOverview() {
  await requireAdmin();
  const company = process.env.BASBUG_FIRMA_ADI || "BASBUG";
  const [items, runs, last] = await Promise.all([
    db.query<{ present: number; groups: number; conflicting: number }>(
      "SELECT count(*) FILTER (WHERE presence='present')::int AS present,count(DISTINCT list_group)::int AS groups,count(*) FILTER (WHERE conflicting)::int AS conflicting FROM supplier_items WHERE supplier='basbug' AND company=$1", [company]),
    db.query<{ total: number; failed: number }>(
      "SELECT count(*)::int AS total,count(*) FILTER (WHERE status IN ('failed','rejected'))::int AS failed FROM supplier_imports WHERE supplier='basbug' AND company=$1 AND started_at>now()-interval '24 hours'", [company]),
    db.query<{ status: string; started_at: Date; completed_at: Date | null; list_group: string; run_kind: string }>(
      "SELECT status,started_at,completed_at,list_group,run_kind FROM supplier_imports WHERE supplier='basbug' AND company=$1 ORDER BY started_at DESC LIMIT 1", [company]),
  ]);
  return { items: items.rows[0], runs: runs.rows[0], last: last.rows[0] ?? null };
}
