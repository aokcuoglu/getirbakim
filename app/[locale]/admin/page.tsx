import { AdminLayout } from '@/components/admin/admin-layout'
import { QuickActions } from '@/components/admin/quick-actions'
import { StatsCards } from '@/components/admin/stats-cards'
import { SalesReport } from '@/components/admin/sales-report'
import { RecentOrdersWidget } from '@/components/admin/recent-orders-widget'
import { ActivityFeed } from '@/components/admin/activity-feed'
import { getAdminDashboardData } from '@/lib/actions/admin-products'

export default async function AdminPage() {
  const data = await getAdminDashboardData()

  return (
    <AdminLayout>
      <div className="space-y-6">
        
        {/* Header */}
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Genel Bakış</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Mağaza performansınız ve son aktiviteler
            </p>
          </div>
        </div>

        {/* Stats Cards */}
        <StatsCards metrics={data.metrics} />

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Sales Report - Spans 2 columns */}
          <div className="lg:col-span-2">
            <SalesReport salesSeries={data.salesSeries} failedSyncRate={data.metrics.failedSyncRate} />
          </div>
          
          {/* Activity Feed */}
          <div>
            <ActivityFeed activities={[]} />
          </div>
        </div>

        {/* Quick Actions */}
        <QuickActions />

        {/* Recent Orders */}
        <RecentOrdersWidget orders={data.recentOrders} />
        
      </div>
    </AdminLayout>
  )
}
