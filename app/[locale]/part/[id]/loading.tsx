import { Skeleton } from '@/components/ui/skeleton'
import { GridProductCardSkeleton } from '@/app/[locale]/[...slug]/_components/GridProductCardSkeleton'

export default function PartDetailLoading() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Navbar placeholder */}
      <div className="h-16 bg-background border-b border-border" />

      {/* Main Content */}
      <main className="flex-1 bg-muted">
        {/* Breadcrumb skeleton */}
        <div className="bg-background border-b border-border py-4 px-6">
          <div className="max-w-7xl mx-auto flex items-center gap-2">
            <Skeleton className="h-4 w-16" />
            <span className="text-muted-foreground/70">/</span>
            <Skeleton className="h-4 w-24" />
            <span className="text-muted-foreground/70">/</span>
            <Skeleton className="h-4 w-32" />
          </div>
        </div>

        {/* Main Product Section */}
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-8">
          <div className="bg-background rounded-xl shadow-sm border border-border p-4 md:p-6 lg:p-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
              {/* Left - Image Gallery Skeleton */}
              <div className="space-y-4">
                <Skeleton className="w-full aspect-square rounded-lg" />
                <div className="flex gap-2">
                  <Skeleton className="w-20 h-20 rounded-md" />
                  <Skeleton className="w-20 h-20 rounded-md" />
                  <Skeleton className="w-20 h-20 rounded-md" />
                  <Skeleton className="w-20 h-20 rounded-md" />
                </div>
              </div>

              {/* Right - Product Info Skeleton */}
              <div className="space-y-6">
                {/* Brand */}
                <div className="flex items-center gap-3">
                  <Skeleton className="w-8 h-8 rounded-full" />
                  <Skeleton className="h-8 w-32" />
                </div>

                {/* Title */}
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-3/4" />
                </div>

                {/* Badges */}
                <div className="flex gap-2">
                  <Skeleton className="h-6 w-24 rounded" />
                  <Skeleton className="h-6 w-20 rounded" />
                </div>

                {/* Properties */}
                <div className="space-y-3 py-4 border-y border-border">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-4 w-36" />
                </div>

                {/* Price */}
                <div className="space-y-2">
                  <Skeleton className="w-32" />
                  <Skeleton className="h-4 w-48" />
                </div>

                {/* Add to Cart */}
                <div className="flex gap-3">
                  <Skeleton className="h-12 w-20 rounded" />
                  <Skeleton className="h-12 flex-1 rounded" />
                </div>

                {/* Dispatch info */}
                <Skeleton className="h-4 w-56" />
              </div>
            </div>
          </div>

          {/* Tabs Skeleton */}
          <div className="mt-8 bg-background rounded-xl shadow-sm border border-border p-6">
            <div className="flex gap-4 border-b border-border pb-4 mb-6">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-32" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>

          {/* Related Products Skeleton */}
          <div className="mt-8">
            <Skeleton className="h-8 w-48 mb-6" />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <GridProductCardSkeleton key={i} />
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
