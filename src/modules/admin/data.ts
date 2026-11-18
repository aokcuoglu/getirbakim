import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import { pickKey, sortOrder } from "@/lib/table-sort";
import { manualCompany, setaCompany } from "@/modules/suppliers/storefront-sources";
import { DINAMIK_COMPANY, DINAMIK_WAREHOUSE } from "@/modules/suppliers/dinamik-import";
import { evaluateFeed, supplierFeedScopes, supplierSchedulerState, type FeedSupplier } from "@/modules/suppliers/data-status";
import type { CommerceOrder } from "@/modules/store/orders";
import type { RefundStatus, ReversalKind } from "@/modules/payments/refund-rules";
import { restockDueCount } from "./restock";
import { installmentSettings } from "@/modules/payments/installment-settings";
import { procurementOpenSql, type AdminOrderLine } from "./order-procurement";
import { supplierRunHistoryLimit } from "@/modules/suppliers/run-status";

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

/** Service applications waiting for approval (the dashboard list). */
export async function adminOverview() {
  await requireAdmin();
  const accounts = await db.query<ServiceAccount>(`SELECT ${serviceColumns} FROM accounts WHERE role='service' AND NOT approved ORDER BY name`);
  return { accounts: accounts.rows };
}

export async function adminServiceAccounts() {
  await requireAdmin();
  return (await db.query<ServiceAccount>(`SELECT ${serviceColumns} FROM accounts WHERE role='service' ORDER BY name`)).rows;
}

export async function adminPricing() {
  await requireAdmin();
  const [settings, latest, installments] = await Promise.all([
    db.query<PricingSettings>("SELECT markup_percent,vat_percent,max_age_hours,shipping_fee_kurus,free_shipping_threshold_kurus FROM commerce_settings WHERE id=true"),
    db.query<CurrencySnapshot>("SELECT currencies_data,completed_at FROM supplier_imports WHERE supplier='basbug' AND company=$1 AND status='succeeded' ORDER BY completed_at DESC,id DESC LIMIT 1", [process.env.BASBUG_FIRMA_ADI || "BASBUG"]),
    installmentSettings(),
  ]);
  if (!settings.rows[0]) throw new Error("Satış ayarları bulunamadı.");
  return { settings: settings.rows[0], latest: latest.rows[0], rates: latest.rows[0]?.currencies_data.dovizListesi ?? [], installments };
}

type AdminPayment = { id: string; provider_order_id: string; status: string; amount_kurus: number; bank_reference: string | null; paid_at: string | null; installment_count: number | null };
/** TAMI void/refund calls of an order (#619), oldest first. */
export type AdminRefund = {
  id: string; payment_id: string; provider_order_id: string; kind: ReversalKind; status: RefundStatus; amount_kurus: number;
  bank_reference: string | null; error_code: string | null; error_message: string | null; requested_at: string; completed_at: string | null;
};

/** Latest Geliver label request of an order (#960); null when none was made. */
export type AdminGeliverShipment = {
  id: string; status: "requested" | "purchased" | "failed" | "unknown"; test: boolean; barcode: string | null; label_url: string | null;
  tracking_status_code: string | null; tracking_sub_status_code: string | null; tracking_status_details: string | null; tracking_location: string | null;
  tracking_status_at: string | null; error_code: string | null; error_message: string | null; requested_at: string;
};

export const orderFilters = {
  all: { label: "Tümü", where: "true" },
  action: { label: "Teyit bekleyen", where: "o.status='pending' AND o.payment_status IN ('paid','none')" },
  shipping: { label: "Kargoya verilecek", where: "o.status='confirmed'" },
  refund: { label: "İade bekleyen", where: "o.payment_status='refund_required'" },
  awaiting_payment: { label: "Ödeme bekleyen", where: "o.status='awaiting_payment'" },
  shipped: { label: "Kargoda", where: "o.status='shipped'" },
  delivered: { label: "Teslim edildi", where: "o.status='delivered'" },
  cancelled: { label: "İptal", where: "o.status='cancelled'" },
} as const;
export type OrderFilter = keyof typeof orderFilters;
// Header sorting on the orders list (TableHead sortKey → column).
const orderSorts = { created: "o.created_at", customer: "o.customer_name", total: "o.total_kurus" };

