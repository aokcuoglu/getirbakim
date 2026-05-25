import { AdminLayout } from '@/components/admin/admin-layout'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { getAdminCustomers } from '@/lib/actions/admin-customers'
import { CustomersAdminClient } from './_components/CustomersAdminClient'

export default async function AdminCustomersPage(props: {
  searchParams: Promise<{
    q?: string
    role?: string
    page?: string
    limit?: string
  }>
}) {
  const searchParams = await props.searchParams

  const data = await getAdminCustomers({
    q: searchParams.q,
    role: searchParams.role as 'all' | 'ADMIN' | 'CUSTOMER' | undefined,
    page: searchParams.page ? Number(searchParams.page) : 1,
    limit: searchParams.limit ? Number(searchParams.limit) : 20
  })

  return (
    <AdminLayout>
      <AdminPageShell>
        <AdminPageHeader
          title="Müşteri Operasyonu"
          description="Müşteri listesini yönetin, rolleri güncelleyin ve müşteri detaylarını inceleyin."
          breadcrumbs={getAdminBreadcrumbs('/admin/customers')}
        />
        <CustomersAdminClient data={data} />
      </AdminPageShell>
    </AdminLayout>
  )
}
