import { AdminLayout } from '@/components/admin/admin-layout'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { QuickActions } from '@/components/admin/quick-actions'
import { StatsCards } from '@/components/admin/stats-cards'
import { SalesReport } from '@/components/admin/sales-report'
import { RecentOrdersWidget } from '@/components/admin/recent-orders-widget'
import { DashboardAlerts } from '@/components/admin/dashboard-alerts'
import { getAdminDashboardData } from '@/lib/actions/admin-products'
import { Button } from '@/components/ui/button'
import { Link } from '@/lib/navigation'
import { Package, ShoppingCart } from 'lucide-react'

export default async function AdminPage() {
  const data = await getAdminDashboardData()

  return (
    <AdminLayout>
      <AdminPageShell width="wide">
        <AdminPageHeader
          eyebrow="Yönetim Paneli"
          title="Genel Bakış"
          description="Mağaza performansı, operasyon uyarıları ve son siparişler"
          actions={
            <>
              <Button variant="outline" size="sm" asChild>
                <Link href="/admin/products">
                  <Package className="mr-2 h-4 w-4" />
                  Ürünler
                </Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/admin/orders">
                  <ShoppingCart className="mr-2 h-4 w-4" />
                  Siparişler
                </Link>
              </Button>
            </>
          }
        />

        <StatsCards metrics={data.metrics} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <SalesReport
              salesSeries={data.salesSeries}
              failedSyncRate={data.metrics.failedSyncRate}
            />
          </div>
          <DashboardAlerts
            alerts={data.alerts}
            failedSyncRate={data.metrics.failedSyncRate}
          />
        </div>

        <QuickActions />

        <RecentOrdersWidget orders={data.recentOrders} />
      </AdminPageShell>
    </AdminLayout>
  )
}
