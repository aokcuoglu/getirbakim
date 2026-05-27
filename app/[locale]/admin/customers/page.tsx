import { Suspense } from 'react'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { AdminTablePageSkeleton } from '@/components/admin/admin-table-page-skeleton'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { CustomersAdminContent } from './_components/CustomersAdminContent'

export default async function AdminCustomersPage(props: {
  searchParams: Promise<{
    q?: string
    role?: string
    page?: string
    limit?: string
  }>
}) {
  const searchParams = await props.searchParams

  return (
    <AdminPageShell>
      <AdminPageHeader
        title="Müşteri Operasyonu"
        description="Müşteri listesini yönetin, rolleri güncelleyin ve müşteri detaylarını inceleyin."
        breadcrumbs={getAdminBreadcrumbs('/admin/customers')}
      />
      <Suspense fallback={<AdminTablePageSkeleton kpiCount={0} />}>
        <CustomersAdminContent searchParams={searchParams} />
      </Suspense>
    </AdminPageShell>
  )
}
