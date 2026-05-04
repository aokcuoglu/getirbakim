import { Skeleton } from '@/components/ui/skeleton'
import { GridProductGridSkeleton } from './_components/GridProductCardSkeleton'

export default function CategoryPageLoading() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Breadcrumb skeleton */}
      <div className="bg-white border-b border-slate-200 py-4 px-6">
        <div className="max-w-7xl mx-auto flex items-center gap-2">
          <Skeleton className="h-4 w-16" />
          <span className="text-slate-300">/</span>
          <Skeleton className="h-4 w-24" />
          <span className="text-slate-300">/</span>
          <Skeleton className="h-4 w-32" />
        </div>
      </div>

      <main className="flex-1 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-8">
          {/* Category title */}
          <Skeleton className="h-8 w-64 mb-6" />

          <div className="flex gap-6">
            {/* Sidebar filters */}
            <div className="hidden lg:block w-64 shrink-0 space-y-4">
              <Skeleton className="h-6 w-20 mb-3" />
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
              <Skeleton className="h-6 w-20 mt-6 mb-3" />
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>

            {/* Product grid */}
            <div className="flex-1">
              {/* Toolbar */}
              <div className="flex items-center justify-between mb-4">
                <Skeleton className="h-5 w-32" />
                <div className="flex items-center gap-2">
                  <Skeleton className="h-9 w-32" />
                  <Skeleton className="h-9 w-9" />
                </div>
              </div>

              <GridProductGridSkeleton count={12} />
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
