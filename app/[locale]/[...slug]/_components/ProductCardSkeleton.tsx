import { Skeleton } from '@/components/ui/skeleton'

export function ProductCardSkeleton() {
  return (
    <div className="flex gap-3 rounded-lg border border-border bg-background p-3">
      <Skeleton className="h-20 w-20 shrink-0 rounded-md" />
      <div className="flex flex-1 flex-col justify-center gap-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    </div>
  )
}
