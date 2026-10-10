import "@/styles/supplier-admin.css";
import "@/styles/admin-workspace.css";
import { AdminSidebar, type AdminNavStatus } from "@/components/admin/admin-nav";
import { requireAdmin } from "@/modules/auth/session";
import { adminNavCounts } from "@/modules/admin/data";
import { supplierHealth } from "@/modules/suppliers/health";
import { supplierStatuses } from "@/modules/suppliers/clients";
import { db } from "@/lib/db";

export const metadata = { title: "Yönetim | Getirbakim", robots: { index: false, follow: false } };

// The workspace replaces the storefront header and footer with its own shell (see StorefrontChrome).
// Every page and data loader still checks the session itself: layouts do not re-run on client navigation.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const account = await requireAdmin();
  const [counts, health] = await Promise.all([adminNavCounts(), supplierHealth(db, process.env.BASBUG_FIRMA_ADI || "BASBUG").catch(() => null)]);
  const dinamik = supplierStatuses().find(s => s.name === "Dinamik");
  const status: AdminNavStatus = {
    ...counts,
    basbug: !health ? "danger" : health.healthy ? "success" : "warning",
    dinamik: dinamik?.verified ? "success" : "neutral",
  };
  return <div className="admin-app admin-workspace">
    <AdminSidebar status={status} account={{ name: account.name, email: account.email }}/>
    <div className="admin-main"><div className="admin-content">{children}</div></div>
  </div>;
}
