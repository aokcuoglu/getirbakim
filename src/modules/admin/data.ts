import "server-only";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import { sortOrder } from "@/lib/table-sort";
import { manualCompany, setaCompany } from "@/modules/suppliers/storefront-sources";
import { DINAMIK_COMPANY } from "@/modules/suppliers/dinamik-import";
import { evaluateFeed, supplierFeedScopes, supplierSchedulerState, type FeedSupplier } from "@/modules/suppliers/data-status";
import type { CommerceOrder } from "@/modules/store/orders";
import { restockDueCount } from "./restock";

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
    db.query<{ database: string; products: string }>("SELECT current_database() as database,(SELECT count(*) FROM store_products) as products"),
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
// Header sorting on the orders list (TableHead sortKey → column).
const orderSorts = { created: "o.created_at", customer: "o.customer_name", total: "o.total_kurus" };

export async function adminOrders(rawPage?: string, rawFilter?: string, sort: { sort?: string; dir?: string } = {}) {
  await requireAdmin();
  const requested = Number(rawPage);
  const page = Number.isSafeInteger(requested) ? Math.max(1, Math.min(10000, requested)) : 1;
  const filter: OrderFilter = rawFilter && rawFilter in orderFilters ? rawFilter as OrderFilter : "all";
  const [orders, counts] = await Promise.all([db.query<CommerceOrder & { payments: AdminPayment[] }>(
    `SELECT o.id,o.number,o.owner_kind,o.owner_id,o.customer_name,o.email,o.phone,o.address,o.note,o.total_kurus,o.subtotal_kurus,o.shipping_kurus,
     o.discount_percent,o.status,o.created_at,o.payment_status,o.payment_due_at,o.paid_at,o.payment_note,o.refund_reference,
     COALESCE((SELECT jsonb_agg(jsonb_build_object('provider_order_id',p.provider_order_id,'status',p.status,'amount_kurus',p.amount_kurus,
      'bank_reference',p.bank_reference,'paid_at',p.paid_at) ORDER BY p.created_at) FROM commerce_payments p WHERE p.order_id=o.id),'[]') AS payments
     FROM commerce_orders o WHERE ${orderFilters[filter].where} ORDER BY ${sortOrder(sort, orderSorts, "o.created_at DESC,o.id DESC")} LIMIT 51 OFFSET $1`,
    [(page - 1) * 50],
  ), db.query<Record<OrderFilter, number>>(`SELECT ${Object.entries(orderFilters).map(([key, f]) => `count(*) FILTER (WHERE ${f.where})::int AS ${key}`).join(",")} FROM commerce_orders o`)]);
  return { orders: orders.rows, page, filter, counts: counts.rows[0] };
}

/** Badge counts for the workspace navigation; kept to cheap aggregate queries. */
// Master brands with a supplier label placed automatically (a new label or brand) and not yet reviewed.
const pendingBrandsSql = "SELECT count(DISTINCT brand_id)::int FROM supplier_brands WHERE method='auto'";
export async function adminNavCounts() {
  await requireAdmin();
  const [{ rows }, restock] = await Promise.all([db.query<{ orders: number; services: number; enrichment: number; brands: number }>(`SELECT
    (SELECT count(*)::int FROM commerce_orders o WHERE ${orderFilters.action.where} OR ${orderFilters.refund.where}) AS orders,
    (SELECT count(*)::int FROM accounts WHERE role='service' AND NOT approved) AS services,
    (SELECT count(*)::int FROM product_enrichment_jobs WHERE status IN ('review','blocked','failed')) AS enrichment,
    (${pendingBrandsSql}) AS brands`), restockDueCount()]);
  return { ...rows[0], restock };
}

