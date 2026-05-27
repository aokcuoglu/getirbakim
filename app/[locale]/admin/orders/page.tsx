import { Suspense } from 'react'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { OrdersAdminClient } from './_components/OrdersAdminClient'
import { AdminTablePageSkeleton } from '@/components/admin/admin-table-page-skeleton'
import { Button } from '@/components/ui/button'
import { Download, Plus } from 'lucide-react'
import { getAdminOrders } from '@/lib/actions/admin-orders'

export default async function AdminOrdersPage() {
  const initialData = await getAdminOrders({ page: 1, limit: 20 })

  return (
    <AdminPageShell>
      <AdminPageHeader
        title="Siparişler"
        description="Tüm siparişlerinizi buradan görüntüleyebilir ve yönetebilirsiniz."
        breadcrumbs={getAdminBreadcrumbs('/admin/orders')}
        actions={
          <>
            <Button size="default" aria-label="Yeni sipariş ekle">
              <Plus className="mr-2 h-4 w-4" />
              Sipariş Ekle
            </Button>
            <Button
              variant="outline"
              size="default"
              aria-label="Siparişleri dışa aktar"
            >
              <Download className="mr-2 h-4 w-4" />
              Dışa Aktar
            </Button>
          </>
        }
      />
      <Suspense fallback={<AdminTablePageSkeleton />}>
        <OrdersAdminClient initialData={initialData} />
      </Suspense>
    </AdminPageShell>
  )
}
