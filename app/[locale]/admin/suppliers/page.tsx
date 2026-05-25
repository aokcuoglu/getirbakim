import { AdminLayout } from '@/components/admin/admin-layout'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { getSuppliersHubOverview } from '@/lib/admin/suppliers-hub-stats'
import { SuppliersHubClient } from './_components/SuppliersHubClient'

export default async function AdminSuppliersPage() {
  const overview = await getSuppliersHubOverview()

  return (
    <AdminLayout>
      <AdminPageShell width="wide">
        <AdminPageHeader
          title="Tedarikçi Entegrasyon Merkezi"
          description="Dinamik ve ParçaTedarik tedarikçi entegrasyonlarını buradan yönetin; API senkronu, katalog metrikleri ve eşleştirme akışına hızlı erişim."
          breadcrumbs={getAdminBreadcrumbs('/admin/suppliers')}
        />
        <SuppliersHubClient overview={overview} />
      </AdminPageShell>
    </AdminLayout>
  )
}
