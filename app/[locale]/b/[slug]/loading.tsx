import { Skeleton } from '@/components/ui/skeleton'
import { BrandPageProductsSkeleton } from './_components/BrandPageProductsSkeleton'

export default function BrandPageLoading() {
  return (
    <>
      <section className="border-b border-border bg-background">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <nav className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Skeleton className="h-4 w-16" />
            <span>/</span>
            <Skeleton className="h-4 w-32" />
          </nav>

          <div className="flex items-center gap-4">
            <Skeleton className="h-14 w-32 shrink-0 rounded-sm" />
            <Skeleton className="h-8 w-64 sm:h-9" />
          </div>
          <Skeleton className="mt-2 h-4 w-full max-w-xl" />
        </div>
      </section>

      <BrandPageProductsSkeleton />
    </>
  )
}
