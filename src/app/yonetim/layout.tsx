import "@/styles/supplier-admin.css";
import "@/styles/admin-workspace.css";
import { AdminNav } from "@/components/admin/admin-nav";
import { requireAdmin } from "@/modules/auth/session";

// The site header comes from the root layout; this only adds the workspace navigation.
// Every page and data loader still checks the session itself: layouts do not re-run on client navigation.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return <div className="admin-workspace"><div className="shell admin-shell">
    <aside className="admin-sidebar"><AdminNav/></aside>
    <div className="admin-content">{children}</div>
  </div></div>;
}
