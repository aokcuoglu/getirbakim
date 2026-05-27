import { AdminSurface } from '@/components/admin/admin-page-shell'
import { Skeleton } from '@/components/ui/skeleton'

interface AdminTablePageSkeletonProps {
  kpiCount?: number
  rowCount?: number
  columnCount?: number
}

export function AdminTablePageSkeleton({
  kpiCount = 4,
  rowCount = 8,
  columnCount = 5
}: AdminTablePageSkeletonProps) {
  return (
    <div
      className="space-y-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Yükleniyor"
    >
      {kpiCount > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: kpiCount }).map((_, index) => (
            <div
              key={`kpi-${index}`}
              className="rounded-lg border border-border bg-card p-3 shadow-sm"
            >
              <Skeleton className="mb-2 h-3.5 w-24" />
              <Skeleton className="h-7 w-16" />
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-10 w-full max-w-sm" />
        <Skeleton className="h-10 w-28" />
        <Skeleton className="h-10 w-28" />
      </div>

      <AdminSurface className="overflow-hidden p-0">
        <div className="border-b border-border px-4 py-3">
          <div className="flex gap-6">
            {Array.from({ length: columnCount }).map((_, index) => (
              <Skeleton key={`head-${index}`} className="h-4 w-24" />
            ))}
          </div>
        </div>
        {Array.from({ length: rowCount }).map((_, rowIndex) => (
          <div
            key={`row-${rowIndex}`}
            className="flex gap-6 border-b border-border px-4 py-3 last:border-0"
          >
            {Array.from({ length: columnCount }).map((_, colIndex) => (
              <Skeleton
                key={`cell-${rowIndex}-${colIndex}`}
                className="h-4 flex-1"
              />
            ))}
          </div>
        ))}
      </AdminSurface>
    </div>
  )
}
