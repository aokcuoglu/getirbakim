import { Skeleton } from '@/components/ui/skeleton'

export function GridProductCardSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
      <Skeleton className="h-36 w-full rounded-md" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    </div>
  )
}
