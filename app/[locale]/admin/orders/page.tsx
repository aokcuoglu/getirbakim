import { AdminLayout } from '@/components/admin/admin-layout'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { getAdminOrders } from '@/lib/actions/admin-orders'
import { OrdersAdminClient } from './_components/OrdersAdminClient'

export default async function AdminOrdersPage(props: {
  searchParams: Promise<{
    q?: string
    status?: string
    page?: string
    limit?: string
  }>
}) {
  const searchParams = await props.searchParams

  const data = await getAdminOrders({
    q: searchParams.q,
    status: searchParams.status as
      | 'all'
      | 'PENDING_PAYMENT'
      | 'PAID'
      | 'PAYMENT_FAILED'
      | 'PROCESSING'
      | 'SHIPPED'
      | 'COMPLETED'
      | 'CANCELLED'
      | 'REFUNDED'
      | undefined,
    page: searchParams.page ? Number(searchParams.page) : 1,
    limit: searchParams.limit ? Number(searchParams.limit) : 20
  })

  return (
    <AdminLayout>
      <AdminPageShell>
        <AdminPageHeader
          title="Sipariş Operasyonu"
          description="Siparişleri izleyin, durumlarını güncelleyin ve toplu operasyonları yönetin."
          eyebrow="Operasyon"
        />
        <OrdersAdminClient data={data} />
      </AdminPageShell>
    </AdminLayout>
  )
}
