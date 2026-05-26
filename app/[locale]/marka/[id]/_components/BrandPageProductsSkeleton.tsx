import { SearchSidebarSkeleton } from '@/components/search/SearchSidebarSkeleton'
import { ProductGridSkeleton } from '@/app/[locale]/[...slug]/_components/ProductCardSkeleton'
import { Skeleton } from '@/components/ui/skeleton'

export function BrandPageProductsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col lg:flex-row gap-5 xl:gap-6">
        <SearchSidebarSkeleton />
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center justify-end gap-2.5 border-b border-border pb-2.5">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Skeleton className="h-8 w-[156px] rounded-sm" />
              <Skeleton className="h-8 w-[68px] rounded-sm" />
              <Skeleton className="h-8 w-[68px] rounded-sm" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
          <ProductGridSkeleton count={6} />
        </div>
      </div>
    </div>
  )
}
