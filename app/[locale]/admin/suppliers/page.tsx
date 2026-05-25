import { AdminLayout } from '@/components/admin/admin-layout'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { getSuppliersHubOverview } from '@/lib/admin/suppliers-hub-stats'
import { SuppliersHubClient } from './_components/SuppliersHubClient'

export default async function AdminSuppliersPage() {
  const overview = await getSuppliersHubOverview()

  return (
    <AdminLayout>
      <AdminPageShell width="wide">
        <AdminPageHeader
          title="Tedarikçi Entegrasyon Merkezi"
          description="Dinamik, ParçaTedarik ve planlanan Başbuğ kaynaklarından gelen API verisini yönetin; eşleştirme ekranını besleyen marka ve ürün hatlarını buradan takip edin."
          eyebrow="Tedarikçi operasyonları"
        />
        <SuppliersHubClient overview={overview} />
      </AdminPageShell>
    </AdminLayout>
  )
}
