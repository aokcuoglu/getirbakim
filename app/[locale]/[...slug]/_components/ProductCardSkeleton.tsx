import { Skeleton } from '@/components/ui/skeleton'

export function ProductCardSkeleton() {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex gap-5">
        {/* Left Side - Brand Logo + Image */}
        <div className="flex flex-col items-start gap-4 shrink-0">
          {/* Brand Logos Row */}
          <div className="flex items-center gap-2">
            <Skeleton className="w-7 h-7 rounded-full" />
            <Skeleton className="h-7 w-20" />
          </div>

          {/* Product Image */}
          <Skeleton className="w-44 h-36 rounded-lg" />
        </div>

        {/* Right Side - Details */}
        <div className="flex-1 min-w-0">
          {/* Title */}
          <Skeleton className="h-6 w-full mb-2" />
          <Skeleton className="h-6 w-3/4 mb-2" />

          {/* Badges */}
          <div className="flex items-center gap-2 mb-2">
            <Skeleton className="h-5 w-24 rounded" />
            <Skeleton className="h-5 w-20 rounded" />
          </div>

          {/* ID */}
          <Skeleton className="h-4 w-24 mb-3" />

          {/* Properties */}
          <div className="space-y-1.5 mb-4">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-4 w-36" />
          </div>

          {/* Price Section */}
          <div className="mt-4">
            <div className="flex items-baseline gap-2 mb-1">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-12" />
            </div>
            <Skeleton className="h-3 w-48 mb-4" />

            {/* Quantity + Add to Cart */}
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-16 rounded" />
              <Skeleton className="h-9 w-28 rounded" />
            </div>

            {/* Compare + Dispatch Info */}
            <div className="mt-4 space-y-2.5">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ProductGridSkeleton({ count = 24 }: { count?: number }) {
  return (
    <div className="grid gap-6">
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  )
}
