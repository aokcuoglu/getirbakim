import { Skeleton } from '@/components/ui/skeleton'

export function GridProductCardSkeleton() {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col h-full">
      {/* Header - Brand Logos */}
      <div className="flex items-center gap-2 p-4 pb-0">
        <Skeleton className="w-7 h-7 rounded-full" />
        <Skeleton className="h-7 w-20" />
      </div>

      {/* Product Image */}
      <div className="w-full aspect-square flex items-center justify-center p-4">
        <Skeleton className="w-full h-full max-h-48 rounded-lg" />
      </div>

      {/* Content */}
      <div className="p-4 pt-0 flex-1 flex flex-col">
        {/* Title */}
        <Skeleton className="h-5 w-full mb-1" />
        <Skeleton className="h-5 w-3/4 mb-2" />

        {/* Badges */}
        <div className="flex items-center gap-2 mb-2">
          <Skeleton className="h-5 w-24 rounded" />
          <Skeleton className="h-4 w-16" />
        </div>

        {/* EAN */}
        <Skeleton className="h-4 w-40 mb-1" />

        {/* Properties */}
        <div className="space-y-1 mb-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-28" />
        </div>

        {/* Show all link */}
        <Skeleton className="h-4 w-16 mb-3" />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Dispatch Info */}
        <Skeleton className="h-4 w-48 mb-3" />

        {/* Price Section */}
        <div className="pt-3 border-t border-slate-100">
          <div className="flex items-baseline gap-2 mb-1">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-4 w-10" />
          </div>
          <Skeleton className="h-3 w-40 mb-3" />

          {/* Quantity + Add to Cart */}
          <div className="flex items-center gap-2">
            <Skeleton className="h-10 w-16 rounded" />
            <Skeleton className="h-10 flex-1 rounded-lg" />
          </div>

          {/* Compare */}
          <Skeleton className="h-4 w-32 mt-3" />
        </div>
      </div>
    </div>
  )
}

export function GridProductGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <GridProductCardSkeleton key={i} />
      ))}
    </div>
  )
}
