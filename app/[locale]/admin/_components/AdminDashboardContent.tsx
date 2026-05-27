import { QuickActions } from '@/components/admin/quick-actions'
import { StatsCards } from '@/components/admin/stats-cards'
import { SalesReport } from '@/components/admin/sales-report'
import { RecentOrdersWidget } from '@/components/admin/recent-orders-widget'
import { DashboardAlerts } from '@/components/admin/dashboard-alerts'
import { getAdminDashboardData } from '@/lib/actions/admin-products'

export async function AdminDashboardContent() {
  const data = await getAdminDashboardData()

  return (
    <>
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
    </>
  )
}