/** Checkout consent evidence (#604); null on orders placed before it was recorded. */
type OrderAgreementSummary = { agreement_at: Date | null; agreement_ip: string | null; agreement_user_agent: string | null; agreement_version: string | null };
// The orders list's "Tedarik" column filter (#606); the tab counts stay unfiltered.
const procurementFilters = {
  all: "true",
  open: procurementOpenSql,
  done: `o.status IN ('pending','confirmed') AND NOT (${procurementOpenSql})`,
};
export type ProcurementFilter = keyof typeof procurementFilters;
export async function adminOrders(rawPage?: string, rawFilter?: string, sort: { sort?: string; dir?: string } = {}, rawProcurement?: string) {
  await requireAdmin();
  const requested = Number(rawPage);
  const page = Number.isSafeInteger(requested) ? Math.max(1, Math.min(10000, requested)) : 1;
  const filter: OrderFilter = pickKey(orderFilters, rawFilter, "all");
  const procurement: ProcurementFilter = pickKey(procurementFilters, rawProcurement, "all");
  const [orders, counts] = await Promise.all([db.query<CommerceOrder & { payments: AdminPayment[]; refunds: AdminRefund[]; lines: AdminOrderLine[]; geliver: AdminGeliverShipment | null } & OrderAgreementSummary>(
    `SELECT o.id,o.number,o.owner_kind,o.owner_id,o.customer_name,o.email,o.phone,o.address,o.note,o.total_kurus,o.subtotal_kurus,o.shipping_kurus,
     o.discount_percent,o.status,o.created_at,o.payment_status,o.payment_due_at,o.paid_at,o.payment_note,o.refund_reference,o.refunded_at,
     o.carrier,o.carrier_name,o.tracking_no,o.tracking_url,o.shipped_at,o.delivered_at,o.cancelled_by,o.cancelled_at,o.installment_count,o.installment_fee_kurus,
     o.delivery_province,o.delivery_district,o.delivery_address_line,o.delivery_postal_code,o.invoice_type,o.invoice_company,o.invoice_tax_no,o.invoice_tax_office,
     o.invoice_province,o.invoice_district,o.invoice_address_line,o.invoice_postal_code,
     a.accepted_at AS agreement_at,a.ip AS agreement_ip,a.user_agent AS agreement_user_agent,a.legal_version AS agreement_version,
     COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'provider_order_id',p.provider_order_id,'status',p.status,'amount_kurus',p.amount_kurus,
      'bank_reference',p.bank_reference,'paid_at',p.paid_at,'installment_count',p.installment_count) ORDER BY p.created_at) FROM commerce_payments p WHERE p.order_id=o.id),'[]') AS payments,
     COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'payment_id',r.payment_id,'provider_order_id',p.provider_order_id,'kind',r.kind,'status',r.status,
      'amount_kurus',r.amount_kurus,'bank_reference',r.bank_reference,'error_code',r.error_code,'error_message',r.error_message,
      'requested_at',r.requested_at,'completed_at',r.completed_at) ORDER BY r.requested_at,r.id)
      FROM commerce_payment_refunds r JOIN commerce_payments p ON p.id=r.payment_id WHERE r.order_id=o.id),'[]') AS refunds,
     -- Lines with what operations need to procure them (#606): supplier scope and cost live in pricing_snapshot.
     COALESCE((SELECT jsonb_agg(jsonb_build_object('product_id',i.product_id,'code',i.code,'name',i.name,'supplier',i.supplier,'quantity',i.quantity,
      'unit_price_kurus',i.unit_price_kurus,'pricing_snapshot',i.pricing_snapshot,'procurement_status',i.procurement_status,'procurement_ref',i.procurement_ref,
      'procurement_ordered_at',i.procurement_ordered_at,'procured_at',i.procured_at,'supplier_item',si.id IS NOT NULL,'master_id',ps.product_id) ORDER BY i.code,i.product_id)
      FROM commerce_order_items i LEFT JOIN supplier_items si ON si.id=i.product_id LEFT JOIN product_sources ps ON ps.supplier_item_id=i.product_id
      WHERE i.order_id=o.id),'[]') AS lines,
     (SELECT jsonb_build_object('id',g.id,'status',g.status,'test',g.test,'barcode',g.barcode,'label_url',g.label_url,'tracking_status_code',g.tracking_status_code,
      'tracking_sub_status_code',g.tracking_sub_status_code,'tracking_status_details',g.tracking_status_details,'tracking_location',g.tracking_location,
      'tracking_status_at',g.tracking_status_at,'error_code',g.error_code,'error_message',g.error_message,'requested_at',g.requested_at)
      FROM commerce_geliver_shipments g WHERE g.order_id=o.id ORDER BY g.requested_at DESC,g.id DESC LIMIT 1) AS geliver
     FROM commerce_orders o LEFT JOIN commerce_order_agreements a ON a.order_id=o.id WHERE ${orderFilters[filter].where} AND ${procurementFilters[procurement]} ORDER BY ${sortOrder(sort, orderSorts, "o.created_at DESC,o.id DESC")} LIMIT 51 OFFSET $1`,
    [(page - 1) * 50],
  ), db.query<Record<OrderFilter, number>>(`SELECT ${Object.entries(orderFilters).map(([key, f]) => `count(*) FILTER (WHERE ${f.where})::int AS ${key}`).join(",")} FROM commerce_orders o`)]);
  return { orders: orders.rows, page, filter, procurement, counts: counts.rows[0] };
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

type DashboardDay = { day: string; orders: number };
// Admin-wide figures that walk a large table and move slowly (no per-user content). Reused for up to a minute;
// after that the next request waits for a fresh read, so a long-idle panel never shows day-old numbers.
function ttlMemo<T>(ttlMs: number, load: () => Promise<T>) {
  let cached: { value: Promise<T>; at: number } | null = null;
  return () => {
    if (cached && Date.now() - cached.at <= ttlMs) return cached.value;
    const entry = { value: load(), at: Date.now() };
    cached = entry;
    // A failed read is not reused: the next request tries again.
    entry.value.catch(() => { if (cached === entry) cached = null; });
    return entry.value;
  };
}
const basbugPresentItems = ttlMemo(60_000, async () =>
  (await db.query<{ items: number }>("SELECT count(*)::int AS items FROM supplier_items WHERE supplier='basbug' AND presence='present'")).rows[0]);
const enrichmentStatusCounts = ttlMemo(60_000, async () =>
  (await db.query<{ status: string; count: number }>("SELECT status,count(*)::int AS count FROM product_enrichment_jobs GROUP BY status")).rows);

export async function adminDashboard() {
  await requireAdmin();
  const [orders, days, recent, catalog, enrichment, imports, brands] = await Promise.all([
    db.query<{ action: number; shipping: number; refund: number; awaiting_payment: number; revenue_30d: string; paid_30d: number; revenue_prev_30d: string }>(`SELECT
      count(*) FILTER (WHERE ${orderFilters.action.where})::int AS action,
      count(*) FILTER (WHERE ${orderFilters.shipping.where})::int AS shipping,
      count(*) FILTER (WHERE ${orderFilters.refund.where})::int AS refund,
      count(*) FILTER (WHERE ${orderFilters.awaiting_payment.where})::int AS awaiting_payment,
      COALESCE(sum(total_kurus) FILTER (WHERE paid_at>=now()-interval '30 days' AND payment_status='paid'),0) AS revenue_30d,
      count(*) FILTER (WHERE paid_at>=now()-interval '30 days' AND payment_status='paid')::int AS paid_30d,
      COALESCE(sum(total_kurus) FILTER (WHERE paid_at>=now()-interval '60 days' AND paid_at<now()-interval '30 days' AND payment_status='paid'),0) AS revenue_prev_30d
      FROM commerce_orders o`),
    // An Istanbul calendar day as a created_at range, so commerce_orders_created_idx is used instead of a full scan.
    db.query<DashboardDay>(`SELECT to_char(d.day,'YYYY-MM-DD') AS day,count(o.id)::int AS orders
      FROM (SELECT (now() AT TIME ZONE 'Europe/Istanbul')::date-n AS day FROM generate_series(13,0,-1) n) d
      LEFT JOIN commerce_orders o ON o.created_at>=d.day::timestamp AT TIME ZONE 'Europe/Istanbul' AND o.created_at<(d.day+1)::timestamp AT TIME ZONE 'Europe/Istanbul'
      GROUP BY d.day ORDER BY d.day`),
    db.query<Pick<CommerceOrder, "id" | "number" | "customer_name" | "total_kurus" | "status" | "payment_status" | "created_at">>(
      "SELECT id,number,customer_name,total_kurus,status,payment_status,created_at FROM commerce_orders ORDER BY created_at DESC,id DESC LIMIT 6"),
    basbugPresentItems(),
    enrichmentStatusCounts(),
    db.query<{ status: string; started_at: Date; completed_at: Date | null; list_group: string; run_kind: string }>(
      "SELECT status,started_at,completed_at,list_group,run_kind FROM supplier_imports WHERE supplier='basbug' ORDER BY started_at DESC LIMIT 1"),
    db.query<{ pending: number; fresh: number }>(`SELECT (${pendingBrandsSql}) AS pending,
      (SELECT count(*)::int FROM (SELECT brand_id FROM supplier_brands GROUP BY brand_id HAVING bool_and(method='auto')) b) AS fresh`),
  ]);
  return { orders: orders.rows[0], days: days.rows, recent: recent.rows, catalog, enrichment, lastImport: imports.rows[0] ?? null, brands: brands.rows[0] };
}

type FitmentReturnRow = { level: string; lines: number; returned: number; not_fit: number };
/** Compatibility level at checkout against returns, for orders that were not cancelled. */
export async function fitmentReturnReport() {
  await requireAdmin();
  return (await db.query<FitmentReturnRow>(
    `SELECT COALESCE(i.fitment_level,'unrecorded') AS level,count(*)::integer AS lines,
     count(*) FILTER (WHERE r.quantity>0)::integer AS returned,count(*) FILTER (WHERE r.not_fit>0)::integer AS not_fit
     FROM commerce_order_items i JOIN commerce_orders o ON o.id=i.order_id
     LEFT JOIN LATERAL (SELECT sum(quantity) AS quantity,sum(quantity) FILTER (WHERE reason='not_fit') AS not_fit
      FROM commerce_returns WHERE order_id=i.order_id AND product_id=i.product_id) r ON true
     WHERE o.status IN ('pending','confirmed','shipped','delivered') GROUP BY 1 ORDER BY 2 DESC`,
  )).rows;
}

type OrderReturn = { id: string; product_id: string; quantity: number; reason: string; note: string; created_at: Date };
export async function orderReturns(orderId: string) {
  await requireAdmin();
  return (await db.query<OrderReturn>("SELECT id,product_id,quantity,reason,note,created_at FROM commerce_returns WHERE order_id=$1 ORDER BY created_at", [orderId])).rows;
}

/** Light-weight Başbuğ figures for the integrations overview; the full browser lives in modules/admin/basbug.ts. */
type DinamikRun = { id: string; run_kind: string; warehouse: string; review_note: string | null; list_group: string; status: string; error_reason: string | null; started_at: Date; completed_at: Date | null; stats: Record<string, number>; quality: { uniqueProducts?: number; missingPrices?: number; duplicateCodes?: number; conflictingCodes?: number; stockRows?: number; priceRows?: number } };
/** Dinamik figures: one scope per brand, stock + price lists fetched by the shared supplier scheduler. */
export async function adminDinamikOverview() {
  await requireAdmin();
  const [items, scopes, runs, recent, lastSucceeded, failing, discovery] = await Promise.all([
    // Brands are counted as groups of one hash aggregate: count(DISTINCT) sorted ~940k rows on disk (#502). Scope rows are
    // not a substitute, they include brands that have no current item.
    db.query<{ present: number; available: number; priced: number; conflicting: number; brands: number }>(`SELECT COALESCE(sum(present),0)::int AS present,
      COALESCE(sum(available),0)::int AS available,COALESCE(sum(priced),0)::int AS priced,COALESCE(sum(conflicting),0)::int AS conflicting,count(*)::int AS brands
      FROM (SELECT list_group,count(*) AS present,count(*) FILTER (WHERE stock_data::text LIKE '%"VAR"%') AS available,
        count(*) FILTER (WHERE price_data->>'fiyat' IS NOT NULL) AS priced,count(*) FILTER (WHERE conflicting) AS conflicting
        FROM supplier_items WHERE supplier='dinamik' AND company=$1 AND warehouse=$2 AND presence='present' GROUP BY list_group) brands`,
      [DINAMIK_COMPANY, DINAMIK_WAREHOUSE]),
    db.query<{ enabled: number; synced: number; failing: number; due: number; last_success: Date | null; oldest_success: Date | null }>(`SELECT count(*) FILTER (WHERE enabled)::int AS enabled,
      count(*) FILTER (WHERE enabled AND last_success_at IS NOT NULL)::int AS synced,count(*) FILTER (WHERE enabled AND consecutive_failures>0)::int AS failing,
      count(*) FILTER (WHERE enabled AND next_run_at<=now())::int AS due,max(last_success_at) AS last_success,min(last_success_at) FILTER (WHERE enabled) AS oldest_success
      FROM supplier_sync_scopes WHERE supplier='dinamik'`),
    db.query<{ total: number; failed: number }>(`SELECT count(*)::int AS total,count(*) FILTER (WHERE status IN ('failed','rejected'))::int AS failed
      FROM supplier_imports WHERE supplier='dinamik' AND started_at>now()-interval '24 hours'`),
    db.query<DinamikRun>(`SELECT id,run_kind,warehouse,review_note,list_group,status,error_reason,started_at,completed_at,stats,quality FROM supplier_imports
      WHERE supplier='dinamik' ORDER BY started_at DESC,id DESC LIMIT $1`, [supplierRunHistoryLimit]),
    db.query<DinamikRun>(`SELECT id,run_kind,warehouse,review_note,list_group,status,error_reason,started_at,completed_at,stats,quality FROM supplier_imports
      WHERE supplier='dinamik' AND status='succeeded' ORDER BY completed_at DESC,id DESC LIMIT 1`),
    db.query<{ list_group: string; consecutive_failures: number; next_run_at: Date; error_reason: string | null }>(`SELECT s.list_group,s.consecutive_failures,s.next_run_at,r.error_reason
      FROM supplier_sync_scopes s LEFT JOIN LATERAL (SELECT error_reason FROM supplier_imports i WHERE i.supplier=s.supplier AND i.company=s.company
        AND i.list_group=s.list_group AND i.warehouse=s.warehouse ORDER BY started_at DESC,id DESC LIMIT 1) r ON true
      WHERE s.supplier='dinamik' AND s.enabled AND s.consecutive_failures>0 ORDER BY s.consecutive_failures DESC,s.list_group LIMIT 20`),
    db.query<{ checked_at: Date; listed: number }>("SELECT checked_at,listed FROM supplier_discovery WHERE supplier='dinamik'"),
  ]);
  return { items: items.rows[0], scopes: scopes.rows[0], runs: runs.rows[0], recent: recent.rows, lastSucceeded: lastSucceeded.rows[0] ?? null, failing: failing.rows, discovery: discovery.rows[0] ?? null };
}

const supplierFeedCompanies = (): Record<FeedSupplier, string> => ({ basbug: process.env.BASBUG_FIRMA_ADI || "BASBUG", dinamik: DINAMIK_COMPANY, seta: setaCompany });

/** Freshness of each API feed, evaluated without the scheduler (sidebar, dashboard and supplier pages share it). */
export const adminSupplierFeedStatus = cache(async () => {
  await requireAdmin();
  const scopes = await supplierFeedScopes(db, supplierFeedCompanies());
  const now = new Date();
  return {
    basbug: evaluateFeed(scopes.basbug, now, Boolean(process.env.BASBUG_BASE_URL)),
    dinamik: evaluateFeed(scopes.dinamik, now, Boolean(process.env.DINAMIK_BASE)),
    seta: evaluateFeed(scopes.seta, now, Boolean(process.env.SETA_API_KEY)),
  };
});

type SupplierFeedMetrics = { present: number; priced: number; unstocked: number; conflicting: number };
type SupplierCatalogMetrics = { available: number; saleable: number };
type SupplierFeedAttempts = { total: number; succeeded: number; failed: number; rejected: number; unresolved: number };

const apiFeedKeys = ["basbug", "dinamik", "seta"] as const;
const pickBySupplier = <K extends string, T>(keys: readonly K[], rows: (T & { supplier: string })[], fallback: T) =>
  Object.fromEntries(keys.map(key => [key, rows.find(row => row.supplier === key) ?? fallback])) as Record<K, T>;

/** Feed status, what each API supplier sent and the 24h attempts of the supplier overview; the manual list's figures come
 * from adminManualLists and the store-side figures from adminSupplierCatalogMetrics, which the page streams. */
export async function adminSupplierFeeds() {
  await requireAdmin();
  const companies = supplierFeedCompanies();
  const pairs = [companies.basbug, companies.dinamik, companies.seta];
  const [status, metrics, attempts, scheduler] = await Promise.all([
    adminSupplierFeedStatus(),
    // What the supplier sent: Dinamik prices products missing from its stock list, and commerce_catalog leaves those out.
    db.query<SupplierFeedMetrics & { supplier: string }>(`SELECT supplier,count(*)::int AS present,
        count(*) FILTER (WHERE price_data IS NOT NULL)::int AS priced,count(*) FILTER (WHERE stock_data IS NULL)::int AS unstocked,
        count(*) FILTER (WHERE conflicting)::int AS conflicting
      FROM supplier_items WHERE (supplier,company) IN (('basbug',$1),('dinamik',$2),('seta',$3)) AND presence='present' GROUP BY supplier`, pairs),
    // A failed attempt is unresolved only while its scope has not succeeded since.
    db.query<SupplierFeedAttempts & { supplier: string }>(`SELECT r.supplier,count(*)::int AS total,count(*) FILTER (WHERE r.status='succeeded')::int AS succeeded,
        count(*) FILTER (WHERE r.status='failed')::int AS failed,count(*) FILTER (WHERE r.status='rejected')::int AS rejected,
        count(DISTINCT r.list_group) FILTER (WHERE r.status IN ('failed','rejected') AND NOT EXISTS (SELECT 1 FROM supplier_imports n
          WHERE n.supplier=r.supplier AND n.company=r.company AND n.list_group=r.list_group AND n.warehouse=r.warehouse
          AND n.status='succeeded' AND n.started_at>r.started_at))::int AS unresolved
      FROM supplier_imports r WHERE r.started_at>now()-interval '24 hours'
        AND (r.supplier,r.company) IN (('basbug',$1),('dinamik',$2),('seta',$3)) GROUP BY r.supplier`, pairs),
    supplierSchedulerState(db),
  ]);
  return {
    status, scheduler,
    metrics: pickBySupplier(apiFeedKeys, metrics.rows, { present: 0, priced: 0, unstocked: 0, conflicting: 0 }),
    attempts: pickBySupplier(apiFeedKeys, attempts.rows, { total: 0, succeeded: 0, failed: 0, rejected: 0, unresolved: 0 }),
  };
}

/** What the store shows of each supplier ("in stock", "saleable"): commerce_catalog prices every row, so this takes
 * seconds and the overview streams it. Its supplier rows are exactly the present supplier_items it accepts. */
export const adminSupplierCatalogMetrics = cache(async () => {
  await requireAdmin();
  const companies = supplierFeedCompanies();
  const { rows } = await db.query<SupplierCatalogMetrics & { supplier: string }>(`SELECT supplier,count(*) FILTER (WHERE available)::int AS available,
      count(*) FILTER (WHERE available AND price_kurus IS NOT NULL)::int AS saleable
    FROM commerce_catalog WHERE (supplier,company) IN (('basbug',$1),('dinamik',$2),('seta',$3),('manual',$4)) GROUP BY supplier`,
  [companies.basbug, companies.dinamik, companies.seta, manualCompany]);
  return pickBySupplier([...apiFeedKeys, "manual"], rows, { available: 0, saleable: 0 });
});

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
