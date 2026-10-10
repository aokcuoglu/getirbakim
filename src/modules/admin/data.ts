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

export async function adminOrders(rawPage?: string) {
  await requireAdmin();
  const requested = Number(rawPage);
  const page = Number.isSafeInteger(requested) ? Math.max(1, Math.min(10000, requested)) : 1;
  const orders = (await db.query<CommerceOrder & { payments: AdminPayment[] }>(
    `SELECT o.id,o.number,o.owner_kind,o.owner_id,o.customer_name,o.email,o.phone,o.address,o.note,o.total_kurus,o.subtotal_kurus,o.shipping_kurus,
     o.discount_percent,o.status,o.created_at,o.payment_status,o.payment_due_at,o.paid_at,o.payment_note,o.refund_reference,
     COALESCE((SELECT jsonb_agg(jsonb_build_object('provider_order_id',p.provider_order_id,'status',p.status,'amount_kurus',p.amount_kurus,
      'bank_reference',p.bank_reference,'paid_at',p.paid_at) ORDER BY p.created_at) FROM commerce_payments p WHERE p.order_id=o.id),'[]') AS payments
     FROM commerce_orders o ORDER BY o.created_at DESC,o.id DESC LIMIT 51 OFFSET $1`,
    [(page - 1) * 50],
  )).rows;
  return { orders, page };
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
