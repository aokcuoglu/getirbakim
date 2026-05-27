import { AdminSurface } from '@/components/admin/admin-page-shell'
import { Skeleton } from '@/components/ui/skeleton'

export function AdminDashboardSkeleton() {
  return (
    <div
      className="space-y-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Yükleniyor"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <AdminSurface key={`stat-${index}`} className="p-4">
            <Skeleton className="mb-2 h-3.5 w-24" />
            <Skeleton className="h-8 w-20" />
          </AdminSurface>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <AdminSurface className="min-h-[280px] p-4 lg:col-span-2">
          <Skeleton className="mb-4 h-5 w-32" />
          <Skeleton className="h-[220px] w-full" />
        </AdminSurface>
        <AdminSurface className="min-h-[280px] p-4">
          <Skeleton className="mb-4 h-5 w-28" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={`alert-${index}`} className="h-12 w-full" />
            ))}
          </div>
        </AdminSurface>
      </div>

      <AdminSurface className="p-4">
        <Skeleton className="mb-4 h-5 w-36" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={`order-${index}`} className="h-10 w-full" />
          ))}
        </div>
      </AdminSurface>
    </div>
  )
}
