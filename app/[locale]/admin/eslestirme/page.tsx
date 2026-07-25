import { Suspense } from 'react'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { AdminTablePageSkeleton } from '@/components/admin/admin-table-page-skeleton'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { EslestirmeContent } from './_components/EslestirmeContent'

export const dynamic = 'force-dynamic'

export default async function AdminEslestirmePage() {
  return (
    <AdminPageShell width="wide">
      <AdminPageHeader
        title="Eşleştirme"
        description="Dinamik ve Başbuğ firmalarının marka ve ürün eşleştirmelerini yönetin."
        breadcrumbs={getAdminBreadcrumbs('/admin/eslestirme')}
      />
      <Suspense fallback={<AdminTablePageSkeleton kpiCount={4} />}>
        <EslestirmeContent />
      </Suspense>
    </AdminPageShell>
  )
}
