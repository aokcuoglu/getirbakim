import { Suspense } from 'react'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { AdminTablePageSkeleton } from '@/components/admin/admin-table-page-skeleton'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { SuppliersAdminContent } from './_components/SuppliersAdminContent'

export default async function AdminSuppliersPage() {
  return (
    <AdminPageShell width="wide">
      <AdminPageHeader
        title="Tedarikçi Entegrasyon Merkezi"
        description="Dinamik ve Başbuğ tedarikçi entegrasyonlarını buradan yönetin; API senkronu, katalog metrikleri ve eşleştirme akışına hızlı erişim."
        breadcrumbs={getAdminBreadcrumbs('/admin/suppliers')}
      />
      <Suspense fallback={<AdminTablePageSkeleton kpiCount={3} rowCount={4} columnCount={4} />}>
        <SuppliersAdminContent />
      </Suspense>
    </AdminPageShell>
  )
}
