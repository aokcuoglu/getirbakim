import { requireAdmin } from "@/modules/auth/session";
import { SupplierConnections } from "@/components/admin/supplier-connections";
import { AdminPage, AdminPageHeader, AdminPanel } from "@/components/admin/ui";

export default async function Suppliers() {
  await requireAdmin();
  return <AdminPage>
    <AdminPageHeader breadcrumbs={[{ label: "Yönetim", href: "/yonetim" }, { label: "Tedarikçiler" }]} eyebrow="Katalog" title="Tedarikçiler" description="Tedarikçi bağlantılarının durumu ve kaynak verileri."/>
    <AdminPanel title="Bağlantılar"><SupplierConnections/></AdminPanel>
  </AdminPage>;
}