export type DashboardDay = { day: string; orders: number; revenue_kurus: number };
export async function adminDashboard() {
  await requireAdmin();
  const [orders, days, recent, catalog, enrichment, imports, succeeded, brands] = await Promise.all([
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
    db.query<{ items: number }>("SELECT count(*)::int AS items FROM supplier_items WHERE supplier='basbug' AND presence='present'"),
    db.query<{ status: string; count: number }>("SELECT status,count(*)::int AS count FROM product_enrichment_jobs GROUP BY status"),
    db.query<{ status: string; started_at: Date; completed_at: Date | null; list_group: string; run_kind: string }>(
      "SELECT status,started_at,completed_at,list_group,run_kind FROM supplier_imports WHERE supplier='basbug' ORDER BY started_at DESC LIMIT 1"),
    db.query<{ completed_at: Date }>("SELECT completed_at FROM supplier_imports WHERE supplier='basbug' AND status='succeeded' ORDER BY completed_at DESC LIMIT 1"),
    db.query<{ pending: number; fresh: number }>(`SELECT (${pendingBrandsSql}) AS pending,
      (SELECT count(*)::int FROM (SELECT brand_id FROM supplier_brands GROUP BY brand_id HAVING bool_and(method='auto')) b) AS fresh`),
  ]);
  return { orders: orders.rows[0], days: days.rows, recent: recent.rows, catalog: catalog.rows[0], enrichment: enrichment.rows, lastImport: imports.rows[0] ?? null, lastSuccess: succeeded.rows[0] ?? null, brands: brands.rows[0] };
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
export type DinamikRun = { list_group: string; status: string; error_reason: string | null; started_at: Date; completed_at: Date | null; stats: Record<string, number>; quality: { uniqueProducts?: number } };
/** Dinamik figures: one scope per brand, stock + price lists fetched by the shared supplier scheduler. */
export async function adminDinamikOverview() {
  await requireAdmin();
  const [items, scopes, runs, recent, failing, discovery] = await Promise.all([
    db.query<{ present: number; available: number; priced: number; conflicting: number; brands: number }>(`SELECT count(*)::int AS present,
      count(*) FILTER (WHERE stock_data::text LIKE '%"VAR"%')::int AS available,count(*) FILTER (WHERE price_data->>'fiyat' IS NOT NULL)::int AS priced,
      count(*) FILTER (WHERE conflicting)::int AS conflicting,count(DISTINCT list_group)::int AS brands
      FROM supplier_items WHERE supplier='dinamik' AND presence='present'`),
    db.query<{ enabled: number; synced: number; failing: number; due: number; last_success: Date | null; oldest_success: Date | null }>(`SELECT count(*) FILTER (WHERE enabled)::int AS enabled,
      count(*) FILTER (WHERE enabled AND last_success_at IS NOT NULL)::int AS synced,count(*) FILTER (WHERE enabled AND consecutive_failures>0)::int AS failing,
      count(*) FILTER (WHERE enabled AND next_run_at<=now())::int AS due,max(last_success_at) AS last_success,min(last_success_at) FILTER (WHERE enabled) AS oldest_success
      FROM supplier_sync_scopes WHERE supplier='dinamik'`),
    db.query<{ total: number; failed: number }>(`SELECT count(*)::int AS total,count(*) FILTER (WHERE status IN ('failed','rejected'))::int AS failed
      FROM supplier_imports WHERE supplier='dinamik' AND started_at>now()-interval '24 hours'`),
    db.query<DinamikRun>(`SELECT list_group,status,error_reason,started_at,completed_at,stats,quality FROM supplier_imports
      WHERE supplier='dinamik' ORDER BY started_at DESC,id DESC LIMIT 12`),
    db.query<{ list_group: string; consecutive_failures: number; next_run_at: Date; error_reason: string | null }>(`SELECT s.list_group,s.consecutive_failures,s.next_run_at,r.error_reason
      FROM supplier_sync_scopes s LEFT JOIN LATERAL (SELECT error_reason FROM supplier_imports i WHERE i.supplier=s.supplier AND i.company=s.company
        AND i.list_group=s.list_group AND i.warehouse=s.warehouse ORDER BY started_at DESC,id DESC LIMIT 1) r ON true
      WHERE s.supplier='dinamik' AND s.enabled AND s.consecutive_failures>0 ORDER BY s.consecutive_failures DESC,s.list_group LIMIT 20`),
    db.query<{ checked_at: Date; listed: number }>("SELECT checked_at,listed FROM supplier_discovery WHERE supplier='dinamik'"),
  ]);
  return { items: items.rows[0], scopes: scopes.rows[0], runs: runs.rows[0], recent: recent.rows, failing: failing.rows, discovery: discovery.rows[0] ?? null };
}

export const supplierFeedCompanies = (): Record<FeedSupplier, string> => ({ basbug: process.env.BASBUG_FIRMA_ADI || "BASBUG", dinamik: DINAMIK_COMPANY, seta: setaCompany });

/** Freshness of each API feed, evaluated without the scheduler (sidebar, dashboard and supplier pages share it). */
export async function adminSupplierFeedStatus() {
  await requireAdmin();
  const scopes = await supplierFeedScopes(db, supplierFeedCompanies());
  const now = new Date();
  return {
    basbug: evaluateFeed(scopes.basbug, now, Boolean(process.env.BASBUG_BASE_URL)),
    dinamik: evaluateFeed(scopes.dinamik, now, Boolean(process.env.DINAMIK_BASE)),
    seta: evaluateFeed(scopes.seta, now, Boolean(process.env.SETA_API_KEY)),
  };
}

export type SupplierFeedMetrics = { present: number; priced: number; unstocked: number; available: number; saleable: number; conflicting: number; dropped: number };
export type SupplierFeedAttempts = { total: number; succeeded: number; failed: number; rejected: number; unresolved: number };

/** Everything the supplier overview shows: feed status, catalog coverage per supplier, 24h attempts, scheduler state. */
export async function adminSupplierFeeds() {
  await requireAdmin();
  const companies = supplierFeedCompanies();
  const keys = ["basbug", "dinamik", "seta", "manual"] as const;
  const pairs = [companies.basbug, companies.dinamik, companies.seta, manualCompany];
  const [status, metrics, attempts, scheduler] = await Promise.all([
    adminSupplierFeedStatus(),
    // "Priced" and "unstocked" read what the supplier sent (Dinamik prices products missing from its stock list, and
    // commerce_catalog leaves those out); "in stock" and "saleable" read commerce_catalog, i.e. what the store shows.
    db.query<SupplierFeedMetrics & { supplier: string }>(`SELECT i.supplier,count(*) FILTER (WHERE i.presence='present')::int AS present,
        count(*) FILTER (WHERE i.presence='present' AND i.price_data IS NOT NULL)::int AS priced,
        count(*) FILTER (WHERE i.presence='present' AND i.stock_data IS NULL)::int AS unstocked,
        count(c.id) FILTER (WHERE i.presence='present' AND c.available)::int AS available,
        count(c.id) FILTER (WHERE i.presence='present' AND c.available AND c.price_kurus IS NOT NULL)::int AS saleable,
        count(*) FILTER (WHERE i.presence='present' AND i.conflicting)::int AS conflicting,
        count(*) FILTER (WHERE i.presence='pending_missing')::int AS dropped
      FROM supplier_items i LEFT JOIN commerce_catalog c ON c.id=i.id
      WHERE (i.supplier,i.company) IN (('basbug',$1),('dinamik',$2),('seta',$3),('manual',$4)) GROUP BY i.supplier`, pairs),
    // A failed attempt is unresolved only while its scope has not succeeded since.
    db.query<SupplierFeedAttempts & { supplier: string }>(`SELECT r.supplier,count(*)::int AS total,count(*) FILTER (WHERE r.status='succeeded')::int AS succeeded,
        count(*) FILTER (WHERE r.status='failed')::int AS failed,count(*) FILTER (WHERE r.status='rejected')::int AS rejected,
        count(DISTINCT r.list_group) FILTER (WHERE r.status IN ('failed','rejected') AND NOT EXISTS (SELECT 1 FROM supplier_imports n
          WHERE n.supplier=r.supplier AND n.company=r.company AND n.list_group=r.list_group AND n.warehouse=r.warehouse
          AND n.status='succeeded' AND n.started_at>r.started_at))::int AS unresolved
      FROM supplier_imports r WHERE r.started_at>now()-interval '24 hours'
        AND (r.supplier,r.company) IN (('basbug',$1),('dinamik',$2),('seta',$3),('manual',$4)) GROUP BY r.supplier`, pairs),
    supplierSchedulerState(db),
  ]);
  const empty = { present: 0, priced: 0, unstocked: 0, available: 0, saleable: 0, conflicting: 0, dropped: 0 };
  const none = { total: 0, succeeded: 0, failed: 0, rejected: 0, unresolved: 0 };
  const pick = <T,>(rows: (T & { supplier: string })[], fallback: T) =>
    Object.fromEntries(keys.map(key => [key, rows.find(row => row.supplier === key) ?? fallback])) as Record<(typeof keys)[number], T>;
  return { status, metrics: pick(metrics.rows, empty), attempts: pick(attempts.rows, none), scheduler };
}

// Scopes the manual "refresh" buttons run, in order. Dinamik has ~800 brands, so only the ones without a successful run
// in the last day are offered (the oldest first); Başbuğ's 15 groups and SETA's single list always run in full.
export async function adminSupplierRefreshPlan() {
  await requireAdmin();
  const basbugCompany = process.env.BASBUG_FIRMA_ADI || "BASBUG";
  const [basbug, dinamik] = await Promise.all([
    db.query<{ list_group: string }>("SELECT list_group FROM supplier_sync_scopes WHERE supplier='basbug' AND company=$1 AND warehouse='MRK' ORDER BY list_group", [basbugCompany]),
    db.query<{ list_group: string; enabled: boolean; stale: boolean }>(`SELECT list_group,enabled,(last_success_at IS NULL OR last_success_at<now()-interval '24 hours') AS stale
      FROM supplier_sync_scopes WHERE supplier='dinamik' ORDER BY last_success_at NULLS FIRST,list_group`),
  ]);
  const enabled = dinamik.rows.filter(row => row.enabled);
  return {
    basbug: basbug.rows.map(row => row.list_group),
    seta: Boolean(process.env.SETA_API_KEY),
    dinamikBrands: enabled.map(row => row.list_group).sort((a, b) => a.localeCompare(b, "tr")),
    dinamikStale: enabled.filter(row => row.stale).map(row => row.list_group),
  };
}
