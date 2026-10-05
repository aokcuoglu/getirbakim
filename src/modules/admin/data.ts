import "server-only";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import type { CommerceOrder } from "@/modules/store/orders";

type ServiceAccount = {
  id: string; name: string; email: string; approved: boolean; discount_percent: number;
  contact_name: string | null; phone: string | null; city: string | null;
};
type PricingSettings = { markup_percent: string; vat_percent: string; max_age_hours: number };
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
    db.query<PricingSettings>("SELECT markup_percent,vat_percent,max_age_hours FROM commerce_settings WHERE id=true"),
    db.query<CurrencySnapshot>("SELECT currencies_data,completed_at FROM supplier_imports WHERE supplier='basbug' AND company=$1 AND status='succeeded' ORDER BY completed_at DESC,id DESC LIMIT 1", [process.env.BASBUG_FIRMA_ADI || "BASBUG"]),
  ]);
  if (!settings.rows[0]) throw new Error("Satış ayarları bulunamadı.");
  return { settings: settings.rows[0], latest: latest.rows[0], rates: latest.rows[0]?.currencies_data.dovizListesi ?? [] };
}

export async function adminOrders(rawPage?: string) {
  await requireAdmin();
  const requested = Number(rawPage);
  const page = Number.isSafeInteger(requested) ? Math.max(1, Math.min(10000, requested)) : 1;
  const orders = (await db.query<CommerceOrder>(
    "SELECT id,number,owner_kind,owner_id,customer_name,email,phone,address,note,total_kurus,discount_percent,status,created_at FROM commerce_orders ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET $1",
    [(page - 1) * 50],
  )).rows;
  return { orders, page };
}
