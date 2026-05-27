import { Suspense } from 'react'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { AdminTablePageSkeleton } from '@/components/admin/admin-table-page-skeleton'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { EslestirmeMainClient } from './_components/EslestirmeMainClient'

export default function EslestirmePage() {
  return (
    <AdminPageShell width="wide">
      <AdminPageHeader
        title="Eşleştirme Yönetimi"
        description="Dinamik markalarını ParçaTedarik üreticileriyle eşleştirin, ürün verilerini görüntüleyin ve model eşleştirmelerini yönetin."
        breadcrumbs={getAdminBreadcrumbs('/admin/eslestirme')}
      />
      <Suspense fallback={<AdminTablePageSkeleton kpiCount={0} rowCount={5} columnCount={4} />}>
        <EslestirmeMainClient />
      </Suspense>
    </AdminPageShell>
  )
}
